// src/shared/feedback/normalizeError.js
import { FEEDBACK_CODES, getMessageByCode } from './messages';

const isNetworkError = (msg = '') =>
  /network|timeout|timed?out|failed to fetch|network request failed|ECONN|EHOSTUNREACH/i.test(msg);

const isEmailTaken = (msg = '') =>
  /already exists|email.*taken|user.*exists|duplicate|email.*exists/i.test(msg);

const isInvalidEmail = (msg = '') =>
  /invalid email|email.*invalid|bad email|incorrect email/i.test(msg);

export function normalizeError(err, { t, defaultField, fieldMap } = {}) {
  const rawMessage = String(
    err?.message ||
      err?.error ||
      err?.details ||
      err?.hint ||
      err?.msg ||
      '',
  );
  const code = String(err?.code || err?.errorCode || err?.status || '').toUpperCase();

  const fieldErrors = {};
  let screenError = null;

  const setFieldError = (field, codeOrMessage) => {
    if (!field) return;
    const message =
      typeof codeOrMessage === 'string' && codeOrMessage in FEEDBACK_CODES
        ? getMessageByCode(codeOrMessage, t)
        : String(codeOrMessage || '');
    fieldErrors[field] = { code: codeOrMessage, message };
  };

  if (isNetworkError(rawMessage)) {
    screenError = {
      code: FEEDBACK_CODES.NETWORK_ERROR,
      message: getMessageByCode(FEEDBACK_CODES.NETWORK_ERROR, t),
      severity: 'error',
    };
  } else if (isEmailTaken(rawMessage) || code === 'EMAIL_TAKEN') {
    const field = fieldMap?.email || 'email';
    setFieldError(field, FEEDBACK_CODES.EMAIL_TAKEN);
  } else if (isInvalidEmail(rawMessage) || code === 'INVALID_EMAIL') {
    const field = fieldMap?.email || 'email';
    setFieldError(field, FEEDBACK_CODES.INVALID_EMAIL);
  } else if (code === 'REQUIRED_FIELD') {
    setFieldError(defaultField || fieldMap?.default || null, FEEDBACK_CODES.REQUIRED_FIELD);
  } else if (rawMessage) {
    screenError = {
      code: FEEDBACK_CODES.UNKNOWN_ERROR,
      message: rawMessage,
      severity: 'error',
    };
  } else {
    screenError = {
      code: FEEDBACK_CODES.UNKNOWN_ERROR,
      message: getMessageByCode(FEEDBACK_CODES.UNKNOWN_ERROR, t),
      severity: 'error',
    };
  }

  return { fieldErrors, screenError };
}
