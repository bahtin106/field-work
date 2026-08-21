import { useEffect, useMemo } from 'react';
import { onlineManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatPersonName } from '../../../lib/personName';
import { supabase } from '../../../lib/supabase';
import { queryKeys } from '../../shared/query/queryKeys';
import {
  assertActiveQueryCacheOwnerContext,
  captureActiveQueryCacheOwnerContext,
  getActiveQueryCacheOwner,
  isActiveQueryCacheOwnerContext,
} from '../../shared/query/queryClient';
import { withReadDeadline } from '../../shared/network/readDeadline';
import { invalidateManyNow, invalidateNow } from '../../shared/query/invalidate';
import { detachObjectFromRequestCaches } from '../requests/objectRelationCache';
import {
  canRunDeferredNetworkWork,
  canRunOutboxSync,
  enqueueObjectUpdate,
  enqueueTrashDelete,
  hasPendingOfflineUpdate,
  isOfflineLikeError,
  syncOfflineOutbox,
  useOfflineSnapshot,
} from '../../shared/offline/offlineStatus';
import {
  createClientObject,
  deleteClientObject,
  getClientObjectById,
  hasEnoughObjectSearchInput,
  listClientObjects,
  listClientObjectsByCompany,
  searchCompanyObjectsForOrder,
  updateClientObject,
} from './api';
import { buildClientObjectLocationSummary } from './addressing';

const OBJECT_MUTATION_OWNER_CONTEXT = '__fieldWorkObjectMutationOwnerContext';

function normalizeObjectListScope(value: any) {
  return String(value || '').trim().toLowerCase();
}

function findCachedClientCompanyId(queryClient: any, clientId: any) {
  const targetClientId = String(clientId || '').trim();
  if (!targetClientId) return '';

  const detail: any = queryClient.getQueryData(queryKeys.clients.detail(targetClientId));
  const detailCompanyId = normalizeObjectListScope(detail?.company_id || detail?.companyId);
  if (detailCompanyId) return detailCompanyId;

  const clientLists = queryClient.getQueriesData({ queryKey: ['clients', 'list'] }) || [];
  for (const [key, value] of clientLists) {
    if (!Array.isArray(value) || !Array.isArray(key)) continue;
    const client = value.find((row: any) => String(row?.id || '').trim() === targetClientId);
    if (!client) continue;
    const rowCompanyId = normalizeObjectListScope(client?.company_id || client?.companyId);
    const sourceParams = key[2] && typeof key[2] === 'object' ? key[2] : {};
    const keyCompanyId = normalizeObjectListScope(sourceParams?.companyId);
    if (rowCompanyId || keyCompanyId) return rowCompanyId || keyCompanyId;
  }

  return '';
}

function findClientObjectsInCachedCompanySuperset(queryClient: any, clientId: any) {
  const targetClientId = String(clientId || '').trim();
  const targetCompanyId = findCachedClientCompanyId(queryClient, targetClientId);
  if (!targetClientId || !targetCompanyId) return null;

  let best: { rows: any[]; updatedAt: number } | null = null;
  const entries = queryClient.getQueriesData({ queryKey: ['objects', 'by-company'] }) || [];
  for (const [key, value] of entries) {
    if (!Array.isArray(value) || !Array.isArray(key)) continue;
    if (normalizeObjectListScope(key[2]) !== targetCompanyId) continue;
    const rows = value.filter((row: any) => {
      const rowCompanyId = normalizeObjectListScope(row?.company_id || row?.companyId);
      if (rowCompanyId && rowCompanyId !== targetCompanyId) return false;
      return String(row?.client_id || row?.clientId || '').trim() === targetClientId;
    });
    if (rows.length === 0) continue;
    const updatedAt = Number(queryClient.getQueryState(key)?.dataUpdatedAt || 0);
    if (!best || updatedAt > best.updatedAt) best = { rows, updatedAt };
  }

  return best?.rows || null;
}

