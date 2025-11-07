// supabase/functions/update_user/index.ts
// Исправлено:
// 1) НЕ трогаем email в public.profiles (часто такого столбца нет) — email меняем только в auth.
// 2) При любой ошибке возвращаем 200 с { ok:false, message }, чтобы клиент видел текст ошибки, а не generic "non-2xx".
// 3) Обновление роли — в profiles.
// 4) Обновление пароля/почты — в auth.admin.updateUserById.

import { serve } from 'https://deno.land/std@0.210.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

type ReqBody = {
  user_id: string;
  email?: string | null;
  new_password?: string | null;
  role?: string | null;
};

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, message: 'Method not allowed' }), {
      headers: { 'Content-Type': 'application/json', ...cors },
      status: 200, // чтобы клиент получил текст
    });
  }

  try {
    const body = (await req.json()) as ReqBody;
    if (!body?.user_id) throw new Error('user_id is required');

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in function secrets');
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
      global: { headers: { 'x-application': 'edge-update-user' } },
    });

    const { user_id, email, new_password, role } = body;

    // 1) Роль — в public.profiles (если передана)
    if (typeof role === 'string' && role.length > 0) {
      const { error: profErr } = await admin.from('profiles').update({ role }).eq('id', user_id);
      if (profErr) throw new Error('Profiles update failed: ' + profErr.message);
    }

    // 2) Email/пароль — только в auth (если переданы)
    const authPatch: { email?: string; password?: string } = {};
    if (email && email.trim().length > 0) authPatch.email = email.trim();
    if (new_password && new_password.length >= 6) authPatch.password = new_password;

    if (Object.keys(authPatch).length > 0) {
      const { error: authErr } = await admin.auth.admin.updateUserById(user_id, authPatch);
      if (authErr) throw new Error('Auth update failed: ' + authErr.message);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json', ...cors },
      status: 200,
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, message: e?.message ?? 'Unknown error' }), {
      headers: { 'Content-Type': 'application/json', ...cors },
      status: 200, // Всегда 200, чтобы клиент не падал с generic ошибкой
    });
  }
});
