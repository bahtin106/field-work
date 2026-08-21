import { onlineManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { formatPersonNameParts } from '../../../lib/personName';
import { queryKeys } from '../../shared/query/queryKeys';
import {
  assertActiveQueryCacheOwnerContext,
  captureActiveQueryCacheOwnerContext,
  isActiveQueryCacheOwnerContext,
} from '../../shared/query/queryClient';
import { withReadDeadline } from '../../shared/network/readDeadline';
import { getEmployeeById, listDepartments, listEmployees, updateEmployeeProfile } from './api';
import { normalizeDepartmentFilterIds } from './departments';
import {
  canRunOutboxSync,
  enqueueEmployeeUpdate,
  syncOfflineOutbox,
  useOfflineSnapshot,
} from '../../shared/offline/offlineStatus';

const EMPLOYEE_MUTATION_OWNER_CONTEXT = Symbol('employee-mutation-owner-context');

function isOfflineLikeError(error: any) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('network request failed') ||
    message.includes('network error') ||
    message.includes('failed to fetch') ||
    message.includes('internet') ||
    message.includes('timed out') ||
    message.includes('offline')
  );
}

function normalizeEmployeeListScope(value: any) {
  return String(value || '').trim().toLowerCase();
}

function normalizedStringSet(values: any) {
  return new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean),
  );
}

function employeeFiltersAreSuperset(source: any = {}, target: any = {}) {
  if (
    normalizeEmployeeListScope(source?.companyId) !==
    normalizeEmployeeListScope(target?.companyId)
  ) {
    return false;
  }

  const sourceDepartments = normalizeDepartmentFilterIds(source?.departments);
  const targetDepartments = normalizeDepartmentFilterIds(target?.departments);
  const sourceHasDepartmentFilter =
    sourceDepartments.includeNoDepartment || sourceDepartments.departmentIds.length > 0;
  const targetHasDepartmentFilter =
    targetDepartments.includeNoDepartment || targetDepartments.departmentIds.length > 0;
  if (sourceHasDepartmentFilter) {
    if (!targetHasDepartmentFilter) return false;
    const allowedDepartments = normalizedStringSet(sourceDepartments.departmentIds);
    if (
      targetDepartments.departmentIds.some(
        (id: any) => !allowedDepartments.has(normalizeEmployeeListScope(id)),
      )
    ) {
      return false;
    }
    if (targetDepartments.includeNoDepartment && !sourceDepartments.includeNoDepartment) {
      return false;
    }
  }

  const sourceRoles = normalizedStringSet(source?.roles);
  const targetRoles = normalizedStringSet(target?.roles);
  if (sourceRoles.size > 0) {
    if (targetRoles.size === 0) return false;
    for (const role of targetRoles) {
      if (!sourceRoles.has(role)) return false;
    }
  }

  if (typeof source?.suspended === 'boolean' && source.suspended !== target?.suspended) {
    return false;
  }
  return true;
}

function employeeMatchesFilters(employee: any, filters: any = {}) {
  const departments = normalizeDepartmentFilterIds(filters?.departments);
  if (departments.includeNoDepartment || departments.departmentIds.length > 0) {
    const departmentId = normalizeEmployeeListScope(
      employee?.department_id || employee?.departmentId,
    );
    const departmentMatches = departmentId
      ? departments.departmentIds.some(
          (id: any) => normalizeEmployeeListScope(id) === departmentId,
        )
      : departments.includeNoDepartment;
    if (!departmentMatches) return false;
  }

  const roles = normalizedStringSet(filters?.roles);
  if (roles.size > 0 && !roles.has(normalizeEmployeeListScope(employee?.role))) return false;

  if (typeof filters?.suspended === 'boolean') {
    const suspended = Boolean(
      employee?.isSuspended ||
        employee?.is_suspended ||
        employee?.is_admin_blocked ||
        employee?.admin_blocked ||
        employee?.license_state === 'blocked_by_license' ||
        employee?.licenseState === 'blocked_by_license',
    );
    if (suspended !== filters.suspended) return false;
  }

  return true;
}

