import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const SUPPORT_MESSAGE_MAX_LEN = 2000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_BY_IP = 12;
const RATE_LIMIT_EMAIL_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_BY_EMAIL = 5;
const RATE_LIMIT_FINGERPRINT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_BY_FINGERPRINT = 10;
const BOT_PROTECTION_MODE = String(Deno.env.get('PUBLIC_SUPPORT_BOT_PROTECTION_MODE') || 'off')
  .trim()
  .toLowerCase(); // off | monitor | required | required_web
const TURNSTILE_SECRET_KEY = String(Deno.env.get('TURNSTILE_SECRET_KEY') || '').trim();

const state = globalThis as typeof globalThis & {
  __publicSupportIpRateLimit?: Map<string, { count: number; windowStartMs: number }>;
  __publicSupportEmailRateLimit?: Map<string, { count: number; windowStartMs: number }>;
  __publicSupportFingerprintRateLimit?: Map<string, { count: number; windowStartMs: number }>;
};
const ipRateLimitStore = state.__publicSupportIpRateLimit || new Map();
state.__publicSupportIpRateLimit = ipRateLimitStore;
const emailRateLimitStore = state.__publicSupportEmailRateLimit || new Map();
state.__publicSupportEmailRateLimit = emailRateLimitStore;
const fingerprintRateLimitStore = state.__publicSupportFingerprintRateLimit || new Map();
state.__publicSupportFingerprintRateLimit = fingerprintRateLimitStore;

type SupportRequestBody = {
  email?: string;
  name?: string | null;
  message?: string;
  bot_token?: string | null;
  client_fingerprint?: string | null;
};

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function getClientIp(req: Request): string {
  const forwardedFor = normalizeText(req.headers.get('x-forwarded-for') || '');
  if (forwardedFor) return forwardedFor.split(',')[0].trim();
  const realIp = normalizeText(req.headers.get('x-real-ip') || '');
  if (realIp) return realIp;
  return 'unknown';
}

function checkBucket(
  store: Map<string, { count: number; windowStartMs: number }>,
  key: string,
  windowMs: number,
  maxRequests: number,
): boolean {
  const now = Date.now();
  const prev = store.get(key);
  if (!prev || now - prev.windowStartMs > windowMs) {
    store.set(key, { count: 1, windowStartMs: now });
    return true;
  }
  if (prev.count >= maxRequests) return false;
  prev.count += 1;
  store.set(key, prev);
  return true;
}

async function verifyTurnstileToken(token: string, clientIp: string): Promise<boolean> {
  if (!TURNSTILE_SECRET_KEY || !token) return false;
  const payload = new URLSearchParams();
  payload.set('secret', TURNSTILE_SECRET_KEY);
  payload.set('response', token);
  if (clientIp && clientIp !== 'unknown') payload.set('remoteip', clientIp);

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: payload.toString(),
  });
  const body = await response.json().catch(() => ({}));
  return body?.success === true;
}

function isValidEmail(value: string): boolean {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function getClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL/PROJECT_URL or SUPABASE_SERVICE_ROLE_KEY/SERVICE_ROLE_KEY');
  }
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

export async function handlePublicSupportRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as SupportRequestBody;
    const email = normalizeEmail(body?.email);
    const name = normalizeText(body?.name || '');
    const message = normalizeText(body?.message);
    const clientIp = getClientIp(req);
    const clientFingerprint = normalizeText(body?.client_fingerprint || req.headers.get('x-client-fingerprint'));
    const botToken = normalizeText(body?.bot_token);

    if (!isValidEmail(email)) {
      return json({ ok: false, code: 'INVALID_EMAIL', message: 'Введите корректный e-mail' });
    }
    if (!message) {
      return json({ ok: false, code: 'EMPTY_MESSAGE', message: 'Введите текст обращения' });
    }
    if (message.length > SUPPORT_MESSAGE_MAX_LEN) {
      return json({ ok: false, code: 'MESSAGE_TOO_LONG', message: 'Превышен лимит символов' });
    }

    const hasWebOrigin = normalizeText(req.headers.get('origin') || '') !== '';
    const challengeRequired =
      BOT_PROTECTION_MODE === 'required' ||
      (BOT_PROTECTION_MODE === 'required_web' && hasWebOrigin);
    if (BOT_PROTECTION_MODE !== 'off') {
      const verified = await verifyTurnstileToken(botToken, clientIp);
      if (!verified && challengeRequired) {
        return json({ ok: false, code: 'BOT_CHALLENGE_REQUIRED', message: 'Проверка безопасности не пройдена' }, 400);
      }
    }

    if (!checkBucket(ipRateLimitStore, `support-ip|${clientIp}`, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_BY_IP)) {
      return json({ ok: false, code: 'RATE_LIMITED', message: 'Слишком много запросов' }, 429);
    }
    if (!checkBucket(emailRateLimitStore, `support-email|${email}`, RATE_LIMIT_EMAIL_WINDOW_MS, RATE_LIMIT_MAX_BY_EMAIL)) {
      return json({ ok: false, code: 'RATE_LIMITED', message: 'Слишком много запросов' }, 429);
    }
    if (
      clientFingerprint &&
      !checkBucket(
        fingerprintRateLimitStore,
        `support-fingerprint|${clientFingerprint}`,
        RATE_LIMIT_FINGERPRINT_WINDOW_MS,
        RATE_LIMIT_MAX_BY_FINGERPRINT,
      )
    ) {
      return json({ ok: false, code: 'RATE_LIMITED', message: 'Слишком много запросов' }, 429);
    }

    const admin = getClient();
    const { error } = await admin.from('feedbacks').insert({
      text: message,
      user_id: null,
      company_id: null,
      contact: email,
      full_name: name || null,
    });
    if (error) throw error;

    return json({ ok: true, message: 'Обращение отправлено' });
  } catch (error) {
    console.error('[public-support-request]', String((error as Error)?.message || error || 'Unknown error'));
    return json({
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Не удалось отправить обращение',
    });
  }
}
