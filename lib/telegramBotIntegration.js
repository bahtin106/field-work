import { supabase } from './supabase';

function humanizeTelegramBotError(message) {
  const normalized = String(message || '').trim();
  if (!normalized) return 'Не удалось загрузить настройки Telegram-бота.';

  const lowered = normalized.toLowerCase();
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
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = String(session?.access_token || '');
  if (!token) {
    throw new Error('Сессия истекла. Войдите снова.');
  }
  const { data, error } = await supabase.functions.invoke('telegram-bot', {
    headers: { Authorization: `Bearer ${token}` },
    body: { action, ...payload },
  });
  if (error) {
    throw new Error(humanizeTelegramBotError(await readInvokeErrorMessage(error, 'Telegram bot integration failed')));
  }
  if (!data?.success) {
    throw new Error(humanizeTelegramBotError(buildErrorMessage(data, 'Telegram bot integration failed')));
  }
  return data;
}
