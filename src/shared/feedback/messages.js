// src/shared/feedback/messages.js
import { t as T } from '../../i18n';

export const FEEDBACK_CODES = {
  REQUIRED_FIELD: 'REQUIRED_FIELD',
  INVALID_EMAIL: 'INVALID_EMAIL',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  INVALID_PHONE: 'INVALID_PHONE',
  PASSWORD_TOO_SHORT: 'PASSWORD_TOO_SHORT',
  PASSWORD_MISMATCH: 'PASSWORD_MISMATCH',
  PASSWORD_INVALID_CHARS: 'PASSWORD_INVALID_CHARS',
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
};

const CODE_TO_KEY = {
  [FEEDBACK_CODES.REQUIRED_FIELD]: 'err_required_field',
  [FEEDBACK_CODES.INVALID_EMAIL]: 'err_email_invalid_format',
  [FEEDBACK_CODES.EMAIL_TAKEN]: 'error_email_exists',
  [FEEDBACK_CODES.INVALID_PHONE]: 'err_phone',
  [FEEDBACK_CODES.PASSWORD_TOO_SHORT]: 'err_password_short',
  [FEEDBACK_CODES.PASSWORD_MISMATCH]: 'err_password_mismatch',
  [FEEDBACK_CODES.PASSWORD_INVALID_CHARS]: 'err_password_invalid_chars',
  [FEEDBACK_CODES.CONSENT_REQUIRED]: 'register_error_consent_required',
  [FEEDBACK_CODES.NETWORK_ERROR]: 'errors_network',
  [FEEDBACK_CODES.TIMEOUT]: 'errors_network',
  [FEEDBACK_CODES.UNKNOWN_ERROR]: 'toast_generic_error',
};

export function getMessageByCode(code, t = T, fallback) {
  const key = CODE_TO_KEY[code];
  if (key) return t(key, fallback ?? key);
  return t('toast_generic_error', fallback ?? 'Ошибка');
}

export function getMessageKeyByCode(code) {
  return CODE_TO_KEY[code] || null;
}
