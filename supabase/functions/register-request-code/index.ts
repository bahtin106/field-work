import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCOUNT_TYPES = new Set(['solo', 'company']);
const COMPANY_NAME_MAX_LENGTH = 64;

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const RATE_LIMIT_EMAIL_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_EMAIL_MAX_REQUESTS = 12;
const RATE_LIMIT_FINGERPRINT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_FINGERPRINT_MAX_REQUESTS = 30;
const REGISTER_CODE_TTL_FALLBACK_SECONDS = 10 * 60;
const BOT_PROTECTION_MODE = String(Deno.env.get('REGISTER_BOT_PROTECTION_MODE') || 'off')
  .trim()
  .toLowerCase(); // off | monitor | required | required_web
const TURNSTILE_SECRET_KEY = String(Deno.env.get('TURNSTILE_SECRET_KEY') || '').trim();

const state = globalThis as typeof globalThis & {
  __registerCodeRequestRateLimit?: Map<string, { count: number; windowStartMs: number }>;
  __registerCodeRequestEmailRateLimit?: Map<string, { count: number; windowStartMs: number }>;
  __registerCodeRequestFingerprintRateLimit?: Map<string, { count: number; windowStartMs: number }>;
};
const rateLimitStore = state.__registerCodeRequestRateLimit || new Map();
state.__registerCodeRequestRateLimit = rateLimitStore;
const emailRateLimitStore = state.__registerCodeRequestEmailRateLimit || new Map();
state.__registerCodeRequestEmailRateLimit = emailRateLimitStore;
const fingerprintRateLimitStore = state.__registerCodeRequestFingerprintRateLimit || new Map();
state.__registerCodeRequestFingerprintRateLimit = fingerprintRateLimitStore;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

async function isProfileEmailOwnedByAuthUser(
  supabaseAdmin: ReturnType<typeof createClient>,
  profile: { id?: string | null } | null,
  email: string,
) {
  const profileId = text(profile?.id);
  if (!profileId) return false;
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(profileId);
  if (error || !data?.user) return false;
  return normalizeEmail(data.user.email) === email;
}

async function listAuthUsersByEmail(
  supabaseAdmin: ReturnType<typeof createClient>,
  email: string,
) {
  const matches: any[] = [];
  let page = 1;
  const perPage = 200;

  for (let i = 0; i < 50; i += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error('EMAIL_CHECK_FAILED');

    const users = Array.isArray(data?.users) ? data.users : [];
    for (const user of users) {
      if (normalizeEmail(user?.email) === email) matches.push(user);
    }

    const total = Number(data?.total || 0);
    if (users.length < perPage || (total > 0 && page * perPage >= total)) break;
    page += 1;
  }

  return matches;
}

async function getAuthEmailState(
  supabaseAdmin: ReturnType<typeof createClient>,
  email: string,
) {
  const authUsers = await listAuthUsersByEmail(supabaseAdmin, email);
  const authUserIds = authUsers.map((user) => text(user?.id)).filter(Boolean);
  const profileIds = new Set<string>();

  if (authUserIds.length) {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .in('id', authUserIds);
    if (error) throw new Error('EMAIL_CHECK_FAILED');
    for (const row of Array.isArray(data) ? data : []) {
      const profileId = text(row?.id);
      if (profileId) profileIds.add(profileId);
    }
  }

  // Resume only this flow (including legacy self-registration), never invitations.
  const recoverableUsers = authUsers.filter((user) => {
    const userId = text(user?.id);
    const registrationSource = text(user?.user_metadata?.registration_source);
    const legacyAccountType = text(user?.user_metadata?.account_type);
    const isLegacyIncompleteRegistration =
      !registrationSource &&
      !user?.invited_at &&
      !user?.email_confirmed_at &&
      !user?.confirmed_at &&
      ACCOUNT_TYPES.has(legacyAccountType);
    return (
      !!userId &&
      !profileIds.has(userId) &&
      !user?.last_sign_in_at &&
      (registrationSource === 'edge_register_user' || isLegacyIncompleteRegistration)
    );
  });
  const recoverableIds = new Set(recoverableUsers.map((user) => text(user?.id)));
  const blockingUsers = authUsers.filter((user) => !recoverableIds.has(text(user?.id)));

  return { blockingUsers, recoverableUsers };
}

