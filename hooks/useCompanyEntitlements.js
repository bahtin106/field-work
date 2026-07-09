import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import React from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';

const CACHE_PREFIX = 'company_entitlements_cache_v1:';
const ENTITLEMENTS_STALE_MS = 2 * 60 * 1000;
const ENTITLEMENTS_GC_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * @typedef {Object} CompanyEntitlements
 * @property {string} company_id
 * @property {boolean} is_owner
 * @property {string|null} plan_code
 * @property {string|null} plan_name
 * @property {string} status
 * @property {string|null} current_period_end
 * @property {number} grace_period_days
 * @property {boolean} can_edit
 * @property {number} days_left
 * @property {number|null} allowed_seats
 * @property {number} used_seats
 * @property {number|null} allowed_storage_gb
 * @property {number|null} used_storage_gb
 * @property {Record<string, boolean>} features
 * @property {Record<string, unknown>} addons
 */

function getCacheKey(companyId) {
  return `${CACHE_PREFIX}${companyId || 'unknown'}`;
}

async function loadCached(companyId) {
  if (!companyId) return null;
  try {
    const raw = await AsyncStorage.getItem(getCacheKey(companyId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveCached(companyId, data) {
  if (!companyId || !data) return;
  try {
    await AsyncStorage.setItem(getCacheKey(companyId), JSON.stringify(data));
  } catch {}
}

async function fetchEntitlements(companyId) {
  if (!companyId) return null;
  const { data, error } = await supabase.rpc('get_company_entitlements', {
    p_company_id: companyId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}

export function useCompanyEntitlements(companyId, options = {}) {
  const { enabled = true } = options || {};
  const queryClient = useQueryClient();
  const [cacheEntry, setCacheEntry] = React.useState({ companyId: null, data: null });
  const [freshEntry, setFreshEntry] = React.useState({ companyId: null, hasFreshData: false });
  const cached = cacheEntry.companyId === companyId ? cacheEntry.data : null;
  const hasFreshData =
    freshEntry.companyId === companyId ? freshEntry.hasFreshData : false;

  React.useEffect(() => {
    setFreshEntry({ companyId: companyId || null, hasFreshData: false });
  }, [companyId]);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const prev = await loadCached(companyId);
      if (alive) setCacheEntry({ companyId: companyId || null, data: prev || null });
    })();
    return () => {
      alive = false;
    };
  }, [companyId]);

  const query = useQuery({
    queryKey: ['companyEntitlements', companyId],
    enabled: enabled && !!companyId,
    queryFn: async () => {
      const fresh = await fetchEntitlements(companyId);
      await saveCached(companyId, fresh);
      setCacheEntry({ companyId: companyId || null, data: fresh || null });
      setFreshEntry({ companyId: companyId || null, hasFreshData: true });
      return fresh;
    },
    placeholderData: (prev) => prev ?? cached ?? null,
    staleTime: ENTITLEMENTS_STALE_MS,
    gcTime: ENTITLEMENTS_GC_MS,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    refetchOnMount: false,
  });
  const { refetch } = query;

  const refetchIfStale = React.useCallback(() => {
    if (!enabled || !companyId) return;
    const state = queryClient.getQueryState(['companyEntitlements', companyId]);
    const updatedAt = Number(state?.dataUpdatedAt || 0);
    if (updatedAt && Date.now() - updatedAt < ENTITLEMENTS_STALE_MS) return;
    refetch();
  }, [companyId, enabled, queryClient, refetch]);

  useFocusEffect(
    React.useCallback(() => {
      if (!enabled || !companyId) return undefined;
      refetchIfStale();
      return undefined;
    }, [companyId, enabled, refetchIfStale]),
  );

  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && enabled && companyId) {
        refetchIfStale();
      }
    });
    return () => sub.remove();
  }, [companyId, enabled, refetchIfStale]);

  return {
    ...query,
    data: query.data ?? cached ?? null,
    hasFreshData,
    refresh: refetch,
  };
}
