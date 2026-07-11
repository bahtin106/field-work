import { useMemo } from 'react';
import { useEmployees, useEmployeesRealtimeSync } from '../../src/features/employees/queries';
import { useAuth } from './useAuth';

export function useUsers(options = {}) {
  const { filters = {}, enabled = true } = options;
  const { isAuthenticated, profile } = useAuth();
  const queryEnabled = enabled && isAuthenticated;
  const companyId = filters?.companyId || profile?.company_id || null;

  const { data, isLoading, isFetching, refetch, error } = useEmployees(filters, {
    enabled: queryEnabled,
    placeholderData: (prev) => prev ?? [],
  });

  useEmployeesRealtimeSync({ enabled: queryEnabled && !!companyId, companyId });

  const isRefreshing = useMemo(() => Boolean(data) && isFetching, [data, isFetching]);

  return {
    users: data || [],
    isLoading,
    isRefreshing,
    refresh: refetch,
    error,
  };
}
