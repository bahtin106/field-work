import { supabase } from './supabase';

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
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token ? String(session.access_token) : '';
  if (!token) {
    throw new Error('Сессия истекла. Войдите снова.');
  }
  const { data, error } = await supabase.functions.invoke('yandex-disk-integration', {
    headers: { Authorization: `Bearer ${token}` },
    body: { action, ...payload },
  });
  if (error) {
    throw new Error(await readInvokeErrorMessage(error, 'Yandex Disk integration failed'));
  }
  if (!data?.success) {
    throw new Error(buildErrorMessage(data, 'Yandex Disk integration failed'));
  }
  return data;
}

export async function yandexDiskMedia(action, payload = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token ? String(session.access_token) : '';
  if (!token) {
    throw new Error('Сессия истекла. Войдите снова.');
  }
  const { data, error } = await supabase.functions.invoke('yandex-disk-media', {
    headers: { Authorization: `Bearer ${token}` },
    body: { action, ...payload },
  });
  if (error) {
    throw new Error(await readInvokeErrorMessage(error, 'Yandex Disk media action failed'));
  }
  if (!data?.success) {
    throw new Error(buildErrorMessage(data, 'Yandex Disk media action failed'));
  }
  return data;
}
