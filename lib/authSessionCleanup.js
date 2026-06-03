import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearCompanyIdCache } from '../hooks/useMyCompanyId';
import { clearOrderMediaCaches } from '../hooks/useOrderMedia';
import { persister, queryClient } from '../src/shared/query/queryClient';
import { resetSmartPrefetchRuntime } from '../src/shared/query/smartPrefetch';
import appReadyState from './appReadyState';
import { globalCache } from './cache/DataCache';

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
    if (globalThis.PERM_CACHE && typeof globalThis.PERM_CACHE === 'object') {
      globalThis.PERM_CACHE.canViewAll = { value: null, ts: 0 };
    }
  } catch {}

  try {
    delete globalThis.__MYORDERS_FEED_FP;
    delete globalThis.__MYORDERS_FEED_SEEN_FP;
    delete globalThis.__MYORDERS_FEED_HAS_ANY;
  } catch {}

  try {
    if (globalThis.EXECUTOR_NAME_CACHE?.clear) {
      globalThis.EXECUTOR_NAME_CACHE.clear();
    }
  } catch {}
}

async function clearAppScopedPersistentCaches() {
  const exactKeys = [
    'orders.my.listCache.v2',
    'myorders_feed_seen_fp',
    'myorders_feed_last_fp',
  ];
  const prefixes = [
    'orders.my.listCache.v3:',
    'myorders.feedSeen.v2:',
    'myorders.feedLastFp.v2:',
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
