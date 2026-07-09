import { serve } from 'https://deno.land/std@0.210.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_PATTERN = /^\d{6}$/;
const CODE_TABLE = 'registration_email_codes';
const CODE_MAX_ATTEMPTS = 6;
const PURPOSE_OLD = 'email_change_old';
const PURPOSE_NEW = 'email_change_new';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: corsHeaders });
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeEmail(value: unknown) {
  return text(value).toLowerCase();
}

function isMissingColumn(error: any, column: string): boolean {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42703' && message.includes(column.toLowerCase());
}

function getBearerToken(req: Request): string {
  return String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
}

function getAdminClient() {
  const url = Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL') || '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';
  if (!url || !key) throw new Error('SERVER_MISCONFIGURED');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application': 'edge-change-email' } },
  });
}

function getEmailServiceUrl() {
  const value = String(Deno.env.get('EMAIL_SERVICE_URL') || Deno.env.get('EXPO_PUBLIC_EMAIL_SERVICE_URL') || '')
    .trim()
    .replace(/\/+$/, '');
  if (!value) throw new Error('EMAIL_SERVICE_UNAVAILABLE');
  return value;
}

function emailServiceHeaders() {
  const token = String(Deno.env.get('EMAIL_SERVER_API_TOKEN') || '').trim();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'X-Email-Server-Token': token } : {}),
  };
}

async function getActor(admin: any, req: Request) {
  const token = getBearerToken(req);
  if (!token) throw new Error('UNAUTHORIZED');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user?.id) throw new Error('UNAUTHORIZED');
  return data.user;
}

async function getProfileForAuthUser(admin: any, userId: string) {
  const tryBy = async (column: string, selectColumns: string) =>
    admin.from('profiles').select(selectColumns).eq(column, userId).limit(1).maybeSingle();

  const variants = ['id, user_id, email', 'id, email', 'id, user_id', 'id'];
  let userIdColumnAvailable = true;
  for (const columns of variants) {
    const byId = await tryBy('id', columns);
    if (!byId?.error && byId?.data) return byId.data;
    if (!byId?.error) break;
    if (isMissingColumn(byId.error, 'email')) continue;
    if (isMissingColumn(byId.error, 'user_id')) {
      userIdColumnAvailable = false;
      continue;
    }
    throw byId.error;
  }

  if (!userIdColumnAvailable) return null;
  for (const columns of variants) {
    if (!columns.includes('user_id')) continue;
    const byUserId = await tryBy('user_id', columns);
    if (!byUserId?.error && byUserId?.data) return byUserId.data;
    if (!byUserId?.error) break;
    if (isMissingColumn(byUserId.error, 'email')) continue;
    if (isMissingColumn(byUserId.error, 'user_id')) return null;
    throw byUserId.error;
  }
  return null;
}

function uniqueIds(values: unknown[]): string[] {
  return values
    .map((value) => text(value))
    .filter((value, index, arr) => !!value && arr.indexOf(value) === index);
}

async function listProfilesByEmail(admin: any, email: string) {
  const variants = ['id, user_id, email', 'id, email', 'id, user_id', 'id'];
  for (const columns of variants) {
    const { data, error } = await admin
      .from('profiles')
      .select(columns)
      .ilike('email', email)
      .limit(20);
    if (!error) {
      const rows = Array.isArray(data) ? data : [];
      return rows.filter((row: any) => {
        if (!Object.prototype.hasOwnProperty.call(row || {}, 'email')) return true;
        return normalizeEmail(row?.email) === email;
      });
    }
    if (isMissingColumn(error, 'email')) return [];
    if (isMissingColumn(error, 'user_id')) continue;
    throw new Error('EMAIL_CHECK_FAILED');
  }
  return [];
}

