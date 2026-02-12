import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { queryKeys } from '../../shared/query/queryKeys';
import { getEmployeeById, listDepartments, listEmployees, updateEmployeeProfile } from './api';

export function useEmployees(filters = {}, options = {}) {
  return useQuery({
    queryKey: queryKeys.employees.list(filters),
    queryFn: () => listEmployees(filters),
    staleTime: 60 * 1000,
    ...options,
  });
}

export function useEmployee(id, options = {}) {
  return useQuery({
    queryKey: queryKeys.employees.detail(id),
    queryFn: () => getEmployeeById(id),
    enabled: !!id,
    staleTime: 120 * 1000,
    ...options,
  });
}

export function useDepartmentsQuery({ companyId, onlyEnabled = true, enabled = true } = {}) {
  return useQuery({
    queryKey: queryKeys.employees.departments(companyId, onlyEnabled),
    queryFn: () => listDepartments({ companyId, onlyEnabled }),
    enabled: enabled && !!companyId,
    staleTime: 10 * 60 * 1000,
  });
}

export function useEmployeesRealtimeSync({ enabled = true } = {}) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    const channel = supabase
      .channel('employees:realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (payload) => {
        const rowId = payload?.new?.id || payload?.old?.id;
        if (rowId) {
          queryClient.invalidateQueries({ queryKey: queryKeys.employees.detail(rowId) });
        }
        queryClient.invalidateQueries({ queryKey: ['employees'] });
      })
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [enabled, queryClient]);
}

export function useUpdateEmployeeMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }) => updateEmployeeProfile(id, patch),
    onSuccess: (updated) => {
      if (updated?.id) {
        queryClient.setQueryData(queryKeys.employees.detail(updated.id), updated);
      }
      queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
  });
}

export async function ensureEmployeePrefetch(queryClient, id) {
  if (!id) return null;
  return queryClient.ensureQueryData({
    queryKey: queryKeys.employees.detail(id),
    queryFn: () => getEmployeeById(id),
    staleTime: 120 * 1000,
  });
}
