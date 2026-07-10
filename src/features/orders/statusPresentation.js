import { withAlpha } from '../../../theme/colors';

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
  if (
    normalized === 'waiting' ||
    normalized === 'pending' ||
    normalized.includes('ожидан') ||
    normalized.includes('wait')
  ) {
    return 'default';
  }
  return 'default';
}

function mixHex(color, target, ratio) {
  const match = String(color || '').match(/^#([0-9A-F]{6})$/i);
  if (!match) return color;
  const source = match[1].match(/.{2}/g).map((value) => parseInt(value, 16));
  const targetValue = target === 'light' ? 255 : 0;
  const mixed = source.map((value) => Math.round(value + (targetValue - value) * ratio));
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

export function getOrderStatusPalette(status, theme, customColor = null) {
  const variant = getOrderStatusVariant(status);
  const fallbackSurface = theme?.colors?.inputBg ?? theme?.colors?.surface;
  const fallbackText = theme?.colors?.textSecondary ?? theme?.colors?.text;
  const statusSet = theme?.colors?.status || theme?._raw?.colors?.status || {};
  const tone = statusSet?.[variant] || statusSet?.default;
  const color = /^#[0-9A-F]{6}$/i.test(String(customColor || ''))
    ? String(customColor).toUpperCase()
    : null;

  if (color) {
    const darkMode = theme?.mode === 'dark';
    return {
      variant,
      color,
      bg: withAlpha(color, darkMode ? 0.24 : 0.14),
      fg: mixHex(color, darkMode ? 'light' : 'dark', darkMode ? 0.2 : 0.28),
    };
  }

  return {
    variant,
    color: null,
    bg: tone?.bg ?? fallbackSurface,
    fg: tone?.fg ?? fallbackText,
  };
}
