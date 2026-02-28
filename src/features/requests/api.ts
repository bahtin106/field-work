import { supabase } from '../../../lib/supabase';
import { getOrderIdsByWorkTypes, mapStatusToDb } from '../../../lib/orderFilters';
import { measureNetwork } from '../../shared/perf/devMetrics';

const DEFAULT_PAGE_SIZE = 20;
const requestByIdInFlight = new Map<string, Promise<any>>();
const OBJECT_RELATION_SELECT = `
  object:client_objects(
    id,
    client_id,
    name,
    summary,
    country,
    region,
    city,
    street,
    house,
    postal_code,
    building,
    floor,
    entrance,
    apartment,
    intercom,
    entrance_info,
    parking_notes,
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
    secondary_phone,
    contact_pref
  )
`;
const ORDER_SELECT_COLUMNS = `*, ${OBJECT_RELATION_SELECT}, ${CLIENT_RELATION_SELECT}`;
const ORDER_SELECT_COLUMNS_FALLBACK = `*, ${OBJECT_RELATION_SELECT}`;
const CALENDAR_SELECT_COLUMNS = ORDER_SELECT_COLUMNS;
const CALENDAR_SELECT_COLUMNS_FALLBACK = ORDER_SELECT_COLUMNS_FALLBACK;
const EXTRA_ORDER_FIELDS = ['time_window_end'];

function buildClientDisplayName(client) {
  if (!client || typeof client !== 'object') return '';
  const fullName = String(client.full_name ?? '').trim();
  if (fullName) return fullName;
  return [
    String(client.last_name ?? '').trim(),
    String(client.first_name ?? '').trim(),
    String(client.middle_name ?? '').trim(),
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeOrder(row) {
  if (!row) return row;
  const customerPhoneVisible =
    row.customer_phone_visible ?? row.client?.phone ?? null;
  const legacyPhoneVisible = row.phone_visible ?? customerPhoneVisible;
  const objectItem = row.object || row.client_object || null;
  const clientItem = row.client || null;
  const customerName = buildClientDisplayName(clientItem) || String(row.fio ?? row.customer_name ?? '').trim();
  return {
    ...row,
    customer_phone_visible: customerPhoneVisible,
    phone_visible: legacyPhoneVisible,
    time_window_start: row.time_window_start ?? null,
    object: objectItem,
    client: clientItem,
    fio: customerName || null,
    customer_name: customerName || null,
    object_name: objectItem?.name || null,
    object_summary: objectItem?.summary || null,
    secondary_phone: clientItem?.secondary_phone || null,
    contact_email: clientItem?.email || null,
    contact_pref: clientItem?.contact_pref || null,
    country: objectItem?.country || null,
    region: objectItem?.region || null,
    city: objectItem?.city || null,
    street: objectItem?.street || null,
    house: objectItem?.house || null,
    postal_code: objectItem?.postal_code || null,
    building: objectItem?.building || null,
    floor: objectItem?.floor || null,
    entrance: objectItem?.entrance || null,
    apartment: objectItem?.apartment || null,
    intercom: objectItem?.intercom || null,
    parking_notes: objectItem?.parking_notes || null,
    geo_lat: objectItem?.geo_lat || null,
    geo_lng: objectItem?.geo_lng || null,
  };
}

async function enrichOrderWithExtraFields(row) {
  if (!row?.id) return normalizeOrder(row);
  try {
    let { data, error } = await supabase
      .from('orders')
      .select(`id, ${EXTRA_ORDER_FIELDS.join(', ')}, ${OBJECT_RELATION_SELECT}, ${CLIENT_RELATION_SELECT}`)
      .eq('id', row.id)
      .maybeSingle();
    if (error && shouldFallbackWithoutClientRelation(error)) {
      const retryResult = await supabase
        .from('orders')
        .select(`id, ${EXTRA_ORDER_FIELDS.join(', ')}, ${OBJECT_RELATION_SELECT}`)
        .eq('id', row.id)
        .maybeSingle();
      data = retryResult.data;
      error = retryResult.error;
    }
    if (error || !data) return normalizeOrder(row);
    return normalizeOrder({ ...row, ...data });
  } catch {
    return normalizeOrder(row);
  }
}

function buildConcurrencyError(message, latest = null) {
  const error = new Error(message || 'Request was changed by another user');
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
  const next = { ...patch };
  if (Object.prototype.hasOwnProperty.call(next, 'contact_pref')) {
    const raw = String(next.contact_pref ?? '').trim();
    next.contact_pref = raw || null;
  }
  return next;
}

function isContactPrefEnumError(error) {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('contact_pref_enum') || msg.includes('invalid input value for enum');
}

export async function updateRequestWithVersion(id, patch, expectedUpdatedAt = null) {
  return measureNetwork('requests.update.withVersion', async () => {
    if (!id) throw new Error('Order id is required');
    const hasTimeWindowEndPatch = Object.prototype.hasOwnProperty.call(
      patch ?? {},
      'time_window_end',
    );

    // Preferred path: DB-side atomic RPC.
    if (!hasTimeWindowEndPatch) {
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
          throw buildConcurrencyError('Order was modified concurrently', latest || null);
        }

        return getRequestById(id);
      } catch (rpcFailure) {
        if (!shouldFallbackFromRpcFailure(rpcFailure)) {
          throw rpcFailure;
        }
      }
    }

    // Fallback path before migration is applied.
    const safePatch = normalizePatchForDirectUpdate(patch);
    let query = supabase.from('orders').update(safePatch).eq('id', id);
    if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt);
    let { data, error } = await query.select('id, updated_at').maybeSingle();
    if (error && isContactPrefEnumError(error) && safePatch.contact_pref != null) {
      const retryPatch = { ...safePatch, contact_pref: null };
      let retryQuery = supabase.from('orders').update(retryPatch).eq('id', id);
      if (expectedUpdatedAt) retryQuery = retryQuery.eq('updated_at', expectedUpdatedAt);
      const retryResult = await retryQuery.select('id, updated_at').maybeSingle();
      data = retryResult.data;
      error = retryResult.error;
    }
    if (error) throw error;

    if (!data) {
      if (!expectedUpdatedAt) {
        throw new Error('Order not found');
      }
      const latest = await getRequestById(id);
      throw buildConcurrencyError('Order was modified concurrently', latest || null);
    }

    return getRequestById(id);
  });
}

