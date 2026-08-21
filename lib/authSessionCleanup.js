import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearCompanyIdCache } from './myCompanyIdCache';
import { clearOrderMediaCaches } from '../hooks/useOrderMedia';
import { clearExecutorNameCache } from '../src/features/requests/executorNameCache';
import {
  clearActiveQueryCacheOwner,
  persister,
  queryClient,
} from '../src/shared/query/queryClient';
import { resetSmartPrefetchRuntime } from '../src/shared/query/smartPrefetch';
import appReadyState from './appReadyState';
import { globalCache } from './cache/DataCache';
import { ACCESS_SNAPSHOT_STORAGE_PREFIXES } from './accessSnapshot';
import { clearActiveOfflineOwner } from '../src/shared/offline/offlineStatus';
import { clearCachedSupabaseAccessToken } from './supabaseSessionCache';

let cleanupInFlight = null;

function withTimeout(promise, ms = 1200) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]);
}

function resetGlobalRuntimeCaches() {
  try {
    globalThis.LIST_CACHE = {};
  } catch {}

  try {
    globalThis.__MYORDERS_FEED_STATE = {};
  } catch {}

  try {
    delete globalThis.__MYORDERS_FEED_FP;
    delete globalThis.__MYORDERS_FEED_SEEN_FP;
    delete globalThis.__MYORDERS_FEED_HAS_ANY;
  } catch {}

  try {
    clearExecutorNameCache();
  } catch {}
}

async function clearAppScopedPersistentCaches() {
  const exactKeys = [
    'orders.my.listCache.v2',
    'myorders_feed_seen_fp',
    'myorders_feed_last_fp',
    'requests.executorNames.v1',
  ];
  const prefixes = [
    'orders.my.listCache.v3:',
    'orders.my.listCache.v4:',
    'orders.my.statusUsage.v1:',
    'orders.all.statusUsage.v1:',
    'myorders.feedSeen.v2:',
    'myorders.feedLastFp.v2:',
    ...ACCESS_SNAPSHOT_STORAGE_PREFIXES,
  ];

  try {
    const keys = await AsyncStorage.getAllKeys();
    const keysToRemove = keys.filter(
      (key) => exactKeys.includes(key) || prefixes.some((prefix) => String(key || '').startsWith(prefix)),
    );
    if (keysToRemove.length) {
      await AsyncStorage.multiRemove(keysToRemove);
    }
  } catch {}
}

export async function cleanupSessionRuntime(_reason = 'auth-transition') {
  if (cleanupInFlight) {
    return cleanupInFlight;
  }

  cleanupInFlight = (async () => {
    // Invalidate queued/throttled persistence before touching either the
    // in-memory cache or its disk snapshot. The persister rechecks this epoch
    // immediately before and after AsyncStorage writes.
    clearActiveQueryCacheOwner();
    clearActiveOfflineOwner();
    clearCachedSupabaseAccessToken();

    try {
      resetSmartPrefetchRuntime();
    } catch {}

    try {
      await withTimeout(queryClient.cancelQueries(), 800);
    } catch {}

    try {
      queryClient.getMutationCache?.().clear?.();
    } catch {}

    try {
      queryClient.clear();
    } catch {}

    try {
      await withTimeout(persister.removeClient?.(), 1200);
    } catch {}

    try {
      await withTimeout(clearAppScopedPersistentCaches(), 1200);
    } catch {}

    try {
      globalCache.clear();
    } catch {}

    try {
      clearCompanyIdCache();
    } catch {}

    try {
      await withTimeout(clearOrderMediaCaches(), 1200);
    } catch {}

    resetGlobalRuntimeCaches();

    try {
      appReadyState.reset();
    } catch {}
  })().finally(() => {
    cleanupInFlight = null;
  });

  return cleanupInFlight;
}

export default cleanupSessionRuntime;
