import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import React from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import { useOfflineSnapshot } from '../src/shared/offline/offlineStatus';
import { withReadDeadline } from '../src/shared/network/readDeadline';

const STORAGE_USAGE_STALE_MS = 60 * 1000;
const STORAGE_USAGE_GC_MS = 14 * 24 * 60 * 60 * 1000;

async function fetchCompanyStorageUsage(companyId, forceRefresh = false, signal = undefined) {
  if (!companyId) return null;
  let request = supabase.rpc('get_company_storage_usage', {
    p_company_id: companyId,
    p_force_refresh: !!forceRefresh,
  });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}

export function useCompanyStorageUsage(companyId) {
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const offlineSnapshot = useOfflineSnapshot();
  const networkRefreshable =
    offlineSnapshot.isNetworkKnown &&
    offlineSnapshot.isOnline &&
    !offlineSnapshot.isPoorConnection;

  const query = useQuery({
    queryKey: ['companyStorageUsage', companyId],
    enabled: !!companyId && networkRefreshable,
    queryFn: ({ signal }) =>
      withReadDeadline(
        (readSignal) => fetchCompanyStorageUsage(companyId, false, readSignal),
        { label: 'Company storage usage', signal },
      ),
    placeholderData: (prev) => prev ?? null,
    staleTime: STORAGE_USAGE_STALE_MS,
    gcTime: STORAGE_USAGE_GC_MS,
    refetchInterval:
      companyId && isFocused && networkRefreshable ? STORAGE_USAGE_STALE_MS : false,
    refetchIntervalInBackground: false,
    refetchOnMount: 'stale',
    retry: 1,
  });
  const { dataUpdatedAt, refetch } = query;

  const refresh = React.useCallback(async () => {
    if (!companyId) return null;
    const fresh = await withReadDeadline(
      (signal) => fetchCompanyStorageUsage(companyId, true, signal),
      { label: 'Company storage usage refresh' },
    );
    queryClient.setQueryData(['companyStorageUsage', companyId], fresh);
    return fresh;
  }, [companyId, queryClient]);

  useFocusEffect(
    React.useCallback(() => {
      if (!companyId || !networkRefreshable) return undefined;
      if (!dataUpdatedAt || Date.now() - dataUpdatedAt >= STORAGE_USAGE_STALE_MS) {
        refetch();
      }
      return undefined;
    }, [companyId, dataUpdatedAt, networkRefreshable, refetch]),
  );

  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && companyId && isFocused && networkRefreshable) {
        queryClient.invalidateQueries({ queryKey: ['companyStorageUsage', companyId] });
      }
    });
    return () => sub.remove();
  }, [companyId, isFocused, networkRefreshable, queryClient]);

  return {
    ...query,
    data: query.data ?? null,
    refresh,
  };
}