function findEmployeesInCachedSuperset(queryClient: any, filters: any) {
  let best: { rows: any[]; updatedAt: number } | null = null;
  const entries = queryClient.getQueriesData({ queryKey: ['employees', 'list'] }) || [];
  for (const [key, value] of entries) {
    if (!Array.isArray(value) || !Array.isArray(key)) continue;
    const sourceFilters = key[2] && typeof key[2] === 'object' ? key[2] : {};
    if (!employeeFiltersAreSuperset(sourceFilters, filters)) continue;
    const rows = value.filter((employee: any) => employeeMatchesFilters(employee, filters));
    if (rows.length === 0) continue;
    const updatedAt = Number(queryClient.getQueryState(key)?.dataUpdatedAt || 0);
    if (!best || updatedAt > best.updatedAt) best = { rows, updatedAt };
  }
  return best?.rows || null;
}

function findDepartmentsInCachedSuperset(
  queryClient: any,
  companyId: any,
  onlyEnabled: boolean,
) {
  if (!onlyEnabled) return null;
  const companyScope = normalizeEmployeeListScope(companyId);
  const entries = queryClient.getQueriesData({
    queryKey: ['employees', 'departments', String(companyId || '')],
  }) || [];
  let best: { rows: any[]; updatedAt: number } | null = null;
  for (const [key, value] of entries) {
    if (!Array.isArray(value) || !Array.isArray(key)) continue;
    if (normalizeEmployeeListScope(key[2]) !== companyScope || key[3] !== false) continue;
    const rows = value.filter((department: any) => department?.is_enabled !== false);
    if (rows.length === 0) continue;
    const updatedAt = Number(queryClient.getQueryState(key)?.dataUpdatedAt || 0);
    if (!best || updatedAt > best.updatedAt) best = { rows, updatedAt };
  }
  return best?.rows || null;
}

export function useEmployees(filters: any = {}, options: any = {}) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.employees.list(filters),
    queryFn: async ({ signal }) => {
      try {
        return await withReadDeadline((readSignal) => listEmployees(filters, readSignal), {
          label: 'Employees list',
          signal,
        });
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const cached = queryClient.getQueryData(queryKeys.employees.list(filters));
        if (Array.isArray(cached)) return cached;
        const derived = findEmployeesInCachedSuperset(queryClient, filters);
        if (derived) return derived;
        throw error;
      }
    },
    staleTime: 60 * 1000,
    retry: (count, error) => !isOfflineLikeError(error) && count < 1,
    ...options,
  });
}

export function useEmployee(id: any, options: any = {}) {
  const queryClient = useQueryClient();
  const {
    privilegedAdminAccess = false,
    ...queryOptions
  } = options || {};
  const detailKey = privilegedAdminAccess
    ? queryKeys.employees.adminDetail(id)
    : queryKeys.employees.detail(id);
  return useQuery({
    queryKey: detailKey,
    queryFn: async ({ signal }) => {
      try {
        return await withReadDeadline((readSignal) => getEmployeeById(id, readSignal, {
          allowSuperAdmin: privilegedAdminAccess,
        }), {
          label: 'Employee detail',
          signal,
        });
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const fromDetail = queryClient.getQueryData(detailKey);
        if (fromDetail) return fromDetail;
        const lists = queryClient.getQueriesData({
          queryKey: privilegedAdminAccess ? ['adminUsersV2'] : ['employees'],
        }) || [];
        for (const [, value] of lists) {
          const arr = Array.isArray(value) ? value : [];
          const found = arr.find(
            (row: any) => String(row?.id || row?.profile_id || '') === String(id || ''),
          );
          if (found) return found;
        }
        throw error;
      }
    },
    enabled: !!id,
    staleTime: 120 * 1000,
    refetchOnMount: false,
    retry: (count, error) => !isOfflineLikeError(error) && count < 1,
    ...queryOptions,
  });
}

