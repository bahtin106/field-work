// supabase/functions/create_user/index.ts
// POST { email, password, role, full_name } -> { user_id }
// Создаёт пользователя в Auth, проставляет роль и имя в profiles.
// Доступно только администратору (проверка по таблице profiles).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: cors });
  }

  try {
    const SUPABASE_URL = Deno.env.get('PROJECT_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1) Проверяем, что вызывает авторизованный пользователь
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace('Bearer ', '');
    if (!jwt) return new Response('Unauthorized', { status: 401, headers: cors });

    // Клент с сервисным ключом, но пробрасываем JWT вызывающего для auth.getUser()
    const supabaseForCaller = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    const { data: caller, error: callerErr } = await supabaseForCaller.auth.getUser();
    if (callerErr || !caller?.user) {
      return new Response('Unauthorized', { status: 401, headers: cors });
    }

    // 2) Достаём роль вызывающего из profiles и проверяем admin
    const { data: prof, error: profErr } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', caller.user.id)
      .single();

    if (profErr || !prof || prof.role !== 'admin') {
      return new Response('Forbidden', { status: 403, headers: cors });
    }

    // 3) Парсим вход
    const body = await req.json().catch(() => ({}));
    const { email, password, role, full_name } = body || {};

    if (!email || !password || !role) {
      return new Response('email, password, role are required', { status: 400, headers: cors });
    }
    if (!['admin', 'dispatcher', 'worker'].includes(role)) {
      return new Response('invalid role', { status: 400, headers: cors });
    }
    if (String(password).length < 8) {
      return new Response('password must be at least 8 chars', { status: 400, headers: cors });
    }

    // 4) Создаём пользователя в Auth
    console.log('Creating user with email:', email);

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {},
    });

    if (createErr) {
      console.error('Auth createUser failed:', {
        error: createErr,
        message: createErr?.message,
        status: createErr?.status,
        code: createErr?.code,
        name: createErr?.name,
      });

      // Если ошибка связана с дублированием email
      if (createErr.message?.includes('already') || createErr.message?.includes('exists')) {
        return new Response('User with this email already exists', {
          status: 400,
          headers: cors,
        });
      }

      return new Response(`Auth create error: ${createErr?.message ?? 'unknown'}`, {
        status: 400,
        headers: cors,
      });
    }

    if (!created?.user) {
      console.error('Created user is null/undefined');
      return new Response('Auth create error: User not created', {
        status: 400,
        headers: cors,
      });
    }

    const userId = created.user.id;
    console.log('User created successfully:', userId);

    // 5) Получаем company_id создателя
    const { data: creatorProfile } = await supabaseAdmin
      .from('profiles')
      .select('company_id')
      .eq('id', caller.user.id)
      .single();

    const companyId = creatorProfile?.company_id;

    if (!companyId) {
      console.error('Creator has no company_id');
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return new Response('Creator must have company_id', {
        status: 400,
        headers: cors,
      });
    }

    // 6) Ждем немного, чтобы триггер успел создать профиль (если есть)
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Проверяем существует ли профиль
    console.log('Checking if profile exists...');
    const { data: existingProfile, error: checkErr } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (checkErr) {
      console.error('Error checking profile:', checkErr);
    }

    let profileErr = null;

    if (existingProfile) {
      // Профиль уже есть (создан триггером) - обновляем
      console.log('Profile exists, updating...');
      const { error } = await supabaseAdmin
        .from('profiles')
        .update({ role, full_name, company_id: companyId })
        .eq('id', userId);
      profileErr = error;
    } else {
      // Профиля нет - создаем
      console.log('Profile does not exist, inserting...');
      const { error } = await supabaseAdmin.from('profiles').insert({
        id: userId,
        role,
        full_name,
        email,
        company_id: companyId,
      });
      profileErr = error;
    }

    if (profileErr) {
      console.error('Profile create/update failed:', {
        error: profileErr,
        message: profileErr.message,
        code: profileErr.code,
      });
      // откат, чтобы не оставлять "голого" юзера без профиля
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return new Response(`Profile error: ${profileErr.message}`, {
        status: 400,
        headers: cors,
      });
    }

    return new Response(JSON.stringify({ user_id: userId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  } catch (e) {
    return new Response(`Internal error: ${e instanceof Error ? e.message : String(e)}`, {
      status: 500,
      headers: cors,
    });
  }
});
