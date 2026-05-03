import { useEffect } from 'react';
import { onlineManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { queryKeys } from '../../shared/query/queryKeys';
import { invalidateManyNow, invalidateNow } from '../../shared/query/invalidate';
import {
  enqueueClientUpdate,
  getOfflineSnapshot,
  isOfflineLikeError,
  syncOfflineOutbox,
} from '../../shared/offline/offlineStatus';
import {
  createClient,
  getClientDeleteBlockers,
  deleteClient,
  getClientById,
  getClientOrderCount,
  listClients,
  updateClient,
} from './api';

export function useClients(params: any = {}, options: any = {}) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.clients.list(params),
    queryFn: async () => {
      try {
        return await listClients(params);
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const cached = queryClient.getQueryData(queryKeys.clients.list(params));
        return Array.isArray(cached) ? cached : [];
      }
    },
    staleTime: 30 * 1000,
    retry: (count, error) => !isOfflineLikeError(error) && count < 1,
    ...options,
  });
}

export function useClient(id: any, options: any = {}) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.clients.detail(id),
    queryFn: async () => {
      try {
        return await getClientById(String(id || ''));
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const fromDetail = queryClient.getQueryData(queryKeys.clients.detail(id));
        if (fromDetail) return fromDetail;
        const lists = queryClient.getQueriesData({ queryKey: ['clients'] }) || [];
        for (const [, value] of lists) {
          const arr = Array.isArray(value) ? value : [];
          const found = arr.find((row: any) => String(row?.id || '') === String(id || ''));
          if (found) return found;
        }
        throw error;
      }
    },
    enabled: !!id,
    staleTime: 60 * 1000,
    retry: (count, error) => !isOfflineLikeError(error) && count < 1,
    ...options,
  });
}

export function useClientOrderCount(id: any, options: any = {}) {
  return useQuery({
    queryKey: queryKeys.clients.orderCount(id),
    queryFn: () => getClientOrderCount(String(id || '')),
    enabled: !!id,
    staleTime: 30 * 1000,
    ...options,
  });
}

export function useClientDeleteBlockers(id: any, options: any = {}) {
  return useQuery({
    queryKey: ['clients', 'delete-blockers', String(id || '')],
    queryFn: () => getClientDeleteBlockers(String(id || '')),
    enabled: !!id,
    staleTime: 15 * 1000,
    ...options,
  });
}

export function useClientsRealtimeSync({ enabled = true, companyId = null }: any = {}) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !companyId) return;

    const channel = supabase
      .channel(`clients:realtime:${companyId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'clients',
          filter: `company_id=eq.${companyId}`,
        },
        (payload: any) => {
          const rowId = payload?.new?.id || payload?.old?.id;
          if (rowId) {
            queryClient.invalidateQueries({ queryKey: queryKeys.clients.detail(rowId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.clients.orderCount(rowId) });
            queryClient.invalidateQueries({ queryKey: ['clients', 'delete-blockers', String(rowId)] });
            queryClient.invalidateQueries({ queryKey: queryKeys.objects.byClient(rowId) });
          }
          queryClient.invalidateQueries({ queryKey: ['clients'] });
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'client_objects',
          filter: `company_id=eq.${companyId}`,
        },
        (payload: any) => {
          const clientId = payload?.new?.client_id || payload?.old?.client_id;
          if (clientId) {
            queryClient.invalidateQueries({ queryKey: queryKeys.objects.byClient(clientId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.clients.detail(clientId) });
            queryClient.invalidateQueries({ queryKey: ['clients', 'delete-blockers', String(clientId)] });
          }
          queryClient.invalidateQueries({ queryKey: ['clients'] });
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'client_tag_links',
          filter: `company_id=eq.${companyId}`,
        },
        (payload: any) => {
          const clientId = String(payload?.new?.client_id || payload?.old?.client_id || '');
          if (clientId) {
            void invalidateNow(queryClient, queryKeys.clients.detail(clientId));
          }
          void invalidateManyNow(queryClient, [['clients'], ['tags']]);
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
          void invalidateManyNow(queryClient, [['clients'], ['objects'], ['tags']]);
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

export function useCreateClientMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: Record<string, any>) => createClient(payload),
    onSuccess: (created: any) => {
      if (created?.id) {
        queryClient.setQueryData(queryKeys.clients.detail(created.id), created);
      }
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}

export function useUpdateClientMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, any> }) => {
      const base = queryClient.getQueryData(queryKeys.clients.detail(id)) as Record<string, any> | null;
      const online = onlineManager.isOnline() && getOfflineSnapshot().isOnline;
      if (!online) {
        const queued = await enqueueClientUpdate({ id, patch, base });
        return {
          ...(base || {}),
          ...(patch || {}),
          id,
          __offlinePending: true,
          __offlineOutboxId: queued.id,
        };
      }
      try {
        return await updateClient(id, patch);
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const queued = await enqueueClientUpdate({ id, patch, base });
        return {
          ...(base || {}),
          ...(patch || {}),
          id,
          __offlinePending: true,
          __offlineOutboxId: queued.id,
        };
      }
    },
    onMutate: async ({ id, patch }) => {
      const detailKey = queryKeys.clients.detail(id);
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
      if (updated?.id) {
        queryClient.setQueryData(queryKeys.clients.detail(updated.id), updated);
      }
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      if (updated?.__offlinePending) {
        syncOfflineOutbox(queryClient).catch(() => {});
      }
    },
  });
}

export function useDeleteClientMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteClient(String(id || '')),
    onSuccess: (_result, deletedId: string) => {
      if (deletedId) {
        queryClient.removeQueries({ queryKey: queryKeys.clients.detail(deletedId) });
        queryClient.removeQueries({ queryKey: queryKeys.clients.orderCount(deletedId) });
        queryClient.removeQueries({ queryKey: ['clients', 'delete-blockers', String(deletedId)] });
        queryClient.removeQueries({ queryKey: queryKeys.objects.byClient(deletedId) });
      }
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}

export async function ensureClientPrefetch(queryClient: any, id: any) {
  if (!id) return null;
  return queryClient.ensureQueryData({
    queryKey: queryKeys.clients.detail(id),
    queryFn: () => getClientById(String(id || '')),
    staleTime: 60 * 1000,
  });
}
