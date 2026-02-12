// lib/supabase.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import 'react-native-url-polyfill/auto';

const EXTRA = Constants.expoConfig?.extra || Constants.manifest?.extra || {};
const supabaseUrl = EXTRA.supabaseUrl;
const supabaseAnonKey = EXTRA.supabaseAnonKey;
const supabaseServiceKey = EXTRA.supabaseServiceKey;
const emailServiceUrl = EXTRA.emailServiceUrl;

if (!supabaseUrl || !supabaseAnonKey) {
  // Поможет быстрее отлавливать конфиг‑ошибки
  globalThis?.console?.warn?.(
    '[supabase] Missing supabaseUrl or supabaseAnonKey in app.json → expo.extra',
  );
}

console.log('[supabase] Connecting to:', supabaseUrl?.replace(/https?:\/\//, ''));
console.log('[supabase] ANON_KEY (first 50 chars):', supabaseAnonKey?.substring(0, 50) + '...');
console.log('[supabase] ANON_KEY (last 20 chars):', '...' + supabaseAnonKey?.substring(supabaseAnonKey.length - 20));
console.log('[supabase] Email API URL:', emailServiceUrl || 'not configured');

// Сохраняем сессию между перезапусками приложения
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage, // персист в AsyncStorage
    autoRefreshToken: true, // автообновление токена
    persistSession: true, // сохранять сессию на диск
    detectSessionInUrl: false, // для React Native редиректы не нужны
    storageKey: 'supabase.auth.token', // явно задаём ключ для хранения
  },
});

// Admin client для операций с service_role ключом
export const supabaseAdmin = supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

// Export email service URL for use in other modules
export const EMAIL_SERVICE_URL = emailServiceUrl || 'https://api.monitorapp.ru';
