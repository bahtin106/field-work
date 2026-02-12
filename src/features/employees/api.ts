import { supabase } from '../../../lib/supabase';
import { measureNetwork } from '../../shared/perf/devMetrics';

function normalizeEmployee(row) {
  const first_name = row?.first_name ?? row?.firstName ?? '';
  const last_name = row?.last_name ?? row?.lastName ?? '';
  const nameParts = `${first_name} ${last_name}`.trim();
  const full_name_raw = nameParts || (row?.full_name ?? row?.fullName ?? '').trim() || null;

  const avatar_url = row?.avatar_url ?? row?.avatarUrl ?? null;

  const normalized = {
    ...row,
    // keep original snake_case fields for existing code
    full_name: full_name_raw,
    display_name: full_name_raw || row?.email || '',
    // add camelCase aliases expected by UI
    firstName: first_name || '',
    lastName: last_name || '',
    fullName: full_name_raw,
    avatarUrl: avatar_url,
    displayName: full_name_raw || row?.email || '',
  };

  return normalized;
}

export async function listEmployees(filters = {}) {
  return measureNetwork('employees.list', async () => {
    let query = supabase
      .from('profiles')
      .select('id, first_name, last_name, full_name, role, department_id, last_seen_at, is_suspended, suspended_at, email, phone, birthdate, avatar_url')
      .order('full_name', { ascending: true, nullsFirst: false });

    if (Array.isArray(filters.departments) && filters.departments.length > 0) {
      const deptIds = filters.departments.map((d) => (typeof d === 'number' ? d : String(d)));
      query = query.in('department_id', deptIds);
    }

    if (Array.isArray(filters.roles) && filters.roles.length > 0) {
      query = query.in('role', filters.roles);
    }

    if (filters.suspended === true) {
      query = query.or('is_suspended.eq.true,suspended_at.not.is.null');
    } else if (filters.suspended === false) {
      query = query.eq('is_suspended', false).is('suspended_at', null);
    }

    const { data, error } = await query;
    if (error) throw error;
    return Array.isArray(data) ? data.map(normalizeEmployee) : [];
  });
}

export async function getEmployeeById(userId) {
  return measureNetwork('employees.getById', async () => {
    if (!userId) return null;

    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id || null;
    const authEmail = auth?.user?.email || '';

    let rpcRow = null;
    let iAmAdmin = false;

    if (uid) {
      const { data: me } = await supabase.from('profiles').select('role').eq('id', uid).single();
      iAmAdmin = me?.role === 'admin';

      if (iAmAdmin) {
        const { data: rpc } = await supabase.rpc('admin_get_profile_with_email', {
          target_user_id: userId,
        });
        rpcRow = Array.isArray(rpc) ? rpc[0] : rpc;
      }
    }

    const { data: prof, error } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, full_name, phone, avatar_url, department_id, is_suspended, suspended_at, birthdate, role')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!prof) return null;

    let departmentName = null;
    if (prof.department_id) {
      const { data: departmentRow } = await supabase
        .from('departments')
        .select('name')
        .eq('id', prof.department_id)
        .maybeSingle();
      departmentName = departmentRow?.name || null;
    }

    let email = '';
    if (rpcRow?.email) {
      email = rpcRow.email;
    } else if (uid && userId === uid && authEmail) {
      email = authEmail;
    }

    return {
      ...normalizeEmployee(prof),
      email,
      meIsAdmin: iAmAdmin,
      myUid: uid,
      departmentName,
      isSuspended: !!(prof?.is_suspended || prof?.suspended_at),
    };
  });
}

export async function listDepartments({ companyId, onlyEnabled = true } = {}) {
  return measureNetwork('employees.departments', async () => {
    if (!companyId) return [];

    const { data, error } = await supabase
      .from('departments')
      .select('id, name, is_enabled, company_id')
      .eq('company_id', companyId)
      .order('name');

    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    return onlyEnabled ? rows.filter((item) => item.is_enabled !== false) : rows;
  });
}

export async function updateEmployeeProfile(userId, patch) {
  return measureNetwork('employees.updateProfile', async () => {
    const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
    if (error) throw error;
    return getEmployeeById(userId);
  });
}
