import { supabase } from './supabase';
import {
  clearCachedSupabaseAccessToken,
  getCachedSupabaseAccessToken,
  getFreshSupabaseAccessToken,
} from './supabaseSessionCache';

const INTEGRATION_FALLBACK = 'Не удалось выполнить действие Яндекс Диска.';
const MEDIA_FALLBACK = 'Не удалось выполнить действие с фото в Яндекс Диске.';

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

function humanizeYandexError(message, fallback) {
  const normalized = String(message || '').trim();
  if (!normalized) return fallback;
  const lowered = normalized.toLowerCase();
  if (isSessionLikeError(lowered)) return 'Сессия истекла. Войдите снова.';
  if (
    lowered.includes('failed to fetch') ||
    lowered.includes('network request failed') ||
    lowered.includes('upstream server') ||
    lowered.includes('invalid response was received')
  ) {
    return 'Временная ошибка связи с Яндекс Диском. Попробуйте ещё раз.';
  }
  if (lowered.includes('yandex disk not connected')) return 'Яндекс Диск не подключён.';
  if (lowered.includes('missing yandex oauth')) return 'Не настроены OAuth-ключи Яндекс Диска на сервере.';
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

export async function yandexDiskIntegration(action, payload = {}) {
  return invokeYandexFunction('yandex-disk-integration', { action, ...payload }, INTEGRATION_FALLBACK);
}

export async function yandexDiskMedia(action, payload = {}) {
  return invokeYandexFunction('yandex-disk-media', { action, ...payload }, MEDIA_FALLBACK);
}

async function invokeYandexFunction(functionName, body, fallback) {
  let token = await getCachedSupabaseAccessToken();
  if (!token) token = await getFreshSupabaseAccessToken();
  if (!token) throw new Error('Сессия истекла. Войдите снова.');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await supabase.functions.invoke(functionName, {
      headers: { Authorization: `Bearer ${token}` },
      body,
    });

    if (error) {
      const message = await readInvokeErrorMessage(error, fallback);
      if (attempt === 0 && isSessionLikeError(message)) {
        clearCachedSupabaseAccessToken();
        token = await getFreshSupabaseAccessToken();
        if (token) continue;
      }
      throw new Error(humanizeYandexError(message, fallback));
    }

    if (!data?.success) {
      const message = buildErrorMessage(data, fallback);
      if (attempt === 0 && isSessionLikeError(message)) {
        clearCachedSupabaseAccessToken();
        token = await getFreshSupabaseAccessToken();
        if (token) continue;
      }
      throw new Error(humanizeYandexError(message, fallback));
    }

    return data;
  }

  throw new Error(fallback);
}
