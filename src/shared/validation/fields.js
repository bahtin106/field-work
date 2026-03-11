import { isValidEmail } from '../../../lib/authValidation';
import { FEEDBACK_CODES, getMessageByCode } from '../feedback/messages';

export function normalizeTextValue(value) {
  return String(value ?? '').trim();
}

export function hasTextValue(value) {
  return normalizeTextValue(value).length > 0;
}

export function getRequiredTextFieldError(value, options = {}) {
  if (options.required !== true) return null;
  return hasTextValue(value) ? null : options.message || null;
}

export function normalizeOptionalEmail(value) {
  const normalized = normalizeTextValue(value).toLowerCase();
  return normalized || null;
}

export function isValidOptionalEmail(value) {
  const normalized = normalizeOptionalEmail(value);
  if (!normalized) return true;
  return isValidEmail(normalized);
}

export function getEmailFieldError(value, options = {}) {
  const normalized = normalizeOptionalEmail(value);
  if (!normalized) {
    if (options.required === true) {
      return options.requiredMessage || getMessageByCode(FEEDBACK_CODES.REQUIRED_FIELD, options.t);
    }
    return null;
  }
  return isValidEmail(normalized)
    ? null
    : getMessageByCode(FEEDBACK_CODES.INVALID_EMAIL, options.t);
}
