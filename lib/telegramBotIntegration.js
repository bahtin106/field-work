import { supabase } from './supabase';
import {
  clearCachedSupabaseAccessToken,
  getCachedSupabaseAccessToken,
  getFreshSupabaseAccessToken,
} from './supabaseSessionCache';

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

function humanizeTelegramBotError(message) {
  const normalized = String(message || '').trim();
  if (!normalized) return 'Не удалось загрузить настройки Telegram-бота.';

  const lowered = normalized.toLowerCase();
  if (isSessionLikeError(lowered)) {
    return 'Сессия истекла. Войдите снова.';
  }
  if (
    lowered.includes('invalid response was received from the upstream server') ||
    lowered.includes('upstream server') ||
    lowered.includes('failed to fetch') ||
    lowered.includes('network request failed')
  ) {
    return 'Временная ошибка загрузки настроек. Попробуйте открыть страницу ещё раз.';
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
    const response = error?.context;
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

export async function telegramBotIntegration(action, payload = {}) {
  let token = await getCachedSupabaseAccessToken();
  if (!token) token = await getFreshSupabaseAccessToken();
  if (!token) throw new Error('Сессия истекла. Войдите снова.');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await supabase.functions.invoke('telegram-bot', {
      headers: { Authorization: `Bearer ${token}` },
      body: { action, ...payload },
    });
    if (error) {
      const message = await readInvokeErrorMessage(error, 'Не удалось загрузить настройки Telegram-бота.');
      if (attempt === 0 && isSessionLikeError(message)) {
        clearCachedSupabaseAccessToken();
        token = await getFreshSupabaseAccessToken();
        if (token) continue;
      }
      throw new Error(humanizeTelegramBotError(message));
    }
    if (!data?.success) {
      const message = buildErrorMessage(data, 'Не удалось загрузить настройки Telegram-бота.');
      if (attempt === 0 && isSessionLikeError(message)) {
        clearCachedSupabaseAccessToken();
        token = await getFreshSupabaseAccessToken();
        if (token) continue;
      }
      throw new Error(humanizeTelegramBotError(message));
    }
    return data;
  }
  throw new Error('Не удалось загрузить настройки Telegram-бота.');
}