export function useDepartmentsQuery({ companyId, onlyEnabled = true, enabled = true }: any = {}) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.employees.departments(companyId, onlyEnabled),
    queryFn: async ({ signal }) => {
      try {
        return await withReadDeadline(
          (readSignal) => listDepartments({ companyId, onlyEnabled }, readSignal),
          {
            label: 'Departments list',
            signal,
          },
        );
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const cached = queryClient.getQueryData(queryKeys.employees.departments(companyId, onlyEnabled));
        if (Array.isArray(cached)) return cached;
        const derived = findDepartmentsInCachedSuperset(
          queryClient,
          companyId,
          onlyEnabled,
        );
        if (derived) return derived;
        throw error;
      }
    },
    enabled: enabled && !!companyId,
    staleTime: 10 * 60 * 1000,
    retry: (count, error) => !isOfflineLikeError(error) && count < 1,
  });
}

type EmployeesRealtimeSubscription = {
  refs: number;
  channel: any;
};

const EMPLOYEE_REALTIME_WATCHED_FIELDS = [
  'first_name',
  'middle_name',
  'last_name',
  'full_name',
  'role',
  'department_id',
  'is_admin_blocked',
  'license_state',
  'avatar_url',
] as const;

const EMPLOYEE_CACHE_FIELD_ALIASES: Record<string, string[]> = {
  first_name: ['firstName'],
  middle_name: ['middleName'],
  last_name: ['lastName'],
  full_name: ['fullName'],
  avatar_url: ['avatarUrl'],
  license_state: ['licenseState'],
};

function readKnownEmployeeCacheField(row: any, field: string) {
  if (!row || typeof row !== 'object') return { known: false, value: undefined };
  if (Object.prototype.hasOwnProperty.call(row, field)) {
    return { known: true, value: row[field] };
  }
  for (const alias of EMPLOYEE_CACHE_FIELD_ALIASES[field] || []) {
    if (Object.prototype.hasOwnProperty.call(row, alias)) {
      return { known: true, value: row[alias] };
    }
  }
  return { known: false, value: undefined };
}

function employeeRealtimeValuesEqual(left: any, right: any) {
  return String(left ?? '') === String(right ?? '');
}

function hasEmployeeRealtimeCacheDifference(queryClient: any, employeeId: string, nextRow: any) {
  const cachedRows: any[] = [];
  const detail = queryClient.getQueryData(queryKeys.employees.detail(employeeId));
  if (detail) cachedRows.push(detail);
  const adminDetail = queryClient.getQueryData(queryKeys.employees.adminDetail(employeeId));
  if (adminDetail) cachedRows.push(adminDetail);

  const lists = queryClient.getQueriesData({ queryKey: ['employees', 'list'] }) || [];
  for (const [, value] of lists) {
    if (!Array.isArray(value)) continue;
    const cached = value.find((row: any) => String(row?.id || '') === employeeId);
    if (cached) cachedRows.push(cached);
  }

  return cachedRows.some((cached) => {
    if (cached?.__offlinePending === true) return false;
    return EMPLOYEE_REALTIME_WATCHED_FIELDS.some((field) => {
      if (!Object.prototype.hasOwnProperty.call(nextRow || {}, field)) return false;
      const current = readKnownEmployeeCacheField(cached, field);
      return current.known && !employeeRealtimeValuesEqual(current.value, nextRow[field]);
    });
  });
}

function hasEmployeeRealtimePayloadDifference(previousRow: any, nextRow: any) {
  return EMPLOYEE_REALTIME_WATCHED_FIELDS.some((field) => {
    if (!Object.prototype.hasOwnProperty.call(previousRow || {}, field)) return false;
    if (!Object.prototype.hasOwnProperty.call(nextRow || {}, field)) return false;
    return !employeeRealtimeValuesEqual(previousRow[field], nextRow[field]);
  });
}

function isLikelyEmployeePresenceHeartbeat(payload: any) {
  if (!Object.prototype.hasOwnProperty.call(payload?.new || {}, 'last_seen_at')) return false;
  const lastSeenAt = Date.parse(String(payload?.new?.last_seen_at || ''));
  if (!Number.isFinite(lastSeenAt)) return false;
  const committedAt = Date.parse(String(payload?.commit_timestamp || ''));
  const referenceTime = Number.isFinite(committedAt) ? committedAt : Date.now();
  return Math.abs(referenceTime - lastSeenAt) <= 5_000;
}

