const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const allowedOrigins = String(process.env.EMAIL_SERVER_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS origin not allowed'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Email-Server-Token'],
}));
app.use(express.json());

const rateLimitBuckets = new Map();
const registrationCodeStore = new Map();
const registrationProofStore = new Map();
const REG_CODE_TABLE = String(process.env.REGISTRATION_CODE_TABLE || 'registration_email_codes').trim();
const REG_PROOF_TABLE = String(process.env.REGISTRATION_PROOF_TABLE || 'registration_email_proofs').trim();

const REG_CODE_TTL_MS = 10 * 60 * 1000;
const REG_CODE_RESEND_COOLDOWN_MS = 60 * 1000;
const REG_CODE_MAX_ATTEMPTS = 6;
const REG_PROOF_TTL_MS = 20 * 60 * 1000;

function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  return String(raw).trim().toLowerCase() === 'true';
}

function getRequestIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  return String(Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || req.ip || 'unknown')
    .split(',')[0]
    .trim();
}

function rateLimit(name, maxRequests, windowMs) {
  return (req, res, next) => {
    const key = `${name}:${getRequestIp(req)}`;
    const now = Date.now();
    const bucket = rateLimitBuckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (bucket.resetAt <= now) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }
    bucket.count += 1;
    rateLimitBuckets.set(key, bucket);
    if (bucket.count > maxRequests) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    return next();
  };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function isSafeHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function maskEmailForLog(value) {
  const email = normalizeEmail(value);
  const [name, domain] = email.split('@');
  if (!name || !domain) return '<invalid-email>';
  return `${name.slice(0, 2)}***@${domain}`;
}

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code || ''), 'utf8').digest('hex');
}

function generateSixDigitCode() {
  const value = crypto.randomInt(0, 1000000);
  return String(value).padStart(6, '0');
}

function generateProofToken() {
  return crypto.randomBytes(24).toString('hex');
}

function hashProofToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function getRegistrationCodeKey(email, purpose) {
  return `${normalizeEmail(email)}:${String(purpose || 'register').trim().toLowerCase()}`;
}

function dateToMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function cleanupRegistrationStores(now = Date.now()) {
  for (const [key, entry] of registrationCodeStore.entries()) {
    if (!entry || Number(entry.expiresAt || 0) <= now) {
      registrationCodeStore.delete(key);
    }
  }
  for (const [token, entry] of registrationProofStore.entries()) {
    if (!entry || Number(entry.expiresAt || 0) <= now || entry.consumed === true) {
      registrationProofStore.delete(token);
    }
  }
}

async function cleanupPersistentRegistrationStores(now = Date.now()) {
  const admin = getSupabaseAdminClient();
  if (!admin) return;
  const isoNow = new Date(now).toISOString();
  await Promise.allSettled([
    admin.from(REG_CODE_TABLE).delete().lte('expires_at', isoNow),
    admin.from(REG_PROOF_TABLE).delete().or(`expires_at.lte.${isoNow},consumed.eq.true`),
  ]);
}

let supabaseAdminClient = null;

function timingSafeStringEqual(left, right) {
  const leftBuf = Buffer.from(String(left || ''));
  const rightBuf = Buffer.from(String(right || ''));
  return leftBuf.length === rightBuf.length && crypto.timingSafeEqual(leftBuf, rightBuf);
}

function getConfiguredServerToken() {
  return String(process.env.EMAIL_SERVER_API_TOKEN || '').trim();
}

