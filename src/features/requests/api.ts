import { supabase } from '../../../lib/supabase';
import { getOrderIdsByWorkTypes, getStatusDbAliases, mapStatusToDb } from '../../../lib/orderFilters';
import { formatPersonName } from '../../../lib/personName';
import { measureNetwork } from '../../shared/perf/devMetrics';
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
const OBJECT_RELATION_SELECT = `
  object:client_objects(
    id,
    client_id,
    name,
    country,
    region,
    district,
    city,
    street,
    house,
    postal_code,
    floor,
    entrance,
    apartment,
    comment,
    location_mode,
    geo_lat,
    geo_lng
  )
`;
const CLIENT_RELATION_SELECT = `
  client:clients(
    id,
    company_id,
    first_name,
    last_name,
    middle_name,
    full_name,
    email,
    phone,
    secondary_phone:additional_phone_1
  )
`;
const ORDER_SELECT_COLUMNS = `*, ${OBJECT_RELATION_SELECT}, ${CLIENT_RELATION_SELECT}`;
const ORDER_SELECT_COLUMNS_FALLBACK = `*, ${OBJECT_RELATION_SELECT}`;
const SECURE_ORDER_SELECT_COLUMNS = '*';
const CALENDAR_SELECT_COLUMNS = ORDER_SELECT_COLUMNS;
const CALENDAR_SELECT_COLUMNS_FALLBACK = ORDER_SELECT_COLUMNS_FALLBACK;
const EXTRA_ORDER_FIELDS = ['time_window_end'];
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
  if (feedStatusValues.length === 1) {
    return query.neq('status', feedStatusValues[0]);
  }
  const encoded = feedStatusValues
    .map((value) => `'${String(value).replace(/'/g, "''")}'`)
    .join(',');
  return query.not('status', 'in', `(${encoded})`);
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
  if (!row?.id) return normalizeOrder(row);
  try {
    let { data, error }: any = await supabase
      .from('orders')
      .select(`id, ${EXTRA_ORDER_FIELDS.join(', ')}, ${OBJECT_RELATION_SELECT}, ${CLIENT_RELATION_SELECT}`)
      .eq('id', row.id)
      .maybeSingle();
    if (error && shouldFallbackWithoutClientRelation(error)) {
      const retryResult: any = await supabase
        .from('orders')
        .select(`id, ${EXTRA_ORDER_FIELDS.join(', ')}, ${OBJECT_RELATION_SELECT}`)
        .eq('id', row.id)
        .maybeSingle();
      data = retryResult.data;
      error = retryResult.error;
    }
    if (error || !data) return normalizeOrder(row);
    return normalizeOrder({ ...(row || {}), ...(data || {}) });
  } catch {
    return normalizeOrder(row);
  }
}

function buildConcurrencyError(message: string, latest: any = null) {
  const error: any = new Error(message || 'Request was changed by another user');
  error.code = 'CONFLICT';
  error.latest = latest;
  return error;
}

function shouldFallbackFromRpcFailure(rpcFailure) {
  const msg = String(rpcFailure?.message || '').toLowerCase();
  const missingRpc =
    msg.includes('function') && (msg.includes('does not exist') || msg.includes('not found'));
  const incompatibleRpcTypes =
    msg.includes('case types uuid and integer cannot be matched') ||
    (msg.includes('types uuid and integer') && msg.includes('cannot be matched'));
  const rpcCaseTypeMismatch =
    msg.includes('case types') && msg.includes('cannot be matched');
  const rpcColumnMismatch =
    msg.includes('column') && (msg.includes('does not exist') || msg.includes('not found'));
  return missingRpc || incompatibleRpcTypes || rpcCaseTypeMismatch || rpcColumnMismatch;
}

function shouldFallbackWithoutClientRelation(error) {
  const msg = String(error?.message || '').toLowerCase();
  return (
    (msg.includes('permission denied') && msg.includes('clients')) ||
    (msg.includes('not enough permissions') && msg.includes('clients'))
  );
}

function normalizePatchForDirectUpdate(patch) {
  if (!patch || typeof patch !== 'object') return {};
  const safePatch = { ...patch };
  delete safePatch.created_by;
  delete safePatch.created_by_user_id;
  delete safePatch.updated_by;
  delete safePatch.updated_by_user_id;
  return safePatch;
}

function isCreatedByUserFkError(error) {
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  return (
    String(error?.code || '') === '23503' &&
    (message.includes('orders_created_by_user_id_fkey') ||
      details.includes('orders_created_by_user_id_fkey'))
  );
}