function patchEmployeeLastSeenInExistingCaches(queryClient: any, employeeId: string, lastSeenAt: any) {
  for (const detailKey of [
    queryKeys.employees.detail(employeeId),
    queryKeys.employees.adminDetail(employeeId),
  ]) {
    if (queryClient.getQueryData(detailKey)) {
      queryClient.setQueryData(detailKey, (previous: any) =>
        previous ? { ...previous, last_seen_at: lastSeenAt } : previous,
      );
    }
  }

  const lists = queryClient.getQueriesData({ queryKey: ['employees', 'list'] }) || [];
  lists.forEach(([key, value]: any) => {
    if (!Array.isArray(value)) return;
    let changed = false;
    const next = value.map((row: any) => {
      if (String(row?.id || '') !== employeeId) return row;
      changed = true;
      return { ...row, last_seen_at: lastSeenAt };
    });
    if (changed) queryClient.setQueryData(key, next);
  });
}

const employeesRealtimeSubscriptions = new WeakMap<
  object,
  Map<string, EmployeesRealtimeSubscription>
>();

function releaseEmployeesRealtimeSubscription(queryClient: any, scopeKey: string) {
  const subscriptions = employeesRealtimeSubscriptions.get(queryClient);
  const entry = subscriptions?.get(scopeKey);
  if (!entry) return;

  entry.refs -= 1;
  if (entry.refs > 0) return;

  subscriptions?.delete(scopeKey);
  if (subscriptions?.size === 0) employeesRealtimeSubscriptions.delete(queryClient);
  try {
    supabase.removeChannel(entry.channel);
  } catch {}
}

