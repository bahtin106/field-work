import { clearCompanyIdCache } from '../hooks/useMyCompanyId';
import { persister, queryClient } from '../src/shared/query/queryClient';
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
    if (globalThis.PERM_CACHE && typeof globalThis.PERM_CACHE === 'object') {
      globalThis.PERM_CACHE.canViewAll = { value: null, ts: 0 };
    }
  } catch {}

  try {
    delete globalThis.__MYORDERS_FEED_FP;
    delete globalThis.__MYORDERS_FEED_SEEN_FP;
    delete globalThis.__MYORDERS_FEED_HAS_ANY;
  } catch {}
}

export async function cleanupSessionRuntime(_reason = 'auth-transition') {
  if (cleanupInFlight) {
    return cleanupInFlight;
  }

  cleanupInFlight = (async () => {
    try {
      queryClient.clear();
    } catch {}

    try {
      queryClient.getMutationCache?.().clear?.();
    } catch {}

    try {
      await withTimeout(queryClient.cancelQueries(), 800);
    } catch {}

    try {
      await withTimeout(persister.removeClient?.(), 1200);
    } catch {}

    try {
      globalCache.clear();
    } catch {}

    try {
      clearCompanyIdCache();
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
