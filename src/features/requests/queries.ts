import { onlineManager, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { supabase } from '../../../lib/supabase';
import { queryKeys } from '../../shared/query/queryKeys';
import {
  enqueueRequestUpdate,
  getOfflineSnapshot,
  isOfflineLikeError,
  syncOfflineOutbox,
} from '../../shared/offline/offlineStatus';
import {
  getAssigneeDisplayNameById,
  getRequestById,
  listCalendarRequests,
  listRequestExecutors,
  listRequestFilterOptions,
  listRequests,
  updateRequest,
} from './api';
import { seedExecutorNames } from './executorNameCache';

const PAGE_SIZE = 30;
const REQUEST_MEDIA_FIELD_KEYS = ['media_file_1', 'media_file_2', 'media_file_3', 'media_file_4', 'media_file_5'];

export function isRequestDetailLoaded(row: any) {
  return row?.__detailLoaded === true;
}

export function markRequestDetailLoaded(row: any) {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    __detailLoaded: true,
    __detailSeed: false,
  };
}

export function markRequestDetailSeed(row: any, previous: any = null) {
  if (!row || typeof row !== 'object') return row;
  const next: any = {
    ...(previous && typeof previous === 'object' ? previous : {}),
    ...row,
    __detailLoaded: isRequestDetailLoaded(previous),
    __detailSeed: !isRequestDetailLoaded(previous),
  };

  for (const field of REQUEST_MEDIA_FIELD_KEYS) {
    const prevList = Array.isArray(previous?.[field]) ? previous[field] : [];
    const seedList = Array.isArray(row?.[field]) ? row[field] : [];
    if (prevList.length > seedList.length) {
      next[field] = prevList;
    }
  }

  return next;
}

function mergePages(data: any) {
  const pages = data?.pages || [];
  return pages.flatMap((page) => (Array.isArray(page) ? page : []));
}

function findRequestInListCaches(queryClient: any, id: any) {
  const targetId = String(id || '').trim();
  if (!targetId) return null;
  const listEntries = queryClient.getQueriesData({ queryKey: ['requests'] }) || [];
  for (const [, value] of listEntries) {
    const candidate = Array.isArray(value?.pages)
      ? value.pages.flatMap((page: any) => (Array.isArray(page) ? page : []))
      : Array.isArray(value)
        ? value
        : [];
    const found = candidate.find((row: any) => String(row?.id || '').trim() === targetId);
    if (found) return markRequestDetailSeed(found);
  }
  return null;
}

function useRequestInfiniteQuery(queryKey: any, params: any, options: any = {}) {
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam = 1 }) => {
      try {
        return await listRequests({ ...params, page: pageParam, pageSize: PAGE_SIZE });
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const cached: any = queryClient.getQueryData(queryKey);
        const pages = Array.isArray(cached?.pages) ? cached.pages : [];
        const fromCache = pages[Number(pageParam) - 1];
        return Array.isArray(fromCache) ? fromCache : [];
      }
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      if (!Array.isArray(lastPage) || lastPage.length < PAGE_SIZE) return undefined;
      if (lastPage.some((row: any) => row?.__hasMore === false)) return undefined;
      return allPages.length + 1;
    },
    staleTime: 20 * 1000,
    retry: (count, error) => !isOfflineLikeError(error) && count < 1,
    ...options,
  });

  const items = useMemo(() => mergePages(query.data), [query.data]);

  return {
    ...query,
    items,
  };
}

function invalidateClientDeleteBlockersNamespace(queryClient: any) {
  queryClient.invalidateQueries({ queryKey: ['clients', 'delete-blockers'] });
}

export function useAllRequests(params: any = {}, options: any = {}) {
  return useRequestInfiniteQuery(queryKeys.requests.all(params), { ...params, scope: 'all' }, options);
}

export function useMyRequests(params: any = {}, options: any = {}) {
  return useRequestInfiniteQuery(queryKeys.requests.my(params), { ...params, scope: 'my' }, options);
}

export function useRequest(id: any, options: any = {}) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.requests.detail(id),
    queryFn: async () => {
      try {
        return markRequestDetailLoaded(await getRequestById(id));
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const fromDetail = queryClient.getQueryData(queryKeys.requests.detail(id));
        if (fromDetail) return fromDetail;
        const fromLists = findRequestInListCaches(queryClient, id);
        if (fromLists) return fromLists;
        throw error;
      }
    },
    initialData: () => {
      const fromDetail = queryClient.getQueryData(queryKeys.requests.detail(id));
      if (fromDetail) return fromDetail;
      return findRequestInListCaches(queryClient, id);
    },
    enabled: !!id,
    staleTime: 45 * 1000,
    retry: (count, error) => !isOfflineLikeError(error) && count < 1,
    ...options,
  });
}

export function useRequestExecutors({ companyId = null, ...options }: any = {}) {
  return useQuery({
    queryKey: queryKeys.requests.executors(companyId),
    queryFn: async () => {
      const rows = await listRequestExecutors({ companyId });
      seedExecutorNames(rows);
      return rows;
    },
    staleTime: 60 * 1000,
    ...options,
  });
}

export function useRequestFilterOptions(options: any = {}) {
  return useQuery({
    queryKey: queryKeys.requests.filterOptions(),
    queryFn: listRequestFilterOptions,
    staleTime: 10 * 60 * 1000,
    ...options,
  });
}

export function useCalendarRequests({
  userId,
  role,
  scope = 'my',
  startDate = null,
  endDate = null,
  isScreenActive = true,
  refetchIntervalMs = false,
  enabled = true,
}: any = {}) {
  return useQuery({
    queryKey: queryKeys.requests.calendar({ userId, role, scope, startDate, endDate }),
    queryFn: () => listCalendarRequests({ userId, role, scope, startDate, endDate }),
    enabled: enabled && !!userId,
    staleTime: 5 * 60 * 1000,
    placeholderData: (previousData) => previousData ?? [],
    refetchOnMount: false,
    refetchInterval: isScreenActive ? refetchIntervalMs : false,
    refetchIntervalInBackground: false,
  });
}

