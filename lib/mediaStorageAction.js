import { supabase } from './supabase';
import { getCachedSupabaseAccessToken } from './supabaseSessionCache';
import { t } from '../src/i18n';

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

export async function invokeMediaStorageAction(functionName, action, payload = {}, fallbackMessage = 'Media storage action failed') {
  const token = await getCachedSupabaseAccessToken();
  if (!token) {
    throw new Error(t('errors_noAuth'));
  }

  const { data, error } = await supabase.functions.invoke(functionName, {
    headers: { Authorization: `Bearer ${token}` },
    body: { action, ...payload },
  });

  if (error) {
    throw new Error(await readInvokeErrorMessage(error, fallbackMessage));
  }
  if (!data?.success) {
    throw new Error(buildErrorMessage(data, fallbackMessage));
  }
  return data;
}
