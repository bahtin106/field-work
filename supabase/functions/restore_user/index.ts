// supabase/functions/restore_user/index.ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

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
    const { email, password, firstName, lastName } = await req.json();

    if (!email || !password) {
      return new Response(
        JSON.stringify({ error: 'email and password required' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    console.log(`[restore_user] Attempting to restore user: ${email}`);

    // 1. Проверяем, существует ли уже
    const { data: existing } = await supabaseAdmin.auth.admin.listUsers();
    const userExists = existing?.users?.some((u) => u.email === email);

    if (userExists) {
      console.log(`[restore_user] User already exists: ${email}`);
      return new Response(
        JSON.stringify({ error: 'User already exists', email }),
        { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Создаём нового пользователя с подтверждённым email
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Сразу подтверждаем
      user_metadata: {
        first_name: firstName || '',
        last_name: lastName || '',
      },
    });

    if (createError) {
      console.error(`[restore_user] Create error:`, createError);
      return new Response(
        JSON.stringify({ error: createError.message }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[restore_user] User created successfully:`, newUser?.user?.id);

    // 3. Получаем профиль из public.profiles если есть
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    // 4. Если профиля нет, создаём (опционально)
    if (!profile && newUser?.user?.id) {
      await supabaseAdmin.from('profiles').insert({
        id: newUser.user.id,
        email,
        first_name: firstName || '',
        last_name: lastName || '',
        created_at: new Date().toISOString(),
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `User ${email} restored successfully`,
        userId: newUser?.user?.id,
      }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[restore_user] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
});
