import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import { AppState } from 'react-native';
import { COMPANY_SETTINGS_QUERY_KEY } from '../../../lib/companySettingsQuery';

const DEFAULT_REFOCUS_ENABLED = false;
const QUERY_CACHE_MAX_ENTRIES = 350;
const INACTIVE_QUERY_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const CACHE_MAINTENANCE_INTERVAL_MS = 3 * 60 * 1000;
const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const HOT_REQUEST_PERSIST_QUERY_SIZE_LIMIT_BYTES = 350 * 1024;
const DEFAULT_QUERY_STALE_MS = 60 * 1000;
const DEFAULT_QUERY_GC_MS = 30 * 60 * 1000;
const DEFAULT_MAX_RETRIES = 2;

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
      keepPreviousData: true,
      placeholderData: (prev) => prev,
      staleTime: DEFAULT_QUERY_STALE_MS,
      gcTime: DEFAULT_QUERY_GC_MS,
      retry: shouldRetryQuery,
      retryDelay,
      refetchOnMount: false,
      refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
      refetchOnReconnect: false,
      networkMode: 'online',
    },
    mutations: {
      retry: 1,
      networkMode: 'online',
    },
  },
});

queryClient.setQueryDefaults(['requests', 'all'], {
  staleTime: 20 * 1000,
  gcTime: 30 * 60 * 1000,
  refetchOnReconnect: true,
});
queryClient.setQueryDefaults(['requests', 'my'], {
  staleTime: 20 * 1000,
  gcTime: 30 * 60 * 1000,
  refetchOnReconnect: true,
});
queryClient.setQueryDefaults(['requests', 'calendar'], {
  staleTime: 20 * 1000,
  gcTime: 30 * 60 * 1000,
  refetchOnReconnect: true,
});
queryClient.setQueryDefaults(['requests', 'detail'], {
  staleTime: 45 * 1000,
  gcTime: 45 * 60 * 1000,
  refetchOnReconnect: true,
});
queryClient.setQueryDefaults(['employees', 'list'], {
  staleTime: 60 * 1000,
  gcTime: 45 * 60 * 1000,
});
queryClient.setQueryDefaults(['employees', 'detail'], {
  staleTime: 120 * 1000,
  gcTime: 45 * 60 * 1000,
});
queryClient.setQueryDefaults(['employees', 'departments'], {
  staleTime: 10 * 60 * 1000,
  gcTime: 60 * 60 * 1000,
});
queryClient.setQueryDefaults(['clients'], {
  staleTime: 45 * 1000,
  gcTime: 45 * 60 * 1000,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['objects'], {
  staleTime: 45 * 1000,
  gcTime: 45 * 60 * 1000,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['finance'], {
  staleTime: 30 * 1000,
  gcTime: 30 * 60 * 1000,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['appSettings'], {
  staleTime: 2 * 60 * 1000,
  gcTime: 30 * 60 * 1000,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['companyEntitlements'], {
  staleTime: 60 * 1000,
  gcTime: 30 * 60 * 1000,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['companyStorageUsage'], {
  staleTime: 60 * 1000,
  gcTime: 30 * 60 * 1000,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['companyAccessState'], {
  staleTime: 60 * 1000,
  gcTime: 30 * 60 * 1000,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['companyPaidSeatsTotal'], {
  staleTime: 60 * 1000,
  gcTime: 30 * 60 * 1000,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['billingMemberStats'], {
  staleTime: 60 * 1000,
  gcTime: 30 * 60 * 1000,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['adminCompanies'], {
  staleTime: 60 * 1000,
  gcTime: 30 * 60 * 1000,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['adminCompany'], {
  staleTime: 60 * 1000,
  gcTime: 30 * 60 * 1000,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['adminCompanySubscriptionMeta'], {
  staleTime: 60 * 1000,
  gcTime: 30 * 60 * 1000,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['adminUsers'], {
  staleTime: 60 * 1000,
  gcTime: 30 * 60 * 1000,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['tags'], {
  staleTime: 30 * 1000,
  gcTime: 30 * 60 * 1000,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['field-settings'], {
  staleTime: 5 * 60 * 1000,
  gcTime: 60 * 60 * 1000,
  refetchOnWindowFocus: false,
});
queryClient.setQueryDefaults(COMPANY_SETTINGS_QUERY_KEY, {
  staleTime: 5 * 60 * 1000,
  gcTime: 30 * 60 * 1000,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});

queryClient.setQueryDefaults(['session'], { retry: 0, gcTime: 0, cacheTime: 0 });
queryClient.setQueryDefaults(['userRole'], { retry: 1, gcTime: 5 * 60 * 1000 });
queryClient.setQueryDefaults(['perm-canViewAll'], { retry: 1, gcTime: 5 * 60 * 1000 });
queryClient.setQueryDefaults(['profile'], { retry: 1, gcTime: 5 * 60 * 1000 });

export const persister = createAsyncStoragePersister({ storage: AsyncStorage });

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

function trimQueryCount(maxEntries = QUERY_CACHE_MAX_ENTRIES) {
  const all = queryClient.getQueryCache().getAll();
  if (all.length <= maxEntries) return 0;

  const needToRemove = all.length - maxEntries;
  const removable = all
    .filter((q) => getObserverCount(q) === 0)
    .sort((a, b) => (a?.state?.dataUpdatedAt || 0) - (b?.state?.dataUpdatedAt || 0));

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

  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) =>
      setOnline(Boolean(state.isConnected) && state.isInternetReachable !== false),
    ),
  );

  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener('change', (s) => {
      const isActive = s === 'active';
      handleFocus(isActive);
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

export const persistOptions = {
  persister,
  buster: 'perf-policy-v2-2026-03-20',
  maxAge: PERSIST_MAX_AGE_MS,
  dehydrateOptions: {
    shouldDehydrateQuery: (q) => {
      const key0 = Array.isArray(q.queryKey) ? q.queryKey[0] : null;
      const key1 = Array.isArray(q.queryKey) ? q.queryKey[1] : null;
      if (key0 === 'session' || key0 === 'userRole' || key0 === 'profile' || key0 === 'perm-canViewAll') {
        return false;
      }
      if (key0 === 'requests' && (key1 === 'all' || key1 === 'my' || key1 === 'calendar')) {
        if (q.state.status !== 'success') return false;
        try {
          const serialized = JSON.stringify(q.state.data);
          return serialized.length <= HOT_REQUEST_PERSIST_QUERY_SIZE_LIMIT_BYTES;
        } catch {
          return false;
        }
      }
      return q.state.status === 'success';
    },
  },
};
