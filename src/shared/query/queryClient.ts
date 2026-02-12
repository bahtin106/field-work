import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import { AppState } from 'react-native';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      keepPreviousData: true,
      placeholderData: (prev) => prev,
      staleTime: 30 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: 1,
      refetchOnMount: 'stale',
      refetchOnWindowFocus: true,
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

export function configureQueryEnvironment() {
  if (listenersConfigured) return;
  listenersConfigured = true;

  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => setOnline(!!state.isConnected)),
  );

  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener('change', (s) => handleFocus(s === 'active'));
    return () => sub.remove();
  });
}

export const persistOptions = {
  persister,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  dehydrateOptions: {
    shouldDehydrateQuery: (q) => {
      const key0 = Array.isArray(q.queryKey) ? q.queryKey[0] : null;
      if (key0 === 'session' || key0 === 'userRole' || key0 === 'profile' || key0 === 'perm-canViewAll') {
        return false;
      }
      return q.state.status === 'success';
    },
  },
};