export function useRequestRealtimeSync({ enabled = true, companyId = null }: any = {}) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const changedIds = new Set();
    let flushTimer = null;

    const flushInvalidations = () => {
      flushTimer = null;
      const ids = Array.from(changedIds);
      changedIds.clear();

      for (const rowId of ids) {
        queryClient.invalidateQueries({ queryKey: queryKeys.requests.detail(rowId) });
      }
      queryClient.invalidateQueries({ queryKey: ['requests', 'all'] });
      queryClient.invalidateQueries({ queryKey: ['requests', 'my'] });
      queryClient.invalidateQueries({ queryKey: ['requests', 'calendar'] });
      invalidateClientDeleteBlockersNamespace(queryClient);
    };

    const filter = companyId ? `company_id=eq.${companyId}` : undefined;
    const channel = supabase
      .channel(`requests:realtime:${companyId || 'global'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          ...(filter ? { filter } : {}),
        },
        (payload: any) => {
          const rowId = payload?.new?.id || payload?.old?.id;
          if (rowId) {
            changedIds.add(rowId);
          }
          if (flushTimer == null) {
            flushTimer = setTimeout(flushInvalidations, 150);
          }
        },
      )
      .subscribe();

    return () => {
      if (flushTimer != null) {
        clearTimeout(flushTimer);
      }
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [companyId, enabled, queryClient]);
}

export function useUpdateRequestMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: any) => {
      const { id, patch, expectedUpdatedAt = null, base = null } = variables || {};
      const baseSnapshot = base || queryClient.getQueryData(queryKeys.requests.detail(id)) || null;
      const online = onlineManager.isOnline() && getOfflineSnapshot().isOnline;
      if (!online) {
        const queued = await enqueueRequestUpdate({
          id,
          patch,
          base: baseSnapshot,
          expectedUpdatedAt,
        });
        return markRequestDetailSeed({
          ...(baseSnapshot || {}),
          ...(patch || {}),
          id,
          updated_at: expectedUpdatedAt || baseSnapshot?.updated_at || new Date().toISOString(),
          __offlinePending: true,
          __offlineOutboxId: queued.id,
        }, baseSnapshot);
      }

      try {
        return markRequestDetailLoaded(await updateRequest(id, patch, expectedUpdatedAt));
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const queued = await enqueueRequestUpdate({
          id,
          patch,
          base: baseSnapshot,
          expectedUpdatedAt,
        });
        return markRequestDetailSeed({
          ...(baseSnapshot || {}),
          ...(patch || {}),
          id,
          updated_at: expectedUpdatedAt || baseSnapshot?.updated_at || new Date().toISOString(),
          __offlinePending: true,
          __offlineOutboxId: queued.id,
        }, baseSnapshot);
      }
    },
    onMutate: async (variables: any) => {
      const { id, patch, base } = variables || {};
      const detailKey = queryKeys.requests.detail(id);
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData(detailKey);
      const baseSnapshot = base || previous || null;
      if (baseSnapshot) {
        queryClient.setQueryData(detailKey, { ...baseSnapshot, ...patch, __offlinePending: !onlineManager.isOnline() });
      }
      return { previous, detailKey, base: baseSnapshot };
    },
    onError: (error: any, _variables, context: any) => {
      if (context?.previous) {
        queryClient.setQueryData(context.detailKey, context.previous);
      }
      if (error?.code === 'CONFLICT' && error?.latest?.id) {
        queryClient.setQueryData(queryKeys.requests.detail(error.latest.id), markRequestDetailLoaded(error.latest));
      }
    },
    onSuccess: (next) => {
      if (next?.id) {
        queryClient.setQueryData(
          queryKeys.requests.detail(next.id),
          next?.__offlinePending ? markRequestDetailSeed(next) : markRequestDetailLoaded(next),
        );
      }
      queryClient.invalidateQueries({ queryKey: ['requests'] });
      invalidateClientDeleteBlockersNamespace(queryClient);
      if (next?.__offlinePending) {
        syncOfflineOutbox(queryClient).catch(() => {});
      }
    },
    onSettled: () => {
      invalidateClientDeleteBlockersNamespace(queryClient);
    },
  });
}

export async function ensureRequestPrefetch(queryClient: any, id: any) {
  if (!id) return null;
  const detailKey = queryKeys.requests.detail(id);
  const existing = queryClient.getQueryData(detailKey);
  if (isRequestDetailLoaded(existing)) return existing;
  return queryClient.fetchQuery({
    queryKey: queryKeys.requests.detail(id),
    queryFn: async () => markRequestDetailLoaded(await getRequestById(id)),
    staleTime: 45 * 1000,
  });
}

export async function ensureRequestAssigneeNamePrefetch(queryClient: any, userId: any) {
  if (!userId) return '';
  return queryClient.ensureQueryData({
    queryKey: queryKeys.requests.assigneeName(userId),
    queryFn: () => getAssigneeDisplayNameById(userId),
    staleTime: 2 * 60 * 1000,
  });
}

export async function ensureCalendarRequestsPrefetch(
  queryClient: any,
  { userId, role, scope = 'my', startDate = null, endDate = null }: any = {},
) {
  if (!userId) return [];
  return queryClient.ensureQueryData({
    queryKey: queryKeys.requests.calendar({ userId, role, scope, startDate, endDate }),
    queryFn: () => listCalendarRequests({ userId, role, scope, startDate, endDate }),
    staleTime: 60 * 1000,
  });
}
