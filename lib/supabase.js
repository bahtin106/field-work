// lib/supabase.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';
import 'react-native-url-polyfill/auto';
import { APP_RUNTIME_CONFIG, getMissingRuntimeConfigKeys } from '../config/appRuntime';
import { createLogger } from './logger';

const log = createLogger('supabase');
const SECURESTORE_SAFE_VALUE_LIMIT = 1800;
const SECURESTORE_CHUNK_META_SUFFIX = '.__chunks';
const SECURESTORE_CHUNK_KEY_SUFFIX = '.__chunk.';
const SECURESTORE_MAX_CHUNKS = 64;
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

async function readSecureStoreChunks(key) {
  const rawCount = await SecureStore.getItemAsync(getChunkMetaKey(key));
  const count = Number(rawCount || 0);
  if (!Number.isInteger(count) || count <= 0 || count > SECURESTORE_MAX_CHUNKS) return null;

  const chunks = await Promise.all(
    Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(getChunkKey(key, index))),
  );
  if (chunks.some((chunk) => chunk == null)) return null;
  return chunks.join('');
}

async function cleanupSecureStoreChunks(key, startIndex = 0) {
  const rawCount = await SecureStore.getItemAsync(getChunkMetaKey(key));
  const count = Number(rawCount || 0);
  const safeCount = Number.isInteger(count) && count > 0 && count <= SECURESTORE_MAX_CHUNKS ? count : 0;
  const deleteCount = Math.max(safeCount, startIndex);

  await Promise.allSettled([
    SecureStore.deleteItemAsync(getChunkMetaKey(key)),
    ...Array.from({ length: deleteCount }, (_, index) => SecureStore.deleteItemAsync(getChunkKey(key, index))),
  ]);
}

async function writeSecureStoreValue(key, value) {
  const normalizedValue = String(value ?? '');
  if (normalizedValue.length <= SECURESTORE_SAFE_VALUE_LIMIT) {
    await SecureStore.setItemAsync(key, normalizedValue, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    await cleanupSecureStoreChunks(key);
    return;
  }

  const chunks = [];
  for (let index = 0; index < normalizedValue.length; index += SECURESTORE_SAFE_VALUE_LIMIT) {
    chunks.push(normalizedValue.slice(index, index + SECURESTORE_SAFE_VALUE_LIMIT));
  }

  if (chunks.length > SECURESTORE_MAX_CHUNKS) {
    throw new Error('SecureStore value exceeds chunk storage limit');
  }

  const previousRawCount = await SecureStore.getItemAsync(getChunkMetaKey(key));
  const previousCount = Number(previousRawCount || 0);
  await Promise.all(
    chunks.map((chunk, index) =>
      SecureStore.setItemAsync(getChunkKey(key, index), chunk, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
    ),
  );
  await SecureStore.setItemAsync(getChunkMetaKey(key), String(chunks.length), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  await SecureStore.deleteItemAsync(key);

  if (Number.isInteger(previousCount) && previousCount > chunks.length) {
    await Promise.allSettled(
      Array.from({ length: previousCount - chunks.length }, (_, offset) =>
        SecureStore.deleteItemAsync(getChunkKey(key, chunks.length + offset)),
      ),
    );
  }
}

const secureSessionStorage = {
  async getItem(key) {
    if (Platform.OS === 'web') return AsyncStorage.getItem(key);
    const chunkedValue = await readSecureStoreChunks(key);
    if (chunkedValue != null) return chunkedValue;
    const secureValue = await SecureStore.getItemAsync(key);
    if (secureValue != null) return secureValue;
    return AsyncStorage.getItem(key);
  },
  async setItem(key, value) {
    if (Platform.OS === 'web') return AsyncStorage.setItem(key, value);
    await writeSecureStoreValue(key, value);
    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {
      log.warn('AsyncStorage cleanup failed:', error?.message || error);
    }
  },
  async removeItem(key) {
    if (Platform.OS === 'web') return AsyncStorage.removeItem(key);
    await Promise.allSettled([
      SecureStore.deleteItemAsync(key),
      cleanupSecureStoreChunks(key),
      AsyncStorage.removeItem(key),
    ]);
  },
};

const SUPABASE_AUTH_STORAGE_KEY = 'supabase.auth.token';

export async function clearPersistedAuthSession() {
  await secureSessionStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
}

/**
 * Reads the encrypted local auth snapshot without forcing a network refresh.
 * This is used only to keep an already signed-in mobile user in the authenticated
 * shell while Supabase retries an expired token on a weak/offline connection.
 */
export async function readPersistedAuthSession() {
  const rawSession = await secureSessionStorage.getItem(SUPABASE_AUTH_STORAGE_KEY);
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
    storage: secureSessionStorage,
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