function normalizeObjectSearchText(value: any) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function cachedTextContainsAllTokens(value: any, search: any) {
  const needle = normalizeObjectSearchText(search);
  if (!needle) return true;
  const haystack = normalizeObjectSearchText(value);
  if (!haystack) return false;
  return needle.split(/\s+/).every((token) => haystack.includes(token));
}

function rememberCachedClientName(
  namesById: Map<string, string>,
  client: any,
  targetCompanyId: string,
  keyCompanyId = '',
) {
  const clientId = String(client?.id || '').trim();
  if (!clientId) return;
  const rowCompanyId = normalizeObjectListScope(client?.company_id || client?.companyId);
  if (rowCompanyId && rowCompanyId !== targetCompanyId) return;
  if (keyCompanyId && keyCompanyId !== targetCompanyId) return;
  const name = formatPersonName(client);
  if (name) namesById.set(clientId, name);
}

function findCachedClientNamesById(queryClient: any, targetCompanyId: string) {
  const namesById = new Map<string, string>();
  const lists = queryClient.getQueriesData({ queryKey: ['clients', 'list'] }) || [];
  for (const [key, value] of lists) {
    if (!Array.isArray(value) || !Array.isArray(key)) continue;
    const sourceParams = key[2] && typeof key[2] === 'object' ? key[2] : {};
    const keyCompanyId = normalizeObjectListScope(sourceParams?.companyId);
    value.forEach((client: any) =>
      rememberCachedClientName(namesById, client, targetCompanyId, keyCompanyId));
  }

  const details = queryClient.getQueriesData({ queryKey: ['clients', 'detail'] }) || [];
  for (const [, client] of details) {
    if (!client || typeof client !== 'object') continue;
    rememberCachedClientName(namesById, client, targetCompanyId);
  }
  return namesById;
}

function mapCachedObjectSearchResult(
  row: any,
  clientName: string,
  requestedClientId: string,
) {
  const clientId = String(row?.client_id || row?.clientId || '').trim();
  const isSameClient = !!requestedClientId && clientId === requestedClientId;
  const shortAddress =
    String(row?.summary || '').trim() ||
    buildClientObjectLocationSummary(row, { compact: true });
  return {
    objectId: String(row?.id || '').trim(),
    clientId,
    objectName: String(row?.name || row?.label || '').trim(),
    clientName,
    shortAddress,
    score: isSameClient ? 1 : 0.8,
    isSameClient,
    country: String(row?.country || '').trim(),
    region: String(row?.region || '').trim(),
    district: String(row?.district || '').trim(),
    city: String(row?.city || '').trim(),
    street: String(row?.street || '').trim(),
    house: String(row?.house || '').trim(),
    postal_code: String(row?.postal_code || '').trim(),
    floor: String(row?.floor || '').trim(),
    entrance: String(row?.entrance || '').trim(),
    apartment: String(row?.apartment || row?.office || '').trim(),
    comment: String(row?.comment || row?.entrance_info || '').trim(),
  };
}

