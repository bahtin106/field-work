import { extractStorageObjectPath } from './storageObjectPaths';

function normalizePath(path) {
  return String(path || '').replace(/^\/+/, '').trim();
}

export async function removeStoragePrefixFiles({
  supabase,
  bucket,
  prefix,
  keepPaths = [],
  pageSize = 100,
}) {
  const keep = new Set((keepPaths || []).map(normalizePath).filter(Boolean));
  const safePrefix = String(prefix || '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!supabase || !bucket || !safePrefix) return { removed: 0 };

  let offset = 0;
  let removed = 0;

  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(safePrefix, {
      limit: pageSize,
      offset,
    });
    if (error) throw error;

    const files = Array.isArray(data) ? data : [];
    if (!files.length) break;

    const batch = files
      .map((f) => normalizePath(`${safePrefix}/${f?.name || ''}`))
      .filter((path) => path && !keep.has(path));

    if (batch.length) {
      const { error: removeError } = await supabase.storage.from(bucket).remove(batch);
      if (removeError) throw removeError;
      removed += batch.length;
    }

    if (files.length < pageSize) break;
    offset += pageSize;
  }

  return { removed };
}

export function extractKeepPathFromUrl(url, bucket) {
  return normalizePath(extractStorageObjectPath(url, bucket));
}
