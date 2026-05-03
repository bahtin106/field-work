import { useEffect } from 'react';
import { onlineManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { queryKeys } from '../../shared/query/queryKeys';
import { invalidateManyNow, invalidateNow } from '../../shared/query/invalidate';
import {
  enqueueObjectUpdate,
  getOfflineSnapshot,
  isOfflineLikeError,
  syncOfflineOutbox,
} from '../../shared/offline/offlineStatus';
import {
  createClientObject,
  deleteClientObject,
  getClientObjectById,
  listClientObjects,
  listClientObjectsByCompany,
  searchCompanyObjectsForOrder,
  updateClientObject,
} from './api';

export function useClientObjects(clientId: any, options: any = {}) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.objects.byClient(clientId),
    queryFn: async () => {
      try {
        return await listClientObjects(String(clientId || ''));
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const cached = queryClient.getQueryData(queryKeys.objects.byClient(clientId));
        return Array.isArray(cached) ? cached : [];
      }
    },
    enabled: !!clientId,
    staleTime: 30 * 1000,
    retry: (count, error) => !isOfflineLikeError(error) && count < 1,
    ...options,
  });
}

export function useCompanyObjects(companyId: any, options: any = {}) {
  const queryClient = useQueryClient();
  const result = useQuery({
    queryKey: queryKeys.objects.byCompany(companyId),
    queryFn: async () => {
      try {
        return await listClientObjectsByCompany(String(companyId || ''));
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const cached = queryClient.getQueryData(queryKeys.objects.byCompany(companyId));
        return Array.isArray(cached) ? cached : [];
      }
    },
    enabled: !!companyId,
    staleTime: 30 * 1000,
    retry: (count, error) => !isOfflineLikeError(error) && count < 1,
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

export function useClientObject(objectId: any, options: any = {}) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.objects.detail(objectId),
    queryFn: async () => {
      try {
        return await getClientObjectById(String(objectId || ''));
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const fromDetail = queryClient.getQueryData(queryKeys.objects.detail(objectId));
        if (fromDetail) return fromDetail;
        const lists = queryClient.getQueriesData({ queryKey: ['objects'] }) || [];
        for (const [, value] of lists) {
          const arr = Array.isArray(value) ? value : [];
          const found = arr.find((row: any) => String(row?.id || '') === String(objectId || ''));
          if (found) return found;
        }
        throw error;
      }
    },
    enabled: !!objectId,
    staleTime: 60 * 1000,
    retry: (count, error) => !isOfflineLikeError(error) && count < 1,
    ...options,
  });
}

export function useSearchCompanyObjectsForOrder(params: any = {}, options: any = {}) {
  const {
    query = '',
    street = '',
    house = '',
    city = '',
    clientId = null,
  } = params as {
    query?: string;
    street?: string;
    house?: string;
    city?: string;
    clientId?: string | null;
  };

  const hasEnoughInput =
    String(street || '').trim().length >= 3 ||
    String(query || '').trim().length >= 8 ||
    (String(street || '').trim().length >= 2 && String(house || '').trim().length >= 1);

  return useQuery({
    queryKey: queryKeys.objects.searchForOrder(params),
    queryFn: () => searchCompanyObjectsForOrder(params),
    enabled: hasEnoughInput,
    staleTime: 15 * 1000,
    ...options,
  });
}

export function useClientObjectsRealtimeSync({ enabled = true, companyId = null }: any = {}) {
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
        (payload: any) => {
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
        (payload: any) => {
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
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, any> }) => {
      const base = queryClient.getQueryData(queryKeys.objects.detail(id)) as Record<string, any> | null;
      const online = onlineManager.isOnline() && getOfflineSnapshot().isOnline;
      if (!online) {
        const queued = await enqueueObjectUpdate({ id, patch, base });
        return {
          ...(base || {}),
          ...(patch || {}),
          id,
          __offlinePending: true,
          __offlineOutboxId: queued.id,
        };
      }
      try {
        return await updateClientObject(id, patch);
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const queued = await enqueueObjectUpdate({ id, patch, base });
        return {
          ...(base || {}),
          ...(patch || {}),
          id,
          __offlinePending: true,
          __offlineOutboxId: queued.id,
        };
      }
    },
    onMutate: async ({ id, patch }: any) => {
      const detailKey = queryKeys.objects.detail(id);
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData(detailKey);
      if (previous && typeof previous === 'object') {
        queryClient.setQueryData(detailKey, {
          ...(previous as Record<string, any>),
          ...(patch || {}),
          __offlinePending: !onlineManager.isOnline(),
        });
      }
      return { previous, detailKey };
    },
    onError: (_error, _variables, context: any) => {
      if (context?.previous) {
        queryClient.setQueryData(context.detailKey, context.previous);
      }
    },
    onSuccess: (updated: any) => {
      const clientId = String(updated?.client_id || '');
      if (updated?.id) {
        queryClient.setQueryData(queryKeys.objects.detail(updated.id), updated);
      }
      if (clientId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.objects.byClient(clientId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.clients.detail(clientId) });
      }
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['requests'] });
      if (updated?.__offlinePending) {
        syncOfflineOutbox(queryClient).catch(() => {});
      }
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
