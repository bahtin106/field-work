import { supabase } from '../../../lib/supabase';
import { getOrderIdsByWorkTypes, mapStatusToDb } from '../../../lib/orderFilters';
import { measureNetwork } from '../../shared/perf/devMetrics';

const DEFAULT_PAGE_SIZE = 20;
const requestByIdInFlight = new Map<string, Promise<any>>();
const CALENDAR_SELECT_COLUMNS = [
  'id',
  'title',
  'customer_name',
  'address',
  'city',
  'town',
  'settlement',
  'street',
  'snt',
  'house',
  'plot',
  'building',
  'status',
  'status_v2',
  'state',
  'order_status',
  'time_window_start',
  'time_window_end',
  'date',
  'start_at',
  'urgent',
  'price',
  'total_price',
  'amount',
  'currency',
  'assigned_to',
  'assigned_to_name',
  'assigned_to_fullname',
  'assignee_name',
  'executor_name',
  'worker_name',
  'assigned_to_first_name',
  'assigned_to_last_name',
  'executor_first_name',
  'executor_last_name',
  'assignee_first_name',
  'assignee_last_name',
  'customer_phone_visible',
  'phone_is_visible',
  'phone',
  'customer_phone_masked',
  'created_at',
  'updated_at',
  'custom',
].join(', ');
const EXTRA_ORDER_FIELDS = [
  'country',
  'postal_code',
  'building',
  'floor',
  'entrance',
  'apartment',
  'intercom',
  'secondary_phone',
  'contact_email',
  'contact_pref',
  'entrance_info',
  'parking_notes',
  'geo_lat',
  'geo_lng',
  'datetime',
  'time_window_end',
];

function normalizeOrder(row) {
  if (!row) return row;
  return {
    ...row,
    time_window_start: row.time_window_start ?? null,
  };
}

async function enrichOrderWithExtraFields(row) {
  if (!row?.id) return normalizeOrder(row);
  try {
    const { data, error } = await supabase
      .from('orders')
      .select(`id, ${EXTRA_ORDER_FIELDS.join(', ')}`)
      .eq('id', row.id)
      .maybeSingle();
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

    let query = supabase.from('orders_secure_v2').select('*');

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

    const { data, error } = await query.order('time_window_start', { ascending: false }).range(from, to);
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
    const { data, error } = await supabase
      .from('orders_secure_v2')
      .select('*')
      .eq('id', id)
      .maybeSingle();
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
      .from('orders_secure_v2')
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

    const { data, error } = await query;
    if (error) throw error;

    const rows = Array.isArray(data) ? data.map(normalizeOrder) : [];
    if (normalizedScope === 'my' && userId) return rows.filter((row) => row.assigned_to === userId);

    return rows;
  });
}
