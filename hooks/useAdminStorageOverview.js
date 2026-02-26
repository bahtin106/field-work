import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import React from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';

const ADMIN_STORAGE_STALE_MS = 10 * 60 * 1000;
const ADMIN_STORAGE_QUERY_KEY = ['adminStorageOverview'];

async function fetchAdminStorageOverview() {
  const { data, error } = await supabase.rpc('admin_get_storage_overview');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export function useAdminStorageOverview(enabled = true) {
  const query = useQuery({
    queryKey: ADMIN_STORAGE_QUERY_KEY,
    enabled,
    queryFn: fetchAdminStorageOverview,
    placeholderData: (prev) => prev ?? [],
    staleTime: ADMIN_STORAGE_STALE_MS,
    gcTime: 20 * 60 * 1000,
    refetchInterval: enabled ? ADMIN_STORAGE_STALE_MS : false,
    refetchIntervalInBackground: false,
    refetchOnMount: 'stale',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 1,
  });

  useFocusEffect(
    React.useCallback(() => {
      if (!enabled) return undefined;
      query.refetch();
      return undefined;
    }, [enabled, query]),
  );

  React.useEffect(() => {
    if (!enabled) return undefined;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        query.refetch();
      }
    });
    return () => sub.remove();
  }, [enabled, query]);

  return {
    ...query,
    data: query.data ?? [],
  };
}
