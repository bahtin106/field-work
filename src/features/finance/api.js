import { supabase } from '../../../lib/supabase';

import {
  assertMutationAuthCarrier,
  assertMutationPayloadCompany,
  pinMutationAuthorization,
} from '../../shared/security/mutationAuthCarrier';

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
  finance_effect,
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
  recipient:profiles!order_finance_entries_recipient_user_id_fkey(id, first_name, middle_name, last_name, full_name)
`;

const ORDER_FINANCE_SNAPSHOT_SELECT = `
  order_id,
  company_id,
  scheme_id,
  scheme_version_id,
  scheme_name,
  scheme_version_number,
  money_holder,
  customer_base_total,
  customer_charge_total,
  customer_discount_total,
  customer_total,
  worker_base_compensation_total,
  worker_bonus_total,
  worker_deduction_total,
  worker_compensation_total,
  worker_reimbursement_total,
  worker_payable_total,
  company_cost_total,
  company_margin_total,
  worker_paid_total,
  company_received_total,
  settlement_direction,
  settlement_amount,
  settlement_status,
  breakdown_json,
  calculated_at,
  locked_at
`;

const FINANCE_SCHEME_SELECT = `
  id,
  company_id,
  name,
  conditions_json,
  is_default,
  is_enabled,
  priority,
  current_version_id,
  archived_at,
  created_at,
  updated_at
`;

const FINANCE_SCHEME_VERSION_SELECT = `
  id,
  scheme_id,
  company_id,
  version_number,
  compensation_mode,
  fixed_amount,
  percent_value,
  percent_base,
  minimum_worker_amount,
  maximum_worker_amount,
  configuration_json,
  created_at
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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

const FINANCE_EFFECTS = new Set([
  'customer_charge',
  'customer_discount',
  'company_cost',
  'worker_reimbursement',
  'worker_bonus',
  'worker_deduction',
  'worker_payment',
  'company_remittance',
]);

function normalizeFinanceEffect(value, kind = 'expense', payer = 'company') {
  const normalized = String(value || '').trim();
  if (FINANCE_EFFECTS.has(normalized)) return normalized;
  if (String(kind || '') === 'income') return 'customer_charge';
  if (String(kind || '') === 'discount') return 'customer_discount';
  return normalizeExpensePayer(payer) === 'executor' ? 'worker_reimbursement' : 'company_cost';
}

