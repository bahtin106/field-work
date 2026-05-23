import { APP_RUNTIME_CONFIG } from '../config/appRuntime';

const FALLBACK_WEBSITE_URL = 'https://monitorapp.ru';

function joinUrl(baseUrl, path) {
  const base = String(baseUrl || FALLBACK_WEBSITE_URL).replace(/\/+$/, '');
  const nextPath = String(path || '').replace(/^\/+/, '');
  return `${base}/${nextPath}`;
}

export function getEmailChangeRedirectUrl() {
  return joinUrl(APP_RUNTIME_CONFIG.billingWebsiteUrl || FALLBACK_WEBSITE_URL, '/email-change');
}

export function getBillingPortalUrl() {
  return joinUrl(APP_RUNTIME_CONFIG.billingWebsiteUrl || FALLBACK_WEBSITE_URL, '/billing');
}
