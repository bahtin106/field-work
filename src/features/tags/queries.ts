import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../shared/query/queryKeys';
import { invalidateManyNow } from '../../shared/query/invalidate';
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
    queryFn: () => listCompanyTags({ companyId: String(companyId || ''), tagType }),
    enabled: !!companyId && !!tagType && enabled,
    staleTime: 30 * 1000,
  });
}

export function useTagSuggestions({ tagType, query, enabled = true }) {
  return useQuery({
    queryKey: queryKeys.tags.suggestions({ tagType, query: String(query || '') }),
    queryFn: () => searchCompanyTags({ tagType, query: String(query || '') }),
    enabled: !!tagType && enabled,
    staleTime: 20 * 1000,
  });
}

export function useSetClientTagsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ clientId, tags }: { clientId: string; tags: string[] }) => setClientTags(clientId, tags),
    onSuccess: (_result, variables) => {
      const clientId = String(variables?.clientId || '');
      void invalidateManyNow(queryClient, [
        ...(clientId ? [queryKeys.clients.detail(clientId)] : []),
        ['clients'],
        ['tags'],
      ]);
    },
  });
}

export function useSetObjectTagsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ objectId, tags }: { objectId: string; tags: string[] }) => setObjectTags(objectId, tags),
    onSuccess: (_result, variables) => {
      const objectId = String(variables?.objectId || '');
      void invalidateManyNow(queryClient, [
        ...(objectId ? [queryKeys.objects.detail(objectId)] : []),
        ['objects'],
        ['clients'],
        ['tags'],
      ]);
    },
  });
}

export function useDeleteCompanyTagMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tagId: string) => deleteCompanyTag(tagId),
    onSuccess: async () => {
      await invalidateManyNow(queryClient, [['clients'], ['objects'], ['requests'], ['tags']]);
    },
  });
}

export function useDeleteAllCompanyTagsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteAllCompanyTags,
    onSuccess: async () => {
      await invalidateManyNow(queryClient, [['clients'], ['objects'], ['requests'], ['tags']]);
    },
  });
}

export function useCreateCompanyTagMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createCompanyTag,
    onSuccess: async (_result, variables: any) => {
      const keys: any[] = [];
      if (variables?.companyId && variables?.tagType) {
        keys.push(queryKeys.tags.list({ companyId: variables.companyId, tagType: variables.tagType }));
      }
      keys.push(['tags']);
      await invalidateManyNow(queryClient, keys);
    },
  });
}

export function useUpdateCompanyTagSettingsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateCompanyTagSettings,
    onSuccess: async (_result, variables: any) => {
      const keys: any[] = [['companySettings']];
      if (variables?.companyId) {
        keys.push(queryKeys.tags.list({ companyId: variables.companyId, tagType: 'client' }));
        keys.push(queryKeys.tags.list({ companyId: variables.companyId, tagType: 'object' }));
      }
      await invalidateManyNow(queryClient, keys);
    },
  });
}
