import { useEffect, useMemo } from 'react';
import { onlineManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { formatPersonNameParts } from '../../../lib/personName';
import { queryKeys } from '../../shared/query/queryKeys';
import {
  assertActiveQueryCacheOwnerContext,
  captureActiveQueryCacheOwnerContext,
  isActiveQueryCacheOwnerContext,
} from '../../shared/query/queryClient';
import { withReadDeadline } from '../../shared/network/readDeadline';
import { invalidateManyNow, invalidateNow } from '../../shared/query/invalidate';
import {
  canRunOutboxSync,
  enqueueClientUpdate,
  enqueueTrashDelete,
  hasPendingOfflineUpdate,
  isOfflineLikeError,
  syncOfflineOutbox,
  useOfflineSnapshot,
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

const CLIENT_MUTATION_OWNER_CONTEXT = '__fieldWorkClientMutationOwnerContext';

function normalizeClientListScope(value: any) {
  return String(value || '').trim().toLowerCase();
}

function clientMatchesCachedSearch(client: any, search: any) {
  const needle = String(search || '').trim().toLowerCase();
  if (!needle) return true;
  const values = [
    client?.full_name,
    client?.fullName,
    client?.first_name,
    client?.firstName,
    client?.middle_name,
    client?.middleName,
    client?.last_name,
    client?.lastName,
    client?.email,
    client?.phone,
    client?.additional_phone_1,
    client?.additionalPhone1,
    client?.additional_phone_2,
    client?.additionalPhone2,
    client?.additional_phone_3,
    client?.additionalPhone3,
  ];
  return values.some((value) => String(value || '').toLowerCase().includes(needle));
}

function findClientsInCachedSuperset(queryClient: any, params: any) {
  const targetCompanyId = normalizeClientListScope(params?.companyId);
  let best: { rows: any[]; updatedAt: number } | null = null;
  const entries = queryClient.getQueriesData({ queryKey: ['clients', 'list'] }) || [];

  for (const [key, value] of entries) {
    if (!Array.isArray(value) || !Array.isArray(key)) continue;
    const sourceParams = key[2] && typeof key[2] === 'object' ? key[2] : {};
    if (normalizeClientListScope(sourceParams?.companyId) !== targetCompanyId) continue;
    // Only an unsearched company list is a safe superset of another search.
    if (String(sourceParams?.search || '').trim()) continue;

    const rows = value
      .filter((client: any) => {
        const rowCompanyId = normalizeClientListScope(client?.company_id || client?.companyId);
        return !targetCompanyId || !rowCompanyId || rowCompanyId === targetCompanyId;
      })
      .filter((client: any) => clientMatchesCachedSearch(client, params?.search));
    if (rows.length === 0) continue;

    const updatedAt = Number(queryClient.getQueryState(key)?.dataUpdatedAt || 0);
    if (!best || updatedAt > best.updatedAt) best = { rows, updatedAt };
  }

  return best?.rows || null;
}

export function useClients(params: any = {}, options: any = {}) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.clients.list(params),
    queryFn: async ({ signal }) => {
      try {
        return await withReadDeadline((readSignal) => listClients(params, readSignal), {
          label: 'Clients list',
          signal,
        });
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const cached = queryClient.getQueryData(queryKeys.clients.list(params));
        if (Array.isArray(cached)) return cached;
        const derived = findClientsInCachedSuperset(queryClient, params);
        if (derived) return derived;
        throw error;
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
    queryFn: async ({ signal }) => {
      try {
        return await withReadDeadline(
          (readSignal) => getClientById(String(id || ''), readSignal),
          {
            label: 'Client detail',
            signal,
          },
        );
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
        if (typeof cached === 'number' && Number.isFinite(cached)) return cached;
        throw error;
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
        if (cached) return cached;
        throw error;
      }
    },
    enabled: !!id,
    staleTime: 15 * 1000,
    retry: (count, error) => !isOfflineLikeError(error) && count < 1,
    ...options,
  });
}

type ClientsRealtimeSubscription = {
  refs: number;
  channel: any;
};

const clientsRealtimeSubscriptions = new WeakMap<
  object,
  Map<string, ClientsRealtimeSubscription>
>();

function releaseClientsRealtimeSubscription(queryClient: any, companyKey: string) {
  const subscriptions = clientsRealtimeSubscriptions.get(queryClient);
  const entry = subscriptions?.get(companyKey);
  if (!entry) return;

  entry.refs -= 1;
  if (entry.refs > 0) return;

  subscriptions?.delete(companyKey);
  if (subscriptions?.size === 0) clientsRealtimeSubscriptions.delete(queryClient);
  try {
    supabase.removeChannel(entry.channel);
  } catch {}
}

function acquireClientsRealtimeSubscription(queryClient: any, companyId: any) {
  const companyKey = String(companyId || '').trim();
  if (!companyKey) return () => {};

  let subscriptions = clientsRealtimeSubscriptions.get(queryClient);
  if (!subscriptions) {
    subscriptions = new Map();
    clientsRealtimeSubscriptions.set(queryClient, subscriptions);
  }

  const existing = subscriptions.get(companyKey);
  if (existing) {
    existing.refs += 1;
    return () => releaseClientsRealtimeSubscription(queryClient, companyKey);
  }

  const refreshClientLists = () => {
    void queryClient.invalidateQueries({ queryKey: ['clients'] });
  };

  const channel = supabase
    .channel(`clients:realtime:${companyKey}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'clients',
        filter: `company_id=eq.${companyKey}`,
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
        filter: `company_id=eq.${companyKey}`,
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
        filter: `company_id=eq.${companyKey}`,
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
        filter: `company_id=eq.${companyKey}`,
      },
      () => {
        void invalidateManyNow(queryClient, [['clients'], ['objects'], ['tags']]);
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') refreshClientLists();
    });

  subscriptions.set(companyKey, { refs: 1, channel });
  return () => releaseClientsRealtimeSubscription(queryClient, companyKey);
}

export function useClientsRealtimeSync({ enabled = true, companyId = null }: any = {}) {
  const queryClient = useQueryClient();
  const network = useOfflineSnapshot();
  const canUseRealtime =
    network.isNetworkKnown && network.isOnline && !network.isPoorConnection;

  useEffect(() => {
    if (!enabled || !companyId || !canUseRealtime) return undefined;
    return acquireClientsRealtimeSubscription(queryClient, companyId);
  }, [canUseRealtime, companyId, enabled, queryClient]);
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
    mutationFn: (payload: Record<string, any>) => {
      assertActiveQueryCacheOwnerContext(payload?.[CLIENT_MUTATION_OWNER_CONTEXT]);
      return createClient(payload);
    },
    onMutate: (payload: Record<string, any>) => {
      const ownerContext = captureActiveQueryCacheOwnerContext();
      assertActiveQueryCacheOwnerContext(ownerContext);
      Object.defineProperty(payload, CLIENT_MUTATION_OWNER_CONTEXT, {
        value: ownerContext,
        configurable: true,
        enumerable: false,
      });
      return { ownerContext };
    },
    onSuccess: (created: any, _payload, context: any) => {
      if (!isActiveQueryCacheOwnerContext(context?.ownerContext)) return;
      if (created?.id) {
        updateClientQueryCaches(queryClient, created.id, created);
      }
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
    onSettled: (_data, _error, payload: Record<string, any>) => {
      if (payload && typeof payload === 'object') delete payload[CLIENT_MUTATION_OWNER_CONTEXT];
    },
  });
}

export function useUpdateClientMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: { id: string; patch: Record<string, any> } & Record<any, any>) => {
      assertActiveQueryCacheOwnerContext(variables?.[CLIENT_MUTATION_OWNER_CONTEXT]);
      const { id, patch } = variables;
      const base = queryClient.getQueryData(queryKeys.clients.detail(id)) as Record<string, any> | null;
      const online = onlineManager.isOnline() && canRunOutboxSync();
      if (!online) {
        assertActiveQueryCacheOwnerContext(variables?.[CLIENT_MUTATION_OWNER_CONTEXT]);
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
        assertActiveQueryCacheOwnerContext(variables?.[CLIENT_MUTATION_OWNER_CONTEXT]);
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
    onMutate: async (variables: any) => {
      const ownerContext = captureActiveQueryCacheOwnerContext();
      assertActiveQueryCacheOwnerContext(ownerContext);
      Object.defineProperty(variables, CLIENT_MUTATION_OWNER_CONTEXT, {
        value: ownerContext,
        configurable: true,
        enumerable: false,
      });
      const { id, patch } = variables;
      const detailKey = queryKeys.clients.detail(id);
      await queryClient.cancelQueries({ queryKey: detailKey });
      await queryClient.cancelQueries({ queryKey: ['clients', 'list'] });
      assertActiveQueryCacheOwnerContext(ownerContext);
      const previous = queryClient.getQueryData(detailKey);
      const previousLists = queryClient.getQueriesData({ queryKey: ['clients', 'list'] });
      updateClientQueryCaches(queryClient, id, (prev: any) => ({
        ...(prev || {}),
        ...(patch || {}),
        id,
        __offlinePending: !(onlineManager.isOnline() && canRunOutboxSync()),
      }));
      return { previous, previousLists, detailKey, ownerContext };
    },
    onError: (_error, _variables, context: any) => {
      if (!isActiveQueryCacheOwnerContext(context?.ownerContext)) return;
      if (context?.previous) {
        queryClient.setQueryData(context.detailKey, context.previous);
      }
      if (Array.isArray(context?.previousLists)) {
        context.previousLists.forEach(([key, value]: any) => {
          queryClient.setQueryData(key, value);
        });
      }
    },
    onSuccess: (updated: any, _variables, context: any) => {
      if (!isActiveQueryCacheOwnerContext(context?.ownerContext)) return;
      if (updated?.id) {
        updateClientQueryCaches(queryClient, updated.id, updated);
      }
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      if (updated?.__offlinePending) {
        syncOfflineOutbox(queryClient).catch(() => {});
      }
    },
    onSettled: (_data, _error, variables: any) => {
      if (variables && typeof variables === 'object') {
        delete variables[CLIENT_MUTATION_OWNER_CONTEXT];
      }
    },
  });
}

export function useDeleteClientMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: any) => {
      const ownerContext = variables?.[CLIENT_MUTATION_OWNER_CONTEXT];
      assertActiveQueryCacheOwnerContext(ownerContext);
      const entityId = String(variables?.id || '');
      const base = queryClient.getQueryData(queryKeys.clients.detail(entityId)) as Record<string, any> | null;
      const online = onlineManager.isOnline() && canRunOutboxSync();
      const hasPendingUpdate = await hasPendingOfflineUpdate('client', entityId);
      assertActiveQueryCacheOwnerContext(ownerContext);
      if (!online || hasPendingUpdate) {
        await enqueueTrashDelete({ entity: 'client', id: entityId, base });
        assertActiveQueryCacheOwnerContext(ownerContext);
        syncOfflineOutbox(queryClient).catch(() => {});
        return { queued: true };
      }
      try {
        await deleteClient(entityId);
        return { queued: false };
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        assertActiveQueryCacheOwnerContext(ownerContext);
        await enqueueTrashDelete({ entity: 'client', id: entityId, base });
        return { queued: true };
      }
    },
    onMutate: (variables: any) => {
      const ownerContext = captureActiveQueryCacheOwnerContext();
      assertActiveQueryCacheOwnerContext(ownerContext);
      Object.defineProperty(variables, CLIENT_MUTATION_OWNER_CONTEXT, {
        value: ownerContext,
        configurable: true,
        enumerable: false,
      });
      return { ownerContext };
    },
    onSuccess: (_result, variables: any, context: any) => {
      if (!isActiveQueryCacheOwnerContext(context?.ownerContext)) return;
      const deletedId = String(variables?.id || '');
      if (deletedId) {
        removeClientFromQueryCaches(queryClient, deletedId);
      }
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
    onSettled: (_data, _error, variables: any) => {
      if (variables && typeof variables === 'object') {
        delete variables[CLIENT_MUTATION_OWNER_CONTEXT];
      }
    },
  });
}

export async function ensureClientPrefetch(queryClient: any, id: any) {
  if (!id) return null;
  return queryClient.ensureQueryData({
    queryKey: queryKeys.clients.detail(id),
    queryFn: ({ signal }) =>
      withReadDeadline((readSignal) => getClientById(String(id || ''), readSignal), {
        label: 'Client detail prefetch',
        signal,
      }),
    staleTime: 60 * 1000,
  });
}
