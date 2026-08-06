require('dotenv').config({ path: '.env.local', quiet: true });
require('dotenv').config({ quiet: true });

const base = require('./app.json');

const PRODUCTION_ENVIRONMENTS = new Set(['production', 'preview']);

function trim(value) {
  return String(value || '').trim();
}

function withoutTrailingSlash(value) {
  return trim(value).replace(/\/+$/, '');
}

function readRequired(name, fallbackName = null) {
  return trim(process.env[name] || (fallbackName ? process.env[fallbackName] : ''));
}

function isProductionLikeBuild() {
  return (
    PRODUCTION_ENVIRONMENTS.has(trim(process.env.NODE_ENV).toLowerCase()) ||
    PRODUCTION_ENVIRONMENTS.has(trim(process.env.EAS_BUILD_PROFILE).toLowerCase())
  );
}

function assertProductionValue(name, value) {
  if (isProductionLikeBuild() && !value) {
    throw new Error(`Missing required production app config value: ${name}`);
  }
}

function readJwtClaims(value) {
  const parts = trim(value).split('.');
  if (parts.length !== 3) return null;

  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function assertPublicSupabaseKey(value) {
  const claims = readJwtClaims(value);

  if (claims?.role === 'service_role') {
    throw new Error(
      'Refusing to expose a Supabase service-role key in the public Expo app configuration.',
    );
  }
}

module.exports = ({ config } = {}) => {
  const baseExpoConfig = config || base.expo || {};
  const supabaseUrl = withoutTrailingSlash(readRequired('EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'));
  const supabaseAnonKey = readRequired('EXPO_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY');
  const emailServiceUrl = withoutTrailingSlash(
    readRequired('EXPO_PUBLIC_EMAIL_SERVICE_URL', 'EMAIL_SERVICE_URL') ||
      readRequired('API_EXTERNAL_URL'),
  );
  const billingWebsiteUrl = withoutTrailingSlash(readRequired('EXPO_PUBLIC_BILLING_WEBSITE_URL'));

  assertProductionValue('EXPO_PUBLIC_SUPABASE_URL or SUPABASE_URL', supabaseUrl);
  assertProductionValue('EXPO_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_ANON_KEY', supabaseAnonKey);
  assertProductionValue('EXPO_PUBLIC_EMAIL_SERVICE_URL, EMAIL_SERVICE_URL, or API_EXTERNAL_URL', emailServiceUrl);
  assertPublicSupabaseKey(supabaseAnonKey);

  return {
    ...baseExpoConfig,
    extra: {
      ...(baseExpoConfig.extra || {}),
      supabaseUrl,
      supabaseAnonKey,
      emailServiceUrl,
      billingWebsiteUrl,
    },
  };
};
