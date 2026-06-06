import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { getLocale } from '../src/i18n';
import { queryClient } from '../src/shared/query/queryClient';
import { queryKeys } from '../src/shared/query/queryKeys';

const WORK_TYPES_CACHE_TTL_MS = 30 * 60 * 1000;
const WORK_TYPES_DISK_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const WORK_TYPES_DISK_CACHE_STALE_MS = 30 * 60 * 1000;
const WORK_TYPES_STORAGE_PREFIX = 'workTypes.cache.v2:';
const workTypesCache = new Map();
const workTypesRefreshInFlight = new Set();
const WORK_TYPES_SELECT_COLUMNS =
  'id, name, position, company_id, is_enabled, created_at, updated_at';
const WORK_TYPES_SELECT_COLUMNS_LEGACY = 'id, name, position, company_id, created_at, updated_at';
const MISSING_COLUMN_CODE = '42703';
const RLS_DENIED_CODE = '42501';
const myCompanyIdInFlightByScope = new Map();

function buildCacheKey(companyId, includeDisabled = false) {
  return `${String(companyId)}::${includeDisabled ? 'all' : 'enabled'}`;
}

function buildStorageKey(cacheKey) {
  return `${WORK_TYPES_STORAGE_PREFIX}${cacheKey}`;
}

function readWorkTypesCache(cacheKey) {
  const cacheEntry = workTypesCache.get(cacheKey);
  if (!cacheEntry) return null;
  if (Date.now() - cacheEntry.storedAt > WORK_TYPES_CACHE_TTL_MS) {
    workTypesCache.delete(cacheKey);
    return null;
  }
  return {
    useWorkTypes: cacheEntry.useWorkTypes,
    types: Array.isArray(cacheEntry.types) ? [...cacheEntry.types] : [],
  };
}

function writeWorkTypesCache(cacheKey, payload) {
  workTypesCache.set(cacheKey, {
    storedAt: Date.now(),
    useWorkTypes: !!payload?.useWorkTypes,
    types: Array.isArray(payload?.types) ? payload.types : [],
  });
}

async function readWorkTypesDiskCache(cacheKey) {
  try {
    const raw = await AsyncStorage.getItem(buildStorageKey(cacheKey));
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return null;
    const storedAt = Number(parsed.storedAt || 0);
    if (!Number.isFinite(storedAt) || Date.now() - storedAt > WORK_TYPES_DISK_CACHE_MAX_AGE_MS) return null;
    return {
      storedAt,
      useWorkTypes: !!parsed.useWorkTypes,
      types: Array.isArray(parsed.types) ? parsed.types.map(normalizeTypeRow).sort(sortWorkTypes) : [],
    };
  } catch {
    return null;
  }
}

async function writeWorkTypesDiskCache(cacheKey, payload) {
  try {
    await AsyncStorage.setItem(
      buildStorageKey(cacheKey),
      JSON.stringify({
        storedAt: Date.now(),
        useWorkTypes: !!payload?.useWorkTypes,
        types: Array.isArray(payload?.types) ? payload.types : [],
      }),
    );
  } catch {}
}

async function removeWorkTypesDiskCache(companyId = null) {
  try {
    if (companyId) {
      await AsyncStorage.multiRemove([
        buildStorageKey(buildCacheKey(companyId, false)),
        buildStorageKey(buildCacheKey(companyId, true)),
      ]);
      return;
    }
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((key) => String(key || '').startsWith(WORK_TYPES_STORAGE_PREFIX));
    if (mine.length) await AsyncStorage.multiRemove(mine);
  } catch {}
}

export function invalidateWorkTypesCache(companyId = null) {
  if (companyId) {
    const prefix = `${String(companyId)}::`;
    for (const key of workTypesCache.keys()) {
      if (String(key).startsWith(prefix)) {
        workTypesCache.delete(key);
      }
    }
    removeWorkTypesDiskCache(companyId).catch(() => {});
    return;
  }
  workTypesCache.clear();
  removeWorkTypesDiskCache().catch(() => {});
}

function normalizeTypeRow(row) {
  return {
    ...row,
    is_enabled: typeof row?.is_enabled === 'boolean' ? row.is_enabled : true,
  };
}

