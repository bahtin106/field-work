import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import { AppState } from 'react-native';
import { COMPANY_SETTINGS_QUERY_KEY } from '../../../lib/companySettingsQuery';
import { logClientError } from '../../../lib/errorLogsClient';
import {
  setNetworkQualityMonitoringActive,
  setOfflineNetState,
  startNetworkQualityMonitoring,
} from '../offline/offlineStatus';

const DEFAULT_REFOCUS_ENABLED = false;
const QUERY_CACHE_MAX_ENTRIES = 350;
const INACTIVE_QUERY_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const CACHE_MAINTENANCE_INTERVAL_MS = 3 * 60 * 1000;
const PERSIST_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const HOT_REQUEST_PERSIST_QUERY_SIZE_LIMIT_BYTES = 900 * 1024;
const HOT_ENTITY_LIST_PERSIST_QUERY_SIZE_LIMIT_BYTES = 220 * 1024;
const DEFAULT_QUERY_STALE_MS = 60 * 1000;
const HOT_REQUEST_LIST_STALE_MS = 60 * 1000;
const DEFAULT_QUERY_GC_MS = PERSIST_MAX_AGE_MS;
const DEFAULT_MAX_RETRIES = 2;
const PERSIST_THROTTLE_MS = 12_000;
// Keep hydration bounded on low-memory Android devices. This is a soft budget:
// paused mutations and optimistic offline data are never removed from disk.
const PERSIST_TARGET_SERIALIZED_CHARS = 3 * 1024 * 1024;
const PERSIST_HARD_SERIALIZED_CHARS = 4 * 1024 * 1024;
const PERSISTED_QUERY_OVERHEAD_CHARS = 512;
const CANONICAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getErrorStatus(error: any): number | null {
  const status = Number(error?.status || error?.statusCode || error?.response?.status);
  return Number.isFinite(status) ? status : null;
}

function isAuthLikeError(error: any) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('jwt') ||
    message.includes('session expired') ||
    message.includes('access denied')
  );
}

function isOfflineLikeError(error: any) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('network request failed') ||
    message.includes('network error') ||
    message.includes('failed to fetch') ||
    message.includes('internet') ||
    message.includes('timed out')
  );
}

function shouldRetryQuery(failureCount: number, error: any) {
  if (!onlineManager.isOnline()) return false;
  if (failureCount >= DEFAULT_MAX_RETRIES) return false;
  if (isAuthLikeError(error)) return false;

  const status = getErrorStatus(error);
  if (status && status < 500 && status !== 408 && status !== 429) {
    return false;
  }

  return isOfflineLikeError(error) || !status || status >= 500 || status === 408 || status === 429;
}

function retryDelay(attemptIndex: number) {
  const attempt = Math.max(1, Number(attemptIndex) || 1);
  return Math.min(1000 * 2 ** (attempt - 1), 15_000);
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      placeholderData: (prev) => prev,
      staleTime: DEFAULT_QUERY_STALE_MS,
      gcTime: DEFAULT_QUERY_GC_MS,
      retry: shouldRetryQuery,
      retryDelay,
      refetchOnMount: false,
      refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
      refetchOnReconnect: false,
      networkMode: 'offlineFirst',
    },
    mutations: {
      retry: 1,
      networkMode: 'offlineFirst',
      onError: (error) => {
        logClientError(error, {
          source: 'react_query_mutation',
          mutationKey: null,
        });
      },
    },
  },
});

