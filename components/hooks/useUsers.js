import { useMemo } from 'react';
import { useEmployees, useEmployeesRealtimeSync } from '../../src/features/employees/queries';
import { useAuth } from './useAuth';

export function useUsers(options = {}) {
  const { filters = {}, enabled = true } = options;
  const { isAuthenticated } = useAuth();
  const queryEnabled = enabled && isAuthenticated;

  const { data, isLoading, isFetching, refetch, error } = useEmployees(filters, {
    enabled: queryEnabled,
    placeholderData: (prev) => prev ?? [],
  });

  useEmployeesRealtimeSync({ enabled: queryEnabled });

  const isRefreshing = useMemo(() => Boolean(data) && isFetching, [data, isFetching]);

  return {
    users: data || [],
    isLoading,
    isRefreshing,
    refresh: refetch,
    error,
  };
}
