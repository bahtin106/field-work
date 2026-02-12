// Edge Function: deactivate_employee
// Деактивирует сотрудника (soft delete) с опциональным переназначением заявок

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Отсутствует авторизация' }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('PROJECT_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: 'Отсутствуют серверные ключи Supabase' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Проверяем права вызывающего
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Ошибка авторизации' }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    // Проверяем роль (только admin)
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: 'Профиль не найден' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    if (profile.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'Только администратор может деактивировать сотрудников' }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    const { user_id, reassign_to } = await req.json();

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: 'Не указан ID сотрудника' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    // Проверяем, что сотрудник не деактивирует сам себя
    if (user_id === user.id) {
      return new Response(
        JSON.stringify({ error: 'Нельзя деактивировать свой аккаунт' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    // Проверяем существование деактивируемого сотрудника
    const { data: targetUser, error: targetError } = await supabaseAdmin
      .from('profiles')
      .select('id, is_suspended')
      .eq('id', user_id)
      .single();

    if (targetError || !targetUser) {
      return new Response(
        JSON.stringify({ error: 'Сотрудник не найден' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    if (targetUser.is_suspended) {
      return new Response(
        JSON.stringify({ error: 'Сотрудник уже деактивирован' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    // Если указан преемник, переназначаем заявки
    if (reassign_to) {
      // Проверяем, что преемник существует и активен
      const { data: successor, error: successorError } = await supabaseAdmin
        .from('profiles')
        .select('id, is_suspended')
        .eq('id', reassign_to)
        .single();

      if (successorError || !successor) {
        return new Response(
          JSON.stringify({ error: 'Преемник не найден' }),
          { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
        );
      }

      if (successor.is_suspended) {
        return new Response(
          JSON.stringify({ error: 'Преемник деактивирован, выберите другого сотрудника' }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
        );
      }

      // Переназначаем все активные заявки
      const { error: reassignError } = await supabaseAdmin
        .from('orders')
        .update({ assigned_to: reassign_to })
        .eq('assigned_to', user_id)
        .not('status', 'in', '("completed","cancelled")');

      if (reassignError) {
        console.error('Ошибка переназначения заявок:', reassignError);
        return new Response(
          JSON.stringify({ error: 'Ошибка при переназначении заявок' }),
          { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
        );
      }
    }

    // Деактивируем сотрудника (soft delete)
    const now = new Date().toISOString();
    const { error: deactivateError } = await supabaseAdmin
      .from('profiles')
      .update({
        is_suspended: true,
        suspended_at: now,
      })
      .eq('id', user_id);

    if (deactivateError) {
      console.error('Ошибка деактивации сотрудника:', deactivateError);
      return new Response(
        JSON.stringify({ error: 'Ошибка при деактивации сотрудника' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: reassign_to
          ? 'Сотрудник деактивирован, заявки переназначены'
          : 'Сотрудник деактивирован',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  } catch (error) {
    console.error('Ошибка в deactivate_employee:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Внутренняя ошибка сервера' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
});
