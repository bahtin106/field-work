import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '../../shared/query/queryKeys';
import { getStatisticsDashboard } from './api';

export function useStatisticsDashboard(params, options = {}) {
  return useQuery({
    queryKey: queryKeys.statistics.dashboard(params),
    queryFn: () => getStatisticsDashboard(params),
    staleTime: 60 * 1000,
    retry: 1,
    ...options,
  });
}