function getSuppliedServerToken(req) {
  return String(req.headers['x-email-server-token'] || req.headers.authorization || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
}

function hasValidServerToken(req) {
  const expected = String(process.env.EMAIL_SERVER_API_TOKEN || '').trim();
  if (!expected) return false;
  return timingSafeStringEqual(getSuppliedServerToken(req), expected);
}

function requireServerToken(req, res, next) {
  if (!getConfiguredServerToken()) {
    return res.status(503).json({ error: 'EMAIL_SERVER_API_TOKEN is required' });
  }
  if (hasValidServerToken(req)) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

function getBearerUserToken(req) {
  const raw = String(req.headers.authorization || '').trim();
  if (!/^Bearer\s+/i.test(raw)) return '';
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  const serverToken = getConfiguredServerToken();
  if (serverToken && timingSafeStringEqual(token, serverToken)) return '';
  return token;
}

function getSupabaseAdminClient() {
  if (supabaseAdminClient) return supabaseAdminClient;
  const url = resolveSupabaseBaseUrl(process.env.SUPABASE_URL);
  const key = String(
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  ).trim();
  if (!url || !key) return null;
  supabaseAdminClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return supabaseAdminClient;
}

async function loadPersistentRegistrationCode(email, purpose) {
  const admin = getSupabaseAdminClient();
  if (!admin) return null;
  const { data, error } = await admin
    .from(REG_CODE_TABLE)
    .select('email,purpose,code_hash,attempts,expires_at,cooldown_until,verified_at')
    .eq('email', normalizeEmail(email))
    .eq('purpose', String(purpose || 'register').trim().toLowerCase())
    .maybeSingle();
  if (error) {
    console.warn('[registration-code-store] load failed:', error.message || error);
    return null;
  }
  if (!data) return null;
  return {
    email: normalizeEmail(data.email),
    purpose: String(data.purpose || purpose || 'register').trim().toLowerCase(),
    codeHash: String(data.code_hash || ''),
    attempts: Number(data.attempts || 0),
    expiresAt: dateToMs(data.expires_at),
    cooldownUntil: dateToMs(data.cooldown_until),
    verifiedAt: data.verified_at ? dateToMs(data.verified_at) : null,
  };
}

async function savePersistentRegistrationCode(entry) {
  const admin = getSupabaseAdminClient();
  if (!admin) return false;
  const { error } = await admin.from(REG_CODE_TABLE).upsert(
    {
      email: normalizeEmail(entry.email),
      purpose: String(entry.purpose || 'register').trim().toLowerCase(),
      code_hash: String(entry.codeHash || ''),
      attempts: Number(entry.attempts || 0),
      expires_at: new Date(Number(entry.expiresAt || 0)).toISOString(),
      cooldown_until: new Date(Number(entry.cooldownUntil || 0)).toISOString(),
      verified_at: entry.verifiedAt ? new Date(Number(entry.verifiedAt)).toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'email,purpose' },
  );
  if (error) {
    console.warn('[registration-code-store] save failed:', error.message || error);
    return false;
  }
  return true;
}

async function deletePersistentRegistrationCode(email, purpose) {
  const admin = getSupabaseAdminClient();
  if (!admin) return;
  const { error } = await admin
    .from(REG_CODE_TABLE)
    .delete()
    .eq('email', normalizeEmail(email))
    .eq('purpose', String(purpose || 'register').trim().toLowerCase());
  if (error) console.warn('[registration-code-store] delete failed:', error.message || error);
}

async function savePersistentRegistrationProof(token, entry) {
  const admin = getSupabaseAdminClient();
  if (!admin) return false;
  const { error } = await admin.from(REG_PROOF_TABLE).insert({
    token_hash: hashProofToken(token),
    email: normalizeEmail(entry.email),
    purpose: String(entry.purpose || 'register').trim().toLowerCase(),
    expires_at: new Date(Number(entry.expiresAt || 0)).toISOString(),
    consumed: false,
  });
  if (error) {
    console.warn('[registration-proof-store] save failed:', error.message || error);
    return false;
  }
  return true;
}

async function loadPersistentRegistrationProof(token) {
  const admin = getSupabaseAdminClient();
  if (!admin) return null;
  const { data, error } = await admin
    .from(REG_PROOF_TABLE)
    .select('email,purpose,expires_at,consumed')
    .eq('token_hash', hashProofToken(token))
    .maybeSingle();
  if (error) {
    console.warn('[registration-proof-store] load failed:', error.message || error);
    return null;
  }
  if (!data) return null;
  return {
    email: normalizeEmail(data.email),
    purpose: String(data.purpose || 'register').trim().toLowerCase(),
    expiresAt: dateToMs(data.expires_at),
    consumed: data.consumed === true,
  };
}

async function consumePersistentRegistrationProof(token) {
  const admin = getSupabaseAdminClient();
  if (!admin) return false;
  const { data, error } = await admin
    .from(REG_PROOF_TABLE)
    .update({ consumed: true, consumed_at: new Date().toISOString() })
    .eq('token_hash', hashProofToken(token))
    .eq('consumed', false)
    .select('token_hash')
    .maybeSingle();
  if (error) {
    console.warn('[registration-proof-store] consume failed:', error.message || error);
    return false;
  }
  return Boolean(data);
}

async function getAuthenticatedCaller(req) {
  const token = getBearerUserToken(req);
  if (!token) return null;

  const admin = getSupabaseAdminClient();
  if (!admin) {
    throw new Error('Missing Supabase configuration for user auth');
  }

  const {
    data: { user },
    error: authError,
  } = await admin.auth.getUser(token);
  if (authError || !user?.id) return null;

  let { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, user_id, role, company_id')
    .or(`id.eq.${user.id},user_id.eq.${user.id}`)
    .limit(1)
    .maybeSingle();
  if (profileError && (profileError.code === '42703' || /user_id/i.test(String(profileError.message || '')))) {
    const fallback = await admin
      .from('profiles')
      .select('id, role, company_id')
      .eq('id', user.id)
      .limit(1)
      .maybeSingle();
    profile = fallback.data;
    profileError = fallback.error;
  }
  if (profileError || !profile) return null;

  const { data: superAdminRow } = await admin
    .from('super_admins')
    .select('user_id, profile_id')
    .eq('is_active', true)
    .or(`user_id.eq.${user.id},profile_id.eq.${user.id}`)
    .maybeSingle();

  const role = String(profile.role || '').trim().toLowerCase();
  const isSuperAdmin = role === 'super_admin' || !!(superAdminRow?.user_id || superAdminRow?.profile_id);
  return {
    user,
    profile,
    isPrivilegedEmailSender: isSuperAdmin || role === 'admin',
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function requireSendEmailAuth(req, res, next) {
  try {
    if (hasValidServerToken(req)) {
      req.emailAuth = { kind: 'server' };
      return next();
    }

    const caller = await getAuthenticatedCaller(req);
    if (!caller) return res.status(401).json({ error: 'Unauthorized' });
    if (!caller.isPrivilegedEmailSender) return res.status(403).json({ error: 'Forbidden' });

    req.emailAuth = { kind: 'user', userId: caller.user.id, profileId: caller.profile.id };
    return next();
  } catch (error) {
    console.error('[EMAIL_AUTH] Failed:', error?.message || error);
    return res.status(500).json({ error: 'Email auth failed' });
  }
}

function resolveSupabaseBaseUrl(rawUrl) {
  const publicUrl = String(process.env.SUPABASE_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  const candidate = String(rawUrl || '').trim();
  if (!candidate) return publicUrl;

  try {
    const parsed = new URL(candidate);
    const host = String(parsed.hostname || '').toLowerCase();
    if (!host) return publicUrl;
    if ((host === 'supabase-kong' || host === 'localhost' || host.endsWith('.internal')) && publicUrl) {
      return publicUrl;
    }
    return parsed.origin;
  } catch {
    return publicUrl;
  }
}

// Функция для простого хеширования пароля (bcrypt альтернатива)
// Примечание: используем crypto вместо bcrypt
function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '').trim(),
  );
}

async function logPasswordChange({
  supabaseUrl,
  supabaseServiceKey,
  userId,
  changedBy,
  ipAddress,
  userAgent,
}) {
  const url = resolveSupabaseBaseUrl(supabaseUrl);
  const key = String(supabaseServiceKey || '').trim();
  if (!url || !key || !isUuid(userId)) return;

  const response = await fetch(`${url}/rest/v1/rpc/upsert_password_change_log`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      p_user_id: String(userId).trim(),
      p_changed_by: isUuid(changedBy) ? String(changedBy).trim() : null,
      p_ip_address: ipAddress ? String(ipAddress).trim() : null,
      p_user_agent: userAgent ? String(userAgent).trim() : null,
      p_source: 'email-server:update-password',
      p_window_seconds: 180,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`password_change_log rpc failed: HTTP ${response.status} ${text}`);
  }
}
function hashPassword(password) {
  // Для демонстрации используем SHA256, но это НЕ полная замена bcrypt
  // Правильное решение - установить bcrypt в контейнере
  const salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512');
  return `$pbkdf2-sha512$${salt}$${hash.toString('hex')}`;
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || '172.17.0.1',  // Docker host gateway
  port: Number(process.env.SMTP_PORT || 25),
  secure: envFlag('SMTP_SECURE', false),
  tls: {
    rejectUnauthorized: envFlag('SMTP_TLS_REJECT_UNAUTHORIZED', true),
  },
});

const SUBSCRIPTION_EMAIL_TEXT = Object.freeze({
  ru: {
    subjects: {
      warning_7d: 'Монитор: подписка скоро закончится',
      warning_1d: 'Монитор: подписка заканчивается завтра',
      expired: 'Монитор: подписка закончилась, доступ ограничен',
    },
    preheaders: {
      warning_7d: 'Напоминание о продлении подписки, чтобы команда продолжала работу без ограничений.',
      warning_1d: 'Подписка заканчивается завтра. Продлите её заранее, чтобы избежать ограничений доступа.',
      expired: 'Подписка уже завершена. После оплаты доступ сотрудников восстановится автоматически.',
    },
    greeting: 'Здравствуйте',
    closing: 'С уважением, команда Монитор',
    warning_intro: 'Срок подписки вашей компании скоро заканчивается.',
    warning_days_left: 'До окончания подписки осталось: {days} дн.',
    warning_period_end: 'Дата окончания подписки: {date}',
    warning_impact_title: 'Что произойдет после окончания подписки:',
    warning_impact_1: 'Приложение перейдет в режим только чтения.',
    warning_impact_2: 'Полный доступ останется только у администратора компании.',
    warning_impact_3: 'Остальные сотрудники будут заблокированы до оплаты.',
    warning_pay_note: 'Пожалуйста, продлите подписку заранее, чтобы избежать блокировок.',
    expired_intro: 'Срок подписки вашей компании закончился.',
    expired_mode: 'Сейчас приложение доступно только в режиме чтения и только для администратора.',
    expired_blocked: 'Остальные сотрудники заблокированы до оплаты подписки.',
    expired_recovery: 'После оплаты доступ сотрудников будет восстановлен автоматически.',
    expired_edit_blocked: 'Администратор может входить в сервис без ограничений, но редактирование недоступно до оплаты.',
    company_label: 'Компания',
    pay_button: 'Оплатить подписку',
    pay_hint: 'Кнопка откроет страницу оплаты. Если вы не авторизованы, сначала откроется вход, затем страница оплаты.',
    what_now: 'Что сейчас происходит',
    what_after_expiry: 'Что произойдет после окончания подписки',
  },
  en: {
    subjects: {
      warning_7d: 'Monitor: your subscription ends soon',
      warning_1d: 'Monitor: your subscription ends tomorrow',
      expired: 'Monitor: subscription expired, access is restricted',
    },
    preheaders: {
      warning_7d: 'Renew now to avoid team access restrictions.',
      warning_1d: 'Without renewal, part of your team will lose access tomorrow.',
      expired: 'Employees are already blocked. Access is restored automatically after payment.',
    },
    greeting: 'Hello',
    closing: 'Best regards, Monitor team',
    warning_intro: 'Your company subscription is about to expire.',
    warning_days_left: 'Days left until expiration: {days}.',
    warning_period_end: 'Subscription end date: {date}',
    warning_impact_title: 'What will happen after expiration:',
    warning_impact_1: 'The app will switch to read-only mode.',
    warning_impact_2: 'Full access will remain only for company admin users.',
    warning_impact_3: 'Other employees will be blocked until payment.',
    warning_pay_note: 'Please renew in advance to avoid access disruption.',
    expired_intro: 'Your company subscription has expired.',
    expired_mode: 'The app is now available in read-only mode and only for the admin.',
    expired_blocked: 'Other employees are blocked until payment.',
    expired_recovery: 'After payment, employee access will be restored automatically.',
    expired_edit_blocked: 'The admin can sign in, but editing remains disabled until payment.',
    company_label: 'Company',
    pay_button: 'Pay Subscription',
    pay_hint: 'The button opens billing. If you are not logged in, sign in first and then continue to billing.',
    what_now: 'Current access mode',
    what_after_expiry: 'What happens after subscription expiry',
  },
});

function pickLang(lang) {
  const code = String(lang || 'ru').toLowerCase();
  return code.startsWith('en') ? 'en' : 'ru';
}

function formatDateByLang(iso, lang) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso || '');
    const locale = lang === 'en' ? 'en-US' : 'ru-RU';
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'Europe/Moscow',
    }).format(d);
  } catch {
    return String(iso || '');
  }
}

