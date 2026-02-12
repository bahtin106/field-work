import { useQuery } from '@tanstack/react-query';
import { getMyCompanyId, getMyProfile } from './api';
import { queryKeys } from '../../shared/query/queryKeys';

export function useMyProfile(options = {}) {
  return useQuery({
    queryKey: queryKeys.profile.me(),
    queryFn: getMyProfile,
    staleTime: 60 * 1000,
    ...options,
  });
}

export function useMyCompanyIdQuery(options = {}) {
  return useQuery({
    queryKey: queryKeys.profile.companyId(),
    queryFn: getMyCompanyId,
    staleTime: 5 * 60 * 1000,
    ...options,
  });
}
