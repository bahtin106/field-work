const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_PATTERN = /^\d{6}$/;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_IP = 40;
const RATE_LIMIT_EMAIL_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_EMAIL = 10;
const RATE_LIMIT_FINGERPRINT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_FINGERPRINT = 25;

const state = globalThis as typeof globalThis & {
  __registerVerifyIpRateLimit?: Map<string, { count: number; windowStartMs: number }>;
  __registerVerifyEmailRateLimit?: Map<string, { count: number; windowStartMs: number }>;
  __registerVerifyFingerprintRateLimit?: Map<string, { count: number; windowStartMs: number }>;
};
const ipRateLimitStore = state.__registerVerifyIpRateLimit || new Map();
state.__registerVerifyIpRateLimit = ipRateLimitStore;
const emailRateLimitStore = state.__registerVerifyEmailRateLimit || new Map();
state.__registerVerifyEmailRateLimit = emailRateLimitStore;
const fingerprintRateLimitStore = state.__registerVerifyFingerprintRateLimit || new Map();
state.__registerVerifyFingerprintRateLimit = fingerprintRateLimitStore;

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

function getClientIp(req: Request) {
  const xff = text(req.headers.get('x-forwarded-for') || '');
  if (xff) return xff.split(',')[0].trim();
  const realIp = text(req.headers.get('x-real-ip') || '');
  if (realIp) return realIp;
  return 'unknown';
}

function checkWindowLimit(
  store: Map<string, { count: number; windowStartMs: number }>,
  key: string,
  maxAllowed: number,
  windowMs: number,
) {
  const now = Date.now();
  const prev = store.get(key);
  if (!prev || now - prev.windowStartMs > windowMs) {
    store.set(key, { count: 1, windowStartMs: now });
    return true;
  }
  if (prev.count >= maxAllowed) return false;
  prev.count += 1;
  store.set(key, prev);
  return true;
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

export async function handleRegisterVerifyCode(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const email = normalizeEmail(body?.email);
    const code = text(body?.code);
    const clientIp = getClientIp(req);
    const clientFingerprint = text(body?.client_fingerprint || req.headers.get('x-client-fingerprint'));

    if (!checkWindowLimit(ipRateLimitStore, `verify-ip|${clientIp}`, RATE_LIMIT_MAX_IP, RATE_LIMIT_WINDOW_MS)) {
      return json({ ok: false, code: 'RATE_LIMITED', message: 'Too many requests' }, 429);
    }

    if (!email || !EMAIL_PATTERN.test(email)) {
      return json({ ok: false, code: 'INVALID_EMAIL', message: 'Invalid email' }, 400);
    }
    if (
      !checkWindowLimit(
        emailRateLimitStore,
        `verify-email|${email}`,
        RATE_LIMIT_MAX_EMAIL,
        RATE_LIMIT_EMAIL_WINDOW_MS,
      )
    ) {
      return json({ ok: false, code: 'RATE_LIMITED', message: 'Too many requests' }, 429);
    }
    if (
      clientFingerprint &&
      !checkWindowLimit(
        fingerprintRateLimitStore,
        `verify-fingerprint|${clientFingerprint}`,
        RATE_LIMIT_MAX_FINGERPRINT,
        RATE_LIMIT_FINGERPRINT_WINDOW_MS,
      )
    ) {
      return json({ ok: false, code: 'RATE_LIMITED', message: 'Too many requests' }, 429);
    }
    if (!CODE_PATTERN.test(code)) {
      return json({ ok: false, code: 'INVALID_CODE', message: 'Invalid code' }, 400);
    }

    const emailServiceUrl = getEmailServiceUrl();
    const verifyRes = await fetch(`${emailServiceUrl}/registration/verify-code`, {
      method: 'POST',
      headers: emailServiceHeaders(),
      body: JSON.stringify({ email, code, purpose: 'register' }),
    });

    const verifyPayload = await verifyRes.json().catch(() => ({}));
    if (!verifyRes.ok || verifyPayload?.ok !== true) {
      const code = String(verifyPayload?.code || 'VERIFY_FAILED').trim() || 'VERIFY_FAILED';
      const status = Number(verifyRes.status || 400) || 400;
      return json({ ok: false, code, message: 'Verification failed' }, status);
    }

    return json({
      ok: true,
      registration_token: String(verifyPayload?.registration_token || ''),
      expires_in_seconds: Number(verifyPayload?.expires_in_seconds || 1200),
    });
  } catch (error) {
    return json({
      ok: false,
      code: 'INTERNAL_ERROR',
      message: String((error as Error)?.message || 'Internal error'),
    }, 500);
  }
}

if (import.meta.main) {
  Deno.serve(handleRegisterVerifyCode);
}