function buildSubscriptionReminderEmail(payload = {}) {
  const lang = pickLang(payload.lang);
  const dict = SUBSCRIPTION_EMAIL_TEXT[lang];
  const normalizeRecipientName = (name) => {
    const value = String(name || '').trim();
    if (!value) return '';
    if (/^\?{2,}/.test(value)) return '';
    if (/^[\?\s]+$/.test(value)) return '';
    return value;
  };
  const fullName = normalizeRecipientName(`${payload.firstName || ''} ${payload.lastName || ''}`.trim());
  const helloName = fullName || (lang === 'ru' ? 'администратор' : 'admin');
  const companyName = String(payload.companyName || '').trim();
  const eventKeyRaw = String(payload.subscriptionEvent || '').trim().toLowerCase();
  const isExpired = eventKeyRaw === 'expired' || eventKeyRaw === 'expired_0d';
  const normalizedEvent = isExpired
    ? 'expired'
    : eventKeyRaw === 'warning_1d'
      ? 'warning_1d'
      : 'warning_7d';
  const periodEndText = formatDateByLang(payload.periodEndIso, lang);
  const daysLeft = Number.isFinite(Number(payload.daysLeft)) ? Math.max(0, Number(payload.daysLeft)) : null;

  const subject = dict.subjects[normalizedEvent];
  const preheader = dict.preheaders?.[normalizedEvent] || dict.preheaders?.expired || '';
  const intro = isExpired ? dict.expired_intro : dict.warning_intro;
  const lines = [];
  if (!isExpired && daysLeft != null) {
    lines.push(dict.warning_days_left.replace('{days}', String(daysLeft)));
  }
  if (periodEndText) {
    lines.push(dict.warning_period_end.replace('{date}', periodEndText));
  }
  const companyLine = companyName ? `${dict.company_label}: ${companyName}` : '';

  const impacts = isExpired
    ? [dict.expired_mode, dict.expired_edit_blocked, dict.expired_blocked, dict.expired_recovery]
    : [dict.warning_impact_1, dict.warning_impact_2, dict.warning_impact_3, dict.warning_pay_note];
  const billingUrl = 'https://monitorapp.ru/login?next=%2Fbilling&redirect=%2Fbilling&returnTo=%2Fbilling';
  const impactTitle = isExpired ? dict.what_now : dict.what_after_expiry;

  const html = `
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${preheader}
    </div>
    <div style="font-family:Arial,sans-serif;background:#f3f4f6;padding:24px 12px;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;padding:24px;">
        <h2 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#111827;">${subject}</h2>
        <p style="margin:0 0 12px;color:#374151;">${dict.greeting}, ${helloName}.</p>
        <p style="margin:0 0 12px;color:#111827;">${intro}</p>
        ${companyLine ? `<p style="margin:0 0 12px;color:#111827;"><strong>${companyLine}</strong></p>` : ''}
        ${lines.map((line) => `<p style="margin:0 0 8px;color:#374151;">${line}</p>`).join('')}

        <div style="margin-top:18px;padding:14px 14px;border-radius:10px;background:#fff7ed;border:1px solid #fed7aa;">
          <p style="margin:0 0 10px;font-weight:700;color:#9a3412;">${impactTitle}</p>
          <ul style="margin:0;padding-left:18px;color:#7c2d12;">
            ${impacts.map((line) => `<li style="margin-bottom:8px;">${line}</li>`).join('')}
          </ul>
        </div>

        <div style="margin-top:18px;">
          <a href="${billingUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700;">
            ${dict.pay_button}
          </a>
        </div>

        <p style="margin-top:24px;color:#6b7280;">${dict.closing}</p>
      </div>
    </div>
  `;

  const text = [
    subject,
    '',
    `${dict.greeting}, ${helloName}.`,
    intro,
    companyLine,
    ...lines,
    '',
    dict.warning_impact_title,
    ...impacts.map((line) => `- ${line}`),
    '',
    `${dict.pay_button}: ${billingUrl}`,
    '',
    dict.closing,
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, html, text };
}

