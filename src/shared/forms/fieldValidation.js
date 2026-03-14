export function isValueEmpty(value) {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function hasValidationError(error) {
  if (error == null) return false;
  if (typeof error === 'string') return error.trim().length > 0;
  if (typeof error === 'object') {
    const message = typeof error.message === 'string' ? error.message.trim() : '';
    return message.length > 0 || error === 'invalid' || error.invalid === true;
  }
  return error === true || error === 'invalid';
}

export function hasRequiredMarker(label) {
  return /\*/.test(String(label || ''));
}

export function getRequiredFieldLabel(label, required = false) {
  const text = String(label || '');
  if (!required || !text || hasRequiredMarker(text)) return text;
  return `${text} *`;
}

export function getFieldValidationState({
  label,
  value,
  error,
  required = false,
  touched = false,
  forceValidation = false,
} = {}) {
  const isRequired = !!required || hasRequiredMarker(label);
  const shouldShowValidation = !!(touched || forceValidation);
  const requiredEmpty = isRequired && shouldShowValidation && isValueEmpty(value);
  const explicitError = hasValidationError(error);

  return {
    isRequired,
    shouldShowValidation,
    requiredEmpty,
    explicitError,
    isInvalid: requiredEmpty || explicitError,
  };
}
