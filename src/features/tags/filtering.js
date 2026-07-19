function readTagValue(tag) {
  if (typeof tag === 'string' || typeof tag === 'number') return String(tag).trim();
  return String(tag?.value || tag?.label || '').trim();
}

function normalizeTagValue(tag) {
  return readTagValue(tag).toLowerCase();
}

export function buildTagFilterOptions(tagCollections = [], selectedValues = []) {
  const byNormalizedValue = new Map();
  const collections = Array.isArray(tagCollections) ? tagCollections : [tagCollections];

  const addTag = (tag) => {
    const value = readTagValue(tag);
    const normalized = normalizeTagValue(value);
    if (!value || !normalized || byNormalizedValue.has(normalized)) return;
    byNormalizedValue.set(normalized, { id: value, value, label: value });
  };

  collections.forEach((collection) => {
    if (Array.isArray(collection)) collection.forEach(addTag);
    else addTag(collection);
  });
  (Array.isArray(selectedValues) ? selectedValues : []).forEach(addTag);

  return Array.from(byNormalizedValue.values()).sort((left, right) =>
    left.label.localeCompare(right.label, 'ru', { sensitivity: 'base' }),
  );
}

export function matchesSelectedTags(tags, selectedValues) {
  const selected = (Array.isArray(selectedValues) ? selectedValues : [])
    .map(normalizeTagValue)
    .filter(Boolean);
  if (selected.length === 0) return true;

  const available = new Set(
    (Array.isArray(tags) ? tags : [])
      .map(normalizeTagValue)
      .filter(Boolean),
  );
  return selected.some((value) => available.has(value));
}

export function buildTagFacetCounts(items, getTags) {
  const counts = {};
  (Array.isArray(items) ? items : []).forEach((item) => {
    const tags = typeof getTags === 'function' ? getTags(item) : item?.tags;
    const uniqueValues = new Set(
      (Array.isArray(tags) ? tags : [])
        .map(normalizeTagValue)
        .filter(Boolean),
    );
    uniqueValues.forEach((value) => {
      counts[value] = (counts[value] || 0) + 1;
    });
  });
  return counts;
}
