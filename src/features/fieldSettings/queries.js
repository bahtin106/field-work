import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../shared/query/queryKeys';
import {
  attachMutationAuthCarrier,
  clearMutationAuthCarrier,
  getMutationAuthCarrier,
  isActiveMutationAuthCarrier,
  requireMutationAuthCarrier,
} from '../../shared/security/mutationAuthCarrier';
import { withReadDeadline } from '../../shared/network/readDeadline';
import { listEntityFieldSettings, saveEntityFieldSettings } from './api';

export function useEntityFieldSettings(entityType, options = {}) {
  return useQuery({
    queryKey: queryKeys.fieldSettings.detail(entityType),
    queryFn: ({ signal }) =>
      withReadDeadline((readSignal) => listEntityFieldSettings(entityType, readSignal), {
        label: 'Entity field settings',
        signal,
      }),
    staleTime: 5 * 60 * 1000,
    refetchOnMount: 'stale',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    ...options,
  });
}

export function useSaveEntityFieldSettingsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables) => {
      const authCarrier = requireMutationAuthCarrier(variables);
      return saveEntityFieldSettings(variables, authCarrier);
    },
    onMutate: async (variables) => {
      await attachMutationAuthCarrier(variables);
    },
    onSuccess: (data, variables) => {
      if (!isActiveMutationAuthCarrier(getMutationAuthCarrier(variables))) return;
      queryClient.setQueryData(queryKeys.fieldSettings.detail(variables.entityType), data);
    },
    onSettled: (_data, _error, variables) => {
      clearMutationAuthCarrier(variables);
    },
  });
}
