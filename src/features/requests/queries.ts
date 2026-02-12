import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { supabase } from '../../../lib/supabase';
import { queryKeys } from '../../shared/query/queryKeys';
import {
  getAssigneeDisplayNameById,
  getRequestById,
  listCalendarRequests,
  listRequestExecutors,
  listRequestFilterOptions,
  listRequests,
  updateRequest,
} from './api';

const PAGE_SIZE = 20;

function mergePages(data) {
  const pages = data?.pages || [];
  return pages.flatMap((page) => (Array.isArray(page) ? page : []));
}

function useRequestInfiniteQuery(queryKey, params, options = {}) {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam = 1 }) => listRequests({ ...params, page: pageParam, pageSize: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      if (!Array.isArray(lastPage) || lastPage.length < PAGE_SIZE) return undefined;
      return allPages.length + 1;
    },
    staleTime: 20 * 1000,
    ...options,
  });

  const items = useMemo(() => mergePages(query.data), [query.data]);

  return {
    ...query,
    items,
  };
}

export function useAllRequests(params = {}, options = {}) {
  return useRequestInfiniteQuery(queryKeys.requests.all(params), { ...params, scope: 'all' }, options);
}

export function useMyRequests(params = {}, options = {}) {
  return useRequestInfiniteQuery(queryKeys.requests.my(params), { ...params, scope: 'my' }, options);
}

export function useRequest(id, options = {}) {
  return useQuery({
    queryKey: queryKeys.requests.detail(id),
    queryFn: () => getRequestById(id),
    enabled: !!id,
    staleTime: 45 * 1000,
    ...options,
  });
}

export function useRequestExecutors(options = {}) {
  return useQuery({
    queryKey: queryKeys.requests.executors(),
    queryFn: listRequestExecutors,
    staleTime: 60 * 1000,
    ...options,
  });
}

export function useRequestFilterOptions(options = {}) {
  return useQuery({
    queryKey: queryKeys.requests.filterOptions(),
    queryFn: listRequestFilterOptions,
    staleTime: 10 * 60 * 1000,
    ...options,
  });
}

export function useCalendarRequests({ userId, role, isScreenActive = true, enabled = true } = {}) {
  return useQuery({
    queryKey: queryKeys.requests.calendar({ userId, role }),
    queryFn: () => listCalendarRequests({ userId, role }),
    enabled: enabled && !!userId,
    staleTime: 20 * 1000,
    refetchInterval: isScreenActive ? 20 * 1000 : false,
    refetchIntervalInBackground: false,
  });
}

export function useRequestRealtimeSync({ enabled = true, companyId = null } = {}) {
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
        (payload) => {
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
    mutationFn: ({ id, patch, expectedUpdatedAt = null }) =>
      updateRequest(id, patch, expectedUpdatedAt),
    onMutate: async ({ id, patch }) => {
      const detailKey = queryKeys.requests.detail(id);
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData(detailKey);
      if (previous) {
        queryClient.setQueryData(detailKey, { ...previous, ...patch });
      }
      return { previous, detailKey };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.detailKey, context.previous);
      }
      if (error?.code === 'CONFLICT' && error?.latest?.id) {
        queryClient.setQueryData(queryKeys.requests.detail(error.latest.id), error.latest);
      }
    },
    onSuccess: (next) => {
      if (next?.id) {
        queryClient.setQueryData(queryKeys.requests.detail(next.id), next);
      }
      queryClient.invalidateQueries({ queryKey: ['requests'] });
    },
  });
}

export async function ensureRequestPrefetch(queryClient, id) {
  if (!id) return null;
  return queryClient.ensureQueryData({
    queryKey: queryKeys.requests.detail(id),
    queryFn: () => getRequestById(id),
    staleTime: 45 * 1000,
  });
}

export async function ensureRequestAssigneeNamePrefetch(queryClient, userId) {
  if (!userId) return '';
  return queryClient.ensureQueryData({
    queryKey: queryKeys.requests.assigneeName(userId),
    queryFn: () => getAssigneeDisplayNameById(userId),
    staleTime: 2 * 60 * 1000,
  });
}