function findObjectSearchInCachedCompanySuperset(queryClient: any, params: any) {
  const requestedClientId = String(params?.clientId || '').trim();
  const clientCompanyId = findCachedClientCompanyId(queryClient, requestedClientId);
  const ownerCompanyId = normalizeObjectListScope(getActiveQueryCacheOwner()?.companyId);
  if (clientCompanyId && ownerCompanyId && clientCompanyId !== ownerCompanyId) return null;
  const targetCompanyId = clientCompanyId || ownerCompanyId;
  if (!targetCompanyId) return null;

  const namesByClientId = findCachedClientNamesById(queryClient, targetCompanyId);
  const searchQuery = String(params?.query || '').trim();
  const street = String(params?.street || '').trim();
  const house = normalizeObjectSearchText(params?.house).replace(/\s+/g, '');
  const city = String(params?.city || '').trim();
  const limit = Number.isFinite(Number(params?.limit))
    ? Math.min(Math.max(Number(params.limit), 1), 10)
    : 6;

  let best: { rows: any[]; updatedAt: number } | null = null;
  const entries = queryClient.getQueriesData({ queryKey: ['objects', 'by-company'] }) || [];
  for (const [key, value] of entries) {
    if (!Array.isArray(key) || !Array.isArray(value)) continue;
    if (normalizeObjectListScope(key[2]) !== targetCompanyId) continue;

    const rows = value
      .filter((row: any) => {
        const rowCompanyId = normalizeObjectListScope(row?.company_id || row?.companyId);
        if (rowCompanyId && rowCompanyId !== targetCompanyId) return false;
        const clientId = String(row?.client_id || row?.clientId || '').trim();
        const clientName =
          formatPersonName(row?.client) || namesByClientId.get(clientId) || '';
        const summary =
          String(row?.summary || '').trim() ||
          buildClientObjectLocationSummary(row, { compact: true });
        const searchable = [
          row?.name,
          clientName,
          summary,
          row?.country,
          row?.region,
          row?.district,
          row?.city,
          row?.street,
          row?.house,
          row?.postal_code,
          row?.floor,
          row?.entrance,
          row?.apartment,
          row?.office,
          row?.comment,
        ].join(' ');
        if (!cachedTextContainsAllTokens(searchable, searchQuery)) return false;
        if (!cachedTextContainsAllTokens(row?.street, street)) return false;
        if (!cachedTextContainsAllTokens(row?.city, city)) return false;
        if (house) {
          const rowHouse = normalizeObjectSearchText(row?.house).replace(/\s+/g, '');
          if (rowHouse !== house) return false;
        }
        return true;
      })
      .map((row: any) => {
        const clientId = String(row?.client_id || row?.clientId || '').trim();
        return mapCachedObjectSearchResult(
          row,
          formatPersonName(row?.client) || namesByClientId.get(clientId) || '',
          requestedClientId,
        );
      })
      .filter((row: any) => row.objectId && row.clientId)
      .sort((left: any, right: any) => {
        if (left.isSameClient !== right.isSameClient) return left.isSameClient ? -1 : 1;
        return right.score - left.score;
      })
      .slice(0, limit);

    // Zero locally matched rows cannot prove an authoritative empty search;
    // retain the remote error in that case instead of poisoning this key.
    if (rows.length === 0) continue;
    const updatedAt = Number(queryClient.getQueryState(key)?.dataUpdatedAt || 0);
    if (!best || updatedAt > best.updatedAt) best = { rows, updatedAt };
  }
  return best?.rows || null;
}

function readCachedObjectSearchFallback(queryClient: any, queryKey: any, params: any) {
  const exact = queryClient.getQueryData(queryKey);
  if (Array.isArray(exact)) return exact;
  return findObjectSearchInCachedCompanySuperset(queryClient, params) || undefined;
}

export function useClientObjects(clientId: any, options: any = {}) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.objects.byClient(clientId),
    queryFn: async ({ signal }) => {
      try {
        return await withReadDeadline(
          (readSignal) => listClientObjects(String(clientId || ''), readSignal),
          {
            label: 'Client objects',
            signal,
          },
        );
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const cached = queryClient.getQueryData(queryKeys.objects.byClient(clientId));
        if (Array.isArray(cached)) return cached;
        const derived = findClientObjectsInCachedCompanySuperset(queryClient, clientId);
        if (derived) return derived;
        throw error;
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
    queryFn: async ({ signal }) => {
      try {
        return await withReadDeadline(
          (readSignal) => listClientObjectsByCompany(String(companyId || ''), readSignal),
          {
            label: 'Company objects',
            signal,
          },
        );
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const cached = queryClient.getQueryData(queryKeys.objects.byCompany(companyId));
        if (Array.isArray(cached)) return cached;
        throw error;
      }
    },
    enabled: !!companyId,
    staleTime: 30 * 1000,
    retry: (count, error) => !isOfflineLikeError(error) && count < 1,
    ...options,
  });
}

