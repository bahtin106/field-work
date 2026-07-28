// lib/supabase.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';
import 'react-native-url-polyfill/auto';
import { APP_RUNTIME_CONFIG, getMissingRuntimeConfigKeys } from '../config/appRuntime';
import { createLogger } from './logger';

const log = createLogger('supabase');
const SECURESTORE_CHUNK_META_SUFFIX = '.__chunks';
const SECURESTORE_CHUNK_KEY_SUFFIX = '.__chunk.';
const SECURESTORE_MAX_CHUNKS = 64;
const ASYNC_STORAGE_AUTHORITY_SUFFIX = '.__async_storage_authoritative';
const supabaseUrl = APP_RUNTIME_CONFIG.supabaseUrl;
const supabaseAnonKey = APP_RUNTIME_CONFIG.supabaseAnonKey;
const emailServiceUrl = APP_RUNTIME_CONFIG.emailServiceUrl;

const missingConfigKeys = getMissingRuntimeConfigKeys();
if (missingConfigKeys.length) {
  log.warn('Missing runtime config keys:', missingConfigKeys);
}

log.debug('Connecting to runtime config', {
  hasSupabaseUrl: !!supabaseUrl,
  hasSupabaseAnonKey: !!supabaseAnonKey,
  hasEmailServiceUrl: !!emailServiceUrl,
});

const getChunkMetaKey = (key) => `${key}${SECURESTORE_CHUNK_META_SUFFIX}`;
const getChunkKey = (key, index) => `${key}${SECURESTORE_CHUNK_KEY_SUFFIX}${index}`;
const getAsyncStorageAuthorityKey = (key) => `${key}${ASYNC_STORAGE_AUTHORITY_SUFFIX}`;

async function readSecureStoreChunks(key) {
  const rawCount = await SecureStore.getItemAsync(getChunkMetaKey(key));
  const count = Number(rawCount || 0);
  if (!Number.isInteger(count) || count <= 0 || count > SECURESTORE_MAX_CHUNKS) return null;

  const chunks = [];
  for (let index = 0; index < count; index += 1) {
    const chunk = await SecureStore.getItemAsync(getChunkKey(key, index));
    if (chunk == null) return null;
    chunks.push(chunk);
  }
  return chunks.join('');
}

async function cleanupSecureStoreChunks(key, startIndex = 0) {
  const rawCount = await SecureStore.getItemAsync(getChunkMetaKey(key));
  const count = Number(rawCount || 0);
  const safeCount = Number.isInteger(count) && count > 0 && count <= SECURESTORE_MAX_CHUNKS ? count : 0;
  const deleteCount = Math.max(safeCount, startIndex);

  await SecureStore.deleteItemAsync(getChunkMetaKey(key));
  for (let index = 0; index < deleteCount; index += 1) {
    await SecureStore.deleteItemAsync(getChunkKey(key, index));
  }
}

async function cleanupLegacySecureStoreValue(key) {
  try {
    await SecureStore.deleteItemAsync(key);
    await cleanupSecureStoreChunks(key);
  } catch (error) {
    // The legacy encrypted copy is no longer authoritative. Some old Android
    // keystores can fail to decrypt/delete it, so cleanup must never break auth.
    log.warn('Legacy SecureStore cleanup failed:', error?.message || error);
  }
}

const sessionStorage = {
  async getItem(key) {
    if (Platform.OS === 'web') return AsyncStorage.getItem(key);

    const asyncValue = await AsyncStorage.getItem(key);
    if (asyncValue != null) return asyncValue;

    // Once AsyncStorage has become authoritative, never resurrect a stale
    // SecureStore session after an explicit sign-out.
    const authorityMarker = await AsyncStorage.getItem(getAsyncStorageAuthorityKey(key));
    if (authorityMarker === '1') return null;

    try {
      const chunkedValue = await readSecureStoreChunks(key);
      const legacyValue = chunkedValue ?? (await SecureStore.getItemAsync(key));
      if (legacyValue == null) return null;

      // One-time migration from the former chunked SecureStore adapter.
      // Supabase's supported React Native storage is AsyncStorage; persisting it
      // before cleanup prevents a slow/fragile Android keystore from losing an
      // otherwise valid session.
      await AsyncStorage.multiSet([
        [key, legacyValue],
        [getAsyncStorageAuthorityKey(key), '1'],
      ]);
      void cleanupLegacySecureStoreValue(key);
      return legacyValue;
    } catch (error) {
      log.warn('Legacy SecureStore session read failed:', error?.message || error);
      return null;
    }
  },
  async setItem(key, value) {
    if (Platform.OS === 'web') return AsyncStorage.setItem(key, value);
    await AsyncStorage.multiSet([
      [key, String(value ?? '')],
      [getAsyncStorageAuthorityKey(key), '1'],
    ]);
    void cleanupLegacySecureStoreValue(key);
  },
  async removeItem(key) {
    if (Platform.OS === 'web') return AsyncStorage.removeItem(key);
    // Write the authority marker first so a failed legacy cleanup can never
    // restore the just-signed-out account on the next app launch.
    await AsyncStorage.setItem(getAsyncStorageAuthorityKey(key), '1');
    await AsyncStorage.removeItem(key);
    void cleanupLegacySecureStoreValue(key);
  },
};

const SUPABASE_AUTH_STORAGE_KEY = 'supabase.auth.token';

export async function clearPersistedAuthSession() {
  await sessionStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
}

/**
 * Reads the persisted local auth snapshot without forcing a network refresh.
 * This is used only to keep an already signed-in mobile user in the authenticated
 * shell while Supabase retries an expired token on a weak/offline connection.
 */
export async function readPersistedAuthSession() {
  const rawSession = await sessionStorage.getItem(SUPABASE_AUTH_STORAGE_KEY);
  if (!rawSession) return null;

  try {
    const session = JSON.parse(rawSession);
    const hasRequiredIdentity =
      session &&
      typeof session === 'object' &&
      typeof session.access_token === 'string' &&
      session.access_token.length > 0 &&
      typeof session.refresh_token === 'string' &&
      session.refresh_token.length > 0 &&
      typeof session.user?.id === 'string' &&
      session.user.id.length > 0;
    return hasRequiredIdentity ? session : null;
  } catch {
    return null;
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: sessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    storageKey: SUPABASE_AUTH_STORAGE_KEY,
    lock: processLock,
  },
});

// On React Native the SDK cannot infer foreground/background state. Keeping
// refresh work in the foreground avoids stale background races and resumes it
// as soon as the user returns to the app.
if (Platform.OS !== 'web') {
  try {
    globalThis.__MONITOR_SUPABASE_AUTH_APP_STATE_SUBSCRIPTION__?.remove?.();
  } catch {}
  globalThis.__MONITOR_SUPABASE_AUTH_APP_STATE_SUBSCRIPTION__ = AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}

export const EMAIL_SERVICE_URL = emailServiceUrl;
