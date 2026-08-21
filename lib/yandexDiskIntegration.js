import { supabase } from './supabase';
import {
  clearCachedSupabaseAccessToken,
  getCachedSupabaseAccessToken,
  getFreshSupabaseAccessToken,
} from './supabaseSessionCache';
import { t } from '../src/i18n';
import {
  assertOwnerBoundAuthorization,
  buildOwnerBoundFunctionHeaders,
} from '../src/shared/security/ownerBoundAuthorization';

const getIntegrationFallback = () => t('toast_error');
const getMediaFallback = () => t('toast_error');

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
  if (isSessionLikeError(lowered)) return t('errors_noAuth');
  if (
    lowered.includes('failed to fetch') ||
    lowered.includes('network request failed') ||
    lowered.includes('upstream server') ||
    lowered.includes('invalid response was received')
  ) {
    return t('errors_network');
  }
  if (lowered.includes('yandex disk not connected')) return t('company_integrations_yandex_error_not_connected');
  if (lowered.includes('missing yandex oauth')) return t('company_integrations_yandex_error_missing_credentials');
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

export async function yandexDiskIntegration(action, payload = {}, options = {}) {
  return invokeYandexFunction(
    'yandex-disk-integration',
    { action, ...payload },
    getIntegrationFallback(),
    options,
  );
}

export async function yandexDiskMedia(action, payload = {}, options = {}) {
  return invokeYandexFunction(
    'yandex-disk-media',
    { action, ...payload },
    getMediaFallback(),
    options,
  );
}

async function invokeYandexFunction(functionName, body, fallback, options = {}) {
  const signal = options?.signal;
  const authCarrier = options?.authCarrier || null;
  const expectedUserId = authCarrier?.userId || options?.expectedUserId || null;
  if (signal?.aborted) {
    const error = new Error('Yandex integration request was aborted');
    error.name = 'AbortError';
    error.code = 'READ_ABORTED';
    throw error;
  }
  let token = authCarrier ? '' : await getCachedSupabaseAccessToken(expectedUserId);
  if (signal?.aborted) {
    const error = new Error('Yandex integration request was aborted');
    error.name = 'AbortError';
    error.code = 'READ_ABORTED';
    throw error;
  }
  if (!authCarrier && !token) token = await getFreshSupabaseAccessToken(expectedUserId);
  if (!authCarrier && !token) throw new Error(t('errors_noAuth'));

  const maxAttempts = authCarrier ? 1 : 2;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const headers = authCarrier
      ? buildOwnerBoundFunctionHeaders(authCarrier, expectedUserId)
      : { Authorization: `Bearer ${token}` };
    const { data, error } = await supabase.functions.invoke(functionName, {
      headers,
      body,
      signal,
    });
    if (authCarrier) assertOwnerBoundAuthorization(authCarrier, expectedUserId);

    if (error) {
      const message = await readInvokeErrorMessage(error, fallback);
      if (!authCarrier && attempt === 0 && isSessionLikeError(message)) {
        clearCachedSupabaseAccessToken();
        token = await getFreshSupabaseAccessToken(expectedUserId);
        if (signal?.aborted) {
          const abortError = new Error('Yandex integration request was aborted');
          abortError.name = 'AbortError';
          abortError.code = 'READ_ABORTED';
          throw abortError;
        }
        if (token) continue;
      }
      throw new Error(humanizeYandexError(message, fallback));
    }

    if (!data?.success) {
      const message = buildErrorMessage(data, fallback);
      if (!authCarrier && attempt === 0 && isSessionLikeError(message)) {
        clearCachedSupabaseAccessToken();
        token = await getFreshSupabaseAccessToken(expectedUserId);
        if (signal?.aborted) {
          const abortError = new Error('Yandex integration request was aborted');
          abortError.name = 'AbortError';
          abortError.code = 'READ_ABORTED';
          throw abortError;
        }
        if (token) continue;
      }
      throw new Error(humanizeYandexError(message, fallback));
    }

    return data;
  }

  throw new Error(fallback);
}
