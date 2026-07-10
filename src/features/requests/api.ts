import { supabase } from '../../../lib/supabase';
import { getOrderIdsByWorkTypes, getStatusDbAliases, mapStatusToDb } from '../../../lib/orderFilters';
import { formatPersonName } from '../../../lib/personName';
import { measureNetwork } from '../../shared/perf/devMetrics';
import { applyOrderSortToQuery, ORDER_DEFAULT_SORT_KEY } from '../orders/orderSort';
import { enrichOrdersWithExecutorNames } from './executorNameCache';
import {
  buildOrderAddressNavigatorQuery,
  buildOrderAddressShort,
  extractOrderAddress,
  extractOrderAddressFromObject,
  normalizeOrderAddressMode,
} from './addressing';
import { applyOrderRelationFilters } from './relationFilters';
import { resolveRequestTitle } from './title';
import { getMyCompanyId } from '../profile/api';

const DEFAULT_PAGE_SIZE = 20;
const SECURE_ORDER_SELECT_COLUMNS = '*';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isAuthSessionMissing(error: any) {
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return name.includes('authsessionmissingerror') || message.includes('auth session missing');
}

function isUuid(value) {
  const normalized = String(value || '').trim();
  return UUID_RE.test(normalized);
}

function excludeFeedStatuses(query: any) {
  const feedStatusValues = getStatusDbAliases('feed').filter(Boolean);
  if (!feedStatusValues.length) return query;
  const encoded = feedStatusValues
    // PostgREST's `in` filter accepts quoted values with double quotes, not
    // SQL-style single quotes. This keeps the feed status out of "All" even
    // for legacy localized status values.
    .map((value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',');
  return query.or(`status.is.null,status.not.in.(${encoded})`);
}

function resolveStatusFilterValues(statuses: any = []) {
  const source = Array.isArray(statuses)
    ? statuses
    : String(statuses || '')
        .split(',')
        .map((item) => item.trim());
  const values = source.flatMap((statusKey) => {
    const aliases = getStatusDbAliases(statusKey);
    if (aliases.length) return aliases;
    const mapped = mapStatusToDb(statusKey);
    return mapped ? [mapped] : [];
  });
  return Array.from(new Set(values.filter(Boolean)));
}

function applyStatusFilterValues(query: any, statusValues: string[] = []) {
  if (!statusValues.length) return query;
  if (statusValues.length === 1) return query.eq('status', statusValues[0]);
  return query.in('status', statusValues);
}

function buildClientDisplayName(client) {
  if (!client || typeof client !== 'object') return '';
  return formatPersonName(client);
}

function normalizeDepartureTimeString(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? '0');
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function hasExplicitTimeInDatetime(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const timeMatch = raw.match(/[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?/);
  if (!timeMatch) return false;
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const seconds = Number(timeMatch[3] ?? '0');
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return false;
  return hours !== 0 || minutes !== 0 || seconds !== 0;
}

function extractDepartureTimeFromLegacyDatetime(input) {
  if (!hasExplicitTimeInDatetime(input)) return null;
  if (!input) return null;
  const parsed = new Date(input);
  if (Number.isNaN(parsed?.getTime?.())) return null;
  const hours = parsed.getHours();
  const minutes = parsed.getMinutes();
  if (hours === 0 && minutes === 0) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
}

function normalizeOrder(row) {
  if (!row) return row;
  const customerPhoneVisible =
    row.phone ?? row.customer_phone_visible ?? row.client?.phone ?? null;
  const legacyPhoneVisible = row.phone_visible ?? customerPhoneVisible;
  const objectItem = row.object || row.client_object || null;
  const clientItem = row.client || null;
  const address = extractOrderAddress(row);
  const addressMode = normalizeOrderAddressMode(row.address_mode);
  const customerName = buildClientDisplayName(clientItem) || String(row.fio ?? row.customer_name ?? '').trim();
  const departureTime =
    normalizeDepartureTimeString(row?.departure_time) ||
    extractDepartureTimeFromLegacyDatetime(row?.time_window_start);
  return {
    ...row,
    title: resolveRequestTitle(row, {
      fallbackDate: row.time_window_start ?? row.created_at ?? row.updated_at ?? null,
    }),
    address_mode: addressMode,
    address_short: buildOrderAddressShort(address) || null,
    address_navigator_query: buildOrderAddressNavigatorQuery(address) || null,
    customer_phone_visible: customerPhoneVisible,
    phone_visible: legacyPhoneVisible,
    time_window_start: row.time_window_start ?? null,
    departure_time: departureTime,
    object: objectItem,
    client: clientItem,
    fio: customerName || null,
    customer_name: customerName || null,
    object_name: objectItem?.name || String(row.object_name || '').trim() || null,
    object_summary: buildOrderAddressShort(extractOrderAddressFromObject(objectItem)) || null,
    object_location_mode: String(objectItem?.location_mode || '').trim() || null,
    secondary_phone: clientItem?.secondary_phone || null,
    contact_email: clientItem?.email || null,
    country: address.country || null,
    region: address.region || null,
    district: address.district || null,
    city: address.city || null,
    street: address.street || null,
    house: address.house || null,
    postal_code: address.postal_code || null,
    office: address.apartment || null,
    floor: address.floor || null,
    entrance: address.entrance || null,
    apartment: address.apartment || null,
    entrance_info: address.comment || address.entrance_info || null,
    parking_notes: null,
    geo_lat: address.geo_lat || null,
    geo_lng: address.geo_lng || null,
  };
}

async function enrichOrderWithExtraFields(row) {
  return normalizeOrder(row);
}

function buildConcurrencyError(message: string, latest: any = null) {
  const error: any = new Error(message || 'Request was changed by another user');
  error.code = 'CONFLICT';
  error.latest = latest;
  return error;
}

async function getRequestByIdFresh(id) {
  const key = String(id || '').trim();
  if (!key || !isUuid(key)) return null;
  return getRequestById(key);
}

export async function updateRequestWithVersion(id, patch, expectedUpdatedAt = null) {
  return measureNetwork('requests.update.withVersion', async () => {
    if (!id) throw new Error('Order id is required');
    // Preferred path: DB-side atomic RPC (supports all current fields).
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('update_order_if_version', {
        p_order_id: String(id),
        p_expected_updated_at: expectedUpdatedAt,
        p_patch: patch ?? {},
      });
      if (rpcError) throw rpcError;

      if (!rpcData) {
        if (!expectedUpdatedAt) {
          throw new Error('Order not found');
        }
        const latest = await getRequestById(id);
        const retryExpectedUpdatedAt = latest?.updated_at || null;
        // One transparent retry with fresh row version to avoid "save only on second click".
        if (retryExpectedUpdatedAt) {
          const { data: retryData, error: retryError } = await supabase.rpc('update_order_if_version', {
            p_order_id: String(id),
            p_expected_updated_at: retryExpectedUpdatedAt,
            p_patch: patch ?? {},
          });
          if (!retryError && retryData) {
            return getRequestByIdFresh(id);
          }
        }
        throw buildConcurrencyError('Order was modified concurrently', latest || null);
      }

      return getRequestByIdFresh(id);
    } catch (rpcFailure) {
      // All order mutations are authorized atomically in the database.
      // A direct-table fallback would bypass the configured access matrix.
      throw rpcFailure;
    }
  });
}

export async function listRequests(params: any = {}) {
  return measureNetwork('requests.list', async () => {
    const {
      scope = 'all',
      status = 'all',
      statuses = [],
      executorId = null,
      executorIds = [],
      departmentId = null,
      workTypeIds = [],
      relationClientId = '',
      relationObjectIds = [],
      clientIds = [],
      orderIds = [],
      dateFrom = null,
      dateTo = null,
      createdFrom = null,
      createdTo = null,
      sumMin = null,
      sumMax = null,
      excludeFeedWhenAll = true,
      sortKey = ORDER_DEFAULT_SORT_KEY,
      userId = null,
      page = 1,
      pageSize = DEFAULT_PAGE_SIZE,
    } = params;

    const extraStatusValues = resolveStatusFilterValues(statuses);
    const normalizedExecutorIds = Array.isArray(executorIds)
      ? executorIds.map(String).map((value) => value.trim()).filter(Boolean)
      : [];
    const normalizedExecutorId = String(executorId || '').trim();
    let query = supabase
      .from('orders_accessible')
      .select(SECURE_ORDER_SELECT_COLUMNS);

    if (scope === 'my') {
      let uid = String(userId || '').trim();
      if (!uid) {
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError) {
          if (isAuthSessionMissing(userError)) return [];
          throw userError;
        }
        uid = String(userData?.user?.id || '').trim();
      }
      if (!uid) return [];
      query = query.eq('assigned_to', uid);
    }

    if (status === 'feed') {
      query = query.is('assigned_to', null);
      const feedStatusValues = getStatusDbAliases('feed');
      if (feedStatusValues.length === 1) query = query.eq('status', feedStatusValues[0]);
      if (feedStatusValues.length > 1) query = query.in('status', feedStatusValues);
    } else {
      if (status === 'all' && excludeFeedWhenAll) {
        query = excludeFeedStatuses(query);
      }
      const statusValues = getStatusDbAliases(status);
      if (statusValues.length === 1) query = query.eq('status', statusValues[0]);
      if (statusValues.length > 1) query = query.in('status', statusValues);
      if (statusValues.length === 0) {
        const statusValue = mapStatusToDb(status);
        if (statusValue) query = query.eq('status', statusValue);
      }
      if (normalizedExecutorIds.length) query = query.in('assigned_to', normalizedExecutorIds);
      else if (normalizedExecutorId) query = query.eq('assigned_to', normalizedExecutorId);
    }
    query = applyStatusFilterValues(query, extraStatusValues);

    if (Array.isArray(workTypeIds) && workTypeIds.length) {
      const ids = await getOrderIdsByWorkTypes(workTypeIds);
      if (!ids.length) return [];
      query = query.in('id', ids);
    }
    if (Array.isArray(clientIds) && clientIds.length) {
      query = query.in('client_id', clientIds.map(String));
    }
    if (Array.isArray(orderIds) && orderIds.length) {
      query = query.in('id', orderIds.map(String));
    }
    const parsedSumMin = String(sumMin ?? '').trim() === '' ? NaN : Number(sumMin);
    const parsedSumMax = String(sumMax ?? '').trim() === '' ? NaN : Number(sumMax);
    if (dateFrom) query = query.gte('time_window_start', dateFrom);
    if (dateTo) query = query.lte('time_window_start', dateTo);
    if (createdFrom) query = query.gte('created_at', createdFrom);
    if (createdTo) query = query.lte('created_at', createdTo);
    if (Number.isFinite(parsedSumMin)) query = query.gte('start_price', parsedSumMin);
    if (Number.isFinite(parsedSumMax)) query = query.lte('start_price', parsedSumMax);

    query = applyOrderRelationFilters(query, {
      clientId: relationClientId,
      objectIds: relationObjectIds,
    });

    const from = Math.max(0, (Number(page) - 1) * Number(pageSize));
    const to = from + Number(pageSize) - 1;

    const { data, error } = await applyOrderSortToQuery(query, sortKey).range(from, to);
    if (error) throw error;
    return enrichOrdersWithExecutorNames(Array.isArray(data) ? data.map(normalizeOrder) : []);
  });
}