export async function listRequests(params = {}) {
  return measureNetwork('requests.list', async () => {
    const {
      scope = 'all',
      status = 'all',
      executorId = null,
      departmentId = null,
      workTypeIds = [],
      page = 1,
      pageSize = DEFAULT_PAGE_SIZE,
    } = params;

    let query = supabase.from('orders').select(ORDER_SELECT_COLUMNS);

    if (scope === 'my') {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const uid = userData?.user?.id;
      if (!uid) return [];
      query = query.eq('assigned_to', uid);
    }

    if (status === 'feed') {
      query = query.is('assigned_to', null);
    } else {
      const statusValue = mapStatusToDb(status);
      if (statusValue) query = query.eq('status', statusValue);
      if (executorId) query = query.eq('assigned_to', executorId);
    }

    if (departmentId != null) {
      query = query.eq('department_id', Number(departmentId));
    }

    if (Array.isArray(workTypeIds) && workTypeIds.length) {
      const ids = await getOrderIdsByWorkTypes(workTypeIds);
      if (!ids.length) return [];
      query = query.in('id', ids);
    }

    const from = Math.max(0, (Number(page) - 1) * Number(pageSize));
    const to = from + Number(pageSize) - 1;

    let { data, error } = await query.order('time_window_start', { ascending: false }).range(from, to);
    if (error && shouldFallbackWithoutClientRelation(error)) {
      let fallbackQuery = supabase.from('orders').select(ORDER_SELECT_COLUMNS_FALLBACK);

      if (scope === 'my') {
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        const uid = userData?.user?.id;
        if (!uid) return [];
        fallbackQuery = fallbackQuery.eq('assigned_to', uid);
      }

      if (status === 'feed') {
        fallbackQuery = fallbackQuery.is('assigned_to', null);
      } else {
        const statusValue = mapStatusToDb(status);
        if (statusValue) fallbackQuery = fallbackQuery.eq('status', statusValue);
        if (executorId) fallbackQuery = fallbackQuery.eq('assigned_to', executorId);
      }

      if (departmentId != null) {
        fallbackQuery = fallbackQuery.eq('department_id', Number(departmentId));
      }

      if (Array.isArray(workTypeIds) && workTypeIds.length) {
        const ids = await getOrderIdsByWorkTypes(workTypeIds);
        if (!ids.length) return [];
        fallbackQuery = fallbackQuery.in('id', ids);
      }

      const retryResult = await fallbackQuery
        .order('time_window_start', { ascending: false })
        .range(from, to);
      data = retryResult.data;
      error = retryResult.error;
    }
    if (error) throw error;
    return Array.isArray(data) ? data.map(normalizeOrder) : [];
  });
}

export async function getRequestById(id) {
  const key = String(id || '');
  if (!key) return null;
  const existing = requestByIdInFlight.get(key);
  if (existing) return existing;

  const p = measureNetwork('requests.getById', async () => {
    let { data, error } = await supabase
      .from('orders')
      .select(ORDER_SELECT_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error && shouldFallbackWithoutClientRelation(error)) {
      const retryResult = await supabase
        .from('orders')
        .select(ORDER_SELECT_COLUMNS_FALLBACK)
        .eq('id', id)
        .maybeSingle();
      data = retryResult.data;
      error = retryResult.error;
    }
    if (error) throw error;
    return enrichOrderWithExtraFields(data);
  }).finally(() => {
    requestByIdInFlight.delete(key);
  });

  requestByIdInFlight.set(key, p);
  return p;
}

export async function updateRequest(id, patch, expectedUpdatedAt = null) {
  return updateRequestWithVersion(id, patch, expectedUpdatedAt);
}

export async function listRequestExecutors({ companyId = null } = {}) {
  return measureNetwork('requests.executors', async () => {
    let query = supabase
      .from('profiles')
      .select('id, first_name, last_name, full_name, email, role, department_id')
      .neq('role', 'client');
    if (companyId) {
      query = query.eq('company_id', companyId);
    }
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

export async function getAssigneeDisplayNameById(userId) {
  return measureNetwork('requests.assigneeName', async () => {
    if (!userId) return '';
    const { data, error } = await supabase
      .from('profiles')
      .select('first_name, last_name, full_name, email')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return '';
    const nameParts = `${data.first_name || ''} ${data.last_name || ''}`.trim();
    const normalizedFullName = (data.full_name || '').trim();
    return nameParts || normalizedFullName || data.email || '';
  });
}

export async function listCalendarRequests({
  userId,
  role,
  scope = 'my',
  startDate = null,
  endDate = null,
} = {}) {
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

    const rows = Array.isArray(data) ? data.map(normalizeOrder) : [];
    if (normalizedScope === 'my' && userId) return rows.filter((row) => row.assigned_to === userId);

    return rows;
  });
}
