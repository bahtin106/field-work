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
  return useQuery({
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
          } catch (e) {
            // Realtime is best-effort; cached screens still refresh through focus/reconnect.
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

function updateObjectInClientCaches(queryClient: any, objectId: string, patchOrUpdater: any) {
  const resolveObject = (prev: any) => {
    const patch = typeof patchOrUpdater === 'function' ? patchOrUpdater(prev) : patchOrUpdater;
    if (!patch || typeof patch !== 'object') return prev;
    return {
      ...(prev || {}),
      ...patch,
      id: patch.id || prev?.id || objectId,
    };
  };

  const clientLists = queryClient.getQueriesData({ queryKey: ['clients', 'list'] }) || [];
  clientLists.forEach(([key, value]: any) => {
    if (!Array.isArray(value)) return;
    let changed = false;
    const nextList = value.map((client: any) => {
      if (!Array.isArray(client?.objects)) return client;
      let clientChanged = false;
      const nextObjects = client.objects.map((objectItem: any) => {
        if (String(objectItem?.id || '') !== objectId) return objectItem;
        clientChanged = true;
        return resolveObject(objectItem);
      });
      if (!clientChanged) return client;
      changed = true;
      const sortedObjects = [...nextObjects].sort((left, right) => {
        if (!!left?.is_primary !== !!right?.is_primary) return left?.is_primary ? -1 : 1;
        return String(left?.name || '').localeCompare(String(right?.name || ''), 'ru');
      });
      const primaryObject = sortedObjects.find((item: any) => item?.is_primary) || sortedObjects[0] || null;
      return {
        ...client,
        objects: sortedObjects,
        primaryObject,
        primaryObjectSummary: primaryObject?.summary || client.primaryObjectSummary || null,
      };
    });
    if (changed) queryClient.setQueryData(key, nextList);
  });

  const clientDetails = queryClient.getQueriesData({ queryKey: ['clients', 'detail'] }) || [];
  clientDetails.forEach(([key, value]: any) => {
    if (!value || typeof value !== 'object' || !Array.isArray(value.objects)) return;
    let changed = false;
    const nextObjects = value.objects.map((objectItem: any) => {
      if (String(objectItem?.id || '') !== objectId) return objectItem;
      changed = true;
      return resolveObject(objectItem);
    });
    if (changed) {
      queryClient.setQueryData(key, {
        ...value,
        objects: nextObjects,
      });
    }
  });
}

export function updateObjectQueryCaches(queryClient: any, objectId: any, patchOrUpdater: any) {
  const id = String(objectId || '').trim();
  if (!id || !queryClient) return null;

  const resolveNext = (prev: any) => {
    const patch = typeof patchOrUpdater === 'function' ? patchOrUpdater(prev) : patchOrUpdater;
    if (!patch || typeof patch !== 'object') return prev;
    return {
      ...(prev || {}),
      ...patch,
      id: patch.id || prev?.id || id,
    };
  };

  let nextDetail: any = null;
  queryClient.setQueryData(queryKeys.objects.detail(id), (prev: any) => {
    nextDetail = resolveNext(prev);
    return nextDetail;
  });

  const lists = queryClient.getQueriesData({ queryKey: ['objects'] }) || [];
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

  updateObjectInClientCaches(queryClient, id, patchOrUpdater);
  return nextDetail;
}

export function removeObjectFromQueryCaches(queryClient: any, objectId: any, clientId: any = null) {
  const id = String(objectId || '').trim();
  if (!id || !queryClient) return;

  queryClient.removeQueries({ queryKey: queryKeys.objects.detail(id) });

  const lists = queryClient.getQueriesData({ queryKey: ['objects'] }) || [];
  lists.forEach(([key, value]: any) => {
    if (!Array.isArray(value)) return;
    const nextList = value.filter((row: any) => String(row?.id || '') !== id);
    if (nextList.length !== value.length) queryClient.setQueryData(key, nextList);
  });

  const normalizedClientId = String(clientId || '').trim();
  if (normalizedClientId) {
    const detailKey = queryKeys.clients.detail(normalizedClientId);
    queryClient.setQueryData(detailKey, (client: any) => {
      if (!client || typeof client !== 'object' || !Array.isArray(client.objects)) return client;
      return {
        ...client,
        objects: client.objects.filter((row: any) => String(row?.id || '') !== id),
      };
    });
  }
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
        updateObjectQueryCaches(queryClient, created.id, created);
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
      await queryClient.cancelQueries({ queryKey: ['objects'] });
      await queryClient.cancelQueries({ queryKey: ['clients'] });
      const previous = queryClient.getQueryData(detailKey);
      const previousObjectLists = queryClient.getQueriesData({ queryKey: ['objects'] });
      const previousClientLists = queryClient.getQueriesData({ queryKey: ['clients'] });
      updateObjectQueryCaches(queryClient, id, (prev: any) => ({
        ...(prev || {}),
        ...(patch || {}),
        id,
        __offlinePending: !onlineManager.isOnline(),
      }));
      return { previous, previousObjectLists, previousClientLists, detailKey };
    },
    onError: (_error, _variables, context: any) => {
      if (context?.previous) {
        queryClient.setQueryData(context.detailKey, context.previous);
      }
      if (Array.isArray(context?.previousObjectLists)) {
        context.previousObjectLists.forEach(([key, value]: any) => {
          queryClient.setQueryData(key, value);
        });
      }
      if (Array.isArray(context?.previousClientLists)) {
        context.previousClientLists.forEach(([key, value]: any) => {
          queryClient.setQueryData(key, value);
        });
      }
    },
    onSuccess: (updated: any) => {
      const clientId = String(updated?.client_id || '');
      if (updated?.id) {
        updateObjectQueryCaches(queryClient, updated.id, updated);
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
        removeObjectFromQueryCaches(queryClient, variables.id, variables.clientId);
      }
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['requests'] });
    },
  });
}