async function getCurrentProfileId() {
  const { data: authData, error: authError }: any = await supabase.auth.getUser();
  if (authError || !authData?.user?.id) return null;
  const userId = String(authData.user.id || '').trim();
  if (!isUuid(userId)) return null;

  const { data, error }: any = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data?.id) return null;
  return String(data.id);
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
      if (!shouldFallbackFromRpcFailure(rpcFailure) && !isCreatedByUserFkError(rpcFailure)) {
        throw rpcFailure;
      }
    }

    // Fallback path before migration is applied.
    const safePatch = {
      ...normalizePatchForDirectUpdate(patch),
      updated_at: new Date().toISOString(),
    };
    let query = supabase.from('orders').update(safePatch).eq('id', id);
    if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt);
    const { data, error } = await query.select('id, updated_at').maybeSingle();
    if (error) {
      if (isCreatedByUserFkError(error)) {
        const currentProfileId = await getCurrentProfileId();
        if (currentProfileId) {
          let repairQuery = supabase
            .from('orders')
            .update({
              ...safePatch,
              created_by_user_id: currentProfileId,
              updated_at: new Date().toISOString(),
            })
            .eq('id', id);
          if (expectedUpdatedAt) repairQuery = repairQuery.eq('updated_at', expectedUpdatedAt);
          const repairResult = await repairQuery.select('id, updated_at').maybeSingle();
          if (!repairResult.error && repairResult.data) {
            return getRequestByIdFresh(id);
          }
        }
      }
      throw error;
    }

    if (!data) {
      if (!expectedUpdatedAt) {
        throw new Error('Order not found');
      }
      const latest = await getRequestById(id);
      const retryExpectedUpdatedAt = latest?.updated_at || null;
      if (retryExpectedUpdatedAt) {
        let retryQuery = supabase
          .from('orders')
          .update({
            ...safePatch,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id)
          .eq('updated_at', retryExpectedUpdatedAt);
        let retryResult = await retryQuery.select('id, updated_at').maybeSingle();
        if (retryResult.error && isCreatedByUserFkError(retryResult.error)) {
          const currentProfileId = await getCurrentProfileId();
          if (currentProfileId) {
            retryQuery = supabase
              .from('orders')
              .update({
                ...safePatch,
                created_by_user_id: currentProfileId,
                updated_at: new Date().toISOString(),
              })
              .eq('id', id)
              .eq('updated_at', retryExpectedUpdatedAt);
            retryResult = await retryQuery.select('id, updated_at').maybeSingle();
          }
        }
        if (!retryResult.error && retryResult.data) {
          return getRequestByIdFresh(id);
        }
      }
      throw buildConcurrencyError('Order was modified concurrently', latest || null);
    }

    return getRequestByIdFresh(id);
  });
}

