import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { queryKeys } from '../../shared/query/queryKeys';
import { getEmployeeById, listDepartments, listEmployees, updateEmployeeProfile } from './api';

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
    refetchOnMount: 'always',
    retry: (count, error) => !isOfflineLikeError(error) && count < 1,
    ...options,
  });
}

export function useDepartmentsQuery({ companyId, onlyEnabled = true, enabled = true }: any = {}) {
  return useQuery({
    queryKey: queryKeys.employees.departments(companyId, onlyEnabled),
    queryFn: () => listDepartments({ companyId, onlyEnabled }),
    enabled: enabled && !!companyId,
    staleTime: 10 * 60 * 1000,
  });
}

export function useEmployeesRealtimeSync({ enabled = true, companyId = null }: any = {}) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const filter = companyId ? `company_id=eq.${companyId}` : undefined;

    const channel = supabase
      .channel('employees:realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles', ...(filter ? { filter } : {}) },
        (payload: any) => {
          const rowId = payload?.new?.id || payload?.old?.id;
          if (rowId) {
            queryClient.invalidateQueries({ queryKey: queryKeys.employees.detail(rowId) });
          }
          queryClient.invalidateQueries({ queryKey: ['employees'] });
        },
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [companyId, enabled, queryClient]);
}

export function useUpdateEmployeeMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }: any) => updateEmployeeProfile(id, patch),
    onSuccess: (updated) => {
      if (updated?.id) updateEmployeeQueryCaches(queryClient, updated.id, updated);
      queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
  });
}

export function updateEmployeeQueryCaches(queryClient: any, employeeId: any, patchOrUpdater: any) {
  const id = String(employeeId || '').trim();
  if (!id || !queryClient) return null;

  const resolveNext = (prev: any) => {
    const patch = typeof patchOrUpdater === 'function' ? patchOrUpdater(prev) : patchOrUpdater;
    if (!patch || typeof patch !== 'object') return prev;
    return {
      ...(prev || {}),
      ...patch,
      id: patch.id || prev?.id || id,
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
  return queryClient.ensureQueryData({
    queryKey: queryKeys.employees.detail(id),
    queryFn: () => getEmployeeById(id),
    staleTime: 120 * 1000,
  });
}
