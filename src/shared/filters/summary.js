function normalizeList(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((v) => String(v || '').trim())
    .filter(Boolean);
}

export function summarizeFilterPart({ label, values, value, countWhenMany = true }) {
  const list = normalizeList(values);
  if (list.length > 0) {
    if (countWhenMany && list.length > 1) return `${label}: ${list.length}`;
    const text = countWhenMany ? list[0] : list.join(', ');
    return label ? `${label}: ${text}` : text;
  }

  const text = String(value || '').trim();
  if (!text) return null;
  return label ? `${label}: ${text}` : text;
}

export function joinFilterSummary(parts, bullet) {
  return (Array.isArray(parts) ? parts : [])
    .filter(Boolean)
    .join(bullet || ' • ');
}

