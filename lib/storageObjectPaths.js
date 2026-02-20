export function extractStorageObjectPath(value, bucket) {
  if (!value || !bucket || typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;

  // Already a relative object path.
  if (!raw.includes('://')) {
    return raw.replace(/^\/+/, '');
  }

  try {
    const url = new URL(raw);
    const markers = [
      `/storage/v1/object/public/${bucket}/`,
      `/storage/v1/object/sign/${bucket}/`,
      `/storage/v1/object/authenticated/${bucket}/`,
      `/storage/v1/object/${bucket}/`,
    ];

    for (const marker of markers) {
      const idx = url.pathname.indexOf(marker);
      if (idx >= 0) {
        const tail = url.pathname.slice(idx + marker.length);
        return decodeURIComponent(tail).replace(/^\/+/, '') || null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function buildStorageObjectPath({ prefix, entityId, category, fileName }) {
  const safePrefix = String(prefix || '').replace(/\/+$/g, '');
  const safeEntityId = String(entityId || '').trim();
  const safeCategory = String(category || '').trim();
  const safeFileName = String(fileName || '').trim();
  return `${safePrefix}/${safeEntityId}/${safeCategory}/${safeFileName}`;
}