function normalizeCompanyName(value: unknown) {
  return text(value).replace(/\s+/g, ' ');
}

function getClientIp(req: Request) {
  const xff = text(req.headers.get('x-forwarded-for') || '');
  if (xff) return xff.split(',')[0].trim();
  const realIp = text(req.headers.get('x-real-ip') || '');
  if (realIp) return realIp;
  return 'unknown';
}

function checkRateLimit(clientIp: string) {
  const now = Date.now();
  const key = `register-code|${clientIp}`;
  const prev = rateLimitStore.get(key);
  if (!prev || now - prev.windowStartMs > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(key, { count: 1, windowStartMs: now });
    return true;
  }
  if (prev.count >= RATE_LIMIT_MAX_REQUESTS) return false;
  prev.count += 1;
  rateLimitStore.set(key, prev);
  return true;
}

function checkEmailRateLimit(email: string) {
  const now = Date.now();
  const key = `register-code-email|${email}`;
  const prev = emailRateLimitStore.get(key);
  if (!prev || now - prev.windowStartMs > RATE_LIMIT_EMAIL_WINDOW_MS) {
    emailRateLimitStore.set(key, { count: 1, windowStartMs: now });
    return true;
  }
  if (prev.count >= RATE_LIMIT_EMAIL_MAX_REQUESTS) return false;
  prev.count += 1;
  emailRateLimitStore.set(key, prev);
  return true;
}

function checkFingerprintRateLimit(fingerprint: string) {
  const now = Date.now();
  const key = `register-code-fingerprint|${fingerprint}`;
  const prev = fingerprintRateLimitStore.get(key);
  if (!prev || now - prev.windowStartMs > RATE_LIMIT_FINGERPRINT_WINDOW_MS) {
    fingerprintRateLimitStore.set(key, { count: 1, windowStartMs: now });
    return true;
  }
  if (prev.count >= RATE_LIMIT_FINGERPRINT_MAX_REQUESTS) return false;
  prev.count += 1;
  fingerprintRateLimitStore.set(key, prev);
  return true;
}

async function verifyTurnstileToken(token: string, clientIp: string) {
  if (!TURNSTILE_SECRET_KEY) return false;
  const payload = new URLSearchParams();
  payload.set('secret', TURNSTILE_SECRET_KEY);
  payload.set('response', token);
  if (clientIp && clientIp !== 'unknown') payload.set('remoteip', clientIp);

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: payload.toString(),
  });
  const body = await res.json().catch(() => ({}));
  return body?.success === true;
}

function getSupabaseAdminClient() {
  const url = Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL') || '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function getEmailServiceUrl() {
  const value = String(Deno.env.get('EMAIL_SERVICE_URL') || Deno.env.get('EXPO_PUBLIC_EMAIL_SERVICE_URL') || '')
    .trim()
    .replace(/\/+$/, '');
  if (!value) throw new Error('EMAIL_SERVICE_URL is required');
  return value;
}

function emailServiceHeaders() {
  const token = String(Deno.env.get('EMAIL_SERVER_API_TOKEN') || '').trim();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'X-Email-Server-Token': token } : {}),
  };
}

