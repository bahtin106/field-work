import { supabase } from '../../../lib/supabase';
import { measureNetwork } from '../../shared/perf/devMetrics';
import { inspectProfileMedia } from '../profileMedia/api';
const employeeByIdInFlight = new Map<string, Promise<any>>();

async function resolveCurrentUserScope() {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id || null;
  if (!uid) {
    return { uid: null, companyId: null, role: '' };
  }

  const { data: me } = await supabase
    .from('profiles')
    .select('role, company_id')
    .eq('id', uid)
    .maybeSingle();

  return {
    uid,
    companyId: me?.company_id || null,
    role: String(me?.role || '').toLowerCase(),
  };
}

function normalizeEmployee(row: any) {
  const first_name = row?.first_name ?? row?.firstName ?? '';
  const last_name = row?.last_name ?? row?.lastName ?? '';
  const middle_name = row?.middle_name ?? row?.middleName ?? '';
  const nameParts = `${first_name} ${middle_name} ${last_name}`.trim();
  const full_name_raw = nameParts || (row?.full_name ?? row?.fullName ?? '').trim() || null;

  const avatar_url = row?.avatar_url ?? row?.avatarUrl ?? null;
  const isSuspended =
    !!row?.isSuspended ||
    !!row?.is_suspended ||
    !!row?.is_admin_blocked ||
    !!row?.admin_blocked;
  const isAdminBlocked =
    !!row?.is_admin_blocked ||
    !!row?.admin_blocked;
  const licenseState = row?.license_state ?? row?.licenseState ?? 'active';
  const isLicenseBlocked = licenseState === 'blocked_by_license';
  const isBlocked = !!row?.isBlocked || isSuspended || isAdminBlocked || isLicenseBlocked;

  const normalized = {
    ...row,
    // keep original snake_case fields for existing code
    full_name: full_name_raw,
    is_suspended: isSuspended,
    is_admin_blocked: isAdminBlocked,
    license_state: licenseState,
    display_name: full_name_raw || row?.email || '',
    // add camelCase aliases expected by UI
    firstName: first_name || '',
    lastName: last_name || '',
    middleName: middle_name || '',
    fullName: full_name_raw,
    avatarUrl: avatar_url,
    avatarDisplayUrl: row?.avatar_display_url ?? row?.avatarDisplayUrl ?? avatar_url,
    displayName: full_name_raw || row?.email || '',
    isSuspended,
    admin_blocked: isAdminBlocked,
    licenseState,
    isBlocked,
  };

  return normalized;
}

export async function listEmployees(filters: any = {}) {
  return measureNetwork('employees.list', async () => {
    const explicitCompanyId = String(filters?.companyId || '').trim() || null;
    const scope = explicitCompanyId ? null : await resolveCurrentUserScope();
    const scopedCompanyId = explicitCompanyId || scope?.companyId || null;
    if (!scopedCompanyId) return [];

    let query = supabase
      .from('profiles')
      .select('id, first_name, last_name, middle_name, full_name, role, department_id, last_seen_at, is_admin_blocked, license_state, blocked_reason, email, phone, birthdate, avatar_url')
      .eq('company_id', scopedCompanyId)
      .order('full_name', { ascending: true, nullsFirst: false });

    if (Array.isArray(filters.departments) && filters.departments.length > 0) {
      const deptIds = filters.departments.map((d) => (typeof d === 'number' ? d : String(d)));
      query = query.in('department_id', deptIds);
    }

    if (Array.isArray(filters.roles) && filters.roles.length > 0) {
      query = query.in('role', filters.roles);
    }

    if (filters.suspended === true) {
      query = query.or(
        'is_admin_blocked.eq.true,license_state.eq.blocked_by_license',
      );
    } else if (filters.suspended === false) {
      query = query
        .eq('is_admin_blocked', false)
        .neq('license_state', 'blocked_by_license');
    }

    const { data, error } = await query;
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const { cleanedUrls, resolvedUrls } = await inspectProfileMedia(
      rows.map((row) => String(row?.avatar_url || '').trim()).filter(Boolean),
    );
    const cleanedSet = new Set<string>(cleanedUrls);
    return rows.map((row) =>
      normalizeEmployee({
        ...row,
        avatar_url: cleanedSet.has(String(row?.avatar_url || '').trim()) ? null : row?.avatar_url,
        avatar_display_url: resolvedUrls[String(row?.avatar_url || '').trim()] || row?.avatar_url || null,
      }),
    );
  });
}