export async function listRequests(params: any = {}) {
  return measureNetwork('requests.list', async () => {
    const {
      scope = 'all',
      status = 'all',
      statuses = [],
      executorId = null,
      departmentId = null,
      workTypeIds = [],
      relationClientId = '',
      relationObjectIds = [],
      clientIds = [],
      orderIds = [],
      dateFrom = null,
      dateTo = null,
      sumMin = null,
      sumMax = null,
      userId = null,
      page = 1,
      pageSize = DEFAULT_PAGE_SIZE,
    } = params;

    const isFeedRequest = status === 'feed';
    const extraStatusValues = resolveStatusFilterValues(statuses);
    let query = supabase
      .from(isFeedRequest ? 'orders_secure_v2' : 'orders')
      .select(isFeedRequest ? SECURE_ORDER_SELECT_COLUMNS : ORDER_SELECT_COLUMNS);

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
      if (status === 'all') {
        query = excludeFeedStatuses(query);
      }
      const statusValues = getStatusDbAliases(status);
      if (statusValues.length === 1) query = query.eq('status', statusValues[0]);
      if (statusValues.length > 1) query = query.in('status', statusValues);
      if (statusValues.length === 0) {
        const statusValue = mapStatusToDb(status);
        if (statusValue) query = query.eq('status', statusValue);
      }
      if (executorId) query = query.eq('assigned_to', executorId);
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
    if (Number.isFinite(parsedSumMin)) query = query.gte('start_price', parsedSumMin);
    if (Number.isFinite(parsedSumMax)) query = query.lte('start_price', parsedSumMax);

    query = applyOrderRelationFilters(query, {
      clientId: relationClientId,
      objectIds: relationObjectIds,
    });

    const from = Math.max(0, (Number(page) - 1) * Number(pageSize));
    const to = from + Number(pageSize) - 1;

    let { data, error } = await query.order('time_window_start', { ascending: false }).range(from, to);
    if (!isFeedRequest && error && shouldFallbackWithoutClientRelation(error)) {
      let fallbackQuery = supabase.from('orders').select(ORDER_SELECT_COLUMNS_FALLBACK);

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
        fallbackQuery = fallbackQuery.eq('assigned_to', uid);
      }

      if (status === 'feed') {
        fallbackQuery = fallbackQuery.is('assigned_to', null);
        const feedStatusValues = getStatusDbAliases('feed');
        if (feedStatusValues.length === 1) fallbackQuery = fallbackQuery.eq('status', feedStatusValues[0]);
        if (feedStatusValues.length > 1) fallbackQuery = fallbackQuery.in('status', feedStatusValues);
      } else {
        if (status === 'all') {
          fallbackQuery = excludeFeedStatuses(fallbackQuery);
        }
        const statusValues = getStatusDbAliases(status);
        if (statusValues.length === 1) fallbackQuery = fallbackQuery.eq('status', statusValues[0]);
        if (statusValues.length > 1) fallbackQuery = fallbackQuery.in('status', statusValues);
        if (statusValues.length === 0) {
          const statusValue = mapStatusToDb(status);
          if (statusValue) fallbackQuery = fallbackQuery.eq('status', statusValue);
        }
        if (executorId) fallbackQuery = fallbackQuery.eq('assigned_to', executorId);
      }
      fallbackQuery = applyStatusFilterValues(fallbackQuery, extraStatusValues);


      if (Array.isArray(workTypeIds) && workTypeIds.length) {
        const ids = await getOrderIdsByWorkTypes(workTypeIds);
        if (!ids.length) return [];
        fallbackQuery = fallbackQuery.in('id', ids);
      }
      if (Array.isArray(clientIds) && clientIds.length) {
        fallbackQuery = fallbackQuery.in('client_id', clientIds.map(String));
      }
      if (Array.isArray(orderIds) && orderIds.length) {
        fallbackQuery = fallbackQuery.in('id', orderIds.map(String));
      }
      if (dateFrom) fallbackQuery = fallbackQuery.gte('time_window_start', dateFrom);
      if (dateTo) fallbackQuery = fallbackQuery.lte('time_window_start', dateTo);
      if (Number.isFinite(parsedSumMin)) fallbackQuery = fallbackQuery.gte('start_price', parsedSumMin);
      if (Number.isFinite(parsedSumMax)) fallbackQuery = fallbackQuery.lte('start_price', parsedSumMax);

      fallbackQuery = applyOrderRelationFilters(fallbackQuery, {
        clientId: relationClientId,
        objectIds: relationObjectIds,
      });

      const retryResult = await fallbackQuery
        .order('time_window_start', { ascending: false })
        .range(from, to);
      data = retryResult.data;
      error = retryResult.error;
    }
    if (error) throw error;
    return enrichOrdersWithExecutorNames(Array.isArray(data) ? data.map(normalizeOrder) : []);
  });
}

export async function getRequestById(id: any) {
  const key = String(id || '').trim();
  if (!key || !isUuid(key)) return null;
  return measureNetwork('requests.getById', async () => {
    let { data, error } = await supabase
      .from('orders')
      .select(ORDER_SELECT_COLUMNS)
      .eq('id', key)
      .maybeSingle();
    if (error && shouldFallbackWithoutClientRelation(error)) {
      const retryResult = await supabase
        .from('orders')
        .select(ORDER_SELECT_COLUMNS_FALLBACK)
        .eq('id', key)
        .maybeSingle();
      data = retryResult.data;
      error = retryResult.error;
    }
    if (error) throw error;
    if (!data) {
      const secureResult: any = await supabase
        .from('orders_secure_v2')
        .select('*')
        .eq('id', key)
        .maybeSingle();
      if (secureResult.error) throw secureResult.error;
      data = secureResult.data;
    }
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
      .from('orders')
      .select(CALENDAR_SELECT_COLUMNS)
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

    let { data, error } = await query;
    if (error && shouldFallbackWithoutClientRelation(error)) {
      let fallbackQuery = supabase
        .from('orders')
        .select(CALENDAR_SELECT_COLUMNS_FALLBACK)
        .order('time_window_start', { ascending: false, nullsFirst: false });

      if (normalizedScope === 'my') {
        fallbackQuery = fallbackQuery.eq('assigned_to', userId);
      }
      if (startDate) {
        fallbackQuery = fallbackQuery.gte('time_window_start', startDate);
      }
      if (endDate) {
        fallbackQuery = fallbackQuery.lte('time_window_start', endDate);
      }

      const retryResult = await fallbackQuery;
      data = retryResult.data;
      error = retryResult.error;
    }
    if (error) throw error;

    const rows = await enrichOrdersWithExecutorNames(Array.isArray(data) ? data.map(normalizeOrder) : []);
    if (normalizedScope === 'my' && userId) return rows.filter((row) => row.assigned_to === userId);

    return rows;
  });
}
