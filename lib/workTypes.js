// src/lib/workTypes.js
// Единая точка работы с видами работ и флагом companies.use_work_types
// Предполагается, что у тебя есть экспортированный клиент Supabase: import { supabase } from '../supabase'
//
// Все методы бросают Error при неуспехе — ловишь в UI и показываешь тост.

import { supabase } from './supabase';

/** Получить флаг use_work_types и список видов для компании */
export async function fetchWorkTypes(companyId) {
  if (!companyId) throw new Error('companyId is required');

  const [{ data: company, error: ce }, { data: types, error: te }] = await Promise.all([
    supabase.from('companies').select('id,use_work_types').eq('id', companyId).single(),
    supabase.from('work_types').select('id, name, position, company_id, created_at, updated_at')
      .eq('company_id', companyId)
      .order('position', { ascending: true }),
  ]);
  if (ce) throw ce;
  if (te) throw te;

  return { useWorkTypes: !!company?.use_work_types, types: types || [] };
}

/** Включить/выключить use_work_types для компании (только админ по RLS) */
export async function setUseWorkTypes(companyId, enabled) {
  if (!companyId) throw new Error('companyId is required');

  const { error } = await supabase
    .from('companies')
    .update({ use_work_types: !!enabled })
    .eq('id', companyId);
  if (error) throw error;
}

/** Создать вид работ (ограничение триггером: не более 10 на компанию) */
export async function createWorkType(companyId, { name, position }) {
  if (!companyId) throw new Error('companyId is required');
  if (!name || !name.trim()) throw new Error('name is required');

  // position опционален — на бэке по умолчанию 1..10 и уникальность (company_id, position)
  const payload = { company_id: companyId, name: name.trim() };
  if (typeof position === 'number') payload.position = position;

  const { data, error } = await supabase
    .from('work_types')
    .insert(payload)
    .select('id, name, position, company_id, created_at, updated_at')
    .single();

  if (error) throw error; // при >10 вернётся ошибка из триггера
  return data;
}

/** Переименовать/изменить позицию вида работ */
export async function updateWorkType(id, patch = {}) {
  if (!id) throw new Error('id is required');

  const upd = {};
  if (patch.name !== undefined) {
    if (!patch.name || !String(patch.name).trim()) throw new Error('name must be non-empty');
    upd.name = String(patch.name).trim();
  }
  if (patch.position !== undefined) {
    if (typeof patch.position !== 'number') throw new Error('position must be a number');
    upd.position = patch.position;
  }
  if (Object.keys(upd).length === 0) return;

  const { data, error } = await supabase
    .from('work_types')
    .update(upd)
    .eq('id', id)
    .select('id, name, position, company_id, created_at, updated_at')
    .single();

  if (error) throw error;
  return data;
}

/** Удалить вид работ */
export async function deleteWorkType(id) {
  if (!id) throw new Error('id is required');
  const { error } = await supabase.from('work_types').delete().eq('id', id);
  if (error) throw error;
}

/** Привязать вид работ к заявке (orders), триггер проверит компанию/обязательность */
export async function setOrderWorkType(orderId, workTypeId) {
  if (!orderId) throw new Error('orderId is required');
  // workTypeId может быть null, если флаг use_work_types=false
  const { error } = await supabase.from('orders').update({ work_type_id: workTypeId ?? null }).eq('id', orderId);
  if (error) throw error;
}

/** Утилита: получить текущую компанию пользователя из profiles */
export async function getMyCompanyId() {
  const { data: { user }, error: aerr } = await supabase.auth.getUser();
  if (aerr) throw aerr;
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase.from('profiles').select('company_id').eq('id', user.id).single();
  if (error) throw error;
  return data?.company_id || null;
}
