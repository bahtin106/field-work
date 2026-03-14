export function normalizeOrderStatusValue(status) {
  return String(status || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
}

export function getOrderStatusVariant(status) {
  const normalized = normalizeOrderStatusValue(status);
  if (!normalized) return 'default';
  if (normalized === 'in_feed' || normalized === 'feed' || normalized.includes('лент')) return 'feed';
  if (normalized === 'new' || normalized.includes('нов')) return 'new';
  if (
    normalized === 'in_progress' ||
    normalized === 'progress' ||
    normalized === 'in work' ||
    normalized.includes('работ')
  ) {
    return 'progress';
  }
  if (
    normalized === 'completed' ||
    normalized === 'complete' ||
    normalized === 'done' ||
    normalized.includes('заверш')
  ) {
    return 'done';
  }
  return 'default';
}

export function getOrderStatusPalette(status, theme) {
  const variant = getOrderStatusVariant(status);
  const fallbackSurface = theme?.colors?.inputBg ?? theme?.colors?.surface ?? '#FFFFFF';
  const fallbackText = theme?.colors?.textSecondary ?? theme?.colors?.text ?? '#0A0A0A';
  const statusSet = theme?.colors?.status || theme?._raw?.colors?.status || {};
  const tone = statusSet?.[variant] || statusSet?.default;

  return {
    variant,
    bg: tone?.bg ?? fallbackSurface,
    fg: tone?.fg ?? fallbackText,
  };
}
