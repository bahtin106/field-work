import { supabase } from './supabase';
import { getCachedSupabaseAccessToken } from './supabaseSessionCache';
import { t } from '../src/i18n';
import { canRunDeferredNetworkWork } from '../src/shared/offline/offlineStatus';
import {
  assertOwnerBoundAuthorization,
  buildOwnerBoundFunctionHeaders,
} from '../src/shared/security/ownerBoundAuthorization';

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

export async function invokeMediaStorageAction(
  functionName,
  action,
  payload = {},
  fallbackMessage = 'Media storage action failed',
  options = {},
) {
  if (!canRunDeferredNetworkWork()) {
    const error = new Error(t('errors_network'));
    error.code = 'NETWORK_QUALITY_REQUIRED';
    throw error;
  }
  const authCarrier = options?.authCarrier || null;
  const expectedUserId = authCarrier?.userId || options?.expectedUserId || null;
  let headers;
  if (authCarrier) {
    headers = buildOwnerBoundFunctionHeaders(authCarrier, expectedUserId);
  } else {
    const token = await getCachedSupabaseAccessToken(expectedUserId);
    if (!token) throw new Error(t('errors_noAuth'));
    headers = { Authorization: `Bearer ${token}` };
  }

  const { data, error } = await supabase.functions.invoke(functionName, {
    headers,
    body: { action, ...payload },
    signal: options?.signal,
  });
  if (authCarrier) assertOwnerBoundAuthorization(authCarrier, expectedUserId);

  if (error) {
    throw new Error(await readInvokeErrorMessage(error, fallbackMessage));
  }
  if (!data?.success) {
    throw new Error(buildErrorMessage(data, fallbackMessage));
  }
  return data;
}
