import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { queryKeys } from '../../shared/query/queryKeys';
import { invalidateManyNow, invalidateNow } from '../../shared/query/invalidate';
import {
  createClientObject,
  deleteClientObject,
  getClientObjectById,
  listClientObjects,
  listClientObjectsByCompany,
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

export function useCompanyObjects(companyId, options = {}) {
  const result = useQuery({
    queryKey: queryKeys.objects.byCompany(companyId),
    queryFn: () => listClientObjectsByCompany(String(companyId || '')),
    enabled: !!companyId,
    staleTime: 30 * 1000,
    ...options,
  });

  // Debug instrumentation to help diagnose flicker when client permissions change
  useEffect(() => {
    try {
      const len = Array.isArray(result.data) ? result.data.length : 0;
      console.debug('[useCompanyObjects] companyId=', companyId, 'enabled=', !!companyId, 'status=', result.status, 'isFetching=', result.isFetching, 'data.length=', len);
    } catch (e) {
      console.debug('[useCompanyObjects] debug failed', e);
    }
  }, [companyId, result.status, result.isFetching, result.data]);

  return result;
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
          try {
            console.debug('[useClientObjectsRealtimeSync] payload event=', payload?.event, 'table=', payload?.table, 'new.id=', payload?.new?.id, 'old.id=', payload?.old?.id);
            const objectId = payload?.new?.id || payload?.old?.id;
            const clientId = payload?.new?.client_id || payload?.old?.client_id;
            if (objectId) {
              console.debug('[useClientObjectsRealtimeSync] invalidating object detail', objectId);
              queryClient.invalidateQueries({ queryKey: queryKeys.objects.detail(objectId) });
            }
            if (clientId) {
              console.debug('[useClientObjectsRealtimeSync] invalidating objects.byClient and clients.detail for client', clientId);
              queryClient.invalidateQueries({ queryKey: queryKeys.objects.byClient(clientId) });
              queryClient.invalidateQueries({ queryKey: queryKeys.clients.detail(clientId) });
            }
            console.debug('[useClientObjectsRealtimeSync] invalidating top-level clients/requests queries');
            queryClient.invalidateQueries({ queryKey: ['clients'] });
            queryClient.invalidateQueries({ queryKey: ['requests'] });
          } catch (e) {
            console.debug('[useClientObjectsRealtimeSync] realtime handler failed', e);
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'object_tag_links',
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const objectId = String(payload?.new?.object_id || payload?.old?.object_id || '');
          if (objectId) {
            void invalidateNow(queryClient, queryKeys.objects.detail(objectId));
          }
          void invalidateManyNow(queryClient, [['objects'], ['clients'], ['tags']]);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'company_tags',
          filter: `company_id=eq.${companyId}`,
        },
        () => {
          void invalidateManyNow(queryClient, [['objects'], ['clients'], ['tags']]);
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
