import { onlineManager, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { supabase } from '../../../lib/supabase';
import { getStatusDbAliases, normalizeOrderStatusFilterKey } from '../../../lib/orderFilters';
import { queryKeys } from '../../shared/query/queryKeys';
import {
  assertActiveQueryCacheOwnerContext,
  captureActiveQueryCacheOwnerContext,
  isActiveQueryCacheOwnerContext,
} from '../../shared/query/queryClient';
import { requestScreenRefresh } from '../../shared/query/screenRefreshRegistry';
import { withReadDeadline } from '../../shared/network/readDeadline';
import {
  canRunDeferredNetworkWork,
  canRunOutboxSync,
  enqueueRequestUpdate,
  isOfflineLikeError,
  syncOfflineOutbox,
  useOfflineSnapshot,
} from '../../shared/offline/offlineStatus';
import {
  getAssigneeDisplayNameById,
  getRelatedRequestCount,
  getRequestById,
  isRequestAuthorizationError,
  listCalendarRequests,
  listRequestExecutors,
  listRequestFilterOptions,
  listRequests,
  updateRequest,
} from './api';
import { seedExecutorNames } from './executorNameCache';

const PAGE_SIZE = 30;
const REQUEST_MEDIA_FIELD_KEYS = ['media_file_1', 'media_file_2', 'media_file_3', 'media_file_4', 'media_file_5'];
const REQUEST_MUTATION_OWNER_CONTEXT = Symbol('request-mutation-owner-context');

function shouldRetryRequestQuery(count: number, error: any) {
  return !isOfflineLikeError(error) && !isRequestAuthorizationError(error) && count < 1;
}

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

const REQUEST_SUPERSET_ARRAY_FILTERS = [
  'statuses',
  'executorIds',
  'clientIds',
  'objectIds',
  'clientTags',
  'objectTags',
  'workTypeIds',
  'orderIds',
  'relationObjectIds',
];
const REQUEST_SUPERSET_SCALAR_FILTERS = [
  'executorId',
  'departmentId',
  'relationClientId',
  'dateFrom',
  'dateTo',
  'startDate',
  'endDate',
  'createdFrom',
  'createdTo',
  'sumMin',
  'sumMax',
];

function normalizeRequestScopeValue(value: any) {
  return String(value || '').trim().toLowerCase();
}

function requestParamsAreUnfilteredSuperset(source: any = {}, target: any = {}, scope: any) {
  const sourceStatus = normalizeOrderStatusFilterKey(source?.status || 'all');
  if (sourceStatus && sourceStatus !== 'all') return false;
  if (
    REQUEST_SUPERSET_ARRAY_FILTERS.some(
      (key) => Array.isArray(source?.[key]) && source[key].filter(Boolean).length > 0,
    )
  ) {
    return false;
  }
  if (
    REQUEST_SUPERSET_SCALAR_FILTERS.some(
      (key) => source?.[key] !== null && source?.[key] !== undefined && String(source[key]).trim(),
    )
  ) {
    return false;
  }

  // Filtering preserves ordering only when both queries use the same server sort.
  if (normalizeRequestScopeValue(source?.sortKey) !== normalizeRequestScopeValue(target?.sortKey)) {
    return false;
  }
  if (
    scope === 'my' &&
    normalizeRequestScopeValue(source?.userId) !== normalizeRequestScopeValue(target?.userId)
  ) {
    return false;
  }

  const sourceExcludesFeed = sourceStatus === 'all' && source?.excludeFeedWhenAll !== false;
  if (sourceExcludesFeed) {
    const targetStatus = normalizeOrderStatusFilterKey(target?.status || 'all');
    const targetStatuses = Array.isArray(target?.statuses)
      ? target.statuses.map(normalizeOrderStatusFilterKey).filter(Boolean)
      : [];
    const targetCanContainFeed =
      targetStatus === 'feed' ||
      targetStatuses.includes('feed') ||
      (targetStatus === 'all' &&
        targetStatuses.length === 0 &&
        target?.excludeFeedWhenAll === false);
    if (targetCanContainFeed) return false;
  }

  return true;
}

function findRequestPageInCachedSuperset(
  queryClient: any,
  queryKey: any,
  params: any,
  pageParam: any,
) {
  const scope = queryKey?.[1] === 'my' ? 'my' : 'all';
  const pageNumber = Math.max(1, Number(pageParam) || 1);
  const from = (pageNumber - 1) * PAGE_SIZE;
  let best: { rows: any[]; updatedAt: number } | null = null;
  const entries = queryClient.getQueriesData({ queryKey: ['requests', scope] }) || [];

  for (const [sourceKey, value] of entries) {
    if (!Array.isArray(sourceKey) || !Array.isArray(value?.pages)) continue;
    const sourceParams = sourceKey[2] && typeof sourceKey[2] === 'object' ? sourceKey[2] : {};
    if (!requestParamsAreUnfilteredSuperset(sourceParams, params, scope)) continue;

    const seenIds = new Set<string>();
    const rows = value.pages
      .flatMap((page: any) => (Array.isArray(page) ? page : []))
      .filter((row: any) =>
        requestBelongsInCachedQuery(queryKey, row, row, { strictLocalProjection: true }),
      )
      .filter((row: any) => {
        const id = String(row?.id || '').trim();
        if (!id || seenIds.has(id)) return false;
        seenIds.add(id);
        return true;
      })
      .slice(from, from + PAGE_SIZE);
    if (rows.length === 0) continue;

    const updatedAt = Number(queryClient.getQueryState(sourceKey)?.dataUpdatedAt || 0);
    if (!best || updatedAt > best.updatedAt) best = { rows, updatedAt };
  }

  return best?.rows || null;
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
    queryFn: async ({ pageParam = 1, signal }) => {
      try {
        return await withReadDeadline(
          (readSignal) =>
            listRequests({ ...params, page: pageParam, pageSize: PAGE_SIZE }, readSignal),
          { label: 'Requests list', signal },
        );
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const cached: any = queryClient.getQueryData(queryKey);
        const pages = Array.isArray(cached?.pages) ? cached.pages : [];
        const fromCache = pages[Number(pageParam) - 1];
        if (Array.isArray(fromCache)) return fromCache;
        const derived = findRequestPageInCachedSuperset(
          queryClient,
          queryKey,
          params,
          pageParam,
        );
        if (derived) return derived;
        throw error;
      }
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      if (!Array.isArray(lastPage) || lastPage.length < PAGE_SIZE) return undefined;
      if (lastPage.some((row: any) => row?.__hasMore === false)) return undefined;
      return allPages.length + 1;
    },
    staleTime: 20 * 1000,
    retry: shouldRetryRequestQuery,
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

const requestRealtimeSubscriptions = new Map<string, any>();

function acquireRequestRealtimeSubscription(queryClient: any, companyId: any, onRequestsChanged?: any) {
  const scope = String(companyId || 'global');
  const existing = requestRealtimeSubscriptions.get(scope);
  if (existing) {
    existing.refs += 1;
    if (typeof onRequestsChanged === 'function') existing.listeners.add(onRequestsChanged);
    return () => releaseRequestRealtimeSubscription(scope, onRequestsChanged);
  }

  const changedIds = new Set<string>();
  const listeners = new Set<any>();
  if (typeof onRequestsChanged === 'function') listeners.add(onRequestsChanged);
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
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
    listeners.forEach((listener) => {
      try {
        listener(ids);
      } catch {}
    });
  };
  const filter = companyId ? `company_id=eq.${companyId}` : undefined;
  const channel = supabase
    .channel(`requests:realtime:${scope}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders', ...(filter ? { filter } : {}) },
      (payload: any) => {
        const rowId = payload?.new?.id || payload?.old?.id;
        if (rowId) changedIds.add(String(rowId));
        if (flushTimer == null) flushTimer = setTimeout(flushInvalidations, 150);
      },
    )
    .subscribe((status: any) => {
      if (status !== 'SUBSCRIBED') return;
      queryClient.invalidateQueries({ queryKey: ['requests', 'all'] });
      queryClient.invalidateQueries({ queryKey: ['requests', 'my'] });
      queryClient.invalidateQueries({ queryKey: ['requests', 'calendar'] });
    });
  requestRealtimeSubscriptions.set(scope, {
    refs: 1,
    channel,
    listeners,
    cancel: () => {
      if (flushTimer != null) clearTimeout(flushTimer);
    },
  });
  return () => releaseRequestRealtimeSubscription(scope, onRequestsChanged);
}

function releaseRequestRealtimeSubscription(scope: string, onRequestsChanged?: any) {
  const entry = requestRealtimeSubscriptions.get(scope);
  if (!entry) return;
  if (typeof onRequestsChanged === 'function') entry.listeners?.delete(onRequestsChanged);
  entry.refs -= 1;
  if (entry.refs > 0) return;
  requestRealtimeSubscriptions.delete(scope);
  entry.cancel?.();
  try {
    supabase.removeChannel(entry.channel);
  } catch {}
}

function requestStatusMatchesFilter(status: any, filter: any) {
  const rawStatus = String(status || '').trim();
  const normalizedStatus = normalizeOrderStatusFilterKey(rawStatus);
  const normalizedFilter = normalizeOrderStatusFilterKey(filter);
  if (!normalizedFilter || normalizedFilter === 'all') return true;
  const aliases = getStatusDbAliases(normalizedFilter).map((value) => String(value || '').trim());
  return aliases.includes(rawStatus) || normalizedStatus === normalizedFilter;
}

function normalizeRequestTagValues(values: any) {
  return (Array.isArray(values) ? values : [])
    .map((value) => {
      if (typeof value === 'string' || typeof value === 'number') return String(value).trim().toLowerCase();
      return String(value?.value || value?.label || '').trim().toLowerCase();
    })
    .filter(Boolean);
}

function requestBelongsInCachedQuery(
  queryKey: any,
  previous: any,
  next: any,
  { strictLocalProjection = false }: any = {},
) {
  if (!Array.isArray(queryKey)) return true;
  const merged = { ...(previous || {}), ...(next || {}) };
  const params = queryKey[0] === 'requests' && queryKey[2] && typeof queryKey[2] === 'object'
    ? queryKey[2]
    : null;

  if (params) {
    const statusFilter = String(params.status || 'all').trim();
    if (statusFilter === 'feed') {
      if (String(merged.assigned_to || '').trim()) return false;
      if (!requestStatusMatchesFilter(merged.status, 'feed')) return false;
    } else {
      if (!requestStatusMatchesFilter(merged.status, statusFilter)) return false;
      if (statusFilter === 'all' && params.excludeFeedWhenAll) {
        if (requestStatusMatchesFilter(merged.status, 'feed')) return false;
      }
    }

    const extraStatuses = Array.isArray(params.statuses) ? params.statuses.filter(Boolean) : [];
    if (
      extraStatuses.length > 0 &&
      !extraStatuses.some((status: any) => requestStatusMatchesFilter(merged.status, status))
    ) {
      return false;
    }

    const executorIds = Array.isArray(params.executorIds)
      ? params.executorIds.map(String).filter(Boolean)
      : [];
    const executorId = String(params.executorId || '').trim();
    const assignedTo = String(merged.assigned_to || '').trim();
    if (executorIds.length > 0 && !executorIds.includes(assignedTo)) return false;
    if (executorIds.length === 0 && executorId && assignedTo !== executorId) return false;

    const clientIds = Array.isArray(params.clientIds) ? params.clientIds.map(String) : [];
    const clientId = String(merged.client_id || '').trim();
    if (clientIds.length > 0 && !clientIds.includes(clientId)) return false;

    const objectIds = Array.isArray(params.objectIds) ? params.objectIds.map(String) : [];
    const objectId = String(merged.object_id || '').trim();
    if (objectIds.length > 0 && !objectIds.includes(objectId)) return false;

    for (const [filterKey, rowKey] of [
      ['clientTags', 'client_tags'],
      ['objectTags', 'object_tags'],
    ]) {
      const selectedTags = normalizeRequestTagValues(params?.[filterKey]);
      if (selectedTags.length === 0) continue;
      const availableTags = new Set(normalizeRequestTagValues(merged?.[rowKey]));
      if (availableTags.size === 0 && !strictLocalProjection) continue;
      if (!selectedTags.some((tag) => availableTags.has(tag))) return false;
    }

    const relationClientId = String(params.relationClientId || '').trim();
    const relationObjectIds = Array.isArray(params.relationObjectIds)
      ? params.relationObjectIds.map(String).filter(Boolean)
      : [];
    if (relationClientId || relationObjectIds.length > 0) {
      const objectId = String(merged.object_id || '').trim();
      const relationMatches =
        (relationClientId && clientId === relationClientId) || relationObjectIds.includes(objectId);
      if (!relationMatches) return false;
    }

    const workTypeIds = Array.isArray(params.workTypeIds)
      ? params.workTypeIds.map(String).filter(Boolean)
      : [];
    if (workTypeIds.length > 0 && !workTypeIds.includes(String(merged.work_type_id || ''))) {
      return false;
    }

    const orderIds = Array.isArray(params.orderIds)
      ? params.orderIds.map(String).filter(Boolean)
      : [];
    if (orderIds.length > 0 && !orderIds.includes(String(merged.id || ''))) return false;

    if (params.departmentId != null) {
      const departmentValue =
        merged.department_id ?? merged.executor_department_id ?? merged.assignee_department_id;
      if (departmentValue === undefined || departmentValue === null) {
        if (strictLocalProjection) return false;
      } else if (String(departmentValue) !== String(params.departmentId)) return false;
    }

    const timeWindowStart = Date.parse(String(merged.time_window_start || ''));
    const createdAt = Date.parse(String(merged.created_at || ''));
    if (params.dateFrom && (!Number.isFinite(timeWindowStart) || timeWindowStart < Date.parse(params.dateFrom))) return false;
    if (params.dateTo && (!Number.isFinite(timeWindowStart) || timeWindowStart > Date.parse(params.dateTo))) return false;
    if (params.startDate && (!Number.isFinite(timeWindowStart) || timeWindowStart < Date.parse(params.startDate))) return false;
    if (params.endDate && (!Number.isFinite(timeWindowStart) || timeWindowStart > Date.parse(params.endDate))) return false;
    if (params.createdFrom && (!Number.isFinite(createdAt) || createdAt < Date.parse(params.createdFrom))) return false;
    if (params.createdTo && (!Number.isFinite(createdAt) || createdAt > Date.parse(params.createdTo))) return false;

    const price = Number(merged.start_price);
    const minPrice = String(params.sumMin ?? '').trim() === '' ? NaN : Number(params.sumMin);
    const maxPrice = String(params.sumMax ?? '').trim() === '' ? NaN : Number(params.sumMax);
    if (Number.isFinite(minPrice) && (!Number.isFinite(price) || price < minPrice)) return false;
    if (Number.isFinite(maxPrice) && (!Number.isFinite(price) || price > maxPrice)) return false;

    if (queryKey[1] === 'my' && previous?.assigned_to !== undefined) {
      const oldAssignee = String(previous.assigned_to || '').trim();
      if (oldAssignee && assignedTo !== oldAssignee) return false;
    }
    if (queryKey[1] === 'calendar' && params.scope !== 'all') {
      const calendarUserId = String(params.userId || '').trim();
      if (calendarUserId && assignedTo !== calendarUserId) return false;
    }
  }

  if (queryKey[0] === 'orders' && queryKey[2] === 'recent') {
    const scopeUserId = String(queryKey[3] || '').split(':')[0];
    if (queryKey[1] === 'my' && scopeUserId) {
      if (String(merged.assigned_to || '').trim() !== scopeUserId) return false;
    }
    if (requestStatusMatchesFilter(merged.status, 'feed')) return false;
  }

  return true;
}

function updateRequestInListCaches(queryClient: any, request: any) {
  const requestId = String(request?.id || '').trim();
  if (!requestId) return;
  const patchValue = (value: any, queryKey: any = null) => {
    if (Array.isArray(value)) {
      let changed = false;
      const next = value.flatMap((row: any) => {
        if (String(row?.id || '').trim() !== requestId) return [row];
        changed = true;
        if (!requestBelongsInCachedQuery(queryKey, row, request)) return [];
        return [{ ...row, ...request }];
      });
      return changed ? next : value;
    }
    if (!value || !Array.isArray(value.pages)) return value;
    let changed = false;
    const pages = value.pages.map((page: any) => {
      if (!Array.isArray(page)) return page;
      return page.flatMap((row: any) => {
        if (String(row?.id || '').trim() !== requestId) return [row];
        changed = true;
        if (!requestBelongsInCachedQuery(queryKey, row, request)) return [];
        return [{ ...row, ...request }];
      });
    });
    return changed ? { ...value, pages } : value;
  };

  const entries = [
    ...(queryClient.getQueriesData({ queryKey: ['requests'] }) || []),
    ...(queryClient.getQueriesData({ queryKey: ['orders'] }) || []),
  ];
  entries.forEach(([key, value]: any) => {
    const next = patchValue(value, key);
    if (next !== value) queryClient.setQueryData(key, next);
  });

  const runtimeListCache = (globalThis as any)?.LIST_CACHE?.myByScope;
  if (runtimeListCache && typeof runtimeListCache === 'object') {
    Object.values(runtimeListCache).forEach((scopeCache: any) => {
      if (!scopeCache || typeof scopeCache !== 'object') return;
      Object.keys(scopeCache).forEach((cacheKey) => {
        const current = scopeCache[cacheKey];
        const statusKey = String(cacheKey || '').split(':')[0] || 'all';
        const previousRow = Array.isArray(current)
          ? current.find((row: any) => String(row?.id || '').trim() === requestId)
          : null;
        const membershipFields = [
          'assigned_to',
          'department_id',
          'executor_department_id',
          'assignee_department_id',
          'work_type_id',
          'object_id',
          'client_id',
        ];
        const membershipChanged =
          previousRow &&
          membershipFields.some(
            (field) =>
              Object.prototype.hasOwnProperty.call(request || {}, field) &&
              String(previousRow?.[field] ?? '') !== String(request?.[field] ?? ''),
          );
        if (membershipChanged) {
          delete scopeCache[cacheKey];
          return;
        }
        if (statusKey === '__multiple__' && previousRow) {
          if (String(previousRow?.status || '').trim() !== String(request?.status || '').trim()) {
            delete scopeCache[cacheKey];
          } else {
            const next = patchValue(current);
            if (next !== current) scopeCache[cacheKey] = next;
          }
          return;
        }
        const next = patchValue(current, [
          'requests',
          'my',
          { status: statusKey, excludeFeedWhenAll: statusKey === 'all' },
        ]);
        if (next !== current) scopeCache[cacheKey] = next;
      });
    });
  }
}

export function useAllRequests(params: any = {}, options: any = {}) {
  return useRequestInfiniteQuery(queryKeys.requests.all(params), { ...params, scope: 'all' }, options);
}

export function useMyRequests(params: any = {}, options: any = {}) {
  return useRequestInfiniteQuery(queryKeys.requests.my(params), { ...params, scope: 'my' }, options);
}

export function useRelatedRequestCount(params: any = {}, options: any = {}) {
  const { enabled = true, ...queryOptions } = options;
  const scope = params?.scope === 'all' ? 'all' : 'my';
  const relationFilters = useMemo(
    () => ({
      clientId: String(params?.clientId || '').trim(),
      objectIds: Array.from(
        new Set(
          (Array.isArray(params?.objectIds) ? params.objectIds : [])
            .map((value) => String(value || '').trim())
            .filter(Boolean),
        ),
      ).sort(),
    }),
    [params?.clientId, params?.objectIds],
  );
  const hasRelations = Boolean(relationFilters.clientId || relationFilters.objectIds.length);

  return useQuery({
    queryKey: queryKeys.requests.relatedCount({ scope, ...relationFilters }),
    queryFn: ({ signal }) =>
      withReadDeadline(
        (readSignal) => getRelatedRequestCount({ scope, ...relationFilters }, readSignal),
        { label: 'Related requests count', signal },
      ),
    enabled: Boolean(enabled && hasRelations),
    staleTime: 30 * 1000,
    retry: shouldRetryRequestQuery,
    ...queryOptions,
  });
}

export function useRequest(id: any, options: any = {}) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.requests.detail(id),
    queryFn: async ({ signal }) => {
      try {
        return markRequestDetailLoaded(
          await withReadDeadline((readSignal) => getRequestById(id, readSignal), {
            label: 'Request detail',
            signal,
          }),
        );
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
    retry: shouldRetryRequestQuery,
    ...options,
    // Detail queries are identity-bound. Reusing the previous key's row can
    // briefly present one request under another request's route.
    placeholderData: () => undefined,
  });
}

export function useRequestExecutors({ companyId = null, ...options }: any = {}) {
  return useQuery({
    queryKey: queryKeys.requests.executors(companyId),
    queryFn: async ({ signal }) => {
      const rows = await withReadDeadline(
        (readSignal) => listRequestExecutors({ companyId }, readSignal),
        {
          label: 'Request executors',
          signal,
        },
      );
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
    queryFn: ({ signal }) =>
      withReadDeadline((readSignal) => listRequestFilterOptions(readSignal), {
        label: 'Request filter options',
        signal,
      }),
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
  const network = useOfflineSnapshot();
  const canUseCalendarPolling = canRunDeferredNetworkWork(network);
  return useQuery({
    queryKey: queryKeys.requests.calendar({ userId, role, scope, startDate, endDate }),
    queryFn: ({ signal }) =>
      withReadDeadline(
        (readSignal) =>
          listCalendarRequests({ userId, role, scope, startDate, endDate }, readSignal),
        { label: 'Calendar requests', signal },
      ),
    enabled: enabled && !!userId,
    staleTime: 5 * 60 * 1000,
    placeholderData: (previousData) => previousData ?? [],
    refetchOnMount: false,
    refetchInterval: isScreenActive && canUseCalendarPolling ? refetchIntervalMs : false,
    refetchIntervalInBackground: false,
  });
}

export function useRequestRealtimeSync({
  enabled = true,
  companyId = null,
  onRequestsChanged,
}: any = {}) {
  const queryClient = useQueryClient();
  const network = useOfflineSnapshot();
  const canUseRealtime =
    network.isNetworkKnown && network.isOnline && !network.isPoorConnection;

  useEffect(() => {
    if (!enabled || !canUseRealtime) return undefined;
    return acquireRequestRealtimeSubscription(queryClient, companyId, onRequestsChanged);
  }, [canUseRealtime, companyId, enabled, onRequestsChanged, queryClient]);
}

export function useUpdateRequestMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: any) => {
      const ownerContext = variables?.[REQUEST_MUTATION_OWNER_CONTEXT];
      assertActiveQueryCacheOwnerContext(ownerContext);
      const {
        id,
        patch,
        expectedUpdatedAt = null,
        base = null,
        retryOnVersionMismatch = true,
      } = variables || {};
      const baseSnapshot = base || queryClient.getQueryData(queryKeys.requests.detail(id)) || null;
      const online = onlineManager.isOnline() && canRunOutboxSync();
      if (!online) {
        assertActiveQueryCacheOwnerContext(ownerContext);
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
        const updated = await updateRequest(
          id,
          patch,
          expectedUpdatedAt,
          undefined,
          { retryOnVersionMismatch },
        );
        return markRequestDetailLoaded({
          ...(baseSnapshot || {}),
          ...(updated || {}),
        });
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        assertActiveQueryCacheOwnerContext(ownerContext);
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
      const ownerContext = captureActiveQueryCacheOwnerContext();
      assertActiveQueryCacheOwnerContext(ownerContext);
      variables[REQUEST_MUTATION_OWNER_CONTEXT] = ownerContext;
      const { id, patch, base } = variables || {};
      const detailKey = queryKeys.requests.detail(id);
      await queryClient.cancelQueries({ queryKey: detailKey });
      assertActiveQueryCacheOwnerContext(ownerContext);
      const previous = queryClient.getQueryData(detailKey);
      const baseSnapshot = base || previous || null;
      if (baseSnapshot) {
        queryClient.setQueryData(detailKey, {
          ...baseSnapshot,
          ...patch,
          __offlinePending: !(onlineManager.isOnline() && canRunOutboxSync()),
        });
      }
      return { previous, detailKey, base: baseSnapshot, ownerContext };
    },
    onError: (error: any, _variables, context: any) => {
      if (!isActiveQueryCacheOwnerContext(context?.ownerContext)) return;
      if (context?.previous) {
        queryClient.setQueryData(context.detailKey, context.previous);
      }
      if (error?.code === 'CONFLICT' && error?.latest?.id) {
        queryClient.setQueryData(queryKeys.requests.detail(error.latest.id), markRequestDetailLoaded(error.latest));
      }
    },
    onSuccess: (next, _variables, context: any) => {
      if (!isActiveQueryCacheOwnerContext(context?.ownerContext)) return;
      if (next?.id) {
        const stored = next?.__offlinePending ? markRequestDetailSeed(next) : markRequestDetailLoaded(next);
        queryClient.setQueryData(
          queryKeys.requests.detail(next.id),
          stored,
        );
        updateRequestInListCaches(queryClient, stored);
        requestScreenRefresh(['orders.my'], {
          reason: 'request-cache-patch',
          request: stored,
        }).catch(() => {});
      }
      queryClient.invalidateQueries({ queryKey: ['requests'] });
      invalidateClientDeleteBlockersNamespace(queryClient);
      if (next?.__offlinePending) {
        syncOfflineOutbox(queryClient).catch(() => {});
      }
    },
    onSettled: (_data, _error, variables: any, context: any) => {
      if (variables && typeof variables === 'object') {
        delete variables[REQUEST_MUTATION_OWNER_CONTEXT];
      }
      if (!isActiveQueryCacheOwnerContext(context?.ownerContext)) return;
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
    queryFn: async ({ signal }) =>
      markRequestDetailLoaded(
        await withReadDeadline((readSignal) => getRequestById(id, readSignal), {
          label: 'Request detail prefetch',
          signal,
        }),
      ),
    staleTime: 0,
  });
}

export async function ensureRequestAssigneeNamePrefetch(queryClient: any, userId: any) {
  if (!userId) return '';
  return queryClient.ensureQueryData({
    queryKey: queryKeys.requests.assigneeName(userId),
    queryFn: ({ signal }) =>
      withReadDeadline(
        (readSignal) => getAssigneeDisplayNameById(userId, readSignal),
        { label: 'Request assignee', signal },
      ),
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
    queryFn: ({ signal }) =>
      withReadDeadline(
        (readSignal) =>
          listCalendarRequests({ userId, role, scope, startDate, endDate }, readSignal),
        { label: 'Calendar requests prefetch', signal },
      ),
    staleTime: 60 * 1000,
  });
}