transporter.verify((error) => {
  if (error) {
    console.error('[SMTP] Connection failed:', error?.message || error);
  } else {
    console.log('[SMTP] Connection successful!');
  }
});

app.post('/send-email', rateLimit('send-email', 30, 60 * 1000), requireSendEmailAuth, async (req, res) => {
  try {
    const { type, firstName, lastName, resetLink, tempPassword } = req.body;
    const email = normalizeEmail(req.body?.email);
    if (!type || !isValidEmail(email)) {
      return res.status(400).json({ error: 'Missing required fields: type, email' });
    }
    if (req.emailAuth?.kind === 'user' && type !== 'password-reset') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (resetLink && !isSafeHttpUrl(resetLink)) {
      return res.status(400).json({ error: 'Invalid resetLink' });
    }

    let subject, html, text;
    if (type === 'invite') {
      const fullName = `${firstName || ''} ${lastName || ''}`.trim() || 'Сотрудник';
      const safeFullName = escapeHtml(fullName);
      const safeTempPassword = escapeHtml(tempPassword || '');
      const safeResetLink = escapeHtml(resetLink || '');
      subject = 'Приглашение присоединиться к системе MonitorApp';
      if (tempPassword) {
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Добро пожаловать в MonitorApp!</h2>
            <p>Привет, ${safeFullName}!</p>
            <p>Вы были приглашены в систему управления заказами MonitorApp.</p>
            <p style="margin-top: 16px;">Ваш пароль для входа:</p>
            <div style="font-family: monospace; font-size: 16px; font-weight: 700; padding: 12px; background: #f3f4f6; border-radius: 8px;">${safeTempPassword}</div>
            <p style="margin-top: 16px;">После входа рекомендуем сменить пароль.</p>
            <p style="margin-top: 30px; color: #666; font-size: 12px;">
              Если вы не регистрировались в этой системе, пожалуйста, проигнорируйте это письмо.
            </p>
          </div>
        `;
        text = `Добро пожаловать в MonitorApp!\n\nПривет, ${fullName}!\n\nВы были приглашены в систему управления заказами MonitorApp.\n\nВаш пароль для входа: ${tempPassword}\n\nПосле входа рекомендуем сменить пароль.`;
      } else if (resetLink) {
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Добро пожаловать в MonitorApp!</h2>
            <p>Привет, ${safeFullName}!</p>
            <p>Вы были приглашены в систему управления заказами MonitorApp.</p>
            <p style="margin-top: 30px;">
              <a href="${safeResetLink}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
                Установить пароль
              </a>
            </p>
            <p style="margin-top: 30px; color: #666; font-size: 12px;">
              Если вы не регистрировались в этой системе, пожалуйста, проигнорируйте это письмо.
            </p>
          </div>
        `;
        text = `Добро пожаловать в MonitorApp!\n\nПривет, ${fullName}!\n\nВы были приглашены в систему управления заказами MonitorApp.\n\nПерейти по ссылке для установки пароля: ${resetLink}`;
      } else {
        return res.status(400).json({ error: 'Missing resetLink or tempPassword' });
      }
    } else if (type === 'password-reset') {
      const fullName = `${firstName || ''} ${lastName || ''}`.trim() || 'Пользователь';
      const safeFullName = escapeHtml(fullName);
      const safeTempPassword = escapeHtml(tempPassword || '');
      const safeResetLink = escapeHtml(resetLink || '');
      subject = 'Восстановление пароля в MonitorApp';
      if (tempPassword) {
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Сброс пароля</h2>
            <p>Привет, ${safeFullName}!</p>
            <p>Администратор сбросил пароль вашей учетной записи.</p>
            <p style="margin-top: 16px;">Ваш новый пароль:</p>
            <div style="font-family: monospace; font-size: 16px; font-weight: 700; padding: 12px; background: #f3f4f6; border-radius: 8px;">${safeTempPassword}</div>
            <p style="margin-top: 16px;">После входа рекомендуем сменить пароль.</p>
          </div>
        `;
        text = `Сброс пароля\n\nПривет, ${fullName}!\n\nАдминистратор сбросил пароль вашей учетной записи.\n\nВаш новый пароль: ${tempPassword}\n\nПосле входа рекомендуем сменить пароль.`;
      } else if (resetLink) {
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Восстановление пароля</h2>
            <p>Привет, ${safeFullName}!</p>
            <p>Вы запросили восстановление пароля для вашей учетной записи.</p>
            <p style="margin-top: 30px;">
              <a href="${safeResetLink}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
                Установить новый пароль
              </a>
            </p>
            <p style="margin-top: 30px; color: #666; font-size: 12px;">
              Ссылка действительна в течение 24 часов.<br/>
              Если вы не запрашивали восстановление пароля, проигнорируйте это письмо.
            </p>
          </div>
        `;
        text = `Восстановление пароля\n\nПривет, ${fullName}!\n\nВы запросили восстановление пароля.\n\nПерейти по ссылке: ${resetLink}\n\nСсылка действительна 24 часа.`;
      } else {
        return res.status(400).json({ error: 'Missing resetLink or tempPassword' });
      }
    } else if (type === 'subscription-reminder') {
      const built = buildSubscriptionReminderEmail(req.body || {});
      subject = built.subject;
      html = built.html;
      text = built.text;
    } else {
      return res.status(400).json({ error: 'Invalid email type' });
    }

    if (type === 'password-reset' && tempPassword) {
      const fullName = `${firstName || ''} ${lastName || ''}`.trim() || '\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c';
      const safeFullName = escapeHtml(fullName);
      const safeTempPassword = escapeHtml(tempPassword);
      subject = '\u041d\u043e\u0432\u044b\u0439 \u043f\u0430\u0440\u043e\u043b\u044c \u0434\u043b\u044f MonitorApp';
      html = `
        <div style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,sans-serif;color:#111827;">
          <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
            <div style="padding:24px 28px;background:#111827;color:#ffffff;">
              <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#cbd5e1;">&#1052;&#1086;&#1085;&#1080;&#1090;&#1086;&#1088;</div>
              <h1 style="margin:10px 0 0;font-size:24px;line-height:1.25;">&#1053;&#1086;&#1074;&#1099;&#1081; &#1087;&#1072;&#1088;&#1086;&#1083;&#1100;</h1>
            </div>
            <div style="padding:28px;">
              <p style="margin:0 0 14px;font-size:16px;">&#1055;&#1088;&#1080;&#1074;&#1077;&#1090;, ${safeFullName}.</p>
              <p style="margin:0 0 18px;line-height:1.55;color:#374151;">&#1040;&#1076;&#1084;&#1080;&#1085;&#1080;&#1089;&#1090;&#1088;&#1072;&#1090;&#1086;&#1088; &#1089;&#1073;&#1088;&#1086;&#1089;&#1080;&#1083; &#1087;&#1072;&#1088;&#1086;&#1083;&#1100; &#1074;&#1072;&#1096;&#1077;&#1081; &#1091;&#1095;&#1077;&#1090;&#1085;&#1086;&#1081; &#1079;&#1072;&#1087;&#1080;&#1089;&#1080;. &#1048;&#1089;&#1087;&#1086;&#1083;&#1100;&#1079;&#1091;&#1081;&#1090;&#1077; &#1087;&#1072;&#1088;&#1086;&#1083;&#1100; &#1085;&#1080;&#1078;&#1077; &#1076;&#1083;&#1103; &#1074;&#1093;&#1086;&#1076;&#1072;.</p>
              <div style="margin:22px 0;padding:18px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;">
                <div style="margin-bottom:8px;font-size:13px;font-weight:700;color:#6b7280;text-transform:uppercase;">&#1042;&#1088;&#1077;&#1084;&#1077;&#1085;&#1085;&#1099;&#1081; &#1087;&#1072;&#1088;&#1086;&#1083;&#1100;</div>
                <div style="font-family:Menlo,Consolas,monospace;font-size:22px;line-height:1.3;font-weight:800;letter-spacing:.04em;color:#111827;">${safeTempPassword}</div>
              </div>
              <div style="margin:20px 0 0;padding:14px 16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;color:#1e3a8a;line-height:1.5;">
                &#1055;&#1086;&#1089;&#1083;&#1077; &#1074;&#1093;&#1086;&#1076;&#1072; &#1089;&#1084;&#1077;&#1085;&#1080;&#1090;&#1077; &#1087;&#1072;&#1088;&#1086;&#1083;&#1100; &#1074; &#1087;&#1088;&#1086;&#1092;&#1080;&#1083;&#1077;.
              </div>
              <p style="margin:24px 0 0;color:#6b7280;font-size:13px;line-height:1.5;">&#1045;&#1089;&#1083;&#1080; &#1074;&#1099; &#1085;&#1077; &#1078;&#1076;&#1072;&#1083;&#1080; &#1101;&#1090;&#1086; &#1087;&#1080;&#1089;&#1100;&#1084;&#1086;, &#1089;&#1074;&#1103;&#1078;&#1080;&#1090;&#1077;&#1089;&#1100; &#1089; &#1074;&#1072;&#1096;&#1080;&#1084; &#1072;&#1076;&#1084;&#1080;&#1085;&#1080;&#1089;&#1090;&#1088;&#1072;&#1090;&#1086;&#1088;&#1086;&#1084;.</p>
            </div>
          </div>
        </div>
      `;
      text = `\u041d\u043e\u0432\u044b\u0439 \u043f\u0430\u0440\u043e\u043b\u044c \u0434\u043b\u044f MonitorApp\n\n\u041f\u0440\u0438\u0432\u0435\u0442, ${fullName}.\n\n\u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440 \u0441\u0431\u0440\u043e\u0441\u0438\u043b \u043f\u0430\u0440\u043e\u043b\u044c \u0432\u0430\u0448\u0435\u0439 \u0443\u0447\u0435\u0442\u043d\u043e\u0439 \u0437\u0430\u043f\u0438\u0441\u0438.\n\n\u0412\u0440\u0435\u043c\u0435\u043d\u043d\u044b\u0439 \u043f\u0430\u0440\u043e\u043b\u044c: ${tempPassword}\n\n\u041f\u043e\u0441\u043b\u0435 \u0432\u0445\u043e\u0434\u0430 \u0441\u043c\u0435\u043d\u0438\u0442\u0435 \u043f\u0430\u0440\u043e\u043b\u044c \u0432 \u043f\u0440\u043e\u0444\u0438\u043b\u0435.`;
    }

    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || 'MonitorApp <noreply@monitorapp.ru>',
      replyTo: process.env.SMTP_REPLY_TO || 'support@monitorapp.ru',
      to: email,
      subject,
      html,
      text,
      headers: {
        'X-Priority': '1 (Highest)',
        'Importance': 'high',
        'Priority': 'urgent'
      }
    });

    console.log(`[${new Date().toISOString()}] Email sent to ${maskEmailForLog(email)}:`, info.messageId);
    return res.status(200).json({ success: true, messageId: info.messageId, message: 'Email sent successfully' });
  } catch (error) {
    console.error('[/send-email] Error:', error?.message || error);
    return res.status(500).json({ error: 'Failed to send email' });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/registration/send-code', rateLimit('registration-send-code', 20, 60 * 1000), requireServerToken, async (req, res) => {
  try {
    await cleanupPersistentRegistrationStores();
    cleanupRegistrationStores();
    const email = normalizeEmail(req.body?.email);
    const purpose = String(req.body?.purpose || 'register').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, code: 'INVALID_EMAIL', message: 'Invalid email' });
    }
    if (purpose !== 'register' && purpose !== 'recovery') {
      return res.status(400).json({ ok: false, code: 'INVALID_PURPOSE', message: 'Invalid purpose' });
    }

    const now = Date.now();
    const codeKey = getRegistrationCodeKey(email, purpose);
    const existing = (await loadPersistentRegistrationCode(email, purpose)) || registrationCodeStore.get(codeKey);
    if (existing && Number(existing.cooldownUntil || 0) > now) {
      const retryAfter = Math.max(1, Math.ceil((existing.cooldownUntil - now) / 1000));
      return res.status(429).json({ ok: false, code: 'RATE_LIMITED', retry_after_seconds: retryAfter });
    }

    const code = generateSixDigitCode();
    const expiresAt = now + REG_CODE_TTL_MS;
    const cooldownUntil = now + REG_CODE_RESEND_COOLDOWN_MS;
    const entry = {
      codeHash: hashCode(code),
      email,
      purpose,
      createdAt: now,
      expiresAt,
      cooldownUntil,
      attempts: 0,
      verifiedAt: null,
    };
    registrationCodeStore.set(codeKey, entry);
    await savePersistentRegistrationCode(entry);

    const isRecoveryPurpose = purpose === 'recovery';
    const subject = isRecoveryPurpose ? 'Восстановление пароля' : 'Подтвердите email';
    const verifyBaseUrl = String(
      isRecoveryPurpose
        ? (process.env.PASSWORD_RESET_VERIFY_URL || 'https://monitorapp.ru/set-password')
        : (process.env.REGISTRATION_VERIFY_URL || 'https://monitorapp.ru/verify-email'),
    ).trim();
    const verifyUrl = `${verifyBaseUrl}${verifyBaseUrl.includes('?') ? '&' : '?'}email=${encodeURIComponent(email)}`;
    const heading = isRecoveryPurpose ? 'Восстановление пароля' : 'Подтвердите email';
    const description = isRecoveryPurpose
      ? 'Чтобы установить новый пароль в сервисе <strong>Монитор</strong>, введите код ниже на странице восстановления.'
      : 'Чтобы завершить регистрацию в сервисе <strong>Монитор</strong>, введите код ниже на странице подтверждения.';
    const hint = isRecoveryPurpose
      ? 'Код действует 15 минут. Если вы не запрашивали восстановление пароля, просто проигнорируйте это письмо.'
      : 'Код действует 15 минут. Если вы не регистрировались в Монитор, просто проигнорируйте это письмо.';
    const textPrefix = isRecoveryPurpose ? 'Восстановление пароля' : 'Подтвердите email';
    const actionLabel = isRecoveryPurpose ? 'Открыть страницу восстановления' : '';
    const actionHtml = isRecoveryPurpose
      ? `
            <a href="${verifyUrl}" style="display:inline-block; background:#2563eb; color:#ffffff; text-decoration:none; font-weight:700; font-size:16px; line-height:1; border-radius:12px; padding:15px 20px;">
              ${actionLabel}
            </a>
        `
      : '';
    const actionText = isRecoveryPurpose ? `\n\n${actionLabel}: ${verifyUrl}` : '';
    const html = `
      <div style="margin:0; padding:0; background:#f3f6fb; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
        <div style="max-width:600px; margin:0 auto; padding:24px 16px;">
          <div style="background:#ffffff; border:1px solid #e3e8f0; border-radius:18px; padding:28px;">
            <h1 style="margin:0 0 14px; color:#0f1b34; font-size:46px; line-height:1.05; font-weight:900;">
              ${heading}
            </h1>
            <p style="margin:0 0 16px; color:#33415c; font-size:16px; line-height:1.5;">
              ${description}
            </p>
            <div style="margin:16px 0 8px; color:#64748b; font-size:16px; line-height:1.4; font-weight:600;">
              Код подтверждения
            </div>
            <div style="margin:0 0 18px; border:1px dashed #9ec5ff; border-radius:14px; background:#f8fbff; padding:18px 14px; text-align:center;">
              <span style="display:inline-block; color:#0f1b34; font-size:52px; line-height:1; letter-spacing:8px; font-weight:800;">${code}</span>
            </div>
            ${actionHtml}
            <p style="margin:18px 0 0; color:#64748b; font-size:14px; line-height:1.5;">
              ${hint}
            </p>
          </div>
        </div>
      </div>
    `;
    const text = `${textPrefix}\n\nКод подтверждения: ${code}${actionText}\n\n${hint}`;

    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || 'MonitorApp <noreply@monitorapp.ru>',
      replyTo: process.env.SMTP_REPLY_TO || 'support@monitorapp.ru',
      to: email,
      subject,
      html,
      text,
    });

    console.log(`[${new Date().toISOString()}] Registration code sent to ${maskEmailForLog(email)}: ${info.messageId}`);
    return res.status(200).json({
      ok: true,
      cooldown_seconds: Math.floor(REG_CODE_RESEND_COOLDOWN_MS / 1000),
      expires_in_seconds: Math.floor(REG_CODE_TTL_MS / 1000),
    });
  } catch (error) {
    console.error('[/registration/send-code] Error:', error);
    return res.status(500).json({ ok: false, code: 'SEND_FAILED', message: 'Failed to send verification code' });
  }
});

