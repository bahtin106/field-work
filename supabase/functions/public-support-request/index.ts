import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const SUPPORT_MESSAGE_MAX_LEN = 2000;

type SupportRequestBody = {
  email?: string;
  name?: string | null;
  message?: string;
};

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
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

    if (!isValidEmail(email)) {
      return json({ ok: false, code: 'INVALID_EMAIL', message: 'Введите корректный e-mail' });
    }
    if (!message) {
      return json({ ok: false, code: 'EMPTY_MESSAGE', message: 'Введите текст обращения' });
    }
    if (message.length > SUPPORT_MESSAGE_MAX_LEN) {
      return json({ ok: false, code: 'MESSAGE_TOO_LONG', message: 'Превышен лимит символов' });
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
    return json({
      ok: false,
      code: 'INTERNAL_ERROR',
      message: String((error as Error)?.message || 'Не удалось отправить обращение'),
    });
  }
}
