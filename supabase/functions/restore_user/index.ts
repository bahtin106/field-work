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

    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return new Response('Unauthorized', { status: 401, headers: cors });
    }

    const { data: callerAuth, error: callerAuthError } = await supabaseAdmin.auth.getUser(token);
    if (callerAuthError || !callerAuth?.user?.id) {
      return new Response('Unauthorized', { status: 401, headers: cors });
    }

    const { data: callerProfile, error: callerProfileError } = await supabaseAdmin
      .from('profiles')
      .select('id, role, company_id')
      .eq('id', callerAuth.user.id)
      .single();
    if (callerProfileError || !callerProfile || callerProfile.role !== 'admin') {
      return new Response('Forbidden', { status: 403, headers: cors });
    }

    const normalizedEmail = String(email || '').trim().toLowerCase();
    const { data: restoredProfile, error: restoredProfileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .ilike('email', normalizedEmail)
      .maybeSingle();
    if (restoredProfileError) {
      return new Response('Profile lookup failed', { status: 400, headers: cors });
    }
    if (!restoredProfile || restoredProfile.company_id !== callerProfile.company_id) {
      return new Response('User not found', { status: 404, headers: cors });
    }

    console.log(`[restore_user] Attempting to restore user: ${normalizedEmail}`);

    // 1. Проверяем, существует ли уже
    const { data: existing } = await supabaseAdmin.auth.admin.listUsers();
    const userExists = existing?.users?.some((u) => String(u.email || '').toLowerCase() === normalizedEmail);

    if (userExists) {
      console.log(`[restore_user] User already exists: ${email}`);
      return new Response(
        JSON.stringify({ error: 'User already exists', email: normalizedEmail }),
        { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Создаём нового пользователя с подтверждённым email
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
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
    const profile = restoredProfile;

    // 4. Если профиля нет, создаём (опционально)
    if (!profile && newUser?.user?.id) {
      await supabaseAdmin.from('profiles').insert({
        id: newUser.user.id,
        email: normalizedEmail,
        first_name: firstName || '',
        last_name: lastName || '',
        created_at: new Date().toISOString(),
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `User ${normalizedEmail} restored successfully`,
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
