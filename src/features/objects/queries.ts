import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { queryKeys } from '../../shared/query/queryKeys';
import {
  createClientObject,
  deleteClientObject,
  getClientObjectById,
  listClientObjects,
  updateClientObject,
} from './api';

export function useClientObjects(clientId, options = {}) {
  return useQuery({
    queryKey: queryKeys.objects.byClient(clientId),
    queryFn: () => listClientObjects(String(clientId || '')),
    enabled: !!clientId,
    staleTime: 30 * 1000,
    ...options,
  });
}

export function useClientObject(objectId, options = {}) {
  return useQuery({
    queryKey: queryKeys.objects.detail(objectId),
    queryFn: () => getClientObjectById(String(objectId || '')),
    enabled: !!objectId,
    staleTime: 60 * 1000,
    ...options,
  });
}

export function useClientObjectsRealtimeSync({ enabled = true, companyId = null } = {}) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !companyId) return;

    const channel = supabase
      .channel(`client-objects:realtime:${companyId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'client_objects',
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const objectId = payload?.new?.id || payload?.old?.id;
          const clientId = payload?.new?.client_id || payload?.old?.client_id;
          if (objectId) {
            queryClient.invalidateQueries({ queryKey: queryKeys.objects.detail(objectId) });
          }
          if (clientId) {
            queryClient.invalidateQueries({ queryKey: queryKeys.objects.byClient(clientId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.clients.detail(clientId) });
          }
          queryClient.invalidateQueries({ queryKey: ['clients'] });
          queryClient.invalidateQueries({ queryKey: ['requests'] });
        },
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [companyId, enabled, queryClient]);
}

export function useCreateClientObjectMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: Record<string, any>) => createClientObject(payload),
    onSuccess: (created: any) => {
      const clientId = String(created?.client_id || '');
      if (clientId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.objects.byClient(clientId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.clients.detail(clientId) });
      }
      if (created?.id) {
        queryClient.invalidateQueries({ queryKey: queryKeys.objects.detail(created.id) });
      }
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}

export function useUpdateClientObjectMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, any> }) =>
      updateClientObject(id, patch),
    onSuccess: (updated: any) => {
      const clientId = String(updated?.client_id || '');
      if (updated?.id) {
        queryClient.invalidateQueries({ queryKey: queryKeys.objects.detail(updated.id) });
      }
      if (clientId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.objects.byClient(clientId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.clients.detail(clientId) });
      }
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['requests'] });
    },
  });
}

export function useDeleteClientObjectMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: { id: string }) => deleteClientObject(String(id || '')),
    onSuccess: (_result, variables: any) => {
      if (variables?.clientId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.objects.byClient(variables.clientId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.clients.detail(variables.clientId) });
      }
      if (variables?.id) {
        queryClient.removeQueries({ queryKey: queryKeys.objects.detail(variables.id) });
      }
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['requests'] });
    },
  });
}

