import { supabase } from '../../../lib/supabase';
import { getOrderIdsByWorkTypes, mapStatusToDb } from '../../../lib/orderFilters';
import { measureNetwork } from '../../shared/perf/devMetrics';

const DEFAULT_PAGE_SIZE = 20;

function normalizeOrder(row) {
  if (!row) return row;
  return {
    ...row,
    time_window_start: row.time_window_start ?? null,
  };
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
  return measureNetwork('requests.getById', async () => {
    const { data, error } = await supabase
      .from('orders_secure_v2')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return normalizeOrder(data);
  });
}

export async function updateRequest(id, patch) {
  return measureNetwork('requests.update', async () => {
    const { error } = await supabase.from('orders').update(patch).eq('id', id);
    if (error) throw error;
    return getRequestById(id);
  });
}

export async function listRequestExecutors() {
  return measureNetwork('requests.executors', async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, department_id')
      .neq('role', 'client');

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

export async function listCalendarRequests({ userId, role } = {}) {
  return measureNetwork('requests.calendar', async () => {
    if (!userId) return [];

    let query = supabase
      .from('orders_secure_v2')
      .select('*')
      .order('time_window_start', { ascending: false, nullsFirst: false });

    if (role === 'worker') {
      query = query.eq('assigned_to', userId);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = Array.isArray(data) ? data.map(normalizeOrder) : [];
    if (role === 'worker' && userId) {
      return rows.filter((row) => row.assigned_to === userId || row.assigned_to == null);
    }

    return rows;
  });
}
