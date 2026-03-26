import { supabase } from '../lib/supabase';

// Legacy helper for backward-compatible order payloads.
export async function fetchOrderWithCustom(orderId) {
  const { data, error } = await supabase.rpc('get_order_with_custom', { p_order_id: orderId });
  if (error) throw error;
  return data;
}

// Full order + payout (if available).
export async function fetchOrderFull(orderId) {
  const { data, error } = await supabase.rpc('get_order_full', { p_order_id: orderId });
  if (error) throw error;
  return data;
}

// Legacy helper: save custom order fields.
export async function saveOrderCustom(orderId, payloadByFieldKey) {
  const { data, error } = await supabase.rpc('save_order_custom_fields', {
    p_order_id: orderId,
    p_data: payloadByFieldKey,
  });
  if (error) throw error;
  return data;
}

// Payout preview for order.
export async function previewPayout(orderId) {
  const { data, error } = await supabase.rpc('compute_payout', { p_order_id: orderId });
  if (error) throw error;
  return data;
}

// User payouts (admin: all, worker: own).
export async function fetchMyPayouts() {
  const { data, error } = await supabase.rpc('get_my_payouts');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

// field_key -> value mapping for orders.
export function readValueFromOrder(orderJson, field) {
  if (!orderJson || !field) return null;
  const { field_key, storage_target } = field;

  if (storage_target === 'custom') return null;

  return orderJson[field_key] ?? null;
}

// Legacy helper kept for compatibility with old RPC contracts.
export function buildCustomPayload(fields, formValuesByFieldKey) {
  void fields;
  void formValuesByFieldKey;
  return {};
}
