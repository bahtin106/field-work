require('dotenv').config({ path: '.env.local', quiet: true });
require('dotenv').config({ quiet: true });

const base = require('./app.json');

function trim(value) {
  return String(value || '').trim();
}

function withoutTrailingSlash(value) {
  return trim(value).replace(/\/+$/, '');
}

function readRequired(name, fallbackName = null) {
  return trim(process.env[name] || (fallbackName ? process.env[fallbackName] : ''));
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
