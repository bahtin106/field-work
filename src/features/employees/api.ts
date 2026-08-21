import { supabase } from '../../../lib/supabase';
import { formatPersonNameParts } from '../../../lib/personName';
import { measureNetwork } from '../../shared/perf/devMetrics';
import { inspectProfileMedia } from '../profileMedia/api';
import { normalizeDepartmentFilterIds } from './departments';
import {
  assertOwnerBoundAuthorization,
  pinOwnerBoundPostgrestRequest,
  type OwnerBoundAuthorization,
} from '../../shared/security/ownerBoundAuthorization';
const employeeByIdInFlight = new Map<string, Promise<any>>();

function applyReadAbortSignal(query: any, signal?: AbortSignal) {
  return signal ? query.abortSignal(signal) : query;
}

function throwIfReadAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error('Employee read was aborted');
  error.name = 'AbortError';
  throw error;
}

function isMissingUserIdColumn(error: any) {
  return error?.code === '42703' || /user_id/i.test(String(error?.message || ''));
}

function withoutUserIdColumn(columns: any) {
  if (columns !== '*') {
    const safeColumns = String(columns || '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item && item !== 'user_id')
      .join(', ');
    if (safeColumns) return safeColumns;
  }
  return columns;
}

async function selectProfileByLookup(
  lookupId: any,
  columns = '*',
  signal?: AbortSignal,
) {
  const id = String(lookupId || '').trim();
  if (!id) return { data: null, error: null };

  const result = await applyReadAbortSignal(
    supabase
      .from('profiles')
      .select(columns)
      .or(`id.eq.${id},user_id.eq.${id}`)
      .maybeSingle(),
    signal,
  );

  if (result.error && isMissingUserIdColumn(result.error)) {
    return applyReadAbortSignal(
      supabase
        .from('profiles')
        .select(withoutUserIdColumn(columns))
        .eq('id', id)
        .maybeSingle(),
      signal,
    );
  }

  return result;
}

async function resolveCurrentUserScope(signal?: AbortSignal) {
  const { data: auth } = await supabase.auth.getUser();
  throwIfReadAborted(signal);
  const uid = auth?.user?.id || null;
  if (!uid) {
    return { uid: null, profileId: null, companyId: null, role: '' };
  }

  const { data: me } = await selectProfileByLookup(
    uid,
    'id, user_id, role, company_id',
    signal,
  );

  return {
    uid,
    profileId: me?.id || null,
    companyId: me?.company_id || null,
    role: String(me?.role || '').toLowerCase(),
  };
}

function normalizeEmployee(row: any) {
  const first_name = row?.first_name ?? row?.firstName ?? '';
  const last_name = row?.last_name ?? row?.lastName ?? '';
  const middle_name = row?.middle_name ?? row?.middleName ?? '';
  const nameParts = formatPersonNameParts({ first_name, middle_name, last_name });
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
    userId: row?.user_id ?? row?.userId ?? null,
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

function normalizeCompanyRoleContext(data: any) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  const candidates = Array.isArray(row.candidates) ? row.candidates : [];
  const admins = Array.isArray(row.admins) ? row.admins : [];
  return {
    ...row,
    profileId: row.profile_id ?? row.profileId ?? null,
    companyId: row.company_id ?? row.companyId ?? null,
    canonicalAdminId:
      row.canonical_admin_id ?? row.canonicalAdminId ?? row.owner_id ?? row.ownerId ?? null,
    currentRole: String(row.current_role ?? row.currentRole ?? '').toLowerCase(),
    accountType: String(row.account_type ?? row.accountType ?? '').toLowerCase(),
    isSolo: !!(row.is_solo ?? row.isSolo),
    isCompanyOwner: !!(row.is_company_owner ?? row.isCompanyOwner),
    adminCount: Number(row.admin_count ?? row.adminCount ?? 0),
    requiresTransferOnDemotion: !!(
      row.requires_transfer_on_demotion ?? row.requiresTransferOnDemotion
    ),
    requiresTransferOnPromotion: !!(
      row.requires_transfer_on_promotion ?? row.requiresTransferOnPromotion
    ),
    roleEditable: row.role_editable ?? row.roleEditable ?? true,
    candidates,
    admins,
  };
}

export async function listEmployees(filters: any = {}, signal?: AbortSignal) {
  return measureNetwork('employees.list', async () => {
    const explicitCompanyId = String(filters?.companyId || '').trim() || null;
    const scope = explicitCompanyId ? null : await resolveCurrentUserScope(signal);
    const scopedCompanyId = explicitCompanyId || scope?.companyId || null;
    if (!scopedCompanyId) return [];

    let query = supabase
      .from('profiles')
      .select('id, first_name, last_name, middle_name, full_name, role, department_id, last_seen_at, is_admin_blocked, license_state, blocked_reason, email, phone, birthdate, avatar_url')
      .eq('company_id', scopedCompanyId)
      .order('full_name', { ascending: true, nullsFirst: false });

    const { departmentIds, includeNoDepartment } = normalizeDepartmentFilterIds(filters.departments);
    if (includeNoDepartment && departmentIds.length > 0) {
      query = query.or(`department_id.is.null,department_id.in.(${departmentIds.join(',')})`);
    } else if (includeNoDepartment) {
      query = query.is('department_id', null);
    } else if (departmentIds.length > 0) {
      query = query.in('department_id', departmentIds);
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

    const { data, error } = await applyReadAbortSignal(query, signal);
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

export async function getEmployeeById(
  userId: any,
  signal?: AbortSignal,
  { allowSuperAdmin = false } = {},
) {
  const employeeId = String(userId || '');
  if (!employeeId) return null;
  const key = `${allowSuperAdmin ? 'admin' : 'regular'}:${employeeId}`;
  const existing = signal ? null : employeeByIdInFlight.get(key);
  if (existing) return existing;

  const p = measureNetwork('employees.getById', async () => {
    const { data: auth, error: authError } = await supabase.auth.getUser();
    throwIfReadAborted(signal);
    const uid = auth?.user?.id || null;
    const authEmail = auth?.user?.email || '';
    if (allowSuperAdmin && (authError || !uid)) {
      throw authError || new Error('SUPER_ADMIN_ACCESS_REQUIRED');
    }

    let rpcRow = null;
    let iAmAdmin = false;
    let iAmSuperAdmin = false;
    let myCompanyId = null;
    let myProfileId = null;
    let superAdminRoleContext = null;
    let superAdminRoleContextLoaded = false;

    if (uid) {
      const { data: me } = await selectProfileByLookup(
        uid,
        'id, user_id, role, company_id',
        signal,
      );
      iAmAdmin = String(me?.role || '').toLowerCase() === 'admin';
      myCompanyId = me?.company_id || null;
      myProfileId = me?.id || null;

      if (allowSuperAdmin) {
        try {
          const { data: superAdminFlag } = await applyReadAbortSignal(
            supabase.rpc('is_super_admin'),
            signal,
          );
          iAmSuperAdmin = superAdminFlag === true;
        } catch (error) {
          throw error;
        }
        if (!iAmSuperAdmin) throw new Error('SUPER_ADMIN_ACCESS_REQUIRED');
      }

      if (iAmSuperAdmin) {
        try {
          const { data: targetProfile } = await selectProfileByLookup(userId, 'id', signal);
          const targetProfileId = targetProfile?.id || userId;
          try {
            const { data: roleContextRaw, error: roleContextError } = await applyReadAbortSignal(
              supabase.rpc('admin_get_company_role_context_super', {
                p_profile_id: targetProfileId,
              }),
              signal,
            );
            if (!roleContextError) {
              superAdminRoleContext = normalizeCompanyRoleContext(roleContextRaw);
              superAdminRoleContextLoaded = superAdminRoleContext !== null;
            }
          } catch {
            superAdminRoleContext = null;
            superAdminRoleContextLoaded = false;
          }

          const { data: fullRows, error: fullErr } = await applyReadAbortSignal(
            supabase.rpc('admin_get_user_profile_full', {
              p_profile_id: targetProfileId,
            }),
            signal,
          );
          if (fullErr) throw fullErr;
          if (!fullErr) {
            const full = Array.isArray(fullRows) ? fullRows[0] : null;
            if (full) {
              const { data: profileFlags } = await selectProfileByLookup(
                targetProfileId,
                'id, user_id, company_id, first_name, last_name, middle_name, full_name, email, is_admin_blocked, license_state, blocked_reason',
                signal,
              );
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
                  user_id: profileFlags?.user_id ?? full.user_id,
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
                accountType: superAdminRoleContext?.accountType || null,
                roleContext: superAdminRoleContext,
                roleContextLoaded: superAdminRoleContextLoaded,
                isSuspended,
                isBlocked,
              };
            }
            throw new Error('ADMIN_EMPLOYEE_NOT_FOUND');
          }
        } catch (error) {
          if (allowSuperAdmin) throw error;
        }
      }

    }

    const { data: targetLookup, error: targetLookupError } = await selectProfileByLookup(
      userId,
      'id, user_id, company_id',
      signal,
    );
    if (targetLookupError) throw targetLookupError;

    const targetProfileId = targetLookup?.id || String(userId || '').trim();
    const isOwnProfile =
      !!uid &&
      (
        String(userId || '') === String(uid) ||
        String(targetLookup?.id || '') === String(myProfileId || '') ||
        String(targetLookup?.user_id || '') === String(uid)
      );

    if (!iAmSuperAdmin && !isOwnProfile && !myCompanyId) return null;
    if (!iAmSuperAdmin && !isOwnProfile && targetLookup?.company_id !== myCompanyId) {
      return null;
    }

    if (iAmAdmin) {
      try {
        const { data: rpc, error: rpcError } = await applyReadAbortSignal(
          supabase.rpc('admin_get_profile_with_email', {
            target_user_id: targetProfileId,
          }),
          signal,
        );
        if (!rpcError) {
          rpcRow = Array.isArray(rpc) ? rpc[0] : rpc;
        }
      } catch {
        rpcRow = null;
      }
    }

    const { data: prof, error } = await selectProfileByLookup(
      targetProfileId,
      'id, user_id, first_name, last_name, middle_name, full_name, phone, avatar_url, department_id, company_id, is_admin_blocked, license_state, blocked_reason, birthdate, role, last_seen_at',
      signal,
    );

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
      const { data: departmentRow } = await applyReadAbortSignal(
        supabase
          .from('departments')
          .select('name')
          .eq('id', prof.department_id)
          .maybeSingle(),
        signal,
      );
      departmentName = departmentRow?.name || null;
    }
    let companyName = null;
    if (safeProf?.company_id) {
      try {
        const { data: companyRow } = await applyReadAbortSignal(
          supabase
            .from('companies')
            .select('name')
            .eq('id', safeProf.company_id)
            .maybeSingle(),
          signal,
        );
        companyName = companyRow?.name || null;
      } catch {
        companyName = null;
      }
    }

    let email = '';
    if (rpcRow?.email) {
      email = rpcRow.email;
    } else if (isOwnProfile && authEmail) {
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
      accountType: superAdminRoleContext?.accountType || null,
      roleContext: superAdminRoleContext,
      roleContextLoaded: superAdminRoleContextLoaded,
      isSuspended: !!safeProf?.is_admin_blocked,
      isBlocked:
        !!safeProf?.is_admin_blocked ||
        safeProf?.license_state === 'blocked_by_license',
    };
  }).finally(() => {
    if (!signal) employeeByIdInFlight.delete(key);
  });

  if (!signal) employeeByIdInFlight.set(key, p);
  return p;
}

export async function listDepartments(
  { companyId, onlyEnabled = true }: any = {},
  signal?: AbortSignal,
) {
  return measureNetwork('employees.departments', async () => {
    if (!companyId) return [];

    const { data, error } = await applyReadAbortSignal(
      supabase
        .from('departments')
        .select('id, name, is_enabled, company_id')
        .eq('company_id', companyId)
        .order('name'),
      signal,
    );

    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    return onlyEnabled ? rows.filter((item) => item.is_enabled !== false) : rows;
  });
}

export async function updateEmployeeProfile(
  userId: any,
  patch: any,
  signal?: AbortSignal,
  {
    allowSuperAdmin = false,
    authorization = null,
    companyId = null,
  }: {
    allowSuperAdmin?: boolean;
    authorization?: OwnerBoundAuthorization | null;
    companyId?: string | null;
  } = {},
) {
  return measureNetwork('employees.updateProfile', async () => {
    if (authorization && !String(companyId || '').trim()) {
      throw new Error('company_id is required for owner-bound employee updates');
    }
    let request: any = supabase.from('profiles').update(patch).eq('id', userId);
    if (companyId) request = request.eq('company_id', companyId);
    if (authorization) request = request.select('*').maybeSingle();
    if (authorization) {
      request = pinOwnerBoundPostgrestRequest(request, authorization);
    }
    const { data, error } = await applyReadAbortSignal(request, signal);
    if (authorization) assertOwnerBoundAuthorization(authorization);
    if (error) throw error;
    if (authorization && companyId) {
      return normalizeEmployee(data);
    }
    return getEmployeeById(userId, signal, { allowSuperAdmin });
  });
}

export async function getEmployeeByIdForOfflineSync(
  userId: any,
  {
    authorization,
    companyId,
    signal,
  }: {
    authorization: OwnerBoundAuthorization;
    companyId: string;
    signal?: AbortSignal;
  },
) {
  const normalizedUserId = String(userId || '').trim();
  const normalizedCompanyId = String(companyId || '').trim();
  if (!normalizedUserId || !normalizedCompanyId) return null;
  assertOwnerBoundAuthorization(authorization);
  let request: any = pinOwnerBoundPostgrestRequest(
    supabase
      .from('profiles')
      .select('*')
      .eq('id', normalizedUserId)
      .eq('company_id', normalizedCompanyId)
      .maybeSingle(),
    authorization,
  );
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  assertOwnerBoundAuthorization(authorization);
  if (error) throw error;
  return normalizeEmployee(data);
}
