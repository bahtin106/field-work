import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../shared/query/queryKeys';
import { listEntityFieldSettings, saveEntityFieldSettings } from './api';

export function useEntityFieldSettings(entityType, options = {}) {
  return useQuery({
    queryKey: queryKeys.fieldSettings.detail(entityType),
    queryFn: () => listEntityFieldSettings(entityType),
    staleTime: 60 * 1000,
    // Field visibility/requiredness is a company-wide setting. Do not let a
    // persisted per-device cache hide an admin's change after an app restart.
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    ...options,
  });
}

export function useSaveEntityFieldSettingsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: saveEntityFieldSettings,
    onSuccess: (data, variables) => {
      queryClient.setQueryData(queryKeys.fieldSettings.detail(variables.entityType), data);
    },
  });
}
