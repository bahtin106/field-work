import { supabase } from '../../../lib/supabase';
import { getOrderIdsByWorkTypes, getStatusDbAliases, mapStatusToDb } from '../../../lib/orderFilters';
import { formatPersonName } from '../../../lib/personName';
import { measureNetwork } from '../../shared/perf/devMetrics';
import { applyOrderSortToQuery, ORDER_DEFAULT_SORT_KEY } from '../orders/orderSort';
import {
  enrichOrdersWithExecutorNames,
  prefetchExecutorNames,
  readOrderExecutorName,
  seedExecutorNames,
} from './executorNameCache';
import {
  buildOrderAddressNavigatorQuery,
  buildOrderAddressShort,
  extractOrderAddress,
  normalizeOrderAddressMode,
} from './addressing';
import { applyOrderRelationFilters, hasRelationFilters } from './relationFilters';
import { resolveRequestTitle } from './title';
import { getMyCompanyId } from '../profile/api';
import { buildClientObjectLocationSummary } from '../objects/addressing';

const DEFAULT_PAGE_SIZE = 20;
const SECURE_ORDER_SELECT_COLUMNS = '*';
// PostgreSQL accepts canonical UUID strings regardless of their version bits.
// Do not reject imported or legacy identifiers solely because their version is unusual.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function warmExecutorNames(rows: any[] = []) {
  seedExecutorNames(rows);
  const missingIds = Array.from(
    new Set(
      rows
        .filter((row) => !readOrderExecutorName(row))
        .map((row) => String(row?.assigned_to || '').trim())
        .filter(Boolean),
    ),
  );
  if (missingIds.length) prefetchExecutorNames(missingIds).catch(() => {});
  return rows;
}

function isAuthSessionMissing(error: any) {
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return name.includes('authsessionmissingerror') || message.includes('auth session missing');
}

export function isRequestAuthorizationError(error: any) {
  const code = String(error?.code || '').trim().toUpperCase();
  const status = Number(error?.status || error?.statusCode || error?.response?.status);
  const message = String(error?.message || error || '').toLowerCase();
  return (
    code === '42501' ||
    code === 'PGRST301' ||
    code === 'AUTH_SESSION_UNAVAILABLE' ||
    status === 401 ||
    status === 403 ||
    message.includes('auth session missing') ||
    message.includes('permission denied') ||
    message.includes('unauthorized') ||
    message.includes('jwt expired')
  );
}

async function requireRequestSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const session = data?.session;
  if (session?.access_token && session?.user?.id) return session;

  const sessionError: any = new Error('Authenticated session is not ready');
  sessionError.name = 'AuthSessionUnavailableError';
  sessionError.code = 'AUTH_SESSION_UNAVAILABLE';
  throw sessionError;
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

function normalizeOrder(row) {
  if (!row) return row;
  const customerPhoneVisible =
    row.phone ?? row.customer_phone_visible ?? row.client?.phone ?? null;
  const legacyPhoneVisible = row.phone_visible ?? customerPhoneVisible;
  const objectItem = row.object || row.client_object || null;
  const clientItem = row.client || null;
  const address = extractOrderAddress(row);
  const addressMode = normalizeOrderAddressMode(row.address_mode);
  const objectSummary =
    buildClientObjectLocationSummary(objectItem, { compact: true }) ||
    String(row.object_summary || '').trim() ||
    null;
  const customerName = buildClientDisplayName(clientItem) || String(row.fio ?? row.customer_name ?? '').trim();
  const departureTime = normalizeDepartureTimeString(row?.departure_time);
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
    __departureTimeIndependent: true,
    object: objectItem,
    client: clientItem,
    fio: customerName || null,
    customer_name: customerName || null,
    object_name: objectItem?.name || String(row.object_name || '').trim() || null,
    object_summary: objectSummary,
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
  const normalized = normalizeOrder(row);
  const workTypeId = String(normalized?.work_type_id || '').trim();
  const existingName = String(
    normalized?.work_type_name || normalized?.work_type?.name || '',
  ).trim();
  if (!workTypeId || existingName) return normalized;

  const { data, error } = await supabase
    .from('work_types')
    .select('id, name')
    .eq('id', workTypeId)
    .maybeSingle();
  if (error || !data) return normalized;
  const name = String(data?.name || '').trim();
  return name
    ? { ...normalized, work_type_name: name, work_type: { id: data.id, name } }
    : normalized;
}

function buildConcurrencyError(message: string, latest: any = null) {
  const error: any = new Error(message || 'Request was changed by another user');
  error.code = 'CONFLICT';
  error.latest = latest;
  return error;
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
            return normalizeOrder(Array.isArray(retryData) ? retryData[0] : retryData);
          }
        }
        throw buildConcurrencyError('Order was modified concurrently', latest || null);
      }

      // The RPC already returns the committed order row. A mandatory follow-up
      // request made a successful save look failed whenever that second request
      // was interrupted on a slow device or during a session transition.
      return normalizeOrder(Array.isArray(rpcData) ? rpcData[0] : rpcData);
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
      objectIds = [],
      orderIds = [],
      clientTags = [],
      objectTags = [],
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
    const normalizeTagFilters = (values: any) =>
      Array.from(
        new Set(
          (Array.isArray(values) ? values : [])
            .map((value) => String(value || '').trim())
            .filter(Boolean),
        ),
      );
    const normalizedClientTags = normalizeTagFilters(clientTags);
    const normalizedObjectTags = normalizeTagFilters(objectTags);
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
    if (Array.isArray(objectIds) && objectIds.length) {
      query = query.in('object_id', objectIds.map(String));
    }
    if (Array.isArray(orderIds) && orderIds.length) {
      query = query.in('id', orderIds.map(String));
    }
    if (normalizedClientTags.length) query = query.overlaps('client_tags', normalizedClientTags);
    if (normalizedObjectTags.length) query = query.overlaps('object_tags', normalizedObjectTags);
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
    return warmExecutorNames(Array.isArray(data) ? data.map(normalizeOrder) : []);
  });
}

export async function getRelatedRequestCount({
  scope = 'my',
  clientId = '',
  objectIds = [],
}: any = {}) {
  const relationFilters = {
    clientId: String(clientId || '').trim(),
    objectIds: Array.from(
      new Set(
        (Array.isArray(objectIds) ? objectIds : [])
          .map((value) => String(value || '').trim())
          .filter(Boolean),
      ),
    ),
  };
  if (!hasRelationFilters(relationFilters)) return 0;

  return measureNetwork('requests.relatedCount', async () => {
    const session = await requireRequestSession();
    let query = supabase
      .from('orders_accessible')
      .select('id', { count: 'exact', head: true });

    if (scope !== 'all') {
      query = query.eq('assigned_to', session.user.id);
    }

    query = excludeFeedStatuses(query);
    query = applyOrderRelationFilters(query, relationFilters);

    const { count, error } = await query;
    if (error) throw error;
    return Math.max(0, Number(count || 0));
  });
}

export async function getRequestById(id: any) {
  const key = String(id || '').trim();
  if (!key || !isUuid(key)) return null;
  return measureNetwork('requests.getById', async () => {
    // Never let a protected order-detail request fall through as `anon` while
    // Supabase is restoring or refreshing the persisted mobile session.
    await requireRequestSession();
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

    const rows = warmExecutorNames(Array.isArray(data) ? data.map(normalizeOrder) : []);
    if (normalizedScope === 'my' && userId) return rows.filter((row) => row.assigned_to === userId);

    return rows;
  });
}
