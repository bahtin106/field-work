import { useEffect, useMemo } from 'react';
import { onlineManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { formatPersonNameParts } from '../../../lib/personName';
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

function findClientInListCaches(queryClient: any, id: any) {
  const targetId = String(id || '').trim();
  if (!targetId || !queryClient) return null;

  const lists = queryClient.getQueriesData({ queryKey: ['clients', 'list'] }) || [];
  let best: { row: any; updatedAt: number } | null = null;
  for (const [key, value] of lists) {
    if (!Array.isArray(value)) continue;
    const found = value.find((row: any) => String(row?.id || '') === targetId);
    if (!found) continue;
    const state = queryClient.getQueryState(key);
    const updatedAt = Number(state?.dataUpdatedAt || 0);
    if (!best || updatedAt > best.updatedAt) {
      best = { row: found, updatedAt };
    }
  }
  return best;
}

export function useClient(id: any, options: any = {}) {
  const queryClient = useQueryClient();
  const listSeed = useMemo(() => findClientInListCaches(queryClient, id), [id, queryClient]);

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
    initialData: () => listSeed?.row,
    initialDataUpdatedAt: () => listSeed?.updatedAt,
    enabled: !!id,
    staleTime: 60 * 1000,
    retry: (count, error) => !isOfflineLikeError(error) && count < 1,
    ...options,
  });
}

export function useClientOrderCount(id: any, options: any = {}) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.clients.orderCount(id),
    queryFn: async () => {
      try {
        return await getClientOrderCount(String(id || ''));
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const cached = queryClient.getQueryData(queryKeys.clients.orderCount(id));
        return Number(cached || 0);
      }
    },
    enabled: !!id,
    staleTime: 30 * 1000,
    retry: (count, error) => !isOfflineLikeError(error) && count < 1,
    ...options,
  });
}

export function useClientDeleteBlockers(id: any, options: any = {}) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['clients', 'delete-blockers', String(id || '')],
    queryFn: async () => {
      try {
        return await getClientDeleteBlockers(String(id || ''));
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const cached = queryClient.getQueryData(['clients', 'delete-blockers', String(id || '')]);
        return cached || {
          clientId: String(id || ''),
          blockingOrdersCount: 0,
          blockingObjectsCount: 0,
          blockingObjectIds: [],
          myOrdersCount: 0,
          feedOrdersCount: 0,
          otherOrdersCount: 0,
          isPartial: true,
        };
      }
    },
    enabled: !!id,
    staleTime: 15 * 1000,
    retry: (count, error) => !isOfflineLikeError(error) && count < 1,
    ...options,
  });
}

export function useClientsRealtimeSync({ enabled = true, companyId = null }: any = {}) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !companyId) return;

    const refreshClientLists = () => {
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
    };

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
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') refreshClientLists();
      });

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [companyId, enabled, queryClient]);
}

export function updateClientQueryCaches(queryClient: any, clientId: any, patchOrUpdater: any) {
  const id = String(clientId || '').trim();
  if (!id || !queryClient) return null;

  const resolveNext = (prev: any) => {
    const patch = typeof patchOrUpdater === 'function' ? patchOrUpdater(prev) : patchOrUpdater;
    if (!patch || typeof patch !== 'object') return prev;
    const merged = {
      ...(prev || {}),
      ...patch,
      id: patch.id || prev?.id || id,
    };
    const firstName = patch.firstName ?? patch.first_name ?? merged.firstName ?? merged.first_name ?? '';
    const middleName = patch.middleName ?? patch.middle_name ?? merged.middleName ?? merged.middle_name ?? '';
    const lastName = patch.lastName ?? patch.last_name ?? merged.lastName ?? merged.last_name ?? '';
    const computedFullName = formatPersonNameParts({ firstName, middleName, lastName });
    const fullName = computedFullName || merged.fullName || merged.full_name || '';
    return {
      ...merged,
      first_name: patch.first_name ?? merged.first_name ?? firstName,
      middle_name: patch.middle_name ?? merged.middle_name ?? middleName,
      last_name: patch.last_name ?? merged.last_name ?? lastName,
      full_name: fullName,
      firstName,
      middleName,
      lastName,
      fullName,
    };
  };

  let nextDetail: any = null;
  queryClient.setQueryData(queryKeys.clients.detail(id), (prev: any) => {
    nextDetail = resolveNext(prev);
    return nextDetail;
  });

  const lists = queryClient.getQueriesData({ queryKey: ['clients', 'list'] }) || [];
  lists.forEach(([key, value]: any) => {
    if (!Array.isArray(value)) return;
    let changed = false;
    const nextList = value.map((row: any) => {
      if (String(row?.id || '') !== id) return row;
      changed = true;
      return resolveNext(row);
    });
    if (changed) queryClient.setQueryData(key, nextList);
  });

  return nextDetail;
}

export function removeClientFromQueryCaches(queryClient: any, clientId: any) {
  const id = String(clientId || '').trim();
  if (!id || !queryClient) return;

  queryClient.removeQueries({ queryKey: queryKeys.clients.detail(id) });
  queryClient.removeQueries({ queryKey: queryKeys.clients.orderCount(id) });
  queryClient.removeQueries({ queryKey: ['clients', 'delete-blockers', id] });
  queryClient.removeQueries({ queryKey: queryKeys.objects.byClient(id) });

  const lists = queryClient.getQueriesData({ queryKey: ['clients', 'list'] }) || [];
  lists.forEach(([key, value]: any) => {
    if (!Array.isArray(value)) return;
    const nextList = value.filter((row: any) => String(row?.id || '') !== id);
    if (nextList.length !== value.length) queryClient.setQueryData(key, nextList);
  });
}

export function useCreateClientMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: Record<string, any>) => createClient(payload),
    onSuccess: (created: any) => {
      if (created?.id) {
        updateClientQueryCaches(queryClient, created.id, created);
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
      await queryClient.cancelQueries({ queryKey: ['clients', 'list'] });
      const previous = queryClient.getQueryData(detailKey);
      const previousLists = queryClient.getQueriesData({ queryKey: ['clients', 'list'] });
      updateClientQueryCaches(queryClient, id, (prev: any) => ({
        ...(prev || {}),
        ...(patch || {}),
        id,
        __offlinePending: !onlineManager.isOnline(),
      }));
      return { previous, previousLists, detailKey };
    },
    onError: (_error, _variables, context: any) => {
      if (context?.previous) {
        queryClient.setQueryData(context.detailKey, context.previous);
      }
      if (Array.isArray(context?.previousLists)) {
        context.previousLists.forEach(([key, value]: any) => {
          queryClient.setQueryData(key, value);
        });
      }
    },
    onSuccess: (updated: any) => {
      if (updated?.id) {
        updateClientQueryCaches(queryClient, updated.id, updated);
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
        removeClientFromQueryCaches(queryClient, deletedId);
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
