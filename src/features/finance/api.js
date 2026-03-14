import { supabase } from '../../../lib/supabase';

const ORDER_FINANCE_SELECT = `
  id,
  company_id,
  order_id,
  rule_id,
  kind,
  title,
  note,
  calc_mode,
  input_amount,
  input_percent,
  percent_base,
  calculated_amount,
  expense_payer,
  photo_urls,
  recipient_user_id,
  requires_note,
  note_visible,
  visibility_scope,
  is_system,
  sort_order,
  created_at,
  updated_at,
  recipient:profiles!order_finance_entries_recipient_user_id_fkey(id, full_name)
`;

const FINANCE_RULE_SELECT = `
  id,
  company_id,
  name,
  kind,
  calc_mode,
  fixed_amount,
  percent_value,
  percent_base,
  recipient_mode,
  recipient_user_id,
  note_template,
  requires_note,
  note_visible,
  is_enabled,
  sort_order,
  created_at,
  updated_at,
  recipient:profiles!company_finance_rules_recipient_user_id_fkey(id, full_name)
`;

function normalizeId(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function normalizeMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100) / 100);
}

function normalizePercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 10000) / 10000);
}

function normalizeExpensePayer(value) {
  return String(value || '').trim() === 'executor' ? 'executor' : 'company';
}

function normalizePercentBase(kind, value) {
  const normalizedKind = String(kind || 'expense').trim();
  const normalizedBase = String(value || 'base_price').trim();
  const allowed =
    normalizedKind === 'discount'
      ? ['base_price', 'gross_before_discount']
      : ['base_price', 'gross_before_discount', 'gross_after_discount'];
  return allowed.includes(normalizedBase) ? normalizedBase : 'base_price';
}

export async function listOrderFinanceEntries(orderId) {
  if (!orderId) return [];
  const { data, error } = await supabase
    .from('order_finance_entries')
    .select(ORDER_FINANCE_SELECT)
    .eq('order_id', orderId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function upsertOrderFinanceEntry(payload) {
  const row = {
    company_id: normalizeId(payload?.company_id),
    order_id: normalizeId(payload?.order_id),
    kind: String(payload?.kind || 'expense').trim(),
    title: String(payload?.title || '').trim(),
    note: payload?.note ? String(payload.note).trim() : null,
    calc_mode: String(payload?.calc_mode || 'fixed').trim(),
    input_amount: normalizeMoney(payload?.input_amount),
    input_percent: normalizePercent(payload?.input_percent),
    percent_base: normalizePercentBase(payload?.kind, payload?.percent_base),
    expense_payer: normalizeExpensePayer(payload?.expense_payer),
    recipient_user_id: normalizeId(payload?.recipient_user_id),
    requires_note: payload?.requires_note === true,
    note_visible: payload?.note_visible !== false,
    visibility_scope: String(payload?.visibility_scope || 'all').trim(),
    sort_order: Number.isFinite(Number(payload?.sort_order)) ? Number(payload.sort_order) : 100,
  };
  const normalizedId = normalizeId(payload?.id);
  if (normalizedId) {
    row.id = normalizedId;
  }

  if (!row.title) throw new Error('Title is required');
  if (!row.company_id || !row.order_id) throw new Error('company_id and order_id are required');

  const { data, error } = await supabase
    .from('order_finance_entries')
    .upsert(row, { onConflict: 'id' })
    .select(ORDER_FINANCE_SELECT)
    .single();

  if (error) throw error;
  return data;
}

export async function deleteOrderFinanceEntry(entryId) {
  if (!entryId) throw new Error('Entry id is required');
  const { error } = await supabase.from('order_finance_entries').delete().eq('id', entryId);
  if (error) throw error;
  return true;
}

export async function listCompanyFinanceRules(companyId) {
  if (!companyId) return [];
  const { data, error } = await supabase
    .from('company_finance_rules')
    .select(FINANCE_RULE_SELECT)
    .eq('company_id', companyId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function upsertCompanyFinanceRule(payload) {
  const row = {
    company_id: normalizeId(payload?.company_id),
    name: String(payload?.name || '').trim(),
    kind: String(payload?.kind || 'expense').trim(),
    calc_mode: String(payload?.calc_mode || 'fixed').trim(),
    fixed_amount: normalizeMoney(payload?.fixed_amount),
    percent_value: normalizePercent(payload?.percent_value),
    percent_base: normalizePercentBase(payload?.kind, payload?.percent_base),
    recipient_mode: String(payload?.recipient_mode || 'none').trim(),
    recipient_user_id: normalizeId(payload?.recipient_user_id),
    note_template: payload?.note_template ? String(payload.note_template).trim() : null,
    requires_note: payload?.requires_note === true,
    note_visible: payload?.note_visible !== false,
    is_enabled: payload?.is_enabled !== false,
    sort_order: Number.isFinite(Number(payload?.sort_order)) ? Number(payload.sort_order) : 100,
  };
  const normalizedId = normalizeId(payload?.id);
  if (normalizedId) {
    row.id = normalizedId;
  }

  if (!row.company_id) throw new Error('company_id is required');
  if (!row.name) throw new Error('name is required');

  const { data, error } = await supabase
    .from('company_finance_rules')
    .upsert(row, { onConflict: 'id' })
    .select(FINANCE_RULE_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCompanyFinanceRule(ruleId) {
  if (!ruleId) throw new Error('Rule id is required');
  const { error } = await supabase.from('company_finance_rules').delete().eq('id', ruleId);
  if (error) throw error;
  return true;
}