export async function getRequestById(id: any) {
  const key = String(id || '').trim();
  if (!key || !isUuid(key)) return null;
  return measureNetwork('requests.getById', async () => {
    const { data, error } = await supabase
      .from('orders_accessible')
      .select(SECURE_ORDER_SELECT_COLUMNS)
      .eq('id', key)
      .maybeSingle();
    if (error) throw error;
    const enriched = await enrichOrderWithExtraFields(data);
    const withExecutor = await enrichOrdersWithExecutorNames(enriched ? [enriched] : []);
    return withExecutor[0] || enriched;
  });
}

export async function updateRequest(id: any, patch: any, expectedUpdatedAt: any = null) {
  return updateRequestWithVersion(id, patch, expectedUpdatedAt);
}

export async function listRequestExecutors({ companyId = null }: any = {}) {
  return measureNetwork('requests.executors', async () => {
    const scopedCompanyId = String(companyId || '').trim() || String(await getMyCompanyId() || '').trim();
    if (!scopedCompanyId) return [];
    let query = supabase
      .from('profiles')
      .select('id, first_name, middle_name, last_name, full_name, email, role, department_id')
      .neq('role', 'client')
      .eq('company_id', scopedCompanyId);
    const { data, error } = await query;

    if (error) throw error;
    return Array.isArray(data) ? data : [];
  });
}

