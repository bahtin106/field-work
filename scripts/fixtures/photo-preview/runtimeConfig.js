// Only resolved by test-photo-preview-native.cjs, never by the app's Metro config.
export const APP_RUNTIME_CONFIG = {
  supabaseUrl: 'http://127.0.0.1:8087',
  supabaseAnonKey: 'native-preview-fixture',
};
export const getMissingRuntimeConfigKeys = () => [];
