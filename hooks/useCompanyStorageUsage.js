import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import React from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';

const STORAGE_USAGE_STALE_MS = 60 * 1000;

async function fetchCompanyStorageUsage(companyId, forceRefresh = false) {
  if (!companyId) return null;
  const { data, error } = await supabase.rpc('get_company_storage_usage', {
    p_company_id: companyId,
    p_force_refresh: !!forceRefresh,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}

export function useCompanyStorageUsage(companyId) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['companyStorageUsage', companyId],
    enabled: !!companyId,
    queryFn: () => fetchCompanyStorageUsage(companyId, false),
    placeholderData: (prev) => prev ?? null,
    staleTime: STORAGE_USAGE_STALE_MS,
    gcTime: 5 * 60 * 1000,
    refetchInterval: companyId ? STORAGE_USAGE_STALE_MS : false,
    refetchIntervalInBackground: false,
    refetchOnMount: 'stale',
    retry: 1,
  });

  const refresh = React.useCallback(async () => {
    if (!companyId) return null;
    const fresh = await fetchCompanyStorageUsage(companyId, true);
    queryClient.setQueryData(['companyStorageUsage', companyId], fresh);
    return fresh;
  }, [companyId, queryClient]);

  useFocusEffect(
    React.useCallback(() => {
      if (!companyId) return undefined;
      queryClient.invalidateQueries({ queryKey: ['companyStorageUsage', companyId] });
      return undefined;
    }, [companyId, queryClient]),
  );

  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && companyId) {
        queryClient.invalidateQueries({ queryKey: ['companyStorageUsage', companyId] });
      }
    });
    return () => sub.remove();
  }, [companyId, queryClient]);

  return {
    ...query,
    data: query.data ?? null,
    refresh,
  };
}
