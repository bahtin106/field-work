import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../shared/query/queryKeys';
import {
  attachMutationAuthCarrier,
  assertMutationPayloadCompany,
  clearMutationAuthCarrier,
  getMutationAuthCarrier,
  isActiveMutationAuthCarrier,
  requireMutationAuthCarrier,
} from '../../shared/security/mutationAuthCarrier';
import { invalidateManyNow } from '../../shared/query/invalidate';
import { withReadDeadline } from '../../shared/network/readDeadline';
import {
  createCompanyTag,
  deleteAllCompanyTags,
  deleteCompanyTag,
  listCompanyTags,
  searchCompanyTags,
  setClientTags,
  setObjectTags,
  updateCompanyTagSettings,
} from './api';

export function useCompanyTags({ companyId, tagType, enabled = true }) {
  return useQuery({
    queryKey: queryKeys.tags.list({ companyId, tagType }),
    queryFn: ({ signal }) =>
      withReadDeadline(
        (readSignal) =>
          listCompanyTags(
            { companyId: String(companyId || ''), tagType },
            readSignal,
          ),
        { label: 'Company tags', signal },
      ),
    enabled: !!companyId && !!tagType && enabled,
    staleTime: 30 * 1000,
  });
}

export function useTagSuggestions({ tagType, query, enabled = true }) {
  return useQuery({
    queryKey: queryKeys.tags.suggestions({ tagType, query: String(query || '') }),
    queryFn: ({ signal }) =>
      withReadDeadline(
        (readSignal) =>
          searchCompanyTags({ tagType, query: String(query || '') }, readSignal),
        { label: 'Tag suggestions', signal },
      ),
    enabled: !!tagType && enabled,
    staleTime: 20 * 1000,
  });
}

export function useSetClientTagsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { clientId: string; tags: string[] }) => {
      const authCarrier = requireMutationAuthCarrier(variables);
      return setClientTags(variables.clientId, variables.tags, authCarrier);
    },
    onMutate: async (variables) => {
      await attachMutationAuthCarrier(variables);
    },
    onSuccess: (_result, variables) => {
      if (!isActiveMutationAuthCarrier(getMutationAuthCarrier(variables))) return;
      const clientId = String(variables?.clientId || '');
      void invalidateManyNow(queryClient, [
        ...(clientId ? [queryKeys.clients.detail(clientId)] : []),
        ['clients'],
        ['tags'],
      ]);
    },
    onSettled: (_data, _error, variables) => clearMutationAuthCarrier(variables),
  });
}

export function useSetObjectTagsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { objectId: string; tags: string[] }) => {
      const authCarrier = requireMutationAuthCarrier(variables);
      return setObjectTags(variables.objectId, variables.tags, authCarrier);
    },
    onMutate: async (variables) => {
      await attachMutationAuthCarrier(variables);
    },
    onSuccess: (_result, variables) => {
      if (!isActiveMutationAuthCarrier(getMutationAuthCarrier(variables))) return;
      const objectId = String(variables?.objectId || '');
      void invalidateManyNow(queryClient, [
        ...(objectId ? [queryKeys.objects.detail(objectId)] : []),
        ['objects'],
        ['clients'],
        ['tags'],
      ]);
    },
    onSettled: (_data, _error, variables) => clearMutationAuthCarrier(variables),
  });
}

export function useDeleteCompanyTagMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { tagId: string }) => {
      const authCarrier = requireMutationAuthCarrier(variables);
      return deleteCompanyTag(variables.tagId, authCarrier);
    },
    onMutate: async (variables) => {
      await attachMutationAuthCarrier(variables);
    },
    onSuccess: async (_result, variables) => {
      if (!isActiveMutationAuthCarrier(getMutationAuthCarrier(variables))) return;
      await invalidateManyNow(queryClient, [['clients'], ['objects'], ['requests'], ['tags']]);
    },
    onSettled: (_data, _error, variables) => clearMutationAuthCarrier(variables),
  });
}

export function useDeleteAllCompanyTagsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: any) => {
      const authCarrier = requireMutationAuthCarrier(variables);
      assertMutationPayloadCompany(authCarrier, variables?.companyId);
      return deleteAllCompanyTags(variables, authCarrier);
    },
    onMutate: async (variables) => {
      await attachMutationAuthCarrier(variables);
    },
    onSuccess: async (_result, variables) => {
      if (!isActiveMutationAuthCarrier(getMutationAuthCarrier(variables))) return;
      await invalidateManyNow(queryClient, [['clients'], ['objects'], ['requests'], ['tags']]);
    },
    onSettled: (_data, _error, variables) => clearMutationAuthCarrier(variables),
  });
}

export function useCreateCompanyTagMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: any) => {
      const authCarrier = requireMutationAuthCarrier(variables);
      assertMutationPayloadCompany(authCarrier, variables?.companyId);
      return createCompanyTag(variables, authCarrier);
    },
    onMutate: async (variables) => {
      await attachMutationAuthCarrier(variables);
    },
    onSuccess: async (_result, variables: any) => {
      if (!isActiveMutationAuthCarrier(getMutationAuthCarrier(variables))) return;
      const keys: any[] = [];
      if (variables?.companyId && variables?.tagType) {
        keys.push(queryKeys.tags.list({ companyId: variables.companyId, tagType: variables.tagType }));
      }
      keys.push(['tags']);
      await invalidateManyNow(queryClient, keys);
    },
    onSettled: (_data, _error, variables) => clearMutationAuthCarrier(variables),
  });
}

export function useUpdateCompanyTagSettingsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: any) => {
      const authCarrier = requireMutationAuthCarrier(variables);
      assertMutationPayloadCompany(authCarrier, variables?.companyId);
      return updateCompanyTagSettings(variables, authCarrier);
    },
    onMutate: async (variables) => {
      await attachMutationAuthCarrier(variables);
    },
    onSuccess: async (_result, variables: any) => {
      if (!isActiveMutationAuthCarrier(getMutationAuthCarrier(variables))) return;
      const keys: any[] = [['companySettings']];
      if (variables?.companyId) {
        keys.push(queryKeys.tags.list({ companyId: variables.companyId, tagType: 'client' }));
        keys.push(queryKeys.tags.list({ companyId: variables.companyId, tagType: 'object' }));
      }
      await invalidateManyNow(queryClient, keys);
    },
    onSettled: (_data, _error, variables) => clearMutationAuthCarrier(variables),
  });
}
