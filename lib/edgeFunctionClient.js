import { supabase } from './supabase';

export const EDGE_FUNCTION_TRANSPORT_ERROR = 'EDGE_FUNCTION_TRANSPORT_UNAVAILABLE';

const DEFAULT_RETRY_DELAYS_MS = [400, 1100];
const TRANSPORT_ERROR_PATTERN =
  /failed to send a request to the edge function|functionsfetcherror|failed to fetch|network request failed|network error|load failed|timed?\s*out|econn|ehostunreach|enetunreach|dns/i;

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(delayMs) || 0)));
}

function getResponseStatus(error) {
  const status = Number(
    error?.context?.status ?? error?.status ?? error?.statusCode ?? error?.response?.status ?? 0,
  );
  return Number.isFinite(status) && status > 0 ? status : 0;
}

export function isEdgeFunctionTransportError(error) {
  if (!error) return false;
  if (String(error?.code || '').trim() === EDGE_FUNCTION_TRANSPORT_ERROR) return true;
  if (getResponseStatus(error) > 0) return false;

  const name = String(error?.name || error?.constructor?.name || '');
  const message = String(error?.message || error?.error || '');
  return /FunctionsFetchError/i.test(name) || TRANSPORT_ERROR_PATTERN.test(`${name} ${message}`);
}

function wrapTransportError(error, attempts) {
  const wrapped = new Error(String(error?.message || 'Edge Function transport is unavailable'));
  wrapped.name = 'EdgeFunctionTransportError';
  wrapped.code = EDGE_FUNCTION_TRANSPORT_ERROR;
  wrapped.attempts = attempts;
  wrapped.cause = error;
  return wrapped;
}

export async function invokeEdgeFunctionWithRetry(
  functionName,
  options,
  { retryDelaysMs = DEFAULT_RETRY_DELAYS_MS } = {},
) {
  const delays = Array.isArray(retryDelaysMs)
    ? retryDelaysMs.map((delay) => Math.max(0, Number(delay) || 0))
    : DEFAULT_RETRY_DELAYS_MS;
  const maxAttempts = delays.length + 1;
  let transportFailureCount = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let result;
    try {
      result = await supabase.functions.invoke(functionName, options);
    } catch (error) {
      result = { data: null, error };
    }

    if (!isEdgeFunctionTransportError(result?.error)) {
      return {
        data: result?.data ?? null,
        error: result?.error ?? null,
        attempts: attempt,
        transportFailureCount,
      };
    }

    transportFailureCount += 1;
    if (attempt >= maxAttempts) {
      return {
        data: result?.data ?? null,
        error: wrapTransportError(result?.error, attempt),
        attempts: attempt,
        transportFailureCount,
      };
    }

    await sleep(delays[attempt - 1]);
  }

  return {
    data: null,
    error: wrapTransportError(null, maxAttempts),
    attempts: maxAttempts,
    transportFailureCount,
  };
}
