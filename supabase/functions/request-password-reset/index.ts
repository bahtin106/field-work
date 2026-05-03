import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const PASSWORD_RESET_COOLDOWN_SECONDS = 60;
const inMemoryCooldownMap = (globalThis as any).__PWD_RESET_COOLDOWN_MAP__ || new Map<string, number>();
(globalThis as any).__PWD_RESET_COOLDOWN_MAP__ = inMemoryCooldownMap;

type ResetRequestBody = {
  email?: string;
};

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value: string): boolean {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function emailServiceHeaders(): Record<string, string> {
  const token = String(Deno.env.get('EMAIL_SERVER_API_TOKEN') || '').trim();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'X-Email-Server-Token': token } : {}),
  };
}

function getEmailServiceUrl(): string {
  const value = String(
    Deno.env.get('EMAIL_SERVICE_URL') ||
      Deno.env.get('EXPO_PUBLIC_EMAIL_SERVICE_URL') ||
      '',
  )
    .trim()
    .replace(/\/+$/, '');
  if (!value) throw new Error('EMAIL_SERVICE_URL is required');
  return value;
}

function generateTempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

function getClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL/PROJECT_URL or SUPABASE_SERVICE_ROLE_KEY/SERVICE_ROLE_KEY');
  }
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

export async function handleRequestPasswordReset(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }, 405);

  const forwardedFor = req.headers.get('x-forwarded-for') || '';
  const ipAddress = forwardedFor.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null;
  const userAgent = req.headers.get('user-agent') || null;
  let requestLogId: number | null = null;

  try {
    const body = (await req.json().catch(() => ({}))) as ResetRequestBody;
    const email = normalizeEmail(body?.email);
    if (!isValidEmail(email)) {
      return json({ ok: false, code: 'INVALID_EMAIL', message: 'Р’РІРµРґРёС‚Рµ РєРѕСЂСЂРµРєС‚РЅС‹Р№ e-mail' });
    }

    const nowMs = Date.now();
    const inMemoryUntil = Number(inMemoryCooldownMap.get(email) || 0);
    if (inMemoryUntil > nowMs) {
      const retryAfter = Math.max(1, Math.ceil((inMemoryUntil - nowMs) / 1000));
      return json({
        ok: false,
        code: 'RATE_LIMIT',
        message: 'РџРѕРІС‚РѕСЂРЅР°СЏ РѕС‚РїСЂР°РІРєР° РїРѕРєР° РЅРµРґРѕСЃС‚СѓРїРЅР°',
        retry_after_seconds: retryAfter,
      });
    }

    const admin = getClient();
    const { data: lastRequestRow } = await admin
      .from('password_reset_requests')
      .select('requested_at')
      .eq('email', email)
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastRequestedAt = lastRequestRow?.requested_at ? new Date(lastRequestRow.requested_at).getTime() : 0;
    const elapsedMs = Date.now() - (Number.isFinite(lastRequestedAt) ? lastRequestedAt : 0);
    const cooldownMs = PASSWORD_RESET_COOLDOWN_SECONDS * 1000;
    if (elapsedMs >= 0 && elapsedMs < cooldownMs) {
      const retryAfter = Math.max(1, Math.ceil((cooldownMs - elapsedMs) / 1000));
      inMemoryCooldownMap.set(email, Date.now() + retryAfter * 1000);
      await admin.from('password_reset_requests').insert({
        email,
        ip_address: ipAddress,
        user_agent: userAgent,
        status: 'rate_limited',
        error_message: `retry_after_${retryAfter}`,
      });
      return json({
        ok: false,
        code: 'RATE_LIMIT',
        message: 'РџРѕРІС‚РѕСЂРЅР°СЏ РѕС‚РїСЂР°РІРєР° РїРѕРєР° РЅРµРґРѕСЃС‚СѓРїРЅР°',
        retry_after_seconds: retryAfter,
      });
    }

    const { data: logRow, error: logInsertError } = await admin
      .from('password_reset_requests')
      .insert({
        email,
        ip_address: ipAddress,
        user_agent: userAgent,
        status: 'pending',
      })
      .select('id')
      .single();
    if (!logInsertError && logRow?.id != null) requestLogId = Number(logRow.id);
    inMemoryCooldownMap.set(email, Date.now() + PASSWORD_RESET_COOLDOWN_SECONDS * 1000);

    const { data: profileRows, error: profileError } = await admin
      .from('profiles')
      .select('id, first_name, last_name, email')
      .ilike('email', email)
      .limit(1);
    if (profileError) throw profileError;

    const profile = Array.isArray(profileRows) ? profileRows[0] : null;
    if (!profile?.id) {
      if (requestLogId != null) {
        await admin.from('password_reset_requests').update({ status: 'user_not_found' }).eq('id', requestLogId);
      }
      return json({ ok: true, cooldown_seconds: PASSWORD_RESET_COOLDOWN_SECONDS, message: 'If the e-mail is registered, a reset message will be sent.' });
    }

    const tempPassword = generateTempPassword();
    const { error: updateError } = await admin.auth.admin.updateUserById(String(profile.id), {
      password: tempPassword,
    });
    if (updateError) throw new Error(`Auth update failed: ${updateError.message}`);

    const emailServiceUrl = getEmailServiceUrl();
    const response = await fetch(`${emailServiceUrl}/send-email`, {
      method: 'POST',
      headers: emailServiceHeaders(),
      body: JSON.stringify({
        type: 'password-reset',
        email,
        firstName: String(profile?.first_name || '').trim(),
        lastName: String(profile?.last_name || '').trim(),
        tempPassword,
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`EMAIL_SEND_FAILED: ${text || String(response.status)}`);
    }

    try {
      await admin.rpc('upsert_password_change_log', {
        p_user_id: String(profile.id),
        p_changed_by: String(profile.id),
        p_ip_address: ipAddress,
        p_user_agent: userAgent,
        p_source: 'edge:request-password-reset',
        p_window_seconds: 180,
      });
    } catch {}

    if (requestLogId != null) {
      await admin
        .from('password_reset_requests')
        .update({ status: 'sent', user_id: String(profile.id), error_message: null })
        .eq('id', requestLogId);
    }

    return json({ ok: true, cooldown_seconds: PASSWORD_RESET_COOLDOWN_SECONDS, message: 'РџРёСЃСЊРјРѕ РѕС‚РїСЂР°РІР»РµРЅРѕ' });
  } catch (error) {
    const message = String((error as Error)?.message || 'Unknown error');
    try {
      if (requestLogId != null) {
        const admin = getClient();
        await admin
          .from('password_reset_requests')
          .update({ status: 'failed', error_message: message.slice(0, 500) })
          .eq('id', requestLogId);
      }
    } catch {}
    return json({
      ok: false,
      code: message.includes('EMAIL_SEND_FAILED') ? 'EMAIL_SEND_FAILED' : 'INTERNAL_ERROR',
      message: message.includes('EMAIL_SEND_FAILED')
        ? 'РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ РїРёСЃСЊРјРѕ. РћР±СЂР°С‚РёС‚РµСЃСЊ РІ РїРѕРґРґРµСЂР¶РєСѓ.'
        : 'РќРµ СѓРґР°Р»РѕСЃСЊ РІРѕСЃСЃС‚Р°РЅРѕРІРёС‚СЊ РїР°СЂРѕР»СЊ. РћР±СЂР°С‚РёС‚РµСЃСЊ РІ РїРѕРґРґРµСЂР¶РєСѓ.',
    });
  }
}
