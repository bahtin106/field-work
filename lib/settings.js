// Единая точка для работы с гибкими настройками и RPC
import { supabase } from '../lib/supabase'

// --- Активные настройки (если хочешь дергать без провайдера) ---
export async function fetchActiveSettings() {
  const { data, error } = await supabase.rpc('get_active_settings')
  if (error) throw error
  return data || {}
}

// --- Схема формы по контексту: 'create' | 'edit' | 'view' | 'list' | 'calendar' ---
export async function fetchFormSchema(context = 'create') {
  const { data, error } = await supabase.rpc('get_form_schema', { p_context: context })
  if (error) throw error
  return data || { context, fields: [] }
}

// --- Заявка с подстановкой кастом-полей ---
export async function fetchOrderWithCustom(orderId) {
  const { data, error } = await supabase.rpc('get_order_with_custom', { p_order_id: orderId })
  if (error) throw error
  return data // jsonb или null
}

// --- Полная заявка (builtin+custom) + payout (если доступен) ---
export async function fetchOrderFull(orderId) {
  const { data, error } = await supabase.rpc('get_order_full', { p_order_id: orderId })
  if (error) throw error
  return data // jsonb или null
}

// --- Сохранение кастом-полей заявки (писать только custom-поля по field_key) ---
export async function saveOrderCustom(orderId, payloadByFieldKey) {
  // payloadByFieldKey: { status_v2: 'in_progress', priority: 'high', ... }
  const { data, error } = await supabase.rpc('save_order_custom_fields', {
    p_order_id: orderId,
    p_data: payloadByFieldKey
  })
  if (error) throw error
  return data // void
}

// --- Предпросмотр выплаты по заявке ---
export async function previewPayout(orderId) {
  const { data, error } = await supabase.rpc('compute_payout', { p_order_id: orderId })
  if (error) throw error
  return data // { order_id, source, amount, ... }
}

// --- Доступные пользователю выплаты (админ — все, исполнитель — свои) ---
export async function fetchMyPayouts() {
  const { data, error } = await supabase.rpc('get_my_payouts')
  if (error) throw error
  return Array.isArray(data) ? data : []
}

// --- Утилиты маппинга: field_key -> value в orders (builtin/custom) ---
export function readValueFromOrder(orderJson, field) {
  // field: объект из get_form_schema / SettingsProvider (f.field_key, f.storage_target, f.custom_key)
  if (!orderJson || !field) return null
  const { field_key, storage_target, custom_key } = field

  if (storage_target === 'custom') {
    const custom = orderJson.custom || {}
    return custom_key ? custom[custom_key] ?? null : null
  }

  // builtin: берём прямо из корня json заявки
  return orderJson[field_key] ?? null
}

// Собрать payload для saveOrderCustom по списку полей и значениям формы
export function buildCustomPayload(fields, formValuesByFieldKey) {
  const payload = {}
  for (const f of fields || []) {
    if (f.storage_target === 'custom') {
      const key = f.field_key
      if (key in (formValuesByFieldKey || {})) {
        payload[key] = formValuesByFieldKey[key]
      }
    }
  }
  return payload
}