export async function handleRegisterRequestCode(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const clientIp = getClientIp(req);
    const body = await req.json().catch(() => ({}));
    const accountType = text(body?.account_type);
    const email = normalizeEmail(body?.email);
    const companyName = normalizeCompanyName(body?.company_name);
    const botToken = text(body?.bot_token);
    const clientFingerprint = text(body?.client_fingerprint || req.headers.get('x-client-fingerprint'));

    if (!ACCOUNT_TYPES.has(accountType)) {
      return json({ ok: false, code: 'INVALID_ACCOUNT_TYPE', message: 'Invalid account type' }, 400);
    }

    if (!email || !EMAIL_PATTERN.test(email)) {
      return json({ ok: false, code: 'INVALID_EMAIL', message: 'Invalid email' }, 400);
    }
    if (BOT_PROTECTION_MODE !== 'off') {
      const hasWebOrigin = text(req.headers.get('origin') || '') !== '';
      const challengeRequired =
        (BOT_PROTECTION_MODE === 'required' && hasWebOrigin) ||
        (BOT_PROTECTION_MODE === 'required_web' && hasWebOrigin);
      if (challengeRequired && !botToken) {
        return json({ ok: false, code: 'BOT_CHALLENGE_REQUIRED', message: 'Bot verification failed' }, 400);
      }
      const verified = await verifyTurnstileToken(botToken, clientIp);
      if (!verified && challengeRequired) {
        return json({ ok: false, code: 'BOT_CHALLENGE_REQUIRED', message: 'Bot verification failed' }, 400);
      }
    }

    if (!checkRateLimit(clientIp)) {
      return json({ ok: false, code: 'RATE_LIMITED', message: 'Too many requests' }, 429);
    }
    if (!checkEmailRateLimit(email)) {
      return json({ ok: false, code: 'RATE_LIMITED', message: 'Too many requests' }, 429);
    }
    if (clientFingerprint && !checkFingerprintRateLimit(clientFingerprint)) {
      return json({ ok: false, code: 'RATE_LIMITED', message: 'Too many requests' }, 429);
    }

    if (accountType === 'company') {
      if (!companyName) {
        return json({ ok: false, code: 'COMPANY_NAME_REQUIRED', message: 'Company name is required' }, 400);
      }
      if (companyName.length > COMPANY_NAME_MAX_LENGTH) {
        return json({ ok: false, code: 'COMPANY_NAME_TOO_LONG', message: 'Company name is too long' }, 400);
      }
    }

    const admin = getSupabaseAdminClient();

    let { data: existingProfile, error: profileErr } = await admin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .limit(1)
      .maybeSingle();

    if (profileErr) {
      return json({ ok: false, code: 'EMAIL_CHECK_FAILED', message: 'Email availability check failed' }, 400);
    }
    if (existingProfile) {
      if (await isProfileEmailOwnedByAuthUser(admin, existingProfile, email)) {
        return json({ ok: false, code: 'EMAIL_TAKEN', message: 'User with this email already exists' }, 409);
      }
      existingProfile = null;
    }

    let authEmailState;
    try {
      authEmailState = await getAuthEmailState(admin, email);
    } catch {
      return json({ ok: false, code: 'EMAIL_CHECK_FAILED', message: 'Email availability check failed' }, 400);
    }
    if (authEmailState.blockingUsers.length || authEmailState.recoverableUsers.length > 1) {
      return json({ ok: false, code: 'EMAIL_TAKEN', message: 'User with this email already exists' }, 409);
    }

    const emailServiceUrl = getEmailServiceUrl();
    const sendRes = await fetch(`${emailServiceUrl}/registration/send-code`, {
      method: 'POST',
      headers: emailServiceHeaders(),
      body: JSON.stringify({ email, purpose: 'register' }),
    });

    const sendPayload = await sendRes.json().catch(() => ({}));
    if (!sendRes.ok || sendPayload?.ok !== true) {
      const code = String(sendPayload?.code || 'SEND_FAILED').trim() || 'SEND_FAILED';
      const status = Number(sendRes.status || 500) || 500;
      if (status === 429 && code === 'RATE_LIMITED') {
        const retryAfterSeconds = Number(sendPayload?.retry_after_seconds || 60);
        const expiresInSeconds = Number(
          sendPayload?.expires_in_seconds || REGISTER_CODE_TTL_FALLBACK_SECONDS,
        );
        return json({
          ok: true,
          code: 'CODE_ALREADY_SENT',
          cooldown_seconds: Number.isFinite(retryAfterSeconds) ? Math.max(1, retryAfterSeconds) : 60,
          expires_in_seconds: Number.isFinite(expiresInSeconds)
            ? Math.max(1, expiresInSeconds)
            : REGISTER_CODE_TTL_FALLBACK_SECONDS,
        });
      }
      return json({
        ok: false,
        code,
        message: 'Failed to send verification code',
        retry_after_seconds: Number(sendPayload?.retry_after_seconds || 0) || undefined,
      }, status);
    }

    return json({
      ok: true,
      cooldown_seconds: Number(sendPayload?.cooldown_seconds || 60),
      expires_in_seconds: Number(sendPayload?.expires_in_seconds || REGISTER_CODE_TTL_FALLBACK_SECONDS),
    });
  } catch (error) {
    console.error('[register-request-code]', String((error as Error)?.message || error || 'Internal error'));
    return json({
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Internal error',
    }, 500);
  }
}

if (import.meta.main) {
  Deno.serve(handleRegisterRequestCode);
}
