/* global __DEV__, console */

// lib/supabase.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import 'react-native-url-polyfill/auto';

const EXTRA = Constants.expoConfig?.extra || Constants.manifest?.extra || {};
const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : false;
const supabaseUrl = EXTRA.supabaseUrl;
const supabaseAnonKey = EXTRA.supabaseAnonKey;
const emailServiceUrl = EXTRA.emailServiceUrl;

if (!supabaseUrl || !supabaseAnonKey) {
  globalThis?.console?.warn?.(
    '[supabase] Missing supabaseUrl or supabaseAnonKey in app.json -> expo.extra',
  );
}

if (isDev) {
  console.debug('[supabase] Connecting to:', supabaseUrl?.replace(/https?:\/\//, ''));
  console.debug('[supabase] Email API URL:', emailServiceUrl || 'not configured');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    storageKey: 'supabase.auth.token',
  },
});

export const EMAIL_SERVICE_URL = emailServiceUrl || 'https://api.monitorapp.ru';
