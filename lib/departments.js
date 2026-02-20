import { supabase } from './supabase';
import { getLocale } from '../src/i18n';

const DEPARTMENTS_CACHE_TTL_MS = 60 * 1000;
const departmentsCache = new Map();
const DEPARTMENTS_SELECT_COLUMNS =
  'id, name, company_id, is_enabled, created_at, updated_at';
const DEPARTMENTS_SELECT_COLUMNS_LEGACY = 'id, name, company_id, created_at, updated_at';
const MISSING_COLUMN_CODE = '42703';
const RLS_DENIED_CODE = '42501';

function buildCacheKey(companyId, includeDisabled = false) {
  return `${String(companyId)}::${includeDisabled ? 'all' : 'enabled'}`;
}

function readDepartmentsCache(cacheKey) {
  const cacheEntry = departmentsCache.get(cacheKey);
  if (!cacheEntry) return null;
  if (Date.now() - cacheEntry.storedAt > DEPARTMENTS_CACHE_TTL_MS) {
    departmentsCache.delete(cacheKey);
    return null;
  }
  return {
    useDepartments: cacheEntry.useDepartments,
    departments: Array.isArray(cacheEntry.departments) ? [...cacheEntry.departments] : [],
  };
}

function writeDepartmentsCache(cacheKey, payload) {
  departmentsCache.set(cacheKey, {
    storedAt: Date.now(),
    useDepartments: !!payload?.useDepartments,
    departments: Array.isArray(payload?.departments) ? payload.departments : [],
  });
}

export function invalidateDepartmentsCache(companyId = null) {
  if (companyId) {
    const prefix = `${String(companyId)}::`;
    for (const key of departmentsCache.keys()) {
      if (String(key).startsWith(prefix)) {
        departmentsCache.delete(key);
      }
    }
    return;
  }
  departmentsCache.clear();
}

function normalizeDepartmentRow(row) {
  return {
    ...row,
    is_enabled: typeof row?.is_enabled === 'boolean' ? row.is_enabled : true,
  };
}

function sortDepartments(left, right) {
  let localeTag = 'ru';
  try {
    localeTag = String(getLocale?.() || 'ru').replace('_', '-');
  } catch {}
  return String(left?.name || '').localeCompare(String(right?.name || ''), localeTag);
}

function isMissingColumnError(error) {
  if (!error) return false;
  if (String(error?.code || '').trim() === MISSING_COLUMN_CODE) return true;
  const message = String(error?.message || '').toLowerCase();
  return message.includes('column') && message.includes('is_enabled');
}

function isRlsDeniedError(error) {
  if (!error) return false;
  if (String(error?.code || '').trim() === RLS_DENIED_CODE) return true;
  const message = String(error?.message || '').toLowerCase();
  return message.includes('row-level security') || message.includes('permission denied');
}

function assertMutationAffectedRows(data, fallbackCode) {
  if (Array.isArray(data) && data.length > 0) return;
  throw new Error(fallbackCode);
}

async function selectDepartments(companyId) {
  const primaryQuery = await supabase
    .from('departments')
    .select(DEPARTMENTS_SELECT_COLUMNS)
    .eq('company_id', companyId)
    .order('name', { ascending: true });

  if (!primaryQuery.error) {
    return { data: primaryQuery.data || [] };
  }

  if (!isMissingColumnError(primaryQuery.error)) {
    throw primaryQuery.error;
  }

  const legacyQuery = await supabase
    .from('departments')
    .select(DEPARTMENTS_SELECT_COLUMNS_LEGACY)
    .eq('company_id', companyId)
    .order('name', { ascending: true });

  if (legacyQuery.error) throw legacyQuery.error;

  return {
    data: (legacyQuery.data || []).map((row) => ({ ...row, is_enabled: true })),
  };
}

export async function fetchDepartments(companyId, options = {}) {
  if (!companyId) throw new Error('companyId is required');

  const forceRefresh = !!options?.forceRefresh;
  const includeDisabled = !!options?.includeDisabled;
  const cacheKey = buildCacheKey(companyId, includeDisabled);
  if (!forceRefresh) {
    const cached = readDepartmentsCache(cacheKey);
    if (cached) return cached;
  }

  const [{ data: company, error: ce }, departmentsResult] = await Promise.all([
    supabase.from('companies').select('id,use_departments').eq('id', companyId).single(),
    selectDepartments(companyId),
  ]);

  if (ce) throw ce;

  let departments = (departmentsResult?.data || []).map(normalizeDepartmentRow);
  if (!includeDisabled) {
    departments = departments.filter((item) => item.is_enabled);
  }
  departments.sort(sortDepartments);

  const payload = { useDepartments: !!company?.use_departments, departments };
  writeDepartmentsCache(cacheKey, payload);
  return payload;
}

