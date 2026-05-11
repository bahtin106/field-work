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
  code?: string;
  password?: string;
  new_password?: string;
  newPassword?: string;
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

function getClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL/PROJECT_URL or SUPABASE_SERVICE_ROLE_KEY/SERVICE_ROLE_KEY');
  }
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
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
      'https://api.monitorapp.ru',
  )
    .trim()
    .replace(/\/+$/, '');
  if (!value) throw new Error('EMAIL_SERVICE_URL is required');
  return value;
}

function normalizeVerifyErrorCode(raw: unknown): string {
  const code = String(raw || '').trim().toUpperCase();
  if (!code) return 'VERIFY_FAILED';
  if (code === 'INVALID_CODE' || code === 'CODE_EXPIRED' || code === 'TOO_MANY_ATTEMPTS') return code;
  return 'VERIFY_FAILED';
}

function normalizeVerifyErrorMessage(code: string): string {
  if (code === 'INVALID_CODE') return 'Неверный код подтверждения';
  if (code === 'CODE_EXPIRED') return 'Срок действия кода истёк. Запросите новый';
  if (code === 'TOO_MANY_ATTEMPTS') return 'Слишком много попыток. Запросите новый код';
  return 'Не удалось проверить код подтверждения';
}

export async function handleRequestPasswordReset(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }, 405);

  const forwardedFor = req.headers.get('x-forwarded-for') || '';
  const ipAddress = forwardedFor.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null;
  const userAgent = req.headers.get('user-agent') || null;
  let requestLogId: number | null = null;

  try {
    const rawBody = await req.json().catch(() => ({} as any));
    const body = (() => {
      if (!rawBody) return {} as ResetRequestBody;
      if (typeof rawBody === 'string') {
        try {
          return JSON.parse(rawBody) as ResetRequestBody;
        } catch {
          return {} as ResetRequestBody;
        }
      }
      if (typeof rawBody === 'object' && rawBody !== null) {
        const candidate = (rawBody as any).body;
        if (candidate && typeof candidate === 'object') return candidate as ResetRequestBody;
        return rawBody as ResetRequestBody;
      }
      return {} as ResetRequestBody;
    })();
    const email = normalizeEmail(body?.email);
    const code = String(body?.code || '').trim();
    const nextPassword = String(body?.new_password || body?.newPassword || body?.password || '').trim();

    if (!isValidEmail(email)) {
      return json({ ok: false, code: 'INVALID_EMAIL', message: 'Введите корректный e-mail' });
    }

    const admin = getClient();
    const { data: profileRows, error: profileError } = await admin
      .from('profiles')
      .select('id, first_name, last_name, email')
      .ilike('email', email)
      .limit(1);
    if (profileError) throw profileError;
    const profile = Array.isArray(profileRows) ? profileRows[0] : null;

    if (code && nextPassword) {
      if (!/^\d{6}$/.test(code)) {
        return json({ ok: false, code: 'INVALID_CODE', message: 'Неверный код подтверждения' });
      }
      if (nextPassword.length < 8) {
        return json({ ok: false, code: 'INVALID_PASSWORD', message: 'Пароль должен быть не короче 8 символов' });
      }
      if (!profile?.id) {
        return json({ ok: false, code: 'USER_NOT_FOUND', message: 'Сотрудник с таким e-mail не найден' });
      }

      const emailServiceUrl = getEmailServiceUrl();
      const verifyRes = await fetch(`${emailServiceUrl}/registration/verify-code`, {
        method: 'POST',
        headers: emailServiceHeaders(),
        body: JSON.stringify({ email, code, purpose: 'recovery' }),
      });
      const verifyPayload = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok || verifyPayload?.ok !== true) {
        const errCode = normalizeVerifyErrorCode(verifyPayload?.code);
        return json({ ok: false, code: errCode, message: normalizeVerifyErrorMessage(errCode) }, errCode === 'TOO_MANY_ATTEMPTS' ? 429 : 400);
      }

      const proofToken = String(verifyPayload?.registration_token || '').trim();
      if (!proofToken) {
        return json({ ok: false, code: 'VERIFY_FAILED', message: 'Не удалось проверить код подтверждения' }, 500);
      }

      const consumeRes = await fetch(`${emailServiceUrl}/registration/consume-token`, {
        method: 'POST',
        headers: emailServiceHeaders(),
        body: JSON.stringify({ email, registration_token: proofToken, purpose: 'recovery' }),
      });
      const consumePayload = await consumeRes.json().catch(() => ({}));
      if (!consumeRes.ok || consumePayload?.ok !== true) {
        return json({ ok: false, code: 'TOKEN_INVALID', message: 'Код подтверждения недействителен. Запросите новый код' }, 400);
      }

      const { error: updateError } = await admin.auth.admin.updateUserById(String(profile.id), {
        password: nextPassword,
      });
      if (updateError) throw new Error(`Auth update failed: ${updateError.message}`);

      try {
        await admin.rpc('upsert_password_change_log', {
          p_user_id: String(profile.id),
          p_changed_by: String(profile.id),
          p_ip_address: ipAddress,
          p_user_agent: userAgent,
          p_source: 'edge:request-password-reset:code',
          p_window_seconds: 180,
        });
      } catch {}

      return json({ ok: true, message: 'Пароль успешно обновлён' });
    }

    if (code || nextPassword) {
      return json({ ok: false, code: 'INVALID_INPUT', message: 'Для подтверждения нужны и код, и новый пароль' }, 400);
    }

    const nowMs = Date.now();
    const inMemoryUntil = Number(inMemoryCooldownMap.get(email) || 0);
    if (inMemoryUntil > nowMs) {
      const retryAfter = Math.max(1, Math.ceil((inMemoryUntil - nowMs) / 1000));
      return json({
        ok: false,
        code: 'RATE_LIMIT',
        message: 'Повторная отправка пока недоступна',
        retry_after_seconds: retryAfter,
      });
    }

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
        message: 'Повторная отправка пока недоступна',
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

    if (!profile?.id) {
      if (requestLogId != null) {
        await admin.from('password_reset_requests').update({ status: 'user_not_found' }).eq('id', requestLogId);
      }
      return json({ ok: false, code: 'USER_NOT_FOUND', message: 'Сотрудник с таким e-mail не найден' });
    }

    const emailServiceUrl = getEmailServiceUrl();
    const sendRes = await fetch(`${emailServiceUrl}/registration/send-code`, {
      method: 'POST',
      headers: emailServiceHeaders(),
      body: JSON.stringify({ email, purpose: 'recovery' }),
    });
    const sendPayload = await sendRes.json().catch(() => ({}));
    if (!sendRes.ok || sendPayload?.ok !== true) {
      const retryAfter = Math.max(1, Number(sendPayload?.retry_after_seconds) || PASSWORD_RESET_COOLDOWN_SECONDS);
      if (sendPayload?.code === 'RATE_LIMITED') {
        return json({
          ok: false,
          code: 'RATE_LIMIT',
          message: 'Повторная отправка пока недоступна',
          retry_after_seconds: retryAfter,
        });
      }
      throw new Error(`EMAIL_SEND_FAILED: ${String(sendPayload?.message || sendRes.status)}`);
    }

    if (requestLogId != null) {
      await admin
        .from('password_reset_requests')
        .update({ status: 'sent', user_id: String(profile.id), error_message: null })
        .eq('id', requestLogId);
    }

    return json({
      ok: true,
      cooldown_seconds: PASSWORD_RESET_COOLDOWN_SECONDS,
      expires_in_seconds: Number(sendPayload?.expires_in_seconds) || 900,
      message: 'Код отправлен на email',
    });
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
        ? 'Не удалось отправить письмо. Обратитесь в поддержку.'
        : 'Не удалось восстановить пароль. Обратитесь в поддержку.',
    });
  }
}