export async function listRequestFilterOptions() {
  return measureNetwork('requests.filterOptions', async () => {
    const { data, error } = await supabase.rpc('get_order_filter_options');
    if (error) throw error;
    return {
      work_type: Array.isArray(data?.work_type) ? data.work_type : [],
      materials: Array.isArray(data?.materials) ? data.materials : [],
    };
  });
}

export async function getAssigneeDisplayNameById(userId: any) {
  return measureNetwork('requests.assigneeName', async () => {
    if (!userId) return '';
    const scopedCompanyId = String(await getMyCompanyId() || '').trim();
    if (!scopedCompanyId) return '';
    const { data, error } = await supabase
      .from('profiles')
      .select('first_name, middle_name, last_name, full_name, email')
      .eq('id', userId)
      .eq('company_id', scopedCompanyId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return '';
    return formatPersonName(data, data.email || '');
  });
}

export async function listCalendarRequests({
  userId,
  role,
  scope = 'my',
  startDate = null,
  endDate = null,
}: any = {}) {
  return measureNetwork('requests.calendar', async () => {
    if (!userId) return [];
    const normalizedScope = scope === 'all' ? 'all' : 'my';

    let query = supabase
      .from('orders_accessible')
      .select(SECURE_ORDER_SELECT_COLUMNS)
      .order('time_window_start', { ascending: false, nullsFirst: false });

    if (normalizedScope === 'my') {
      query = query.eq('assigned_to', userId);
    }
    if (startDate) {
      query = query.gte('time_window_start', startDate);
    }
    if (endDate) {
      query = query.lte('time_window_start', endDate);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = await enrichOrdersWithExecutorNames(Array.isArray(data) ? data.map(normalizeOrder) : []);
    if (normalizedScope === 'my' && userId) return rows.filter((row) => row.assigned_to === userId);

    return rows;
  });
}
