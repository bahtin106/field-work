import Constants from 'expo-constants';

const EXTRA = Constants.expoConfig?.extra || Constants.manifest?.extra || {};

function trim(value) {
  return String(value || '').trim();
}

function trimTrailingSlash(value) {
  return trim(value).replace(/\/+$/, '');
}

function readPublicEnv(name) {
  return trim(process.env?.[name]);
}

// Production has one Supabase origin. Keep it out of environment precedence so
// an old EAS/local variable cannot silently redirect the app to a hosted project.
export const CANONICAL_SUPABASE_URL = 'https://supabase.monitorapp.ru';

export const APP_RUNTIME_CONFIG = Object.freeze({
  supabaseUrl: CANONICAL_SUPABASE_URL,
  supabaseAnonKey:
    readPublicEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY') ||
    readPublicEnv('SUPABASE_ANON_KEY') ||
    trim(EXTRA.supabaseAnonKey),
  emailServiceUrl: trimTrailingSlash(
    readPublicEnv('EXPO_PUBLIC_EMAIL_SERVICE_URL') ||
      readPublicEnv('EMAIL_SERVICE_URL') ||
      EXTRA.emailServiceUrl,
  ),
  billingWebsiteUrl: trimTrailingSlash(
    readPublicEnv('EXPO_PUBLIC_BILLING_WEBSITE_URL') ||
      EXTRA.billingWebsiteUrl,
  ),
});

export function getMissingRuntimeConfigKeys() {
  return Object.entries({
    supabaseUrl: APP_RUNTIME_CONFIG.supabaseUrl,
    supabaseAnonKey: APP_RUNTIME_CONFIG.supabaseAnonKey,
  })
    .filter(([, value]) => !value)
    .map(([key]) => key);
}
