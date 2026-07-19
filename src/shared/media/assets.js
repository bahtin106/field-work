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
    createdAt: row.created_at ? String(row.created_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  };
}

export async function listMediaAssets({ entityType, entityId, categories } = {}) {
  const type = String(entityType || '').trim();
  const id = String(entityId || '').trim();
  if (!type || !id) return [];

  let query = supabase
    .from('media_assets')
    .select(
      'id, company_id, entity_type, entity_id, parent_order_id, category, source_url, display_url, thumb_url, provider, storage_bucket, storage_path, mime_type, file_size_bytes, width, height, sort_order, status, error_code, error_message, metadata, created_at, updated_at',
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
  if (!raw) return false;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === 'yadi.sk' || host.endsWith('.yadi.sk') || host.startsWith('disk.yandex.');
  } catch {
    return /^(https?:\/\/)?yadi\.sk\//i.test(raw) || /^(https?:\/\/)?disk\.yandex\.[^/]+\//i.test(raw);
  }
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

const MIN_PLAUSIBLE_MEDIA_TIMESTAMP_MS = Date.UTC(2000, 0, 1);
const MAX_MEDIA_TIMESTAMP_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

function plausibleMediaTimestamp(value) {
  const timestamp = Number(value);
  if (
    !Number.isFinite(timestamp) ||
    timestamp < MIN_PLAUSIBLE_MEDIA_TIMESTAMP_MS ||
    timestamp > Date.now() + MAX_MEDIA_TIMESTAMP_FUTURE_SKEW_MS
  ) return null;
  return new Date(timestamp).toISOString();
}

function firstMediaTimestamp(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const millis = value > 10_000_000_000 ? value : value * 1000;
      const numericDate = plausibleMediaTimestamp(millis);
      if (numericDate) return numericDate;
    }
    const raw = String(value || '').trim();
    if (!raw) continue;
    if (/^\d+(?:\.\d+)?$/.test(raw)) {
      const numeric = Number(raw);
      const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
      const numericDate = plausibleMediaTimestamp(millis);
      if (numericDate) return numericDate;
      continue;
    }
    const exifMatch = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
    const normalized = exifMatch
      ? `${exifMatch[1]}-${exifMatch[2]}-${exifMatch[3]}T${exifMatch[4]}:${exifMatch[5]}:${exifMatch[6]}`
      : raw;
    const parsed = new Date(normalized);
    const parsedDate = plausibleMediaTimestamp(parsed.getTime());
    if (parsedDate) return parsedDate;
  }
  return null;
}

export function buildMediaAssetInfoMap(assets = []) {
  const next = {};
  for (const asset of Array.isArray(assets) ? assets : []) {
    const sourceUrl = String(asset?.sourceUrl || '').trim();
    if (!sourceUrl) continue;
    const metadata = asset?.metadata && typeof asset.metadata === 'object' ? asset.metadata : {};
    const exif = metadata.exif && typeof metadata.exif === 'object' ? metadata.exif : {};
    const capturedAt = firstMediaTimestamp(
      metadata.captured_at,
      metadata.capturedAt,
      metadata.taken_at,
      metadata.takenAt,
      metadata.date_taken,
      metadata.dateTaken,
      metadata.creation_time,
      metadata.creationTime,
      exif.DateTimeOriginal,
      exif.DateTimeDigitized,
      exif.DateTime,
    );
    const uploadedAt = firstMediaTimestamp(
      metadata.uploaded_at,
      metadata.uploadedAt,
      asset?.createdAt,
    );
    const origin = String(
      metadata.media_origin || metadata.mediaOrigin || metadata.origin || '',
    ).trim();
    if (!capturedAt && !uploadedAt && !origin) continue;
    next[sourceUrl] = { capturedAt, uploadedAt, origin: origin || null };
  }
  return next;
}
