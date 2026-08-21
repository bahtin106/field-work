import { supabase } from './supabase';
import { getCachedSupabaseAccessToken } from './supabaseSessionCache';
import { t } from '../src/i18n';
import { canRunDeferredNetworkWork } from '../src/shared/offline/offlineStatus';

function buildErrorMessage(data, fallback) {
  if (!data) return fallback;
  if (typeof data === 'string' && data.trim()) return data.trim();
  if (typeof data?.message === 'string' && data.message.trim()) return data.message.trim();
  if (typeof data?.error === 'string' && data.error.trim()) return data.error.trim();
  return fallback;
}

async function readInvokeErrorMessage(error, fallback) {
  try {
    const response = error?.context;
    if (response && typeof response === 'object') {
      const source = typeof response.clone === 'function' ? response.clone() : response;
      if (typeof source.json === 'function') {
        try {
          const payload = await source.json();
          return buildErrorMessage(payload, fallback);
        } catch {}
      }
      if (typeof source.text === 'function') {
        try {
          const text = await source.text();
          return buildErrorMessage(text, fallback);
        } catch {}
      }
    }
  } catch {}
  return buildErrorMessage(error, fallback);
}

async function invokeFunction(functionName, fallback, action, payload = {}) {
  if (!canRunDeferredNetworkWork()) {
    const error = new Error(t('errors_network'));
    error.code = 'NETWORK_QUALITY_REQUIRED';
    throw error;
  }
  const token = await getCachedSupabaseAccessToken();
  if (!token) {
    throw new Error(t('errors_noAuth'));
  }

  const { data, error } = await supabase.functions.invoke(functionName, {
    headers: { Authorization: `Bearer ${token}` },
    body: { action, ...payload },
  });

  if (error) {
    throw new Error(await readInvokeErrorMessage(error, fallback));
  }
  if (!data?.success) {
    throw new Error(buildErrorMessage(data, fallback));
  }
  return data;
}

export async function financeEntryMediaStorage(action, payload = {}) {
  return invokeFunction(
    'finance-entry-media-storage',
    'Finance entry media storage action failed',
    action,
    payload,
  );
}

export async function financeEntryYandexMedia(action, payload = {}) {
  return invokeFunction(
    'finance-entry-yandex-media',
    'Finance entry Yandex media action failed',
    action,
    payload,
  );
}
