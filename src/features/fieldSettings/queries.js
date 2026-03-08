import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../shared/query/queryKeys';
import { listEntityFieldSettings, saveEntityFieldSettings } from './api';

export function useEntityFieldSettings(entityType, options = {}) {
  return useQuery({
    queryKey: queryKeys.fieldSettings.detail(entityType),
    queryFn: () => listEntityFieldSettings(entityType),
    staleTime: 60 * 1000,
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
