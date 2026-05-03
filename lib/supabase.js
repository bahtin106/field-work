/* global __DEV__, console */

// lib/supabase.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import 'react-native-url-polyfill/auto';
import { APP_RUNTIME_CONFIG, getMissingRuntimeConfigKeys } from '../config/appRuntime';

const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : false;
const SECURESTORE_SAFE_VALUE_LIMIT = 1800;
const supabaseUrl = APP_RUNTIME_CONFIG.supabaseUrl;
const supabaseAnonKey = APP_RUNTIME_CONFIG.supabaseAnonKey;
const emailServiceUrl = APP_RUNTIME_CONFIG.emailServiceUrl;

const missingConfigKeys = getMissingRuntimeConfigKeys();
if (missingConfigKeys.length) {
  globalThis?.console?.warn?.(
    `[supabase] Missing runtime config: ${missingConfigKeys.join(', ')}`,
  );
}

if (isDev) {
  console.debug('[supabase] Connecting to:', supabaseUrl?.replace(/https?:\/\//, ''));
  console.debug('[supabase] Email API URL:', emailServiceUrl || 'not configured');
}

const secureSessionStorage = {
  async getItem(key) {
    if (Platform.OS === 'web') return AsyncStorage.getItem(key);
    const secureValue = await SecureStore.getItemAsync(key);
    if (secureValue != null) return secureValue;
    return AsyncStorage.getItem(key);
  },
  async setItem(key, value) {
    if (Platform.OS === 'web') return AsyncStorage.setItem(key, value);
    const normalizedValue = String(value ?? '');
    if (normalizedValue.length > SECURESTORE_SAFE_VALUE_LIMIT) {
      await AsyncStorage.setItem(key, normalizedValue);
      try {
        await SecureStore.deleteItemAsync(key);
      } catch (error) {
        if (isDev) console.warn('[supabase] SecureStore cleanup failed:', error?.message || error);
      }
      return;
    }
    await SecureStore.setItemAsync(key, normalizedValue, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {
      if (isDev) console.warn('[supabase] AsyncStorage cleanup failed:', error?.message || error);
    }
  },
  async removeItem(key) {
    if (Platform.OS === 'web') return AsyncStorage.removeItem(key);
    await Promise.allSettled([SecureStore.deleteItemAsync(key), AsyncStorage.removeItem(key)]);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureSessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    storageKey: 'supabase.auth.token',
  },
});

export const EMAIL_SERVICE_URL = emailServiceUrl;
