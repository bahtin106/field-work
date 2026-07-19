const DEFAULT_DECIMAL_OPTIONS = Object.freeze({
  allowNegative: true,
  allowDecimal: true,
});

function normalizeDigitGlyph(value) {
  const code = value.charCodeAt(0);
  if (code >= 0xff10 && code <= 0xff19) return String(code - 0xff10);
  return value;
}

function clampDigits(value, limit) {
  if (!Number.isFinite(limit) || limit < 0) return value;
  return value.slice(0, Math.floor(limit));
}

/**
 * Normalizes an editable numeric string without coercing it to Number, so
 * intermediate values such as "-" and "12." remain typeable.
 */
export function normalizeNumericInput(value, options = DEFAULT_DECIMAL_OPTIONS) {
  const source = String(value ?? '')
    .replace(/[−–—]/g, '-')
    .replace(/[０-９]/g, normalizeDigitGlyph);
  const allowNegative = options?.allowNegative !== false;
  const allowDecimal = options?.allowDecimal !== false;
  const isNegative = allowNegative && source.trimStart().startsWith('-');

  let integerPart = '';
  let fractionPart = '';
  let decimalSeen = false;
  for (const char of source) {
    if (char >= '0' && char <= '9') {
      if (decimalSeen) fractionPart += char;
      else integerPart += char;
      continue;
    }
    if (allowDecimal && (char === '.' || char === ',') && !decimalSeen) {
      decimalSeen = true;
    }
  }

  integerPart = clampDigits(integerPart, options?.maxIntegerDigits);
  fractionPart = clampDigits(fractionPart, options?.maxFractionDigits);

  let normalized = integerPart;
  if (decimalSeen) normalized = `${integerPart || '0'}.${fractionPart}`;
  if (isNegative) normalized = `-${normalized}`;
  return normalized;
}

export function normalizeIntegerInput(value, options = {}) {
  return normalizeNumericInput(value, {
    ...options,
    allowDecimal: false,
  });
}

export function resolveNumericInputOptions(keyboardType, numericInput) {
  if (numericInput === false) return null;
  const inferred = keyboardType === 'decimal-pad' || keyboardType === 'numeric';
  if (!inferred && numericInput == null) return null;
  return {
    ...DEFAULT_DECIMAL_OPTIONS,
    ...(numericInput && typeof numericInput === 'object' ? numericInput : null),
  };
}
