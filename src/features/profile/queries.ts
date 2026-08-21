import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getMyCompanyId, getMyProfile } from './api';
import { queryKeys } from '../../shared/query/queryKeys';
import { withReadDeadline } from '../../shared/network/readDeadline';

export function useMyProfile(options = {}) {
  return useQuery({
    queryKey: queryKeys.profile.me(),
    queryFn: ({ signal }) =>
      withReadDeadline((readSignal) => getMyProfile(readSignal), {
        label: 'Current profile',
        signal,
      }),
    staleTime: 60 * 1000,
    refetchOnMount: false,
    ...options,
  });
}

export function useMyCompanyIdQuery(options = {}) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.profile.companyId(),
    queryFn: ({ signal }) =>
      withReadDeadline((readSignal) => getMyCompanyId(readSignal), {
        label: 'Current company',
        signal,
      }),
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
