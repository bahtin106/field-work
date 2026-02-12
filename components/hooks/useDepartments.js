import { useMemo } from 'react';
import { useDepartmentsQuery } from '../../src/features/employees/queries';
import { useAuth } from './useAuth';

export function useDepartments(options = {}) {
  const { companyId, enabled = true, onlyEnabled = true } = options;
  const { isAuthenticated } = useAuth();
  const queryEnabled = enabled && !!companyId && isAuthenticated;

  const { data, isLoading, isFetching, refetch, error } = useDepartmentsQuery({
    companyId,
    onlyEnabled,
    enabled: queryEnabled,
  });

  const isRefreshing = useMemo(() => Boolean(data) && isFetching, [data, isFetching]);

  return {
    departments: data || [],
    isLoading,
    isRefreshing,
    refresh: refetch,
    error,
  };
}
