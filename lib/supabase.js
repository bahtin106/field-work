// lib/supabase.js
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

const EXTRA = Constants.expoConfig?.extra || Constants.manifest?.extra || {};
const supabaseUrl = EXTRA.supabaseUrl;
const supabaseAnonKey = EXTRA.supabaseAnonKey;

if (!supabaseUrl || !supabaseAnonKey) {
  // Поможет быстрее отлавливать конфиг‑ошибки
  globalThis?.console?.warn?.(
    '[supabase] Missing supabaseUrl or supabaseAnonKey in app.json → expo.extra',
  );
}

// Сохраняем сессию между перезапусками приложения
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage, // персист в AsyncStorage
    autoRefreshToken: true, // автообновление токена
    persistSession: true, // сохранять сессию на диск
    detectSessionInUrl: false, // для React Native редиректы не нужны
  },
});