function findObjectInListCaches(queryClient: any, objectId: any) {
  const targetId = String(objectId || '').trim();
  if (!targetId || !queryClient) return null;

  let best: { row: any; updatedAt: number } | null = null;
  const remember = (row: any, updatedAt: number) => {
    if (!row || String(row?.id || '') !== targetId) return;
    if (!best || updatedAt > best.updatedAt) {
      best = { row, updatedAt };
    }
  };

  const objectLists = queryClient.getQueriesData({ queryKey: ['objects'] }) || [];
  for (const [key, value] of objectLists) {
    if (!Array.isArray(value)) continue;
    const state = queryClient.getQueryState(key);
    const updatedAt = Number(state?.dataUpdatedAt || 0);
    value.forEach((row: any) => remember(row, updatedAt));
  }

  const clientLists = queryClient.getQueriesData({ queryKey: ['clients', 'list'] }) || [];
  for (const [, value] of clientLists) {
    if (!Array.isArray(value)) continue;
    for (const client of value) {
      const objects = Array.isArray(client?.objects) ? client.objects : [];
      const found = objects.find((row: any) => String(row?.id || '') === targetId);
      if (!found) continue;
      remember(
        {
          ...found,
          client_id: found.client_id || client?.id || null,
          client: found.client || client,
        },
        0,
      );
    }
  }

  return best;
}

export function useClientObject(objectId: any, options: any = {}) {
  const queryClient = useQueryClient();
  const listSeed = useMemo(() => findObjectInListCaches(queryClient, objectId), [objectId, queryClient]);

  return useQuery({
    queryKey: queryKeys.objects.detail(objectId),
    queryFn: async ({ signal }) => {
      try {
        return await withReadDeadline(
          (readSignal) => getClientObjectById(String(objectId || ''), readSignal),
          {
            label: 'Object detail',
            signal,
          },
        );
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
    initialData: () => listSeed?.row,
    initialDataUpdatedAt: () => listSeed?.updatedAt,
    enabled: !!objectId,
    staleTime: 60 * 1000,
    retry: (count, error) => !isOfflineLikeError(error) && count < 1,
    ...options,
  });
}

export function useSearchCompanyObjectsForOrder(params: any = {}, options: any = {}) {
  const queryClient = useQueryClient();
  const network = useOfflineSnapshot();
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

  const hasEnoughInput = hasEnoughObjectSearchInput({ query, street, house });
  const queryKey = queryKeys.objects.searchForOrder(params);
  const canSearchNetwork = canRunDeferredNetworkWork(network);
  const isRequested = options?.enabled !== false;

  return useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      if (!canRunDeferredNetworkWork()) {
        const cached = readCachedObjectSearchFallback(queryClient, queryKey, params);
        if (cached !== undefined) return cached;
        const pausedError: any = new Error('Object search paused while offline or on a poor connection');
        pausedError.code = 'OBJECT_SEARCH_NETWORK_PAUSED';
        throw pausedError;
      }
      try {
        return await withReadDeadline(
          (readSignal) => searchCompanyObjectsForOrder(params, readSignal),
          { label: 'Company object search', signal },
        );
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const cached = readCachedObjectSearchFallback(queryClient, queryKey, params);
        if (cached !== undefined) return cached;
        throw error;
      }
    },
    staleTime: 15 * 1000,
    retry: (count, error) => !isOfflineLikeError(error) && count < 1,
    ...options,
    // Search suggestions are deferred enrichment. Keep exact/superset cache
    // visible on EDGE/offline and wait for a healthy connection before RPC.
    enabled: hasEnoughInput && isRequested && canSearchNetwork,
    placeholderData: () =>
      readCachedObjectSearchFallback(queryClient, queryKey, params),
  });
}

type ObjectsRealtimeSubscription = {
  refs: number;
  channel: any;
};

const objectsRealtimeSubscriptions = new WeakMap<
  object,
  Map<string, ObjectsRealtimeSubscription>
>();