export async function getEmployeeById(userId: any) {
  const key = String(userId || '');
  if (!key) return null;
  const existing = employeeByIdInFlight.get(key);
  if (existing) return existing;

  const p = measureNetwork('employees.getById', async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id || null;
    const authEmail = auth?.user?.email || '';

    let rpcRow = null;
    let iAmAdmin = false;
    let iAmSuperAdmin = false;
    let myCompanyId = null;

    if (uid) {
      const { data: me } = await supabase.from('profiles').select('role, company_id').eq('id', uid).maybeSingle();
      iAmAdmin = String(me?.role || '').toLowerCase() === 'admin';
      myCompanyId = me?.company_id || null;

      try {
        const { data: superAdminFlag } = await supabase.rpc('is_super_admin');
        iAmSuperAdmin = superAdminFlag === true;
      } catch {
        iAmSuperAdmin = false;
      }

      if (iAmSuperAdmin) {
        try {
          const { data: fullRows, error: fullErr } = await supabase.rpc('admin_get_user_profile_full', {
            p_profile_id: userId,
          });
          if (!fullErr) {
            const full = Array.isArray(fullRows) ? fullRows[0] : null;
            if (full) {
              const { data: profileFlags } = await supabase
                .from('profiles')
                .select('company_id, first_name, last_name, middle_name, full_name, email, is_admin_blocked, license_state, blocked_reason')
                .eq('id', userId)
                .maybeSingle();
              const isSuspended = !!(profileFlags?.is_admin_blocked || full?.is_suspended);
              const isAdminBlocked = !!(profileFlags?.is_admin_blocked);
              const licenseState = profileFlags?.license_state || full?.license_state || 'active';
              const blockedReason = profileFlags?.blocked_reason || full?.blocked_reason || null;
              const isBlocked = isSuspended || isAdminBlocked || licenseState === 'blocked_by_license';
              const { cleanedUrls, resolvedUrls } = await inspectProfileMedia(
                [String(full?.avatar_url || '').trim()].filter(Boolean),
              );
              const cleanedSet = new Set<string>(cleanedUrls);
              return {
                ...normalizeEmployee({
                  id: full.profile_id,
                  first_name: profileFlags?.first_name ?? full.first_name,
                  last_name: profileFlags?.last_name ?? full.last_name,
                  middle_name: profileFlags?.middle_name ?? full.middle_name,
                  full_name: profileFlags?.full_name ?? full.full_name,
                  phone: full.phone,
                  avatar_url: cleanedSet.has(String(full?.avatar_url || '').trim()) ? null : full.avatar_url,
                  avatar_display_url:
                    resolvedUrls[String(full?.avatar_url || '').trim()] || full?.avatar_url || null,
                  department_id: full.department_id,
                  birthdate: full.birthdate,
                  role: full.role,
                  last_seen_at: full.last_seen_at,
                  is_suspended: isSuspended,
                  is_admin_blocked: isAdminBlocked,
                  license_state: licenseState,
                  blocked_reason: blockedReason,
                }),
                email: profileFlags?.email || full.email || '',
                meIsAdmin: true,
                meIsSuperAdmin: true,
                myUid: uid,
                departmentName: full.department_name || null,
                companyName: full.company_name || null,
                companyId: profileFlags?.company_id || full.company_id || null,
                isSuspended,
                isBlocked,
              };
            }
          }
        } catch {
          // fallback to default path below
        }
      }

      if (iAmAdmin) {
        const { data: rpc } = await supabase.rpc('admin_get_profile_with_email', {
          target_user_id: userId,
        });
        rpcRow = Array.isArray(rpc) ? rpc[0] : rpc;
      }
    }

    if (!iAmSuperAdmin && !myCompanyId) return null;

    let profileQuery = supabase
      .from('profiles')
      .select('id, first_name, last_name, middle_name, full_name, phone, avatar_url, department_id, company_id, is_admin_blocked, license_state, blocked_reason, birthdate, role, last_seen_at')
      .eq('id', userId);

    if (!iAmSuperAdmin && myCompanyId) {
      profileQuery = profileQuery.eq('company_id', myCompanyId);
    }

    const { data: prof, error } = await profileQuery.maybeSingle();

    if (error) throw error;
    if (!prof) return null;
    const { cleanedUrls, resolvedUrls } = await inspectProfileMedia(
      [String(prof?.avatar_url || '').trim()].filter(Boolean),
    );
    const cleanedSet = new Set<string>(cleanedUrls);
    const safeProf = {
      ...prof,
      avatar_url: cleanedSet.has(String(prof?.avatar_url || '').trim()) ? null : prof?.avatar_url,
      avatar_display_url: resolvedUrls[String(prof?.avatar_url || '').trim()] || prof?.avatar_url || null,
    };

    let departmentName = null;
    if (prof.department_id) {
      const { data: departmentRow } = await supabase
        .from('departments')
        .select('name')
        .eq('id', prof.department_id)
        .maybeSingle();
      departmentName = departmentRow?.name || null;
    }
    let companyName = null;
    if (safeProf?.company_id) {
      try {
        const { data: companyRow } = await supabase
          .from('companies')
          .select('name')
          .eq('id', safeProf.company_id)
          .maybeSingle();
        companyName = companyRow?.name || null;
      } catch {
        companyName = null;
      }
    }

    let email = '';
    if (rpcRow?.email) {
      email = rpcRow.email;
    } else if (uid && userId === uid && authEmail) {
      email = authEmail;
    }

    return {
      ...normalizeEmployee(safeProf),
      email,
      meIsAdmin: iAmAdmin || iAmSuperAdmin,
      meIsSuperAdmin: iAmSuperAdmin,
      myUid: uid,
      departmentName,
      companyName,
      companyId: safeProf?.company_id || null,
      isSuspended: !!safeProf?.is_admin_blocked,
      isBlocked:
        !!safeProf?.is_admin_blocked ||
        safeProf?.license_state === 'blocked_by_license',
    };
  }).finally(() => {
    employeeByIdInFlight.delete(key);
  });

  employeeByIdInFlight.set(key, p);
  return p;
}

export async function listDepartments({ companyId, onlyEnabled = true }: any = {}) {
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

export async function updateEmployeeProfile(userId: any, patch: any) {
  return measureNetwork('employees.updateProfile', async () => {
    const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
    if (error) throw error;
    return getEmployeeById(userId);
  });
}
