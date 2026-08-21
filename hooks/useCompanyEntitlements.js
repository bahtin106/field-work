import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import React from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import { withReadDeadline } from '../src/shared/network/readDeadline';
import { useOfflineSnapshot } from '../src/shared/offline/offlineStatus';

const CACHE_PREFIX = 'company_entitlements_cache_v1:';
const ENTITLEMENTS_STALE_MS = 2 * 60 * 1000;
const ENTITLEMENTS_GC_MS = 14 * 24 * 60 * 60 * 1000;
const liveSubscriptions = new Map();

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

async function fetchEntitlements(companyId, signal = undefined) {
  if (!companyId) return null;
  let request = supabase.rpc('get_company_entitlements', {
    p_company_id: companyId,
  });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}

function getEntitlementsQueryKey(companyId) {
  return ['companyEntitlements', companyId];
}

function refreshEntitlementsQuery(queryClient, companyId) {
  return queryClient.invalidateQueries({
    queryKey: getEntitlementsQueryKey(companyId),
    exact: true,
    refetchType: 'active',
  });
}

function normalizeTimestamp(value) {
  const parsed = new Date(String(value || '')).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function subscriptionStateChanged(cachedEntitlements, subscriptionRow) {
  if (!subscriptionRow || typeof subscriptionRow !== 'object') return true;
  if (!cachedEntitlements || typeof cachedEntitlements !== 'object') return true;

  if (
    normalizeTimestamp(subscriptionRow.current_period_end) !==
    normalizeTimestamp(cachedEntitlements.current_period_end)
  ) {
    return true;
  }

  const nextStatus = String(subscriptionRow.status || '').trim().toLowerCase();
  const cachedStatus = String(cachedEntitlements.status || '').trim().toLowerCase();
  if (nextStatus && cachedStatus && nextStatus !== cachedStatus) return true;

  const cachedAllowedSeats = Number(cachedEntitlements.allowed_seats);
  const nextAllowedSeats = Number(subscriptionRow.paid_seats_total);
  if (
    cachedEntitlements.allowed_seats !== null &&
    cachedEntitlements.allowed_seats !== undefined &&
    Number.isFinite(cachedAllowedSeats) &&
    Number.isFinite(nextAllowedSeats) &&
    cachedAllowedSeats !== nextAllowedSeats
  ) {
    return true;
  }

  return false;
}

function releaseEntitlementsSubscription(companyId) {
  const key = String(companyId || '').trim();
  const entry = liveSubscriptions.get(key);
  if (!entry) return;

  entry.refs -= 1;
  if (entry.refs > 0) return;

  liveSubscriptions.delete(key);
  entry.appStateSubscription?.remove?.();
  try {
    supabase.removeChannel(entry.channel);
  } catch {}
}

function acquireEntitlementsSubscription(queryClient, companyId) {
  const key = String(companyId || '').trim();
  if (!key) return () => {};

  const existing = liveSubscriptions.get(key);
  if (existing) {
    existing.refs += 1;
    return () => releaseEntitlementsSubscription(key);
  }

  let refreshInFlight = null;
  const refresh = (payload = null) => {
    if (
      payload?.new &&
      !subscriptionStateChanged(
        queryClient.getQueryData(getEntitlementsQueryKey(key)),
        payload.new,
      )
    ) {
      return refreshInFlight || Promise.resolve();
    }
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = refreshEntitlementsQuery(queryClient, key)
      .catch(() => {})
      .finally(() => {
        refreshInFlight = null;
      });
    return refreshInFlight;
  };
  let subscribedOnce = false;
  const channel = supabase
    .channel(`company-entitlements-${key}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'company_subscriptions',
        filter: `company_id=eq.${key}`,
      },
      refresh,
    )
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      if (subscribedOnce) refresh();
      subscribedOnce = true;
    });
  const appStateSubscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') refresh();
  });

  liveSubscriptions.set(key, {
    refs: 1,
    channel,
    appStateSubscription,
  });
  return () => releaseEntitlementsSubscription(key);
}

export function useCompanyEntitlements(companyId, options = {}) {
  const { enabled = true } = options || {};
  const queryClient = useQueryClient();
  const offlineSnapshot = useOfflineSnapshot();
  const networkRefreshable =
    offlineSnapshot.isNetworkKnown &&
    offlineSnapshot.isOnline &&
    !offlineSnapshot.isPoorConnection;
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
    queryKey: getEntitlementsQueryKey(companyId),
    enabled: enabled && !!companyId && networkRefreshable,
    queryFn: async ({ signal }) => {
      const fresh = await withReadDeadline(
        (readSignal) => fetchEntitlements(companyId, readSignal),
        { label: 'Company entitlements', signal },
      );
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
    if (!enabled || !companyId || !networkRefreshable) return;
    const state = queryClient.getQueryState(getEntitlementsQueryKey(companyId));
    const updatedAt = Number(state?.dataUpdatedAt || 0);
    if (updatedAt && Date.now() - updatedAt < ENTITLEMENTS_STALE_MS) return;
    refetch();
  }, [companyId, enabled, networkRefreshable, queryClient, refetch]);

  useFocusEffect(
    React.useCallback(() => {
      if (!enabled || !companyId || !networkRefreshable) return undefined;
      refetchIfStale();
      return undefined;
    }, [companyId, enabled, networkRefreshable, refetchIfStale]),
  );

  React.useEffect(() => {
    if (!enabled || !companyId || !networkRefreshable) return undefined;
    return acquireEntitlementsSubscription(queryClient, companyId);
  }, [companyId, enabled, networkRefreshable, queryClient]);

  return {
    ...query,
    data: query.data ?? cached ?? null,
    hasFreshData,
    refresh: refetch,
  };
}