async function listAuthUsersByEmail(admin: any, email: string) {
  const authSchemaClient = typeof admin?.schema === 'function' ? admin.schema('auth') : null;
  if (authSchemaClient) {
    const { data, error } = await authSchemaClient.from('users').select('id, email').ilike('email', email).limit(20);
    if (!error) {
      return (Array.isArray(data) ? data : []).filter((row: any) => normalizeEmail(row?.email) === email);
    }
    const code = String(error?.code || '');
    const message = String(error?.message || '').toLowerCase();
    const schemaUnavailable =
      code === '42P01' ||
      code === '42501' ||
      code === 'PGRST106' ||
      message.includes('schema') ||
      message.includes('permission denied') ||
      message.includes('does not exist');
    if (!schemaUnavailable) throw new Error('EMAIL_CHECK_FAILED');
  }

  const matches: any[] = [];
  let page = 1;
  const perPage = 200;
  for (let i = 0; i < 50; i += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error('EMAIL_CHECK_FAILED');
    const users = Array.isArray(data?.users) ? data.users : [];
    users.forEach((user: any) => {
      if (normalizeEmail(user?.email) === email) matches.push(user);
    });
    const total = Number(data?.total || 0);
    if (users.length < perPage || (total > 0 && page * perPage >= total)) break;
    page += 1;
  }
  return matches;
}

async function isEmailTakenByOther(admin: any, email: string, ownIds: unknown[]) {
  const ownIdSet = new Set(uniqueIds(ownIds));
  const [profiles, authUsers] = await Promise.all([listProfilesByEmail(admin, email), listAuthUsersByEmail(admin, email)]);
  const profileTaken = profiles.some((row: any) => {
    const rowIds = uniqueIds([row?.id, row?.user_id]);
    if (!rowIds.length) return true;
    return !rowIds.some((id) => ownIdSet.has(id));
  });
  if (profileTaken) return true;

  return authUsers.some((user: any) => {
    const id = text(user?.id);
    return !!id && !ownIdSet.has(id);
  });
}

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function verifyStoredEmailCode(admin: any, email: string, purpose: string, code: string) {
  const { data, error } = await admin
    .from(CODE_TABLE)
    .select('email,purpose,code_hash,attempts,expires_at')
    .eq('email', email)
    .eq('purpose', purpose)
    .maybeSingle();
  if (error) throw new Error('CODE_CHECK_FAILED');
  if (!data) throw new Error('CODE_EXPIRED');

  const expiresAt = new Date(data.expires_at || 0).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    await admin.from(CODE_TABLE).delete().eq('email', email).eq('purpose', purpose);
    throw new Error('CODE_EXPIRED');
  }

  const nextAttempts = Number(data.attempts || 0) + 1;
  if ((await sha256Hex(code)) !== String(data.code_hash || '')) {
    if (nextAttempts >= CODE_MAX_ATTEMPTS) {
      await admin.from(CODE_TABLE).delete().eq('email', email).eq('purpose', purpose);
      throw new Error('TOO_MANY_ATTEMPTS');
    }
    await admin
      .from(CODE_TABLE)
      .update({ attempts: nextAttempts, updated_at: new Date().toISOString() })
      .eq('email', email)
      .eq('purpose', purpose);
    throw new Error('INVALID_CODE');
  }

  return true;
}

async function consumeStoredEmailCode(admin: any, email: string, purpose: string) {
  await admin.from(CODE_TABLE).delete().eq('email', email).eq('purpose', purpose);
}

