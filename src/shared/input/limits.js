export const TEXT_INPUT_LIMITS = Object.freeze({
  name: 128,
  shortText: 128,
  text: 255,
  search: 255,
  email: 254,
  password: 128,
  phone: 32,
  numeric: 32,
  address: 512,
  description: 4000,
});

const NUMERIC_KEYBOARDS = new Set([
  'decimal-pad',
  'numeric',
  'number-pad',
  'numbers-and-punctuation',
]);

export function resolveTextInputMaxLength({
  maxLength,
  inputKind,
  keyboardType,
  secureTextEntry,
  multiline,
} = {}) {
  if (Number.isFinite(maxLength) && maxLength > 0) {
    return Math.floor(maxLength);
  }
  if (inputKind && TEXT_INPUT_LIMITS[inputKind]) {
    return TEXT_INPUT_LIMITS[inputKind];
  }
  if (secureTextEntry) return TEXT_INPUT_LIMITS.password;
  if (keyboardType === 'email-address') return TEXT_INPUT_LIMITS.email;
  if (keyboardType === 'phone-pad') return TEXT_INPUT_LIMITS.phone;
  if (NUMERIC_KEYBOARDS.has(keyboardType)) return TEXT_INPUT_LIMITS.numeric;
  if (multiline) return TEXT_INPUT_LIMITS.description;
  return TEXT_INPUT_LIMITS.text;
}

export function formatMaxLengthError(template, maxLength) {
  return String(template || '').replace('{max}', String(maxLength));
}
