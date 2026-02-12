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
  changed_by?: string | null;
  email?: string | null;
  new_password?: string | null;
  password?: string | null;
  role?: string | null;
  profile?: {
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
    birthdate?: string | null;
    department_id?: string | null;
  } | null;
  is_suspended?: boolean | null;
  suspended_at?: string | null;
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

    const { user_id, changed_by, email, new_password, password, role, profile, is_suspended, suspended_at } =
      body;

    // 1) Обновление полей профиля (если переданы)
    const profilePatch: any = {};
    if (profile && typeof profile === 'object') {
      if ('first_name' in profile) profilePatch.first_name = profile.first_name;
      if ('last_name' in profile) profilePatch.last_name = profile.last_name;
      if ('phone' in profile) profilePatch.phone = profile.phone;
      if ('birthdate' in profile) profilePatch.birthdate = profile.birthdate;
      if ('department_id' in profile) profilePatch.department_id = profile.department_id;
      if ('full_name' in profile) {
        const fullNameCandidate = profile.full_name;
        profilePatch.full_name =
          typeof fullNameCandidate === 'string' ? fullNameCandidate.trim() : fullNameCandidate;
      }
    }
    if (typeof role === 'string' && role.length > 0) {
      profilePatch.role = role;
    }
    if (typeof is_suspended === 'boolean') {
      profilePatch.is_suspended = is_suspended;
    }
    if (suspended_at !== undefined) {
      profilePatch.suspended_at = suspended_at;
    }

    const shouldSyncFullName =
      'first_name' in profilePatch || 'last_name' in profilePatch;
    if (shouldSyncFullName) {
      const firstValue =
        typeof profilePatch.first_name === 'string' ? profilePatch.first_name.trim() : '';
      const lastValue =
        typeof profilePatch.last_name === 'string' ? profilePatch.last_name.trim() : '';
      const combined = [firstValue, lastValue].filter(Boolean).join(' ').trim();
      profilePatch.full_name = combined || null;
    }

    if (Object.keys(profilePatch).length > 0) {
      const { error: profErr } = await admin
        .from('profiles')
        .update(profilePatch)
        .eq('id', user_id);
      if (profErr) throw new Error('Profiles update failed: ' + profErr.message);
    }

    // 2) Email/пароль — только в auth (если переданы)
    const authPatch: { email?: string; password?: string } = {};
    let passwordChanged = false;
    
    if (email && email.trim().length > 0) authPatch.email = email.trim();
    const pwd = password || new_password;
    if (pwd && pwd.length >= 6) {
      authPatch.password = pwd;
      passwordChanged = true;
    }

    if (Object.keys(authPatch).length > 0) {
      console.log(`[UPDATE_USER] Updating auth for user ${user_id}:`, {
        hasEmail: !!authPatch.email,
        hasPassword: passwordChanged,
      });
      
      const { error: authErr } = await admin.auth.admin.updateUserById(user_id, authPatch);
      
      if (authErr) {
        console.error(`[UPDATE_USER] Auth update failed for user ${user_id}:`, authErr);
        throw new Error('Auth update failed: ' + authErr.message);
      }
      
      console.log(`[UPDATE_USER] Auth update successful for user ${user_id}`);

      // 3) Логируем изменение пароля в таблицу password_change_log (если существует)
      if (passwordChanged) {
        try {
          console.log(`[UPDATE_USER] Logging password change for user ${user_id}`);
          const { error: logErr } = await admin
            .from('password_change_log')
            .insert({
              user_id,
              changed_at: new Date().toISOString(),
              changed_by: changed_by || user_id, // Если changed_by не указан, значит пользователь меняет свой пароль
            });
          
          if (logErr) {
            // Логирование — не критично, но выведем в лог
            console.warn(`[UPDATE_USER] Failed to log password change:`, logErr.message);
          } else {
            console.log(`[UPDATE_USER] Password change logged successfully for user ${user_id}`);
          }
        } catch (logException) {
          console.warn(`[UPDATE_USER] Exception while logging password change:`, logException);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json', ...cors },
      status: 200,
    });
  } catch (e: any) {
    console.error(`[UPDATE_USER] Error:`, e?.message);
    return new Response(JSON.stringify({ ok: false, message: e?.message ?? 'Unknown error' }), {
      headers: { 'Content-Type': 'application/json', ...cors },
      status: 200, // Всегда 200, чтобы клиент не падал с generic ошибкой
    });
  }
});