async function sendCode(email: string, purpose: string) {
  const res = await fetch(`${getEmailServiceUrl()}/registration/send-code`, {
    method: 'POST',
    headers: emailServiceHeaders(),
    body: JSON.stringify({ email, purpose }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok !== true) {
    const code = text(payload?.code) || 'SEND_FAILED';
    if (code === 'RATE_LIMITED') {
      const retryAfter = Math.max(1, Number(payload?.retry_after_seconds) || 60);
      const err = new Error('RATE_LIMITED') as Error & { retryAfter?: number };
      err.retryAfter = retryAfter;
      throw err;
    }
    throw new Error('SEND_FAILED');
  }
  return {
    cooldown_seconds: Number(payload?.cooldown_seconds || 60),
    expires_in_seconds: Number(payload?.expires_in_seconds || 600),
  };
}

function publicError(error: unknown) {
  const code = text((error as any)?.message || error || 'INTERNAL_ERROR').toUpperCase();
  if (code === 'UNAUTHORIZED') return { status: 401, body: { ok: false, code } };
  if (code === 'INVALID_EMAIL' || code === 'SAME_EMAIL' || code === 'INVALID_CODE') return { status: 400, body: { ok: false, code } };
  if (code === 'EMAIL_TAKEN') return { status: 409, body: { ok: false, code } };
  if (code === 'CODE_EXPIRED') return { status: 400, body: { ok: false, code } };
  if (code === 'TOO_MANY_ATTEMPTS' || code === 'RATE_LIMITED') {
    return { status: 429, body: { ok: false, code, retry_after_seconds: Number((error as any)?.retryAfter || 0) || undefined } };
  }
  if (code === 'SEND_FAILED' || code === 'EMAIL_SERVICE_UNAVAILABLE') return { status: 503, body: { ok: false, code } };
  if (code === 'EMAIL_CHECK_FAILED' || code === 'CODE_CHECK_FAILED') return { status: 500, body: { ok: false, code } };
  console.error('[change-email]', text((error as Error)?.message || error));
  return { status: 500, body: { ok: false, code: 'INTERNAL_ERROR' } };
}

export async function handleChangeEmailRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const admin = getAdminClient();
    const actor = await getActor(admin, req);
    const profile = await getProfileForAuthUser(admin, String(actor.id));
    const profileId = text(profile?.id) || String(actor.id);
    const profileUserId = text(profile?.user_id);
    const currentEmail = normalizeEmail(actor.email || profile?.email);
    if (!currentEmail || !EMAIL_PATTERN.test(currentEmail)) throw new Error('UNAUTHORIZED');

    const body = await req.json().catch(() => ({}));
    const action = text(body?.action || 'request').toLowerCase();
    const newEmail = normalizeEmail(body?.new_email);
    if (!newEmail || !EMAIL_PATTERN.test(newEmail)) throw new Error('INVALID_EMAIL');
    if (newEmail === currentEmail) throw new Error('SAME_EMAIL');

    const ownIds = [actor.id, profileId, profileUserId];
    if (await isEmailTakenByOther(admin, newEmail, ownIds)) throw new Error('EMAIL_TAKEN');

    if (action === 'request') {
      const [oldSend, newSend] = await Promise.all([
        sendCode(currentEmail, PURPOSE_OLD),
        sendCode(newEmail, PURPOSE_NEW),
      ]);
      return json({
        ok: true,
        current_email: currentEmail,
        new_email: newEmail,
        cooldown_seconds: Math.max(Number(oldSend.cooldown_seconds || 0), Number(newSend.cooldown_seconds || 0), 60),
        expires_in_seconds: Math.min(Number(oldSend.expires_in_seconds || 600), Number(newSend.expires_in_seconds || 600)),
      });
    }

    if (action !== 'confirm') throw new Error('INVALID_ACTION');
    const currentCode = text(body?.current_code || body?.old_code);
    const newCode = text(body?.new_code);
    if (!CODE_PATTERN.test(currentCode) || !CODE_PATTERN.test(newCode)) throw new Error('INVALID_CODE');

    await verifyStoredEmailCode(admin, currentEmail, PURPOSE_OLD, currentCode);
    await verifyStoredEmailCode(admin, newEmail, PURPOSE_NEW, newCode);

    const { error: authError } = await admin.auth.admin.updateUserById(String(actor.id), {
      email: newEmail,
      email_confirm: true,
    } as any);
    if (authError) {
      if (/already|exists|registered/i.test(String(authError.message || ''))) throw new Error('EMAIL_TAKEN');
      throw authError;
    }

    if (profileId) {
      const { error: profileUpdateError } = await admin.from('profiles').update({ email: newEmail }).eq('id', profileId);
      if (profileUpdateError && !isMissingColumn(profileUpdateError, 'email')) {
        try {
          await admin.auth.admin.updateUserById(String(actor.id), { email: currentEmail, email_confirm: true } as any);
        } catch {}
        throw profileUpdateError;
      }
    }

    await Promise.allSettled([
      consumeStoredEmailCode(admin, currentEmail, PURPOSE_OLD),
      consumeStoredEmailCode(admin, newEmail, PURPOSE_NEW),
    ]);

    return json({ ok: true, current_email: currentEmail, new_email: newEmail });
  } catch (error) {
    const result = publicError(error);
    return json(result.body, result.status);
  }
}

if (import.meta.main) {
  serve(handleChangeEmailRequest);
}
