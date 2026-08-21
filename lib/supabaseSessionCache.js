import { supabase } from './supabase';

const ACCESS_TOKEN_CACHE_TTL_MS = 20 * 1000;
const ACCESS_TOKEN_EXPIRY_SAFETY_MS = 60 * 1000;

let cachedAccessToken = '';
let cachedAccessTokenUntil = 0;
let cachedAccessTokenUserId = '';
let accessTokenPromise = null;
let tokenCacheGeneration = 0;
let observedAuthUserId = '';
let observedAuthReady = false;

const normalizeUserId = (value) => String(value || '').trim().toLowerCase();

function invalidateAccessTokenCache({ resetObservedAuth = true } = {}) {
  tokenCacheGeneration += 1;
  cachedAccessToken = '';
  cachedAccessTokenUntil = 0;
  cachedAccessTokenUserId = '';
  accessTokenPromise = null;
  if (resetObservedAuth) {
    observedAuthUserId = '';
    observedAuthReady = false;
  }
}

function isExpectedUser(userId, expectedUserId) {
  const expected = normalizeUserId(expectedUserId);
  return !expected || (!!userId && userId === expected);
}

function canReuseCachedToken(expectedUserId, now) {
  if (!cachedAccessToken || cachedAccessTokenUntil <= now || !cachedAccessTokenUserId) {
    return false;
  }
  if (!isExpectedUser(cachedAccessTokenUserId, expectedUserId)) return false;
  if (observedAuthReady && cachedAccessTokenUserId !== observedAuthUserId) return false;
  return true;
}

// Invalidate synchronously on every Supabase auth transition. The generation
// guard below prevents a getSession() started before this callback from
// repopulating the cache after logout/account switching.
try {
  supabase.auth.onAuthStateChange((_event, session) => {
    invalidateAccessTokenCache({ resetObservedAuth: false });
    observedAuthUserId = normalizeUserId(session?.user?.id);
    observedAuthReady = true;
  });
} catch {}

export async function getCachedSupabaseAccessToken(expectedUserId = null) {
  const now = Date.now();
  const expected = normalizeUserId(expectedUserId);
  if (canReuseCachedToken(expected, now)) {
    return cachedAccessToken;
  }

  // A cached token for a different expected owner is never returned. Rotate
  // the generation before reading the SDK session so no concurrent old read
  // can win the race and restore it.
  if (cachedAccessToken && expected && cachedAccessTokenUserId !== expected) {
    invalidateAccessTokenCache({ resetObservedAuth: false });
  }

  const activePromise = accessTokenPromise;
  if (activePromise?.generation === tokenCacheGeneration) {
    const result = await activePromise.promise;
    return isExpectedUser(result?.userId, expected) ? String(result?.token || '') : '';
  }

  const generationAtStart = tokenCacheGeneration;
  const promise = (async () => {
    let session = null;
    try {
      const result = await supabase.auth.getSession();
      session = result?.data?.session || null;
    } catch {
      return { token: '', userId: '', stale: false };
    }

    if (generationAtStart !== tokenCacheGeneration) {
      return { token: '', userId: '', stale: true };
    }

    const userId = normalizeUserId(session?.user?.id);
    const token = session?.access_token ? String(session.access_token) : '';
    if (!token || !userId) {
      invalidateAccessTokenCache({ resetObservedAuth: false });
      observedAuthUserId = userId;
      observedAuthReady = true;
      return { token: '', userId, stale: false };
    }

    const expiresAtMs = Number(session?.expires_at || 0) * 1000;
    if (expiresAtMs > 0 && expiresAtMs - ACCESS_TOKEN_EXPIRY_SAFETY_MS <= now) {
      invalidateAccessTokenCache({ resetObservedAuth: false });
      observedAuthUserId = userId;
      observedAuthReady = true;
      return { token: '', userId, stale: false };
    }
    if (generationAtStart !== tokenCacheGeneration) {
      return { token: '', userId: '', stale: true };
    }

    const tokenSafeUntil = expiresAtMs > now ? expiresAtMs - ACCESS_TOKEN_EXPIRY_SAFETY_MS : 0;
    cachedAccessToken = token;
    cachedAccessTokenUserId = userId;
    cachedAccessTokenUntil = tokenSafeUntil > now
      ? Math.min(now + ACCESS_TOKEN_CACHE_TTL_MS, tokenSafeUntil)
      : now + ACCESS_TOKEN_CACHE_TTL_MS;
    observedAuthUserId = userId;
    observedAuthReady = true;
    return { token, userId, stale: false };
  })();
  accessTokenPromise = { generation: generationAtStart, promise };

  try {
    const result = await promise;
    if (result?.stale || generationAtStart !== tokenCacheGeneration) return '';
    return isExpectedUser(result?.userId, expected) ? String(result?.token || '') : '';
  } finally {
    if (accessTokenPromise?.promise === promise) {
      accessTokenPromise = null;
    }
  }
}

export async function getFreshSupabaseAccessToken(expectedUserId = null) {
  clearCachedSupabaseAccessToken();
  try {
    await supabase.auth.refreshSession();
  } catch {}
  // TOKEN_REFRESHED may fire during refreshSession. Start a new generation and
  // read the final SDK session instead of storing a potentially superseded JWT.
  clearCachedSupabaseAccessToken();
  return getCachedSupabaseAccessToken(expectedUserId);
}

export function clearCachedSupabaseAccessToken() {
  invalidateAccessTokenCache();
}