app.post('/registration/verify-code', rateLimit('registration-verify-code', 50, 60 * 1000), requireServerToken, async (req, res) => {
  try {
    await cleanupPersistentRegistrationStores();
    cleanupRegistrationStores();
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '').trim();
    const purpose = String(req.body?.purpose || 'register').trim().toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, code: 'INVALID_EMAIL' });
    }
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ ok: false, code: 'INVALID_CODE' });
    }
    if (purpose !== 'register' && purpose !== 'recovery') {
      return res.status(400).json({ ok: false, code: 'INVALID_PURPOSE' });
    }

    const codeKey = getRegistrationCodeKey(email, purpose);
    const entry = (await loadPersistentRegistrationCode(email, purpose)) || registrationCodeStore.get(codeKey);
    if (!entry || Number(entry.expiresAt || 0) <= Date.now()) {
      registrationCodeStore.delete(codeKey);
      await deletePersistentRegistrationCode(email, purpose);
      return res.status(400).json({ ok: false, code: 'CODE_EXPIRED' });
    }
    if (String(entry.purpose || '') !== purpose) {
      return res.status(400).json({ ok: false, code: 'INVALID_CODE' });
    }

    const attempts = Number(entry.attempts || 0) + 1;
    entry.attempts = attempts;
    if (attempts > REG_CODE_MAX_ATTEMPTS) {
      registrationCodeStore.delete(codeKey);
      await deletePersistentRegistrationCode(email, purpose);
      return res.status(429).json({ ok: false, code: 'TOO_MANY_ATTEMPTS' });
    }

    if (!timingSafeStringEqual(hashCode(code), String(entry.codeHash || ''))) {
      registrationCodeStore.set(codeKey, entry);
      await savePersistentRegistrationCode(entry);
      return res.status(400).json({ ok: false, code: 'INVALID_CODE' });
    }

    const proofToken = generateProofToken();
    const proofEntry = {
      email,
      purpose,
      createdAt: Date.now(),
      expiresAt: Date.now() + REG_PROOF_TTL_MS,
      consumed: false,
    };
    registrationProofStore.set(proofToken, proofEntry);
    await savePersistentRegistrationProof(proofToken, proofEntry);
    registrationCodeStore.delete(codeKey);
    await deletePersistentRegistrationCode(email, purpose);

    return res.status(200).json({
      ok: true,
      registration_token: proofToken,
      expires_in_seconds: Math.floor(REG_PROOF_TTL_MS / 1000),
    });
  } catch (error) {
    console.error('[/registration/verify-code] Error:', error);
    return res.status(500).json({ ok: false, code: 'VERIFY_FAILED' });
  }
});

