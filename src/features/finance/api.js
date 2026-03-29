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
  conditions_json,
  recipient_mode,
  expense_payer,
  apply_to_existing,
  note_template,
  is_enabled,
  sort_order,
  created_at,
  updated_at
`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROUTE_PLACEHOLDER_RE = /^\[[^\]]+\]$/;

function normalizeId(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function isValidUuid(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized || ROUTE_PLACEHOLDER_RE.test(normalized)) return false;
  return UUID_RE.test(normalized);
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

function normalizeRuleConditions(value) {
  const fallback = { op: 'all', conditions: [] };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const op = String(value.op || 'all').trim().toLowerCase();
  const rawConditions = Array.isArray(value.conditions) ? value.conditions : [];
  const conditions = rawConditions
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const fact = String(item.fact || '').trim();
      const operator = String(item.operator || '').trim();
      const conditionValue = item.value;
      if (!fact || !operator || conditionValue === undefined) return null;
      return { fact, operator, value: conditionValue };
    })
    .filter(Boolean);
  return { op: op === 'all' ? 'all' : 'all', conditions };
}

function normalizePercentBase(kind, value) {
  const normalizedKind = String(kind || 'expense').trim();
  const normalizedBase = String(value || 'base_price').trim();
  const allowed =
    normalizedKind === 'discount'
      ? ['base_price', 'gross_before_discount', 'income_total', 'gross_after_discount']
      : ['base_price', 'gross_before_discount', 'gross_after_discount', 'income_total'];
  return allowed.includes(normalizedBase) ? normalizedBase : 'base_price';
}

export async function listOrderFinanceEntries(orderId) {
  if (!isValidUuid(orderId)) return [];
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
  if (!Array.isArray(data)) return [];
  return data.map((row) => {
    const normalized = { ...row };
    if (typeof normalized.conditions_json === 'string') {
      try {
        normalized.conditions_json = JSON.parse(normalized.conditions_json);
      } catch {
        normalized.conditions_json = { op: 'all', conditions: [] };
      }
    }
    if (!normalized.conditions_json || typeof normalized.conditions_json !== 'object') {
      normalized.conditions_json = { op: 'all', conditions: [] };
    }
    return normalized;
  });
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
    conditions_json: normalizeRuleConditions(payload?.conditions_json),
    recipient_mode: String(payload?.recipient_mode || 'none').trim(),
    expense_payer: normalizeExpensePayer(payload?.expense_payer),
    note_template: payload?.note_template ? String(payload.note_template).trim() : null,
    apply_to_existing: payload?.apply_to_existing === true,
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

export async function deleteCompanyFinanceRule(payload) {
  const isObjectPayload = payload && typeof payload === 'object' && !Array.isArray(payload);
  const ruleId = isObjectPayload ? payload.ruleId : payload;
  const deleteExistingEntries = isObjectPayload ? payload.deleteExistingEntries === true : false;
  if (!ruleId) throw new Error('Rule id is required');

  const { error } = await supabase.rpc('delete_company_finance_rule', {
    p_rule_id: ruleId,
    p_delete_existing_entries: deleteExistingEntries,
  });

  if (error && !deleteExistingEntries) {
    const fallback = await supabase.from('company_finance_rules').delete().eq('id', ruleId);
    if (fallback.error) throw fallback.error;
    return true;
  }
  if (error) throw error;
  return true;
}
