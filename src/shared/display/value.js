const DASH_VALUES = new Set(['-', '–', '—']);

export function toDisplayString(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

export function hasDisplayValue(value) {
  const normalized = toDisplayString(value).trim();
  if (!normalized) return false;
  return !DASH_VALUES.has(normalized);
}