function acquireEmployeesRealtimeSubscription(queryClient: any, companyId: any) {
  const normalizedCompanyId = String(companyId || '').trim();
  const scopeKey = normalizedCompanyId || '__global__';

  let subscriptions = employeesRealtimeSubscriptions.get(queryClient);
  if (!subscriptions) {
    subscriptions = new Map();
    employeesRealtimeSubscriptions.set(queryClient, subscriptions);
  }

  const existing = subscriptions.get(scopeKey);
  if (existing) {
    existing.refs += 1;
    return () => releaseEmployeesRealtimeSubscription(queryClient, scopeKey);
  }

  const filter = normalizedCompanyId ? `company_id=eq.${normalizedCompanyId}` : undefined;
  const channel = supabase
    .channel(`employees:realtime:${scopeKey}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'profiles', ...(filter ? { filter } : {}) },
      (payload: any) => {
        const rowId = payload?.new?.id || payload?.old?.id;
        if (payload?.eventType === 'UPDATE' && rowId && payload?.new) {
          const normalizedRowId = String(rowId);
          const changedKnownField =
            hasEmployeeRealtimePayloadDifference(payload.old, payload.new) ||
            hasEmployeeRealtimeCacheDifference(queryClient, normalizedRowId, payload.new);
          const presenceHeartbeat = isLikelyEmployeePresenceHeartbeat(payload);
          if (Object.prototype.hasOwnProperty.call(payload.new, 'last_seen_at')) {
            patchEmployeeLastSeenInExistingCaches(
              queryClient,
              normalizedRowId,
              payload.new.last_seen_at || null,
            );
          }
          if (changedKnownField || !presenceHeartbeat) {
            queryClient.invalidateQueries({ queryKey: queryKeys.employees.detail(rowId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.employees.adminDetail(rowId) });
            queryClient.invalidateQueries({ queryKey: ['employees'] });
          }
          return;
        }
        if (rowId) {
          queryClient.invalidateQueries({ queryKey: queryKeys.employees.detail(rowId) });
          queryClient.invalidateQueries({ queryKey: queryKeys.employees.adminDetail(rowId) });
        }
        queryClient.invalidateQueries({ queryKey: ['employees'] });
      },
    )
    .subscribe((status: any) => {
      if (status === 'SUBSCRIBED') {
        queryClient.invalidateQueries({ queryKey: ['employees'] });
      }
    });

  subscriptions.set(scopeKey, { refs: 1, channel });
  return () => releaseEmployeesRealtimeSubscription(queryClient, scopeKey);
}

export function useEmployeesRealtimeSync({ enabled = true, companyId = null }: any = {}) {
  const queryClient = useQueryClient();
  const network = useOfflineSnapshot();
  const canUseRealtime =
    network.isNetworkKnown && network.isOnline && !network.isPoorConnection;

  useEffect(() => {
    if (!enabled || !canUseRealtime) return undefined;
    return acquireEmployeesRealtimeSubscription(queryClient, companyId);
  }, [canUseRealtime, companyId, enabled, queryClient]);
}

export function useUpdateEmployeeMutation({ privilegedAdminAccess = false } = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: any) => {
      assertActiveQueryCacheOwnerContext(variables?.[EMPLOYEE_MUTATION_OWNER_CONTEXT]);
      const { id, patch } = variables;
      const detailKey = privilegedAdminAccess
        ? queryKeys.employees.adminDetail(id)
        : queryKeys.employees.detail(id);
      const base = queryClient.getQueryData(detailKey) as Record<string, any> | null;
      const online = onlineManager.isOnline() && canRunOutboxSync();
      if (!online) {
        if (privilegedAdminAccess) {
          throw new Error('PRIVILEGED_EMPLOYEE_EDIT_REQUIRES_ONLINE');
        }
        assertActiveQueryCacheOwnerContext(variables?.[EMPLOYEE_MUTATION_OWNER_CONTEXT]);
        const queued = await enqueueEmployeeUpdate({ id, patch, base });
        return {
          ...(base || {}),
          ...(patch || {}),
          id,
          __offlinePending: true,
          __offlineOutboxId: queued.id,
        };
      }
      try {
        return await updateEmployeeProfile(id, patch, undefined, {
          allowSuperAdmin: privilegedAdminAccess,
        });
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        if (privilegedAdminAccess) throw error;
        assertActiveQueryCacheOwnerContext(variables?.[EMPLOYEE_MUTATION_OWNER_CONTEXT]);
        const queued = await enqueueEmployeeUpdate({ id, patch, base });
        return {
          ...(base || {}),
          ...(patch || {}),
          id,
          __offlinePending: true,
          __offlineOutboxId: queued.id,
        };
      }
    },
    onMutate: async (variables: any) => {
      const ownerContext = captureActiveQueryCacheOwnerContext();
      assertActiveQueryCacheOwnerContext(ownerContext);
      variables[EMPLOYEE_MUTATION_OWNER_CONTEXT] = ownerContext;
      const { id, patch } = variables;
      const detailKey = privilegedAdminAccess
        ? queryKeys.employees.adminDetail(id)
        : queryKeys.employees.detail(id);
      await queryClient.cancelQueries({ queryKey: detailKey });
      await queryClient.cancelQueries({ queryKey: ['employees', 'list'] });
      assertActiveQueryCacheOwnerContext(ownerContext);
      const previous = queryClient.getQueryData(detailKey);
      const previousLists = queryClient.getQueriesData({ queryKey: ['employees', 'list'] });
      updateEmployeeQueryCaches(
        queryClient,
        id,
        {
          ...(patch || {}),
          __offlinePending: !(onlineManager.isOnline() && canRunOutboxSync()),
        },
        { privilegedAdminAccess },
      );
      return { previous, previousLists, detailKey, ownerContext };
    },
    onError: (_error, _variables, context: any) => {
      if (!isActiveQueryCacheOwnerContext(context?.ownerContext)) return;
      if (context?.previous) queryClient.setQueryData(context.detailKey, context.previous);
      if (Array.isArray(context?.previousLists)) {
        context.previousLists.forEach(([key, value]: any) => {
          queryClient.setQueryData(key, value);
        });
      }
    },
    onSuccess: (updated, _variables, context: any) => {
      if (!isActiveQueryCacheOwnerContext(context?.ownerContext)) return;
      if (updated?.id) {
        updateEmployeeQueryCaches(
          queryClient,
          updated.id,
          updated,
          { privilegedAdminAccess },
        );
      }
      if (privilegedAdminAccess) {
        queryClient.invalidateQueries({ queryKey: ['adminUsersV2'] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['employees'] });
      }
      if (updated?.__offlinePending) {
        syncOfflineOutbox(queryClient).catch(() => {});
      }
    },
    onSettled: (_data, _error, variables: any) => {
      if (variables && typeof variables === 'object') {
        delete variables[EMPLOYEE_MUTATION_OWNER_CONTEXT];
      }
    },
  });
}

export function updateEmployeeQueryCaches(
  queryClient: any,
  employeeId: any,
  patchOrUpdater: any,
  { privilegedAdminAccess = false } = {},
) {
  const id = String(employeeId || '').trim();
  if (!id || !queryClient) return null;

  const resolveNext = (prev: any) => {
    const patch = typeof patchOrUpdater === 'function' ? patchOrUpdater(prev) : patchOrUpdater;
    if (!patch || typeof patch !== 'object') return prev;
    const merged = {
      ...(prev || {}),
      ...patch,
      id: patch.id || prev?.id || id,
    };
    const firstName = patch.firstName ?? patch.first_name ?? merged.firstName ?? merged.first_name ?? '';
    const middleName = patch.middleName ?? patch.middle_name ?? merged.middleName ?? merged.middle_name ?? '';
    const lastName = patch.lastName ?? patch.last_name ?? merged.lastName ?? merged.last_name ?? '';
    const computedFullName = formatPersonNameParts({ firstName, middleName, lastName });
    const explicitFullName = patch.fullName ?? patch.full_name;
    const fullName = explicitFullName ?? (computedFullName || merged.fullName || merged.full_name || null);
    return {
      ...merged,
      first_name: patch.first_name ?? merged.first_name ?? firstName,
      middle_name: patch.middle_name ?? merged.middle_name ?? middleName,
      last_name: patch.last_name ?? merged.last_name ?? lastName,
      full_name: fullName,
      firstName,
      middleName,
      lastName,
      fullName,
      display_name: fullName || merged.email || '',
      displayName: fullName || merged.email || '',
      avatarDisplayUrl: patch.avatar_display_url ?? patch.avatar_url ?? merged.avatarDisplayUrl,
      avatarUrl: patch.avatarUrl ?? patch.avatar_url ?? merged.avatarUrl,
    };
  };

  let nextDetail: any = null;
  const detailKey = privilegedAdminAccess
    ? queryKeys.employees.adminDetail(id)
    : queryKeys.employees.detail(id);
  queryClient.setQueryData(detailKey, (prev: any) => {
    nextDetail = resolveNext(prev);
    return nextDetail;
  });

  if (privilegedAdminAccess) return nextDetail;

  const lists = queryClient.getQueriesData({ queryKey: ['employees', 'list'] }) || [];
  lists.forEach(([key, value]: any) => {
    if (!Array.isArray(value)) return;
    let changed = false;
    const nextList = value.map((row: any) => {
      if (String(row?.id || '') !== id) return row;
      changed = true;
      return resolveNext(row);
    });
    if (changed) {
      queryClient.setQueryData(key, nextList);
    }
  });

  return nextDetail;
}

export async function ensureEmployeePrefetch(queryClient: any, id: any) {
  if (!id) return null;
  const existing = queryClient.getQueryData(queryKeys.employees.detail(id));
  if (existing && !existing.__listSeed) return existing;
  return queryClient.fetchQuery({
    queryKey: queryKeys.employees.detail(id),
    queryFn: ({ signal }) =>
      withReadDeadline((readSignal) => getEmployeeById(id, readSignal), {
        label: 'Employee detail prefetch',
        signal,
      }),
    staleTime: 0,
  });
}
