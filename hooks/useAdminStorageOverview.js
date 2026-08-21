import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import React from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import { withReadDeadline } from '../src/shared/network/readDeadline';
import {
  canRunDeferredNetworkWork,
  useOfflineSnapshot,
} from '../src/shared/offline/offlineStatus';

const ADMIN_STORAGE_STALE_MS = 10 * 60 * 1000;
const ADMIN_STORAGE_QUERY_KEY = ['adminStorageOverview'];

async function fetchAdminStorageOverview(signal) {
  const { data, error } = await supabase
    .rpc('admin_get_storage_overview')
    .abortSignal(signal);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export function useAdminStorageOverview(enabled = true) {
  const isFocused = useIsFocused();
  const offlineSnapshot = useOfflineSnapshot();
  const networkRefreshable = canRunDeferredNetworkWork(offlineSnapshot);
  const query = useQuery({
    queryKey: ADMIN_STORAGE_QUERY_KEY,
    enabled: enabled && networkRefreshable,
    queryFn: ({ signal }) =>
      withReadDeadline(
        (readSignal) => fetchAdminStorageOverview(readSignal),
        { label: 'Admin storage overview', signal },
      ),
    placeholderData: (prev) => prev ?? [],
    staleTime: ADMIN_STORAGE_STALE_MS,
    gcTime: 20 * 60 * 1000,
    refetchInterval: enabled && isFocused && networkRefreshable ? ADMIN_STORAGE_STALE_MS : false,
    refetchIntervalInBackground: false,
    refetchOnMount: 'stale',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });
  const { refetch, dataUpdatedAt } = query;

  useFocusEffect(
    React.useCallback(() => {
      if (!enabled || !networkRefreshable) return undefined;
      if (!dataUpdatedAt || Date.now() - dataUpdatedAt >= ADMIN_STORAGE_STALE_MS) refetch();
      return undefined;
    }, [dataUpdatedAt, enabled, networkRefreshable, refetch]),
  );

  React.useEffect(() => {
    if (!enabled || !networkRefreshable) return undefined;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refetch();
      }
    });
    return () => sub.remove();
  }, [enabled, networkRefreshable, refetch]);

  return {
    ...query,
    data: query.data ?? [],
  };
}
