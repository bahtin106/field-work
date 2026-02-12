// Edge Function: check_employee_orders
// Проверяет количество активных заявок у сотрудника перед его деактивацией

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

    // Проверяем роль (только admin может деактивировать)
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

    if (profile.role !== 'admin' && profile.role !== 'dispatcher') {
      return new Response(
        JSON.stringify({ error: 'Недостаточно прав' }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    const { user_id } = await req.json();

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: 'Не указан ID сотрудника' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    // Проверяем, что деактивируемый сотрудник существует
    const { data: targetUser, error: targetError } = await supabaseAdmin
      .from('profiles')
      .select('id, first_name, last_name, full_name')
      .eq('id', user_id)
      .single();

    if (targetError || !targetUser) {
      return new Response(
        JSON.stringify({ error: 'Сотрудник не найден' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    // Считаем активные заявки (не завершенные и не отмененные)
    const { count: activeCount, error: countError } = await supabaseAdmin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', user_id)
      .not('status', 'in', '("completed","cancelled")');

    if (countError) {
      console.error('Ошибка подсчета заявок:', countError);
      return new Response(
        JSON.stringify({ error: 'Ошибка при проверке заявок' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    // Получаем список доступных сотрудников для переназначения (кроме самого деактивируемого)
    const { data: availableEmployees, error: employeesError } = await supabaseAdmin
      .from('profiles')
      .select('id, first_name, last_name, full_name, role')
      .neq('id', user_id)
      .is('is_suspended', false)
      .order('first_name', { ascending: true });

    if (employeesError) {
      console.error('Ошибка получения списка сотрудников:', employeesError);
    }

    // Считаем все заявки сотрудника (для удаления)
    const { count: totalCount, error: totalCountError } = await supabaseAdmin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', user_id);

    if (totalCountError) {
      console.error('Ошибка подсчета всех заявок:', totalCountError);
      return new Response(
        JSON.stringify({ error: 'Ошибка при проверке всех заявок' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        user: targetUser,
        activeOrdersCount: activeCount ?? 0,
        totalOrdersCount: totalCount ?? 0,
        hasOrders: (totalCount ?? 0) > 0,
        availableEmployees: availableEmployees ?? [],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  } catch (error) {
    console.error('Ошибка в check_employee_orders:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Внутренняя ошибка сервера' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
});
