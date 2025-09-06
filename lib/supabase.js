// lib/supabase.js
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://fopalcvzdkftsvhqszcx.supabase.co';
const supabaseAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvcGFsY3Z6ZGtmdHN2aHFzemN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQyOTk5OTIsImV4cCI6MjA2OTg3NTk5Mn0.GJ7W9E_Oap78oBtDTl_ATpb1zcz3UI-dl7x9Ujv9QlY';

// Сохраняем сессию между перезапусками приложения
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage, // персист в AsyncStorage
    autoRefreshToken: true, // автообновление токена
    persistSession: true, // сохранять сессию на диск
    detectSessionInUrl: false, // для React Native редиректы не нужны
  },
});
