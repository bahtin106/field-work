import { t as T } from '../../i18n';

export const QUERY_MESSAGE_KEYS = {
  NETWORK: 'errors_network',
  UNKNOWN: 'toast_generic_error',
  LOAD_REQUESTS: 'errors_loadOrders',
  LOAD_EMPLOYEES: 'errors_loadUsers',
};

export function getQueryErrorMessage(err, fallbackKey = QUERY_MESSAGE_KEYS.UNKNOWN) {
  const message = String(err?.message || '').toLowerCase();
  if (message.includes('network') || message.includes('fetch')) {
    return T(QUERY_MESSAGE_KEYS.NETWORK);
  }
  return T(fallbackKey);
}
