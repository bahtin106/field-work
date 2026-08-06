import { supabase } from '../../../lib/supabase';

const ORDER_CUSTOMER_PAYMENT_SELECT = `
  id,
  company_id,
  order_id,
  amount,
  payment_method,
  money_holder,
  paid_at,
  note,
  source,
  created_by,
  updated_by,
  created_at,
  updated_at
`;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value, fieldName) {
  const normalized = String(value || '').trim();
  if (!UUID_RE.test(normalized)) {
    throw new Error(`${fieldName} is required`);
  }
  return normalized;
}

export async function listOrderCustomerPayments(orderId) {
  const normalizedOrderId = requireUuid(orderId, 'Order id');
  const { data, error } = await supabase
    .from('order_customer_payments')
    .select(ORDER_CUSTOMER_PAYMENT_SELECT)
    .eq('order_id', normalizedOrderId)
    .order('paid_at', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function upsertOrderCustomerPayment(payload) {
  const orderId = requireUuid(payload?.order_id, 'Order id');
  const body = {
    ...(payload?.id ? { id: requireUuid(payload.id, 'Payment id') } : null),
    order_id: orderId,
    amount: payload?.amount,
    payment_method: String(payload?.payment_method || '').trim(),
    money_holder: String(payload?.money_holder || '').trim(),
    paid_at: payload?.paid_at || new Date().toISOString(),
    note: String(payload?.note || '').trim() || null,
  };
  const { data, error } = await supabase.rpc('upsert_order_customer_payment_v1', {
    p_payload: body,
  });

  if (error) throw error;
  return data || null;
}

export async function deleteOrderCustomerPayment(paymentId) {
  const normalizedPaymentId = requireUuid(paymentId, 'Payment id');
  const { data, error } = await supabase.rpc('delete_order_customer_payment_v1', {
    p_payment_id: normalizedPaymentId,
  });

  if (error) throw error;
  return data !== false;
}