queryClient.setQueryDefaults(['requests', 'all'], {
  staleTime: HOT_REQUEST_LIST_STALE_MS,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnReconnect: true,
});
queryClient.setQueryDefaults(['requests', 'my'], {
  staleTime: HOT_REQUEST_LIST_STALE_MS,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnReconnect: true,
});
queryClient.setQueryDefaults(['requests', 'calendar'], {
  staleTime: HOT_REQUEST_LIST_STALE_MS,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnReconnect: true,
});
queryClient.setQueryDefaults(['requests', 'detail'], {
  staleTime: 45 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnReconnect: true,
});
queryClient.setQueryDefaults(['employees', 'list'], {
  staleTime: 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
});
queryClient.setQueryDefaults(['employees', 'detail'], {
  staleTime: 120 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
});
queryClient.setQueryDefaults(['employees', 'departments'], {
  staleTime: 10 * 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
});
queryClient.setQueryDefaults(['clients'], {
  staleTime: 45 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['company'], {
  staleTime: 10 * 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['department'], {
  staleTime: 10 * 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['objects'], {
  staleTime: 45 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['finance'], {
  staleTime: 30 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['appSettings'], {
  staleTime: 2 * 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['companyEntitlements'], {
  staleTime: 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['companyStorageUsage'], {
  staleTime: 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['companyAccessState'], {
  staleTime: 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['companyPaidSeatsTotal'], {
  staleTime: 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['billingMemberStats'], {
  staleTime: 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['adminCompanies'], {
  staleTime: 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['adminCompany'], {
  staleTime: 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['adminCompanySubscriptionMeta'], {
  staleTime: 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['adminUsers'], {
  staleTime: 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['tags'], {
  staleTime: 30 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['field-settings'], {
  staleTime: 5 * 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: false,
});
queryClient.setQueryDefaults(COMPANY_SETTINGS_QUERY_KEY, {
  staleTime: 5 * 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});

queryClient.setQueryDefaults(['session'], { retry: 0, gcTime: 0 });
queryClient.setQueryDefaults(['userRole'], { retry: 1, gcTime: PERSIST_MAX_AGE_MS });
queryClient.setQueryDefaults(['perm-canViewAll'], { retry: 1, gcTime: PERSIST_MAX_AGE_MS });
queryClient.setQueryDefaults(['profile'], { retry: 1, gcTime: PERSIST_MAX_AGE_MS });

// Cache dehydration serializes on the JS thread. Batch bursts of updates so
// offline durability cannot interrupt taps and navigation every second.
export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  throttleTime: PERSIST_THROTTLE_MS,
  serialize: serializePersistedClient,
});

let listenersConfigured = false;
let maintenanceTimer: ReturnType<typeof setInterval> | null = null;

function getObserverCount(query: any): number {
  try {
    if (typeof query?.getObserversCount === 'function') {
      return Number(query.getObserversCount()) || 0;
    }
  } catch {}
  return 0;
}

function isDurableOfflineQuery(queryKey: any): boolean {
  const key0 = Array.isArray(queryKey) ? queryKey[0] : null;
  const key1 = Array.isArray(queryKey) ? queryKey[1] : null;
  if (key0 === 'requests' && (key1 === 'all' || key1 === 'my' || key1 === 'calendar' || key1 === 'detail')) {
    return true;
  }
  if (key0 === 'orders' && (key1 === 'my' || key1 === 'all') && Array.isArray(queryKey) && queryKey[2] === 'recent') {
    return true;
  }
  if (key0 === 'employees' && (key1 === 'list' || key1 === 'detail' || key1 === 'departments')) {
    return true;
  }
  if (key0 === 'clients' || key0 === 'objects' || key0 === 'tags' || key0 === 'field-settings') {
    return true;
  }
  if (key0 === 'company-order-statuses') {
    return true;
  }
  if (
    key0 === 'company' ||
    key0 === 'department' ||
    (key0 === 'profile' &&
      (key1 === 'me' ||
        key1 === 'company-id' ||
        CANONICAL_UUID_RE.test(String(key1 || '')) ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(String(key1 || ''))))
  ) {
    return true;
  }
  if (
    key0 === 'appSettings' ||
    key0 === 'companyEntitlements' ||
    key0 === 'companyStorageUsage' ||
    key0 === 'companyAccessState' ||
    key0 === 'companyPaidSeatsTotal' ||
    key0 === 'billingMemberStats'
  ) {
    return true;
  }
  if (Array.isArray(queryKey) && Array.isArray(COMPANY_SETTINGS_QUERY_KEY)) {
    return COMPANY_SETTINGS_QUERY_KEY.every((part, index) => queryKey[index] === part);
  }
  return false;
}

function trimQueryCount(maxEntries = QUERY_CACHE_MAX_ENTRIES) {
  const all = queryClient.getQueryCache().getAll();
  if (all.length <= maxEntries) return 0;

  const needToRemove = all.length - maxEntries;
  const removable = all
    .filter((q) => getObserverCount(q) === 0)
    .sort((a, b) => {
      const durableOrder = Number(isDurableOfflineQuery(a.queryKey)) - Number(isDurableOfflineQuery(b.queryKey));
      if (durableOrder !== 0) return durableOrder;
      return (a?.state?.dataUpdatedAt || 0) - (b?.state?.dataUpdatedAt || 0);
    });

  const candidates = removable.slice(0, needToRemove);
  for (const q of candidates) {
    queryClient.removeQueries({ queryKey: q.queryKey, exact: true });
  }
  return candidates.length;
}

function pruneInactiveOldQueries(maxAgeMs = INACTIVE_QUERY_MAX_AGE_MS) {
  const cutoff = Date.now() - maxAgeMs;
  const all = queryClient.getQueryCache().getAll();
  let removed = 0;

  for (const q of all) {
    const isActive = getObserverCount(q) > 0;
    if (isDurableOfflineQuery(q.queryKey)) continue;
    const updatedAt = q?.state?.dataUpdatedAt || 0;
    if (!isActive && updatedAt > 0 && updatedAt < cutoff) {
      queryClient.removeQueries({ queryKey: q.queryKey, exact: true });
      removed += 1;
    }
  }

  return removed;
}

export function runQueryCacheMaintenance() {
  pruneInactiveOldQueries();
  trimQueryCount();
}

function startCacheMaintenance() {
  if (maintenanceTimer) return;
  maintenanceTimer = setInterval(() => {
    runQueryCacheMaintenance();
  }, CACHE_MAINTENANCE_INTERVAL_MS);
}

function stopCacheMaintenance() {
  if (!maintenanceTimer) return;
  clearInterval(maintenanceTimer);
  maintenanceTimer = null;
}

export function configureQueryEnvironment() {
  if (listenersConfigured) return;
  listenersConfigured = true;
  startNetworkQualityMonitoring(AppState.currentState === 'active');

  onlineManager.setEventListener((_setOnline) =>
    NetInfo.addEventListener((state) => {
      setOfflineNetState(state);
    }),
  );

  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener('change', (s) => {
      const isActive = s === 'active';
      handleFocus(isActive);
      setNetworkQualityMonitoringActive(isActive);
      if (isActive) {
        runQueryCacheMaintenance();
        startCacheMaintenance();
      } else {
        stopCacheMaintenance();
      }
    });
    return () => sub.remove();
  });

  runQueryCacheMaintenance();
  startCacheMaintenance();
}

type SerializedDataStats = {
  chars: number;
  hasOfflinePending: boolean;
};

const serializedDataStatsCache = new WeakMap<object, SerializedDataStats>();

function getSerializedDataStats(data: unknown): SerializedDataStats {
  if (data && typeof data === 'object') {
    const cached = serializedDataStatsCache.get(data as object);
    if (cached) return cached;
    try {
      const serialized = JSON.stringify(data);
      const stats = {
        chars: serialized?.length || 0,
        hasOfflinePending: serialized?.includes('"__offlinePending":true') || false,
      };
      serializedDataStatsCache.set(data as object, stats);
      return stats;
    } catch {
      return { chars: Number.POSITIVE_INFINITY, hasOfflinePending: false };
    }
  }
  try {
    return { chars: JSON.stringify(data)?.length || 0, hasOfflinePending: false };
  } catch {
    return { chars: Number.POSITIVE_INFINITY, hasOfflinePending: false };
  }
}

function isPersistableSize(data: unknown, maxBytes: number) {
  return getSerializedDataStats(data).chars <= maxBytes;
}

function getPersistedQueryPriority(query: any) {
  const dataStats = getSerializedDataStats(query?.state?.data);
  if (dataStats.hasOfflinePending) return 0;

  const key = Array.isArray(query?.queryKey) ? query.queryKey : [];
  const key0 = key[0];
  const key1 = key[1];
  if (
    key0 === 'profile' ||
    key0 === 'company' ||
    key0 === 'department' ||
    key0 === 'appSettings' ||
    key0 === 'companyEntitlements' ||
    key0 === 'companyAccessState' ||
    key0 === 'companyPaidSeatsTotal' ||
    key0 === 'billingMemberStats' ||
    key0 === 'company-order-statuses' ||
    key0 === 'field-settings' ||
    key0 === 'tags' ||
    (Array.isArray(COMPANY_SETTINGS_QUERY_KEY) &&
      COMPANY_SETTINGS_QUERY_KEY.every((part, index) => key[index] === part))
  ) {
    return 1;
  }
  if (
    (key0 === 'requests' && (key1 === 'all' || key1 === 'my' || key1 === 'calendar')) ||
    (key0 === 'orders' && (key1 === 'all' || key1 === 'my') && key[2] === 'recent') ||
    (key0 === 'employees' && (key1 === 'list' || key1 === 'departments')) ||
    (key0 === 'clients' && key1 === 'list') ||
    (key0 === 'objects' && (key1 === 'by-company' || key1 === 'by-client'))
  ) {
    return 2;
  }
  if (key1 === 'detail') return 3;
  return 4;
}

function estimatePersistedQueryChars(query: any) {
  const dataChars = getSerializedDataStats(query?.state?.data).chars;
  if (!Number.isFinite(dataChars)) return Number.POSITIVE_INFINITY;
  let keyChars = 0;
  try {
    keyChars = JSON.stringify(query?.queryKey)?.length || 0;
  } catch {}
  return dataChars + keyChars + String(query?.queryHash || '').length + PERSISTED_QUERY_OVERHEAD_CHARS;
}

function sortPersistedQueriesByValue(queries: any[]) {
  return [...queries].sort((left, right) => {
    const priorityDelta = getPersistedQueryPriority(left) - getPersistedQueryPriority(right);
    if (priorityDelta !== 0) return priorityDelta;
    return Number(right?.state?.dataUpdatedAt || 0) - Number(left?.state?.dataUpdatedAt || 0);
  });
}

function compactPersistedClient(persistedClient: any) {
  const queries = Array.isArray(persistedClient?.clientState?.queries)
    ? persistedClient.clientState.queries
    : [];
  if (!queries.length) return persistedClient;

  let fixedChars = 0;
  try {
    fixedChars = JSON.stringify({
      ...persistedClient,
      clientState: {
        ...(persistedClient.clientState || {}),
        queries: [],
      },
    }).length;
  } catch {
    return persistedClient;
  }

  let remainingChars = Math.max(0, PERSIST_TARGET_SERIALIZED_CHARS - fixedChars);
  const selected: any[] = [];
  for (const query of sortPersistedQueriesByValue(queries)) {
    const estimate = estimatePersistedQueryChars(query);
    const isOfflinePending = getSerializedDataStats(query?.state?.data).hasOfflinePending;
    if (isOfflinePending || estimate <= remainingChars) {
      selected.push(query);
      if (Number.isFinite(estimate)) remainingChars = Math.max(0, remainingChars - estimate);
    }
  }

  if (selected.length === queries.length) return persistedClient;
  return {
    ...persistedClient,
    clientState: {
      ...(persistedClient.clientState || {}),
      queries: selected,
    },
  };
}

function serializePersistedClient(persistedClient: any) {
  let compacted = compactPersistedClient(persistedClient);
  let serialized = JSON.stringify(compacted);
  if (serialized.length <= PERSIST_HARD_SERIALIZED_CHARS) return serialized;

  // The estimate intentionally leaves headroom, but unusually large query
  // metadata can still cross the hard bound. Remove the least valuable cached
  // rows in one more pass while retaining optimistic offline state.
  const queries = Array.isArray(compacted?.clientState?.queries)
    ? compacted.clientState.queries
    : [];
  const required = queries.filter(
    (query: any) => getSerializedDataStats(query?.state?.data).hasOfflinePending,
  );
  const optional = sortPersistedQueriesByValue(
    queries.filter((query: any) => !getSerializedDataStats(query?.state?.data).hasOfflinePending),
  );
  let overflow = serialized.length - PERSIST_HARD_SERIALIZED_CHARS;
  while (overflow > 0 && optional.length) {
    const removed = optional.pop();
    try {
      overflow -= Math.max(1, JSON.stringify(removed)?.length || 0);
    } catch {
      overflow = 0;
    }
  }
  compacted = {
    ...compacted,
    clientState: {
      ...(compacted.clientState || {}),
      queries: [...required, ...optional],
    },
  };
  serialized = JSON.stringify(compacted);
  return serialized;
}

export const persistOptions = {
  persister,
  buster: 'offline-v2-auth-scoped-2026-06-03',
  maxAge: PERSIST_MAX_AGE_MS,
  dehydrateOptions: {
    shouldDehydrateQuery: (q) => {
      const key0 = Array.isArray(q.queryKey) ? q.queryKey[0] : null;
      const key1 = Array.isArray(q.queryKey) ? q.queryKey[1] : null;
      if (q.state.status !== 'success') return false;
      if (key0 === 'session' || key0 === 'userRole' || key0 === 'perm-canViewAll') {
        return false;
      }
      if (getSerializedDataStats(q.state.data).hasOfflinePending) return true;
      if (
        key0 === 'profile' &&
        key1 !== 'me' &&
        key1 !== 'company-id' &&
        !CANONICAL_UUID_RE.test(String(key1 || '')) &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(String(key1 || ''))
      ) {
        return false;
      }
      if (key0 === 'requests' && (key1 === 'all' || key1 === 'my' || key1 === 'calendar')) {
        return isPersistableSize(q.state.data, HOT_REQUEST_PERSIST_QUERY_SIZE_LIMIT_BYTES);
      }
      if (key0 === 'orders' && (key1 === 'my' || key1 === 'all') && Array.isArray(q.queryKey) && q.queryKey[2] === 'recent') {
        return isPersistableSize(q.state.data, HOT_REQUEST_PERSIST_QUERY_SIZE_LIMIT_BYTES);
      }
      if (
        (key0 === 'clients' && key1 === 'list') ||
        (key0 === 'objects' && (key1 === 'by-company' || key1 === 'by-client')) ||
        (key0 === 'employees' && key1 === 'list')
      ) {
        return isPersistableSize(q.state.data, HOT_ENTITY_LIST_PERSIST_QUERY_SIZE_LIMIT_BYTES);
      }
      return isDurableOfflineQuery(q.queryKey);
    },
  },
};