function releaseObjectsRealtimeSubscription(queryClient: any, companyKey: string) {
  const subscriptions = objectsRealtimeSubscriptions.get(queryClient);
  const entry = subscriptions?.get(companyKey);
  if (!entry) return;

  entry.refs -= 1;
  if (entry.refs > 0) return;

  subscriptions?.delete(companyKey);
  if (subscriptions?.size === 0) objectsRealtimeSubscriptions.delete(queryClient);
  try {
    supabase.removeChannel(entry.channel);
  } catch {}
}

function acquireObjectsRealtimeSubscription(queryClient: any, companyId: any) {
  const companyKey = String(companyId || '').trim();
  if (!companyKey) return () => {};

  let subscriptions = objectsRealtimeSubscriptions.get(queryClient);
  if (!subscriptions) {
    subscriptions = new Map();
    objectsRealtimeSubscriptions.set(queryClient, subscriptions);
  }

  const existing = subscriptions.get(companyKey);
  if (existing) {
    existing.refs += 1;
    return () => releaseObjectsRealtimeSubscription(queryClient, companyKey);
  }

  const refreshObjectLists = () => {
    void queryClient.invalidateQueries({ queryKey: ['objects'] });
  };

  const channel = supabase
    .channel(`client-objects:realtime:${companyKey}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'client_objects',
        filter: `company_id=eq.${companyKey}`,
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
          queryClient.invalidateQueries({ queryKey: ['objects'] });
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
        filter: `company_id=eq.${companyKey}`,
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
        filter: `company_id=eq.${companyKey}`,
      },
      () => {
        void invalidateManyNow(queryClient, [['objects'], ['clients'], ['tags']]);
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') refreshObjectLists();
    });

  subscriptions.set(companyKey, { refs: 1, channel });
  return () => releaseObjectsRealtimeSubscription(queryClient, companyKey);
}

export function useClientObjectsRealtimeSync({ enabled = true, companyId = null }: any = {}) {
  const queryClient = useQueryClient();
  const network = useOfflineSnapshot();
  const canUseRealtime =
    network.isNetworkKnown && network.isOnline && !network.isPoorConnection;

  useEffect(() => {
    if (!enabled || !companyId || !canUseRealtime) return undefined;
    return acquireObjectsRealtimeSubscription(queryClient, companyId);
  }, [canUseRealtime, companyId, enabled, queryClient]);
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

  detachObjectFromRequestCaches(queryClient, id);
}

export function useCreateClientObjectMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: Record<string, any>) => {
      assertActiveQueryCacheOwnerContext(payload?.[OBJECT_MUTATION_OWNER_CONTEXT]);
      return createClientObject(payload);
    },
    onMutate: (payload: Record<string, any>) => {
      const ownerContext = captureActiveQueryCacheOwnerContext();
      assertActiveQueryCacheOwnerContext(ownerContext);
      Object.defineProperty(payload, OBJECT_MUTATION_OWNER_CONTEXT, {
        value: ownerContext,
        configurable: true,
        enumerable: false,
      });
      return { ownerContext };
    },
    onSuccess: (created: any, _payload, context: any) => {
      if (!isActiveQueryCacheOwnerContext(context?.ownerContext)) return;
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
    onSettled: (_data, _error, payload: Record<string, any>) => {
      if (payload && typeof payload === 'object') delete payload[OBJECT_MUTATION_OWNER_CONTEXT];
    },
  });
}

export function useUpdateClientObjectMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: { id: string; patch: Record<string, any> } & Record<any, any>) => {
      assertActiveQueryCacheOwnerContext(variables?.[OBJECT_MUTATION_OWNER_CONTEXT]);
      const { id, patch } = variables;
      const base = queryClient.getQueryData(queryKeys.objects.detail(id)) as Record<string, any> | null;
      const online = onlineManager.isOnline() && canRunOutboxSync();
      if (!online) {
        assertActiveQueryCacheOwnerContext(variables?.[OBJECT_MUTATION_OWNER_CONTEXT]);
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
        assertActiveQueryCacheOwnerContext(variables?.[OBJECT_MUTATION_OWNER_CONTEXT]);
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
    onMutate: async (variables: any) => {
      const ownerContext = captureActiveQueryCacheOwnerContext();
      assertActiveQueryCacheOwnerContext(ownerContext);
      Object.defineProperty(variables, OBJECT_MUTATION_OWNER_CONTEXT, {
        value: ownerContext,
        configurable: true,
        enumerable: false,
      });
      const { id, patch } = variables;
      const detailKey = queryKeys.objects.detail(id);
      await queryClient.cancelQueries({ queryKey: detailKey });
      await queryClient.cancelQueries({ queryKey: ['objects'] });
      await queryClient.cancelQueries({ queryKey: ['clients'] });
      assertActiveQueryCacheOwnerContext(ownerContext);
      const previous = queryClient.getQueryData(detailKey);
      const previousObjectLists = queryClient.getQueriesData({ queryKey: ['objects'] });
      const previousClientLists = queryClient.getQueriesData({ queryKey: ['clients'] });
      updateObjectQueryCaches(queryClient, id, (prev: any) => ({
        ...(prev || {}),
        ...(patch || {}),
        id,
        __offlinePending: !(onlineManager.isOnline() && canRunOutboxSync()),
      }));
      return { previous, previousObjectLists, previousClientLists, detailKey, ownerContext };
    },
    onError: (_error, _variables, context: any) => {
      if (!isActiveQueryCacheOwnerContext(context?.ownerContext)) return;
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
    onSuccess: (updated: any, _variables, context: any) => {
      if (!isActiveQueryCacheOwnerContext(context?.ownerContext)) return;
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
    onSettled: (_data, _error, variables: any) => {
      if (variables && typeof variables === 'object') {
        delete variables[OBJECT_MUTATION_OWNER_CONTEXT];
      }
    },
  });
}

export function useDeleteClientObjectMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: { id: string } & Record<any, any>) => {
      const ownerContext = variables?.[OBJECT_MUTATION_OWNER_CONTEXT];
      assertActiveQueryCacheOwnerContext(ownerContext);
      const { id } = variables;
      const entityId = String(id || '');
      const base = queryClient.getQueryData(queryKeys.objects.detail(entityId)) as Record<string, any> | null;
      const online = onlineManager.isOnline() && canRunOutboxSync();
      const hasPendingUpdate = await hasPendingOfflineUpdate('object', entityId);
      assertActiveQueryCacheOwnerContext(ownerContext);
      if (!online || hasPendingUpdate) {
        await enqueueTrashDelete({ entity: 'object', id: entityId, base });
        assertActiveQueryCacheOwnerContext(ownerContext);
        syncOfflineOutbox(queryClient).catch(() => {});
        return { queued: true };
      }
      try {
        await deleteClientObject(entityId);
        return { queued: false };
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        assertActiveQueryCacheOwnerContext(ownerContext);
        await enqueueTrashDelete({ entity: 'object', id: entityId, base });
        return { queued: true };
      }
    },
    onMutate: (variables: any) => {
      const ownerContext = captureActiveQueryCacheOwnerContext();
      assertActiveQueryCacheOwnerContext(ownerContext);
      Object.defineProperty(variables, OBJECT_MUTATION_OWNER_CONTEXT, {
        value: ownerContext,
        configurable: true,
        enumerable: false,
      });
      return { ownerContext };
    },
    onSuccess: (_result, variables: any, context: any) => {
      if (!isActiveQueryCacheOwnerContext(context?.ownerContext)) return;
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
    onSettled: (_data, _error, variables: any) => {
      if (variables && typeof variables === 'object') {
        delete variables[OBJECT_MUTATION_OWNER_CONTEXT];
      }
    },
  });
}

export async function ensureClientObjectPrefetch(queryClient: any, id: any) {
  if (!id) return null;
  return queryClient.ensureQueryData({
    queryKey: queryKeys.objects.detail(id),
    queryFn: ({ signal }) =>
      withReadDeadline((readSignal) => getClientObjectById(String(id || ''), readSignal), {
        label: 'Object detail prefetch',
        signal,
      }),
    staleTime: 60 * 1000,
  });
}
