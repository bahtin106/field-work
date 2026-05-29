import { APP_RUNTIME_CONFIG } from '../../../config/appRuntime';
import { supabase } from '../../../lib/supabase';

export function normalizeMediaAsset(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: String(row.id || ''),
    companyId: String(row.company_id || ''),
    entityType: String(row.entity_type || ''),
    entityId: String(row.entity_id || ''),
    parentOrderId: row.parent_order_id ? String(row.parent_order_id) : null,
    category: String(row.category || ''),
    sourceUrl: String(row.source_url || ''),
    displayUrl: String(row.display_url || ''),
    thumbUrl: String(row.thumb_url || ''),
    provider: String(row.provider || 'unknown'),
    storageBucket: row.storage_bucket ? String(row.storage_bucket) : null,
    storagePath: row.storage_path ? String(row.storage_path) : null,
    mimeType: row.mime_type ? String(row.mime_type) : null,
    fileSizeBytes: Number(row.file_size_bytes || 0),
    width: row.width == null ? null : Number(row.width || 0),
    height: row.height == null ? null : Number(row.height || 0),
    sortOrder: Number(row.sort_order || 0),
    status: String(row.status || 'ready'),
    errorCode: row.error_code ? String(row.error_code) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
  };
}

export async function listMediaAssets({ entityType, entityId, categories } = {}) {
  const type = String(entityType || '').trim();
  const id = String(entityId || '').trim();
  if (!type || !id) return [];

  let query = supabase
    .from('media_assets')
    .select(
      'id, company_id, entity_type, entity_id, parent_order_id, category, source_url, display_url, thumb_url, provider, storage_bucket, storage_path, mime_type, file_size_bytes, width, height, sort_order, status, error_code, error_message, metadata',
    )
    .eq('entity_type', type)
    .eq('entity_id', id)
    .neq('status', 'deleted')
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true });

  const safeCategories = Array.isArray(categories)
    ? categories.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (safeCategories.length) query = query.in('category', safeCategories);

  const { data, error } = await query;
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(normalizeMediaAsset).filter(Boolean);
}

export function buildMediaAssetDisplayMap(assets = []) {
  const next = {};
  for (const asset of Array.isArray(assets) ? assets : []) {
    const sourceUrl = String(asset?.sourceUrl || '').trim();
    if (!sourceUrl) continue;
    if (String(asset?.provider || '') === 'beget_s3' && asset?.storagePath) continue;
    const displayUrl = String(asset?.displayUrl || '').trim();
    if (isYandexPublicPageUrl(displayUrl)) continue;
    if (displayUrl) next[sourceUrl] = displayUrl;
  }
  return next;
}

function isYandexPublicPageUrl(value) {
  const raw = String(value || '').trim().toLowerCase();
  return raw.includes('yadi.sk/') || raw.includes('disk.yandex.');
}

export function buildMediaThumbnailUrl(asset, { width = 512, height = 512, fit = 'fill' } = {}) {
  const id = String(asset?.id || '').trim();
  if (!id || !APP_RUNTIME_CONFIG.supabaseUrl) return '';

  const params = new URLSearchParams({
    id,
    w: String(width),
    h: String(height),
    fit: fit === 'fit' ? 'fit' : 'fill',
  });
  return `${APP_RUNTIME_CONFIG.supabaseUrl}/functions/v1/media-thumbnail?${params.toString()}`;
}

export function buildMediaAssetThumbMap(assets = [], options) {
  const next = {};
  for (const asset of Array.isArray(assets) ? assets : []) {
    const sourceUrl = String(asset?.sourceUrl || '').trim();
    if (!sourceUrl) continue;
    const thumbUrl = buildMediaThumbnailUrl(asset, options) || String(asset?.thumbUrl || '').trim();
    if (thumbUrl) next[sourceUrl] = thumbUrl;
  }
  return next;
}
