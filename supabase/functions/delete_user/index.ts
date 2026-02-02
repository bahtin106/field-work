// supabase/functions/delete_user/index.ts
// Полное удаление сотрудника (hard delete) с обязательным переназначением заявок.
// ВНИМАНИЕ: удаляет запись из auth и profiles.

import { serve } from 'https://deno.land/std@0.210.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

type ReqBody = {
  user_id: string;
  reassign_to?: string | null;
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
      status: 200,
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
      global: { headers: { 'x-application': 'edge-delete-user' } },
    });

    // Авторизация: только admin
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) throw new Error('Missing auth token');

    const { data: authData, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !authData?.user) throw new Error('Auth failed');

    const { data: meProfile, error: meErr } = await admin
      .from('profiles')
      .select('id, role')
      .eq('id', authData.user.id)
      .single();
    if (meErr || !meProfile) throw new Error('Profile not found');
    if (meProfile.role !== 'admin') throw new Error('Access denied');

    const { user_id, reassign_to } = body;

    if (user_id === authData.user.id) throw new Error('Cannot delete yourself');

    // Проверяем, что пользователь существует
    const { data: target, error: targetErr } = await admin
      .from('profiles')
      .select('id')
      .eq('id', user_id)
      .single();
    if (targetErr || !target) throw new Error('User not found');

    // Подсчитываем все заявки сотрудника
    const { count: totalCount, error: totalCountError } = await admin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', user_id);
    if (totalCountError) throw new Error('Orders count failed: ' + totalCountError.message);

    // При наличии заявок обязателен преемник
    if ((totalCount ?? 0) > 0 && !reassign_to) {
      throw new Error('Successor is required for delete');
    }

    // Проверяем преемника (если указан)
    if (reassign_to) {
      const { data: successor, error: succErr } = await admin
        .from('profiles')
        .select('id, is_suspended')
        .eq('id', reassign_to)
        .single();
      if (succErr || !successor) throw new Error('Successor not found');
      if (successor.is_suspended) throw new Error('Successor is suspended');

      // Переназначаем все заявки (любого статуса), чтобы не терять связность
      const { error: reassignErr } = await admin
        .from('orders')
        .update({ assigned_to: reassign_to })
        .eq('assigned_to', user_id);
      if (reassignErr) throw new Error('Orders reassign failed: ' + reassignErr.message);
    }

    // Удаляем профиль
    const { error: deleteProfileErr } = await admin.from('profiles').delete().eq('id', user_id);
    if (deleteProfileErr) throw new Error('Profile delete failed: ' + deleteProfileErr.message);

    // Удаляем пользователя из auth
    const { error: deleteAuthErr } = await admin.auth.admin.deleteUser(user_id);
    if (deleteAuthErr) throw new Error('Auth delete failed: ' + deleteAuthErr.message);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json', ...cors },
      status: 200,
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, message: e?.message ?? 'Unknown error' }), {
      headers: { 'Content-Type': 'application/json', ...cors },
      status: 200,
    });
  }
});
