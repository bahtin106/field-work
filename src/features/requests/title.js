function pad2(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '00';
  return String(Math.trunc(num)).padStart(2, '0');
}

function toValidDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeRawTitle(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

export function buildAutoRequestTitle(dateInput = null, options = {}) {
  const prefix = String(options?.prefix || 'Request').trim() || 'Request';
  const date = toValidDate(dateInput) || new Date();
  const stamp = `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return `${prefix} ${stamp}`.trim();
}

export function resolveRequestTitle(input, options = {}) {
  const explicitTitle = normalizeRawTitle(
    typeof input === 'string' ? input : input?.title,
  );
  if (explicitTitle) return explicitTitle;

  const fallbackDate =
    options?.fallbackDate ||
    (typeof input === 'object' && input
      ? input.time_window_start || input.created_at || input.updated_at
      : null);

  return buildAutoRequestTitle(fallbackDate, options);
}
