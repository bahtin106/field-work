import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import { AppState } from 'react-native';

const QUERY_CACHE_MAX_ENTRIES = 350;
const INACTIVE_QUERY_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const CACHE_MAINTENANCE_INTERVAL_MS = 3 * 60 * 1000;
const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      keepPreviousData: true,
      placeholderData: (prev) => prev,
      staleTime: 30 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: 1,
      refetchOnMount: 'stale',
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      networkMode: 'online',
    },
    mutations: {
      retry: 1,
      networkMode: 'online',
    },
  },
});

queryClient.setQueryDefaults(['requests', 'all'], { staleTime: 20 * 1000, gcTime: 30 * 60 * 1000 });
queryClient.setQueryDefaults(['requests', 'my'], { staleTime: 20 * 1000, gcTime: 30 * 60 * 1000 });
queryClient.setQueryDefaults(['requests', 'calendar'], {
  staleTime: 20 * 1000,
  gcTime: 30 * 60 * 1000,
});
queryClient.setQueryDefaults(['requests', 'detail'], {
  staleTime: 45 * 1000,
  gcTime: 45 * 60 * 1000,
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
    NetInfo.addEventListener((state) => setOnline(!!state.isConnected)),
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
  buster: 'perf-policy-v1-2026-02-19',
  maxAge: PERSIST_MAX_AGE_MS,
  dehydrateOptions: {
    shouldDehydrateQuery: (q) => {
      const key0 = Array.isArray(q.queryKey) ? q.queryKey[0] : null;
      const key1 = Array.isArray(q.queryKey) ? q.queryKey[1] : null;
      if (key0 === 'session' || key0 === 'userRole' || key0 === 'profile' || key0 === 'perm-canViewAll') {
        return false;
      }
      if (
        key0 === 'requests' &&
        (key1 === 'all' || key1 === 'my' || key1 === 'calendar')
      ) {
        return false;
      }
      return q.state.status === 'success';
    },
  },
};
