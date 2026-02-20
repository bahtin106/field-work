import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import React from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';

const CACHE_PREFIX = 'company_entitlements_cache_v1:';

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

export function useCompanyEntitlements(companyId) {
  const queryClient = useQueryClient();
  const [cached, setCached] = React.useState(null);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const prev = await loadCached(companyId);
      if (alive && prev) setCached(prev);
    })();
    return () => {
      alive = false;
    };
  }, [companyId]);

  const query = useQuery({
    queryKey: ['companyEntitlements', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const fresh = await fetchEntitlements(companyId);
      await saveCached(companyId, fresh);
      setCached(fresh);
      return fresh;
    },
    placeholderData: (prev) => prev ?? cached ?? null,
    staleTime: 10 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchInterval: companyId ? 10 * 1000 : false,
    refetchIntervalInBackground: false,
    refetchOnMount: 'always',
  });

  useFocusEffect(
    React.useCallback(() => {
      if (!companyId) return undefined;
      query.refetch();
      return undefined;
    }, [companyId, query]),
  );

  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && companyId) {
        queryClient.invalidateQueries({ queryKey: ['companyEntitlements', companyId] });
      }
    });
    return () => sub.remove();
  }, [companyId, queryClient]);

  return {
    ...query,
    data: query.data ?? cached ?? null,
    refresh: query.refetch,
  };
}
