const PASSWORD_MASK_CHAR = '\u2022';

export function maskPasswordValue(value, maskChar = PASSWORD_MASK_CHAR) {
  const normalized = String(value ?? '');
  return maskChar.repeat(normalized.length);
}

export function deriveNextPasswordValue({
  currentValue = '',
  inputText = '',
  lastKey = null,
  maskChar = PASSWORD_MASK_CHAR,
}) {
  const current = String(currentValue ?? '');
  const incoming = String(inputText ?? '');

  if (!incoming.length) return '';

  if (lastKey === 'Backspace') {
    return current.slice(0, -1);
  }

  if (typeof lastKey === 'string' && lastKey.length === 1) {
    return current + lastKey;
  }

  const currentMask = maskChar.repeat(current.length);
  if (incoming.startsWith(currentMask)) {
    const appended = incoming.slice(currentMask.length);
    if (appended.length) return current + appended;
  }

  const unmasked = incoming.split(maskChar).join('');
  if (unmasked.length) return unmasked;

  if (incoming.length < current.length) {
    return current.slice(0, incoming.length);
  }

  return current;
}

export { PASSWORD_MASK_CHAR };
