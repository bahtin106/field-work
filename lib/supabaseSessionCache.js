import { supabase } from './supabase';

const ACCESS_TOKEN_CACHE_TTL_MS = 20 * 1000;
const ACCESS_TOKEN_EXPIRY_SAFETY_MS = 60 * 1000;

let cachedAccessToken = '';
let cachedAccessTokenUntil = 0;
let accessTokenPromise = null;

export async function getCachedSupabaseAccessToken() {
  const now = Date.now();
  if (cachedAccessToken && cachedAccessTokenUntil > now) {
    return cachedAccessToken;
  }
  if (accessTokenPromise) {
    return accessTokenPromise;
  }

  accessTokenPromise = (async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token ? String(session.access_token) : '';
    if (!token) {
      cachedAccessToken = '';
      cachedAccessTokenUntil = 0;
      return '';
    }

    const expiresAtMs = Number(session?.expires_at || 0) * 1000;
    const tokenSafeUntil = expiresAtMs > now ? expiresAtMs - ACCESS_TOKEN_EXPIRY_SAFETY_MS : 0;
    cachedAccessToken = token;
    cachedAccessTokenUntil = tokenSafeUntil > now
      ? Math.min(now + ACCESS_TOKEN_CACHE_TTL_MS, tokenSafeUntil)
      : now + ACCESS_TOKEN_CACHE_TTL_MS;
    return token;
  })();

  try {
    return await accessTokenPromise;
  } finally {
    accessTokenPromise = null;
  }
}

export async function getFreshSupabaseAccessToken() {
  clearCachedSupabaseAccessToken();
  try {
    const {
      data: { session },
    } = await supabase.auth.refreshSession();
    const token = session?.access_token ? String(session.access_token) : '';
    if (token) {
      const now = Date.now();
      const expiresAtMs = Number(session?.expires_at || 0) * 1000;
      const tokenSafeUntil = expiresAtMs > now ? expiresAtMs - ACCESS_TOKEN_EXPIRY_SAFETY_MS : 0;
      cachedAccessToken = token;
      cachedAccessTokenUntil = tokenSafeUntil > now
        ? Math.min(now + ACCESS_TOKEN_CACHE_TTL_MS, tokenSafeUntil)
        : now + ACCESS_TOKEN_CACHE_TTL_MS;
      return token;
    }
  } catch {}
  return getCachedSupabaseAccessToken();
}

export function clearCachedSupabaseAccessToken() {
  cachedAccessToken = '';
  cachedAccessTokenUntil = 0;
  accessTokenPromise = null;
}
