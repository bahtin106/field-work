import { isValidRu, normalizeRu } from '../../../components/ui/phone';

function normalizeInput(raw) {
  return normalizeRu(String(raw || ''));
}

export function normalizeOptionalMobilePhone(raw) {
  const normalized = normalizeInput(raw);
  if (!normalized || normalized.length <= 1) return null;
  return normalized;
}

export function hasMobilePhoneValue(raw) {
  return !!normalizeOptionalMobilePhone(raw);
}

export function isValidOptionalMobilePhone(raw) {
  const normalized = normalizeOptionalMobilePhone(raw);
  if (!normalized) return true;
  return isValidRu(normalized);
}

export function toE164MobilePhoneOrNull(raw) {
  const normalized = normalizeOptionalMobilePhone(raw);
  if (!normalized || !isValidRu(normalized)) return null;
  return `+${normalized}`;
}