function financeEffectKind(effect) {
  if (effect === 'customer_charge') return 'income';
  if (effect === 'customer_discount') return 'discount';
  return 'expense';
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

export async function listOrderFinanceEntries(orderId, signal = undefined) {
  if (!isValidUuid(orderId)) return [];
  let request = supabase
    .from('order_finance_entries')
    .select(ORDER_FINANCE_SELECT)
    .eq('order_id', orderId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function getOrderFinanceSnapshot(orderId, signal = undefined) {
  if (!isValidUuid(orderId)) return null;
  let request = supabase
    .from('order_finance_snapshots')
    .select(ORDER_FINANCE_SNAPSHOT_SELECT)
    .eq('order_id', orderId)
    .maybeSingle();
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return data || null;
}

export async function getOrderFinanceSchemeRule(orderId, signal = undefined) {
  if (!isValidUuid(orderId)) return null;
  let request = supabase.rpc('get_order_finance_scheme_rule_v2', {
    p_order_id: orderId,
  });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return data && typeof data === 'object' ? data : null;
}

export async function setOrderFinanceMoneyHolder({ orderId, moneyHolder }, authCarrier) {
  assertMutationAuthCarrier(authCarrier, { requireOfflineOwner: true });
  if (!isValidUuid(orderId)) throw new Error('Order id is required');
  const holder = String(moneyHolder || '').trim() === 'executor' ? 'executor' : 'company';
  const request = pinMutationAuthorization(
    supabase.rpc('set_order_finance_money_holder_v2', {
      p_order_id: orderId,
      p_money_holder: holder,
    }),
    authCarrier,
    { requireOfflineOwner: true },
  );
  const { data, error } = await request;
  assertMutationAuthCarrier(authCarrier, { requireOfflineOwner: true });
  if (error) throw error;
  return data !== false;
}

export async function setOrderFinanceSchemeDisabled({ orderId, isDisabled }, authCarrier) {
  assertMutationAuthCarrier(authCarrier, { requireOfflineOwner: true });
  if (!isValidUuid(orderId)) throw new Error('Order id is required');
  const request = pinMutationAuthorization(
    supabase.rpc('set_order_finance_scheme_disabled_v2', {
      p_order_id: orderId,
      p_is_disabled: isDisabled === true,
    }),
    authCarrier,
    { requireOfflineOwner: true },
  );
  const { data, error } = await request;
  assertMutationAuthCarrier(authCarrier, { requireOfflineOwner: true });
  if (error) throw error;
  return data !== false;
}

export async function upsertOrderFinanceEntry(payload, authCarrier) {
  assertMutationAuthCarrier(authCarrier, { requireOfflineOwner: true });
  const companyId = assertMutationPayloadCompany(authCarrier, payload?.company_id, {
    requireOfflineOwner: true,
  });
  const financeEffect = normalizeFinanceEffect(
    payload?.finance_effect,
    payload?.kind,
    payload?.expense_payer,
  );
  const row = {
    company_id: companyId,
    order_id: normalizeId(payload?.order_id),
    kind: financeEffectKind(financeEffect),
    title: String(payload?.title || '').trim(),
    note: payload?.note ? String(payload.note).trim() : null,
    calc_mode: String(payload?.calc_mode || 'fixed').trim(),
    input_amount: normalizeMoney(payload?.input_amount),
    input_percent: normalizePercent(payload?.input_percent),
    percent_base: normalizePercentBase(financeEffectKind(financeEffect), payload?.percent_base),
    finance_effect: financeEffect,
    expense_payer: financeEffect === 'worker_reimbursement' ? 'executor' : 'company',
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

  if (normalizedId) {
    const updateRow = { ...row };
    delete updateRow.id;
    delete updateRow.company_id;
    delete updateRow.order_id;

    const updateRequest = pinMutationAuthorization(
      supabase
        .from('order_finance_entries')
        .update(updateRow)
        .eq('id', normalizedId)
        .eq('company_id', row.company_id)
        .eq('order_id', row.order_id)
        .select(ORDER_FINANCE_SELECT)
        .maybeSingle(),
      authCarrier,
      { requireOfflineOwner: true },
    );
    const { data: updated, error: updateError } = await updateRequest;
    assertMutationAuthCarrier(authCarrier, { requireOfflineOwner: true });

    if (updateError) throw updateError;
    if (updated) return updated;
  }

  assertMutationAuthCarrier(authCarrier, { requireOfflineOwner: true });
  const insertRequest = pinMutationAuthorization(
    supabase
      .from('order_finance_entries')
      .insert(row)
      .select(ORDER_FINANCE_SELECT)
      .single(),
    authCarrier,
    { requireOfflineOwner: true },
  );
  const { data, error } = await insertRequest;
  assertMutationAuthCarrier(authCarrier, { requireOfflineOwner: true });

  if (error) throw error;
  return data;
}

export async function deleteOrderFinanceEntry(
  { entryId, companyId, orderId = null },
  authCarrier,
) {
  assertMutationAuthCarrier(authCarrier, { requireOfflineOwner: true });
  const scopedCompanyId = assertMutationPayloadCompany(authCarrier, companyId, {
    requireOfflineOwner: true,
  });
  if (!entryId) throw new Error('Entry id is required');
  let request = supabase
    .from('order_finance_entries')
    .delete()
    .eq('id', entryId)
    .eq('company_id', scopedCompanyId);
  if (orderId) request = request.eq('order_id', orderId);
  const protectedRequest = pinMutationAuthorization(request, authCarrier, {
    requireOfflineOwner: true,
  });
  const { error } = await protectedRequest;
  assertMutationAuthCarrier(authCarrier, { requireOfflineOwner: true });
  if (error) throw error;
  return true;
}

export async function excludeOrderFinanceRule({ orderId, ruleId, companyId }, authCarrier) {
  assertMutationAuthCarrier(authCarrier, { requireOfflineOwner: true });
  assertMutationPayloadCompany(authCarrier, companyId, { requireOfflineOwner: true });
  if (!orderId || !ruleId) throw new Error('Order id and rule id are required');
  const request = pinMutationAuthorization(
    supabase.rpc('exclude_order_finance_rule', {
      p_order_id: orderId,
      p_rule_id: ruleId,
    }),
    authCarrier,
    { requireOfflineOwner: true },
  );
  const { data, error } = await request;
  assertMutationAuthCarrier(authCarrier, { requireOfflineOwner: true });
  if (error) throw error;
  return data !== false;
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

export async function upsertCompanyFinanceRule(payload, authCarrier) {
  assertMutationAuthCarrier(authCarrier);
  const companyId = assertMutationPayloadCompany(authCarrier, payload?.company_id);
  const row = {
    company_id: companyId,
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

  const request = pinMutationAuthorization(
    supabase
      .from('company_finance_rules')
      .upsert(row, { onConflict: 'id' })
      .select(FINANCE_RULE_SELECT)
      .single(),
    authCarrier,
  );
  const { data, error } = await request;
  assertMutationAuthCarrier(authCarrier);
  if (error) throw error;
  return data;
}

export async function deleteCompanyFinanceRule(payload, authCarrier) {
  assertMutationAuthCarrier(authCarrier);
  const isObjectPayload = payload && typeof payload === 'object' && !Array.isArray(payload);
  const ruleId = isObjectPayload ? payload.ruleId : payload;
  const deleteExistingEntries = isObjectPayload ? payload.deleteExistingEntries === true : false;
  const companyId = assertMutationPayloadCompany(
    authCarrier,
    isObjectPayload ? payload.companyId || payload.company_id : null,
  );
  if (!ruleId) throw new Error('Rule id is required');

  const request = pinMutationAuthorization(
    supabase.rpc('delete_company_finance_rule', {
      p_rule_id: ruleId,
      p_delete_existing_entries: deleteExistingEntries,
    }),
    authCarrier,
  );
  const { error } = await request;
  assertMutationAuthCarrier(authCarrier);

  if (error && !deleteExistingEntries) {
    const fallbackRequest = pinMutationAuthorization(
      supabase
        .from('company_finance_rules')
        .delete()
        .eq('id', ruleId)
        .eq('company_id', companyId),
      authCarrier,
    );
    const fallback = await fallbackRequest;
    assertMutationAuthCarrier(authCarrier);
    if (fallback.error) throw fallback.error;
    return true;
  }
  if (error) throw error;
  return true;
}

export async function listCompanyFinanceSchemes(companyId) {
  if (!companyId) return [];
  const { data: schemes, error: schemesError } = await supabase
    .from('company_finance_schemes')
    .select(FINANCE_SCHEME_SELECT)
    .eq('company_id', companyId)
    .is('archived_at', null)
    .order('is_default', { ascending: false })
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true });
  if (schemesError) throw schemesError;

  const rows = Array.isArray(schemes) ? schemes : [];
  const versionIds = rows.map((row) => row?.current_version_id).filter(Boolean);
  if (!versionIds.length) return rows.map((row) => ({ ...row, current_version: null }));

  const { data: versions, error: versionsError } = await supabase
    .from('company_finance_scheme_versions')
    .select(FINANCE_SCHEME_VERSION_SELECT)
    .in('id', versionIds);
  if (versionsError) throw versionsError;
  const versionsById = new Map(
    (Array.isArray(versions) ? versions : []).map((version) => [String(version.id), version]),
  );
  return rows.map((row) => ({
    ...row,
    current_version: versionsById.get(String(row.current_version_id || '')) || null,
  }));
}

export async function upsertCompanyFinanceScheme(payload, authCarrier) {
  assertMutationAuthCarrier(authCarrier);
  const companyId = assertMutationPayloadCompany(authCarrier, payload?.company_id);
  if (!companyId) throw new Error('company_id is required');
  const name = String(payload?.name || '').trim();
  if (!name) throw new Error('name is required');

  const rpcPayload = {
    id: normalizeId(payload?.id),
    company_id: companyId,
    name,
    conditions_json: normalizeRuleConditions(payload?.conditions_json),
    compensation_mode: String(payload?.compensation_mode || 'manual').trim(),
    fixed_amount: normalizeMoney(payload?.fixed_amount),
    percent_value: normalizePercent(payload?.percent_value),
    percent_base: ['base_price', 'customer_total', 'income_total'].includes(
      String(payload?.percent_base || ''),
    )
      ? String(payload.percent_base)
      : 'customer_total',
    minimum_worker_amount:
      payload?.minimum_worker_amount === null ||
      payload?.minimum_worker_amount === undefined ||
      String(payload.minimum_worker_amount).trim() === ''
        ? null
        : normalizeMoney(payload.minimum_worker_amount),
    maximum_worker_amount:
      payload?.maximum_worker_amount === null ||
      payload?.maximum_worker_amount === undefined ||
      String(payload.maximum_worker_amount).trim() === ''
        ? null
        : normalizeMoney(payload.maximum_worker_amount),
    is_default: payload?.is_default === true,
    is_enabled: payload?.is_enabled !== false,
    priority: Number.isFinite(Number(payload?.priority)) ? Number(payload.priority) : 100,
    apply_to_existing: payload?.apply_to_existing === true,
    configuration_json:
      payload?.configuration_json &&
      typeof payload.configuration_json === 'object' &&
      !Array.isArray(payload.configuration_json)
        ? payload.configuration_json
        : {},
  };

  const request = pinMutationAuthorization(
    supabase.rpc('upsert_company_finance_scheme_v2', {
      p_payload: rpcPayload,
    }),
    authCarrier,
  );
  const { data, error } = await request;
  assertMutationAuthCarrier(authCarrier);
  if (error) throw error;
  return data;
}

export async function archiveCompanyFinanceScheme({
  schemeId,
  companyId,
  recalculateExisting = false,
}, authCarrier) {
  assertMutationAuthCarrier(authCarrier);
  assertMutationPayloadCompany(authCarrier, companyId);
  if (!schemeId) throw new Error('Scheme id is required');
  const request = pinMutationAuthorization(
    supabase.rpc('archive_company_finance_scheme_v2', {
      p_scheme_id: schemeId,
      p_recalculate_existing: recalculateExisting === true,
    }),
    authCarrier,
  );
  const { data, error } = await request;
  assertMutationAuthCarrier(authCarrier);
  if (error) throw error;
  return data !== false;
}

export async function setCompanyFinanceSchemeEnabled({
  schemeId,
  companyId,
  isEnabled,
  recalculateExisting = true,
}, authCarrier) {
  assertMutationAuthCarrier(authCarrier);
  assertMutationPayloadCompany(authCarrier, companyId);
  if (!schemeId) throw new Error('Scheme id is required');
  const request = pinMutationAuthorization(
    supabase.rpc('set_company_finance_scheme_enabled_v2', {
      p_scheme_id: schemeId,
      p_is_enabled: isEnabled === true,
      p_recalculate_existing: recalculateExisting === true,
    }),
    authCarrier,
  );
  const { data, error } = await request;
  assertMutationAuthCarrier(authCarrier);
  if (error) throw error;
  return data !== false;
}