function sortWorkTypes(left, right) {
  const leftPosition = Number.isFinite(left?.position) ? left.position : Number.MAX_SAFE_INTEGER;
  const rightPosition = Number.isFinite(right?.position)
    ? right.position
    : Number.MAX_SAFE_INTEGER;
  if (leftPosition !== rightPosition) return leftPosition - rightPosition;
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

async function selectWorkTypes(companyId) {
  const primaryQuery = await supabase
    .from('work_types')
    .select(WORK_TYPES_SELECT_COLUMNS)
    .eq('company_id', companyId)
    .order('position', { ascending: true });

  if (!primaryQuery.error) {
    return { data: primaryQuery.data || [], hasIsEnabledColumn: true };
  }

  if (!isMissingColumnError(primaryQuery.error)) {
    throw primaryQuery.error;
  }

  const legacyQuery = await supabase
    .from('work_types')
    .select(WORK_TYPES_SELECT_COLUMNS_LEGACY)
    .eq('company_id', companyId)
    .order('position', { ascending: true });

  if (legacyQuery.error) throw legacyQuery.error;

  return {
    data: (legacyQuery.data || []).map((row) => ({ ...row, is_enabled: true })),
    hasIsEnabledColumn: false,
  };
}

async function fetchWorkTypesFromNetwork(companyId, includeDisabled, cacheKey) {
  const [{ data: company, error: ce }, typesResult] = await Promise.all([
    supabase.from('companies').select('id,use_work_types').eq('id', companyId).single(),
    selectWorkTypes(companyId),
  ]);

  if (ce) throw ce;

  let types = (typesResult?.data || []).map(normalizeTypeRow);
  if (!includeDisabled) {
    types = types.filter((type) => type.is_enabled);
  }
  types.sort(sortWorkTypes);

  const payload = { useWorkTypes: !!company?.use_work_types, types };
  writeWorkTypesCache(cacheKey, payload);
  writeWorkTypesDiskCache(cacheKey, payload).catch(() => {});
  return payload;
}

function refreshWorkTypesInBackground(companyId, includeDisabled, cacheKey) {
  if (workTypesRefreshInFlight.has(cacheKey)) return;
  workTypesRefreshInFlight.add(cacheKey);
  fetchWorkTypesFromNetwork(companyId, includeDisabled, cacheKey)
    .catch(() => {})
    .finally(() => {
      workTypesRefreshInFlight.delete(cacheKey);
    });
}

export async function fetchWorkTypes(companyId, options = {}) {
  if (!companyId) throw new Error('companyId is required');

  const forceRefresh = !!options?.forceRefresh;
  const includeDisabled = !!options?.includeDisabled;
  const cacheKey = buildCacheKey(companyId, includeDisabled);
  if (!forceRefresh) {
    const cached = readWorkTypesCache(cacheKey);
    if (cached) return cached;

    const diskCached = await readWorkTypesDiskCache(cacheKey);
    if (diskCached) {
      const payload = {
        useWorkTypes: diskCached.useWorkTypes,
        types: diskCached.types,
      };
      writeWorkTypesCache(cacheKey, payload);
      if (Date.now() - diskCached.storedAt > WORK_TYPES_DISK_CACHE_STALE_MS) {
        refreshWorkTypesInBackground(companyId, includeDisabled, cacheKey);
      }
      return payload;
    }
  }

  return fetchWorkTypesFromNetwork(companyId, includeDisabled, cacheKey);
}

export async function setUseWorkTypes(companyId, enabled) {
  if (!companyId) throw new Error('companyId is required');

  const { error } = await supabase
    .from('companies')
    .update({ use_work_types: !!enabled })
    .eq('id', companyId);

  if (error) throw error;
  invalidateWorkTypesCache(companyId);
}

export async function createWorkType(companyId, { name, position }) {
  if (!companyId) throw new Error('companyId is required');
  if (!name || !name.trim()) throw new Error('name is required');

  const payload = { company_id: companyId, name: name.trim(), is_enabled: true };
  if (typeof position === 'number') payload.position = position;

  let query = await supabase
    .from('work_types')
    .insert(payload)
    .select(WORK_TYPES_SELECT_COLUMNS)
    .maybeSingle();

  if (query.error && isMissingColumnError(query.error)) {
    query = await supabase
      .from('work_types')
      .insert({ company_id: companyId, name: name.trim(), ...(typeof position === 'number' ? { position } : {}) })
      .select(WORK_TYPES_SELECT_COLUMNS_LEGACY)
      .maybeSingle();
  }

  if (query.error) {
    if (isRlsDeniedError(query.error)) {
      throw new Error('work_types_forbidden_create');
    }
    throw query.error;
  }
  if (!query.data) {
    throw new Error('work_types_create_no_row');
  }
  invalidateWorkTypesCache(companyId);
  return normalizeTypeRow(query.data);
}

export async function updateWorkType(companyId, id, patch = {}) {
  if (!companyId) throw new Error('companyId is required');
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
  if (patch.isEnabled !== undefined) {
    upd.is_enabled = !!patch.isEnabled;
  }
  if (Object.keys(upd).length === 0) return;

  let query = await supabase
    .from('work_types')
    .update(upd)
    .eq('id', id)
    .eq('company_id', companyId)
    .select(WORK_TYPES_SELECT_COLUMNS);

  if (query.error && isMissingColumnError(query.error) && Object.prototype.hasOwnProperty.call(upd, 'is_enabled')) {
    const { is_enabled: _ignored, ...legacyPatch } = upd;
    if (Object.keys(legacyPatch).length === 0) {
      invalidateWorkTypesCache(companyId);
      return;
    }
    query = await supabase
      .from('work_types')
      .update(legacyPatch)
      .eq('id', id)
      .eq('company_id', companyId)
      .select(WORK_TYPES_SELECT_COLUMNS_LEGACY);
  }

  if (query.error) {
    if (isRlsDeniedError(query.error)) {
      throw new Error('work_types_forbidden_update');
    }
    throw query.error;
  }
  assertMutationAffectedRows(query.data, 'work_types_update_no_rows');
  invalidateWorkTypesCache(companyId);
  return normalizeTypeRow(query.data[0]);
}

export async function setWorkTypeEnabled(companyId, id, enabled) {
  return updateWorkType(companyId, id, { isEnabled: enabled });
}

export async function deleteWorkType(companyId, id) {
  if (!companyId) throw new Error('companyId is required');
  if (!id) throw new Error('id is required');

  const { error: detachError } = await supabase
    .from('orders')
    .update({ work_type_id: null })
    .eq('company_id', companyId)
    .eq('work_type_id', id);
  if (detachError) throw detachError;

  const { data, error } = await supabase
    .from('work_types')
    .delete()
    .eq('id', id)
    .eq('company_id', companyId)
    .select('id');

  if (error) {
    if (isRlsDeniedError(error)) {
      throw new Error('work_types_forbidden_delete');
    }
    throw error;
  }
  assertMutationAffectedRows(data, 'work_types_delete_no_rows');
  invalidateWorkTypesCache(companyId);
}

export async function setOrderWorkType(orderId, workTypeId) {
  if (!orderId) throw new Error('orderId is required');

  const { error } = await supabase
    .from('orders')
    .update({ work_type_id: workTypeId ?? null })
    .eq('id', orderId);

  if (error) throw error;
}

function readCachedMyCompanyId(expectedUserId = null) {
  const normalizedExpectedUserId = String(expectedUserId || '').trim();

  try {
    const cachedProfile = queryClient.getQueryData(queryKeys.profile.me());
    if (cachedProfile && typeof cachedProfile === 'object') {
      const cachedProfileUserId = String(cachedProfile.id || '').trim();
      const cachedCompanyId = String(cachedProfile.company_id || cachedProfile.companyId || '').trim();
      if (cachedCompanyId && (!normalizedExpectedUserId || cachedProfileUserId === normalizedExpectedUserId)) {
        return cachedCompanyId;
      }
    }

    const cachedCompanyId = String(queryClient.getQueryData(queryKeys.profile.companyId()) || '').trim();
    if (cachedCompanyId && !normalizedExpectedUserId) {
      return cachedCompanyId;
    }
  } catch {}

  return '';
}

function rememberMyCompanyId(companyId) {
  const normalizedCompanyId = String(companyId || '').trim();
  if (!normalizedCompanyId) return;
  try {
    queryClient.setQueryData(queryKeys.profile.companyId(), normalizedCompanyId);
  } catch {}
}

export function clearMyCompanyIdRuntimeCache() {
  myCompanyIdInFlightByScope.clear();
}

export async function getMyCompanyId(options = {}) {
  const userIdHint =
    typeof options === 'string' ? String(options || '').trim() : String(options?.userId || '').trim();
  const cachedCompanyId = readCachedMyCompanyId(userIdHint);
  if (cachedCompanyId) return cachedCompanyId;

  const inFlightScope = userIdHint || '__current__';
  if (myCompanyIdInFlightByScope.has(inFlightScope)) {
    return myCompanyIdInFlightByScope.get(inFlightScope);
  }

  const promise = (async () => {
    let userId = userIdHint;
    if (!userId) {
      const {
        data: { user },
        error: aerr,
      } = await supabase.auth.getUser();

      if (aerr) throw aerr;
      if (!user) throw new Error('Not authenticated');
      userId = String(user.id || '').trim();
    }

    const cachedAfterAuth = readCachedMyCompanyId(userId);
    if (cachedAfterAuth) return cachedAfterAuth;

    const { data, error } = await supabase
      .from('profiles')
      .select('company_id')
      .eq('id', userId)
      .single();

    if (error) throw error;
    const companyId = data?.company_id || null;
    rememberMyCompanyId(companyId);
    return companyId;
  })().finally(() => {
    myCompanyIdInFlightByScope.delete(inFlightScope);
  });

  myCompanyIdInFlightByScope.set(inFlightScope, promise);
  return promise;
}
