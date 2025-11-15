// theme/colors.js

/**
 * Safe alpha helper for both hex/rgb strings and dynamic PlatformColor objects
 * @param {string|object} color - Color value (hex, rgb string, or PlatformColor)
 * @param {number} a - Alpha value between 0 and 1
 * @returns {string|object} Color with alpha applied
 */
export function withAlpha(color, a) {
  if (typeof color === 'string') {
    const hex = color.match(/^#([0-9a-fA-F]{6})$/);
    if (hex) {
      const alpha = Math.round(Math.max(0, Math.min(1, a)) * 255)
        .toString(16)
        .padStart(2, '0');
      return color + alpha;
    }
    const rgb = color.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
    if (rgb) {
      return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${a})`;
    }
  }
  return color;
}
