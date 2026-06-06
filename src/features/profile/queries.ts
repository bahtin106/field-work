import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getMyCompanyId, getMyProfile } from './api';
import { queryKeys } from '../../shared/query/queryKeys';

export function useMyProfile(options = {}) {
  return useQuery({
    queryKey: queryKeys.profile.me(),
    queryFn: getMyProfile,
    staleTime: 60 * 1000,
    refetchOnMount: false,
    ...options,
  });
}

export function useMyCompanyIdQuery(options = {}) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.profile.companyId(),
    queryFn: getMyCompanyId,
    initialData: () => {
      const cachedCompanyId = queryClient.getQueryData(queryKeys.profile.companyId());
      if (cachedCompanyId) return cachedCompanyId;
      const cachedProfile: any = queryClient.getQueryData(queryKeys.profile.me());
      return cachedProfile?.company_id || cachedProfile?.companyId || undefined;
    },
    staleTime: 5 * 60 * 1000,
    ...options,
  });
}
