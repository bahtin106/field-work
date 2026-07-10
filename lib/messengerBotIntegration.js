import { supabase } from './supabase';
import {
  clearCachedSupabaseAccessToken,
  getCachedSupabaseAccessToken,
  getFreshSupabaseAccessToken,
} from './supabaseSessionCache';
import { t } from '../src/i18n';

const FUNCTION_BY_PROVIDER = {
  telegram: 'telegram-bot',
  max: 'max-bot',
};

function isSessionLikeError(message) {
  const lowered = String(message || '').toLowerCase();
  return (
    lowered.includes('unauthorized') ||
    lowered.includes('jwt') ||
    lowered.includes('session') ||
    lowered.includes('token expired') ||
    lowered.includes('invalid token')
  );
}

function fallbackMessage(provider) {
  return provider === 'max'
    ? t('company_settings_max_load_failed')
    : t('company_settings_telegram_load_failed');
}

function humanizeMessengerBotError(provider, message) {
  const normalized = String(message || '').trim();
  if (!normalized) return fallbackMessage(provider);

  const lowered = normalized.toLowerCase();
  if (lowered.includes('edge function returned a non-2xx status code')) {
    return fallbackMessage(provider);
  }
  if (isSessionLikeError(lowered)) {
    return t('errors_noAuth');
  }
  if (lowered.includes('forbidden') || lowered.includes('access denied')) {
    return t('errors_noSettingsAccess');
  }
  if (lowered.includes('company not found')) {
    return t('errors_loadSettings');
  }
  if (
    lowered.includes('invalid response was received from the upstream server') ||
    lowered.includes('upstream server') ||
    lowered.includes('failed to fetch') ||
    lowered.includes('network request failed')
  ) {
    return t('errors_network');
  }

  return normalized;
}

function buildErrorMessage(data, fallback) {
  if (!data) return fallback;
  if (typeof data === 'string' && data.trim()) return data.trim();
  if (typeof data?.message === 'string' && data.message.trim()) return data.message.trim();
  if (typeof data?.error === 'string' && data.error.trim()) return data.error.trim();
  return fallback;
}

async function readInvokeErrorMessage(error, fallback) {
  try {
    const response = error?.context?.response || error?.context;
    if (response && typeof response === 'object') {
      const source = typeof response.clone === 'function' ? response.clone() : response;
      if (typeof source.json === 'function') {
        try {
          return buildErrorMessage(await source.json(), fallback);
        } catch {}
      }
      if (typeof source.text === 'function') {
        try {
          return buildErrorMessage(await source.text(), fallback);
        } catch {}
      }
    }
  } catch {}
  return buildErrorMessage(error, fallback);
}

export async function messengerBotIntegration(provider, action, payload = {}) {
  const normalizedProvider = String(provider || '').toLowerCase() === 'max' ? 'max' : 'telegram';
  const functionName = FUNCTION_BY_PROVIDER[normalizedProvider];
  const fallback = fallbackMessage(normalizedProvider);

  let token = await getCachedSupabaseAccessToken();
  if (!token) token = await getFreshSupabaseAccessToken();
  if (!token) throw new Error(t('errors_noAuth'));

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await supabase.functions.invoke(functionName, {
      headers: { Authorization: `Bearer ${token}` },
      body: { action, ...payload },
    });
    if (error) {
      const message = await readInvokeErrorMessage(error, fallback);
      if (attempt === 0 && isSessionLikeError(message)) {
        clearCachedSupabaseAccessToken();
        token = await getFreshSupabaseAccessToken();
        if (token) continue;
      }
      throw new Error(humanizeMessengerBotError(normalizedProvider, message));
    }
    if (!data?.success) {
      const message = buildErrorMessage(data, fallback);
      if (attempt === 0 && isSessionLikeError(message)) {
        clearCachedSupabaseAccessToken();
        token = await getFreshSupabaseAccessToken();
        if (token) continue;
      }
      throw new Error(humanizeMessengerBotError(normalizedProvider, message));
    }
    return data;
  }
  throw new Error(fallback);
}

export const telegramBotIntegration = (action, payload = {}) =>
  messengerBotIntegration('telegram', action, payload);

export const maxBotIntegration = (action, payload = {}) =>
  messengerBotIntegration('max', action, payload);
