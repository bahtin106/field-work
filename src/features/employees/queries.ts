import { onlineManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { formatPersonNameParts } from '../../../lib/personName';
import { queryKeys } from '../../shared/query/queryKeys';
import { getEmployeeById, listDepartments, listEmployees, updateEmployeeProfile } from './api';
import {
  enqueueEmployeeUpdate,
  getOfflineSnapshot,
  syncOfflineOutbox,
} from '../../shared/offline/offlineStatus';

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

export function useEmployees(filters: any = {}, options: any = {}) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.employees.list(filters),
    queryFn: async () => {
      try {
        return await listEmployees(filters);
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const cached = queryClient.getQueryData(queryKeys.employees.list(filters));
        return Array.isArray(cached) ? cached : [];
      }
    },
    staleTime: 60 * 1000,
    retry: (count, error) => !isOfflineLikeError(error) && count < 1,
    ...options,
  });
}

export function useEmployee(id: any, options: any = {}) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.employees.detail(id),
    queryFn: async () => {
      try {
        return await getEmployeeById(id);
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const fromDetail = queryClient.getQueryData(queryKeys.employees.detail(id));
        if (fromDetail) return fromDetail;
        const lists = queryClient.getQueriesData({ queryKey: ['employees'] }) || [];
        for (const [, value] of lists) {
          const arr = Array.isArray(value) ? value : [];
          const found = arr.find((row: any) => String(row?.id || '') === String(id || ''));
          if (found) return found;
        }
        throw error;
      }
    },
    enabled: !!id,
    staleTime: 120 * 1000,
    refetchOnMount: false,
    retry: (count, error) => !isOfflineLikeError(error) && count < 1,
    ...options,
  });
}

export function useDepartmentsQuery({ companyId, onlyEnabled = true, enabled = true }: any = {}) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.employees.departments(companyId, onlyEnabled),
    queryFn: async () => {
      try {
        return await listDepartments({ companyId, onlyEnabled });
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const cached = queryClient.getQueryData(queryKeys.employees.departments(companyId, onlyEnabled));
        return Array.isArray(cached) ? cached : [];
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
  const detailKey = queryKeys.employees.detail(employeeId);
  if (queryClient.getQueryData(detailKey)) {
    queryClient.setQueryData(detailKey, (previous: any) =>
      previous ? { ...previous, last_seen_at: lastSeenAt } : previous,
    );
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
            queryClient.invalidateQueries({ queryKey: ['employees'] });
          }
          return;
        }
        if (rowId) {
          queryClient.invalidateQueries({ queryKey: queryKeys.employees.detail(rowId) });
        }
        queryClient.invalidateQueries({ queryKey: ['employees'] });
      },
    )
    .subscribe();

  subscriptions.set(scopeKey, { refs: 1, channel });
  return () => releaseEmployeesRealtimeSubscription(queryClient, scopeKey);
}

export function useEmployeesRealtimeSync({ enabled = true, companyId = null }: any = {}) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return undefined;
    return acquireEmployeesRealtimeSubscription(queryClient, companyId);
  }, [companyId, enabled, queryClient]);
}

export function useUpdateEmployeeMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, patch }: any) => {
      const base = queryClient.getQueryData(queryKeys.employees.detail(id)) as Record<string, any> | null;
      const online = onlineManager.isOnline() && getOfflineSnapshot().isOnline;
      if (!online) {
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
        return await updateEmployeeProfile(id, patch);
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
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
    onMutate: async ({ id, patch }: any) => {
      const detailKey = queryKeys.employees.detail(id);
      await queryClient.cancelQueries({ queryKey: detailKey });
      await queryClient.cancelQueries({ queryKey: ['employees', 'list'] });
      const previous = queryClient.getQueryData(detailKey);
      const previousLists = queryClient.getQueriesData({ queryKey: ['employees', 'list'] });
      updateEmployeeQueryCaches(queryClient, id, {
        ...(patch || {}),
        __offlinePending: !onlineManager.isOnline(),
      });
      return { previous, previousLists, detailKey };
    },
    onError: (_error, _variables, context: any) => {
      if (context?.previous) queryClient.setQueryData(context.detailKey, context.previous);
      if (Array.isArray(context?.previousLists)) {
        context.previousLists.forEach(([key, value]: any) => {
          queryClient.setQueryData(key, value);
        });
      }
    },
    onSuccess: (updated) => {
      if (updated?.id) updateEmployeeQueryCaches(queryClient, updated.id, updated);
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      if (updated?.__offlinePending) {
        syncOfflineOutbox(queryClient).catch(() => {});
      }
    },
  });
}

export function updateEmployeeQueryCaches(queryClient: any, employeeId: any, patchOrUpdater: any) {
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
  queryClient.setQueryData(queryKeys.employees.detail(id), (prev: any) => {
    nextDetail = resolveNext(prev);
    return nextDetail;
  });

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
    queryFn: () => getEmployeeById(id),
    staleTime: 0,
  });
}
