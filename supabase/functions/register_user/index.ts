// supabase/functions/register_user/index.ts
// POST { email, password, first_name, last_name, full_name, phone, birthdate, account_type, company_name }
// Создаёт первого пользователя новой компании (или solo-аккаунт).
// Доступно без авторизации (для регистрации новых пользователей).

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

    // Парсим входные данные
    const body = await req.json().catch(() => ({}));
    const {
      email,
      password,
      first_name,
      last_name,
      full_name,
      phone,
      birthdate,
      account_type,
      company_name,
    } = body || {};

    // Валидация обязательных полей
    if (!email || !password || !first_name || !last_name) {
      return new Response('email, password, first_name, last_name are required', {
        status: 400,
        headers: cors,
      });
    }

    if (!account_type || !['solo', 'company'].includes(account_type)) {
      return new Response('account_type must be solo or company', { status: 400, headers: cors });
    }

    if (account_type === 'company' && !company_name) {
      return new Response('company_name is required for company account type', {
        status: 400,
        headers: cors,
      });
    }

    if (String(password).length < 8) {
      return new Response('password must be at least 8 chars', { status: 400, headers: cors });
    }

    // Проверка email
    const emailLower = String(email).trim().toLowerCase();
    const { data: existingUser } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', emailLower)
      .maybeSingle();

    if (existingUser) {
      return new Response('User with this email already exists', { status: 400, headers: cors });
    }

    console.log('Creating user with email:', emailLower);

    // Создаём пользователя в Auth
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: emailLower,
      password,
      email_confirm: true,
      user_metadata: {},
    });

    if (createErr) {
      console.error('Auth createUser failed:', {
        error: createErr,
        message: createErr?.message,
      });

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

    let companyId = null;

    // Создаём компанию если нужно
    if (account_type === 'company') {
      console.log('Creating company:', company_name);
      const { data: newCompany, error: companyErr } = await supabaseAdmin
        .from('companies')
        .insert({
          name: String(company_name).trim(),
          created_by: userId,
        })
        .select('id')
        .single();

      if (companyErr) {
        console.error('Company create failed:', companyErr);
        await supabaseAdmin.auth.admin.deleteUser(userId);
        return new Response(`Company error: ${companyErr.message}`, {
          status: 400,
          headers: cors,
        });
      }

      companyId = newCompany?.id;
      console.log('Company created:', companyId);
    }

    // Ждём, чтобы триггер успел создать профиль
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

    const profileData = {
      role: 'admin', // Первый пользователь всегда админ
      first_name: String(first_name).trim(),
      last_name: String(last_name).trim(),
      full_name: String(full_name || `${first_name} ${last_name}`).trim(),
      email: emailLower,
      phone: phone ? String(phone).replace(/\D/g, '') : null,
      birthdate: birthdate || null,
      company_id: companyId,
    };

    if (existingProfile) {
      // Профиль уже есть (создан триггером) - обновляем
      console.log('Profile exists, updating...');
      const { error } = await supabaseAdmin.from('profiles').update(profileData).eq('id', userId);
      profileErr = error;
    } else {
      // Профиля нет - создаем
      console.log('Profile does not exist, inserting...');
      const { error } = await supabaseAdmin.from('profiles').insert({
        id: userId,
        ...profileData,
      });
      profileErr = error;
    }

    if (profileErr) {
      console.error('Profile create/update failed:', {
        error: profileErr,
        message: profileErr.message,
        code: profileErr.code,
      });
      // Откат
      if (companyId) {
        await supabaseAdmin.from('companies').delete().eq('id', companyId);
      }
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return new Response(`Profile error: ${profileErr.message}`, {
        status: 400,
        headers: cors,
      });
    }

    console.log('Registration completed successfully');

    return new Response(
      JSON.stringify({
        user_id: userId,
        company_id: companyId,
        success: true,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...cors },
      },
    );
  } catch (e) {
    console.error('Unexpected error:', e);
    return new Response(`Internal error: ${e instanceof Error ? e.message : String(e)}`, {
      status: 500,
      headers: cors,
    });
  }
});