export async function setUseDepartments(companyId, enabled) {
  if (!companyId) throw new Error('companyId is required');

  const { error } = await supabase
    .from('companies')
    .update({ use_departments: !!enabled })
    .eq('id', companyId);

  if (error) throw error;
  invalidateDepartmentsCache(companyId);
}

export async function createDepartment(companyId, { name }) {
  if (!companyId) throw new Error('companyId is required');
  if (!name || !name.trim()) throw new Error('name is required');

  const payload = { company_id: companyId, name: name.trim(), is_enabled: true };
  let query = await supabase
    .from('departments')
    .insert(payload)
    .select(DEPARTMENTS_SELECT_COLUMNS)
    .maybeSingle();

  if (query.error && isMissingColumnError(query.error)) {
    query = await supabase
      .from('departments')
      .insert({ company_id: companyId, name: name.trim() })
      .select(DEPARTMENTS_SELECT_COLUMNS_LEGACY)
      .maybeSingle();
  }

  if (query.error) {
    if (isRlsDeniedError(query.error)) {
      throw new Error('departments_forbidden_create');
    }
    if (String(query.error?.message || '').includes('DEPARTMENTS_LIMIT_REACHED')) {
      throw new Error('departments_limit_reached');
    }
    throw query.error;
  }
  if (!query.data) throw new Error('departments_create_no_row');

  invalidateDepartmentsCache(companyId);
  return normalizeDepartmentRow(query.data);
}

export async function updateDepartment(companyId, id, patch = {}) {
  if (!companyId) throw new Error('companyId is required');
  if (!id) throw new Error('id is required');

  const upd = {};
  if (patch.name !== undefined) {
    if (!patch.name || !String(patch.name).trim()) throw new Error('name must be non-empty');
    upd.name = String(patch.name).trim();
  }
  if (patch.isEnabled !== undefined) {
    upd.is_enabled = !!patch.isEnabled;
  }
  if (Object.keys(upd).length === 0) return;

  let query = await supabase
    .from('departments')
    .update(upd)
    .eq('id', id)
    .eq('company_id', companyId)
    .select(DEPARTMENTS_SELECT_COLUMNS);

  if (
    query.error &&
    isMissingColumnError(query.error) &&
    Object.prototype.hasOwnProperty.call(upd, 'is_enabled')
  ) {
    const { is_enabled: _ignored, ...legacyPatch } = upd;
    if (Object.keys(legacyPatch).length === 0) {
      invalidateDepartmentsCache(companyId);
      return;
    }
    query = await supabase
      .from('departments')
      .update(legacyPatch)
      .eq('id', id)
      .eq('company_id', companyId)
      .select(DEPARTMENTS_SELECT_COLUMNS_LEGACY);
  }

  if (query.error) {
    if (isRlsDeniedError(query.error)) {
      throw new Error('departments_forbidden_update');
    }
    throw query.error;
  }
  assertMutationAffectedRows(query.data, 'departments_update_no_rows');

  invalidateDepartmentsCache(companyId);
  return normalizeDepartmentRow(query.data[0]);
}

export async function setDepartmentEnabled(companyId, id, enabled) {
  return updateDepartment(companyId, id, { isEnabled: enabled });
}

export async function deleteDepartment(companyId, id) {
  if (!companyId) throw new Error('companyId is required');
  if (!id) throw new Error('id is required');

  const { error: profilesDetachError } = await supabase
    .from('profiles')
    .update({ department_id: null })
    .eq('company_id', companyId)
    .eq('department_id', id);
  if (profilesDetachError) throw profilesDetachError;

  const { error: ordersDetachError } = await supabase
    .from('orders')
    .update({ department_id: null })
    .eq('company_id', companyId)
    .eq('department_id', id);
  if (ordersDetachError) throw ordersDetachError;

  const { data, error } = await supabase
    .from('departments')
    .delete()
    .eq('id', id)
    .eq('company_id', companyId)
    .select('id');

  if (error) {
    if (isRlsDeniedError(error)) {
      throw new Error('departments_forbidden_delete');
    }
    throw error;
  }
  assertMutationAffectedRows(data, 'departments_delete_no_rows');
  invalidateDepartmentsCache(companyId);
}
