// supabase/functions/invite_user/index.ts
// POST { email, first_name, last_name, full_name, phone, birthdate, role, department_id }
// Отправляет приглашение сотруднику с волшебной ссылкой для создания пароля.
// Требует авторизацию (admin/dispatcher только)

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

    // Получаем текущего пользователя из токена
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    
    console.log('[invite_user] Auth header:', authHeader ? 'present' : 'missing');
    
    if (!token) {
      console.log('[invite_user] No token provided');
      return new Response('Unauthorized - no token', { status: 401, headers: cors });
    }

    const { data: { user: currentUser }, error: userError } = await supabaseAdmin.auth.getUser(token);
    
    console.log('[invite_user] User lookup result:', currentUser?.id, 'Error:', userError?.message);
    
    if (!currentUser) {
      console.log('[invite_user] Current user not found');
      return new Response('Unauthorized - invalid token', { status: 401, headers: cors });
    }

    // Проверяем права (должен быть admin или dispatcher)
    const { data: currentProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role, company_id')
      .eq('id', currentUser.id)
      .maybeSingle();

    console.log('[invite_user] Profile lookup:', currentProfile?.role, 'Error:', profileError?.message);

    if (!currentProfile || !['admin', 'dispatcher'].includes(currentProfile.role)) {
      console.log('[invite_user] Forbidden - wrong role:', currentProfile?.role);
      return new Response('Forbidden: only admin/dispatcher can invite users', { status: 403, headers: cors });
    }

    // Парсим входные данные
    const body = await req.json().catch(() => ({}));
    const {
      email,
      first_name,
      last_name,
      full_name,
      phone,
      birthdate,
      role,
      department_id,
    } = body || {};

    // Валидация
    if (!email) {
      return new Response('email is required', { status: 400, headers: cors });
    }

    const emailLower = String(email).trim().toLowerCase();

    // Проверяем что email не занят
    const { data: existingUser } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', emailLower)
      .maybeSingle();

    if (existingUser) {
      return new Response('User with this email already exists', { status: 400, headers: cors });
    }

    // Используем встроенный метод Supabase для отправки приглашения
    // inviteUserByEmail отправляет письмо с ссылкой для подтверждения и создания пароля
    const inviteOptions = {
      redirectTo: 'workorders://auth/verify-email',
      data: {
        first_name: first_name || null,
        last_name: last_name || null,
        full_name: full_name || null,
        invited_at: new Date().toISOString(),
        invited_by: currentUser.id,
      },
    };

    console.log('[invite_user] Calling inviteUserByEmail for:', emailLower);
    
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      emailLower,
      inviteOptions
    );

    console.log('[invite_user] Invite result:', inviteData?.user?.id, 'Error:', inviteError?.message);

    if (inviteError) {
      console.error('Invite failed:', inviteError);
      return new Response(`Invite error: ${inviteError?.message ?? 'unknown'}`, {
        status: 400,
        headers: cors,
      });
    }

    const newUserId = inviteData?.user?.id;
    if (!newUserId) {
      return new Response('Failed to create invite', { status: 400, headers: cors });
    }

    // Создаём профиль для пользователя
    const profileData = {
      id: newUserId,
      email: emailLower,
      first_name: first_name || null,
      last_name: last_name || null,
      full_name: full_name || null,
      phone: phone || null,
      birthdate: birthdate || null,
      role: role || 'worker',
      department_id: department_id || null,
      company_id: currentProfile.company_id,
      invited_at: new Date().toISOString(),
      invited_by: currentUser.id,
    };

    const { error: createProfileError } = await supabaseAdmin
      .from('profiles')
      .insert(profileData);

    if (createProfileError) {
      console.error('Profile creation failed:', createProfileError);
      // Профиль уже может быть создан автоматически, попробуем update
      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update(profileData)
        .eq('id', newUserId);
      
      if (updateError) {
        console.error('Profile update failed:', updateError);
      }
    }

    console.log('Invitation sent to:', emailLower, 'User ID:', newUserId);

    return new Response(
      JSON.stringify({
        success: true,
        user_id: newUserId,
        email: emailLower,
        message: 'Invitation sent',
      }),
      {
        status: 200,
        headers: {
          ...cors,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(`Internal error: ${error?.message ?? 'unknown'}`, {
      status: 500,
      headers: cors,
    });
  }
});