app.post('/registration/consume-token', rateLimit('registration-consume-token', 100, 60 * 1000), requireServerToken, async (req, res) => {
  try {
    await cleanupPersistentRegistrationStores();
    cleanupRegistrationStores();
    const email = normalizeEmail(req.body?.email);
    const token = String(req.body?.registration_token || '').trim();
    const purpose = String(req.body?.purpose || 'register').trim().toLowerCase();

    if (!email || !token) {
      return res.status(400).json({ ok: false, code: 'INVALID_INPUT' });
    }
    if (purpose !== 'register' && purpose !== 'recovery') {
      return res.status(400).json({ ok: false, code: 'INVALID_PURPOSE' });
    }

    const persistentEntry = await loadPersistentRegistrationProof(token);
    const entry = persistentEntry || registrationProofStore.get(token);
    if (!entry) {
      return res.status(400).json({ ok: false, code: 'INVALID_TOKEN' });
    }
    if (entry.consumed === true) {
      return res.status(400).json({ ok: false, code: 'TOKEN_ALREADY_USED' });
    }
    if (Number(entry.expiresAt || 0) <= Date.now()) {
      registrationProofStore.delete(token);
      return res.status(400).json({ ok: false, code: 'TOKEN_EXPIRED' });
    }
    if (normalizeEmail(entry.email) !== email || String(entry.purpose || '') !== purpose) {
      return res.status(400).json({ ok: false, code: 'TOKEN_MISMATCH' });
    }

    if (persistentEntry) {
      const consumed = await consumePersistentRegistrationProof(token);
      if (!consumed) {
        return res.status(400).json({ ok: false, code: 'TOKEN_ALREADY_USED' });
      }
    }
    entry.consumed = true;
    registrationProofStore.set(token, entry);
    cleanupRegistrationStores();
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[/registration/consume-token] Error:', error);
    return res.status(500).json({ ok: false, code: 'CONSUME_FAILED' });
  }
});

app.post('/api/update-password', rateLimit('update-password', 10, 60 * 1000), requireServerToken, async (req, res) => {
  try {
    const userId = req.body.user_id || req.body.userId;
    const { password, newPassword, changed_by } = req.body;
    const finalPassword = password || newPassword;

    if (!isUuid(userId) || !finalPassword || String(finalPassword).length < 8) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid input',
        message: 'valid user_id and password are required',
      });
    }
    if (changed_by && !isUuid(changed_by)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid input',
        message: 'valid changed_by is required',
      });
    }

    const url = resolveSupabaseBaseUrl(process.env.SUPABASE_URL);
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      console.error(`[${new Date().toISOString()}] Missing Supabase credentials`);
      return res.status(500).json({
        ok: false,
        error: 'Missing Supabase configuration',
        message: 'Failed to update password',
      });
    }

    console.log(`[${new Date().toISOString()}] [UPDATE_PASSWORD] Updating password for user: ${userId}`, {
      changed_by: changed_by || userId,
    });

    const adminUrl = `${url}/auth/v1/admin/users/${userId}`;
    const response = await fetch(adminUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        password: finalPassword
      })
    });

    if (!response.ok) {
      await response.text().catch(() => '');
      console.error(`[${new Date().toISOString()}] [UPDATE_PASSWORD] Admin API call failed with status ${response.status}`);
      return res.status(response.status).json({
        ok: false,
        error: 'Admin API call failed',
        message: 'Failed to update password',
      });
    }

    await response.json().catch(() => null);
    console.log(`[${new Date().toISOString()}] [UPDATE_PASSWORD] Password updated successfully for user: ${userId}`);

    const forwardedFor = req.headers['x-forwarded-for'];
    const rawIp = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : String(forwardedFor || req.ip || '').split(',')[0];
    try {
      await logPasswordChange({
        supabaseUrl: url,
        supabaseServiceKey: key,
        userId,
        changedBy: changed_by || userId,
        ipAddress: rawIp,
        userAgent: req.get('user-agent'),
      });
      console.log(`[${new Date().toISOString()}] [UPDATE_PASSWORD] Password change logged for user: ${userId}`);
    } catch (logErr) {
      console.warn(
        `[${new Date().toISOString()}] [UPDATE_PASSWORD] Password change log failed for user ${userId}:`,
        logErr?.message || logErr,
      );
    }

    return res.status(200).json({
      ok: true,
      success: true,
      message: 'Password updated successfully'
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [/api/update-password] Error:`, error.message);
    return res.status(500).json({
      ok: false,
      error: 'Failed to update password',
      message: 'Failed to update password'
    });
  }
});

// Endpoint для обновления пароля в Supabase через Admin API
app.post('/update-password', rateLimit('legacy-update-password', 10, 60 * 1000), requireServerToken, async (req, res) => {
  try {
    const { userId, newPassword } = req.body;
    
    if (!isUuid(userId) || !newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ error: 'valid userId and newPassword are required' });
    }

    const url = resolveSupabaseBaseUrl(process.env.SUPABASE_URL);
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      console.error(`[${new Date().toISOString()}] Missing Supabase credentials`);
      return res.status(500).json({ error: 'Missing Supabase configuration' });
    }

    console.log(`[${new Date().toISOString()}] Updating password for user: ${userId}`);

    // Используем Supabase Admin API для обновления пароля пользователя
    const adminUrl = `${url}/auth/v1/admin/users/${userId}`;
    const response = await fetch(adminUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        password: newPassword
      })
    });

    if (!response.ok) {
      await response.text().catch(() => '');
      console.error(`[${new Date().toISOString()}] Admin API call failed with status ${response.status}`);
      return res.status(response.status).json({ 
        error: 'Admin API call failed', 
        message: 'Failed to update password'
      });
    }

    await response.json().catch(() => null);
    console.log(`[${new Date().toISOString()}] Password updated successfully for user: ${userId}`);
    
    return res.status(200).json({ 
      success: true, 
      message: 'Password updated successfully'
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [/update-password] Error:`, error.message);
    return res.status(500).json({ 
      error: 'Failed to update password',
      message: 'Failed to update password'
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Email server running on port ${PORT}`);
  console.log(`POST http://localhost:${PORT}/send-email - Send email`);
  console.log(`POST http://localhost:${PORT}/api/update-password - Update password`);
  console.log(`POST http://localhost:${PORT}/update-password - Password update confirmation`);
  console.log(`GET http://localhost:${PORT}/health - Health check`);
});
