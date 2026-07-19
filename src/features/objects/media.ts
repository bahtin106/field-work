import { encode as encodeBase64 } from 'base64-arraybuffer';
import { Platform } from 'react-native';
import { objectMediaStorage } from '../../../lib/objectMediaStorage';
import {
  buildMediaAssetDisplayMap,
  buildMediaAssetInfoMap,
  buildMediaAssetThumbMap,
  listMediaAssets,
} from '../../shared/media/assets';
import { uploadPreparedImageFile } from '../../shared/media/imagePipeline';
import { t as T } from '../../i18n';

const LOCAL_RENDERABLE_MEDIA_URI_RE = /^(file|content|asset|ph|assets-library):\/\//i;
const DATA_IMAGE_URI_RE = /^data:image\//i;
const HTTP_URI_RE = /^https?:\/\//i;
type ObjectMediaInfo = { capturedAt: string | null, uploadedAt: string | null };
type ObjectMediaAssetMaps = {
  displayUrls: Record<string, string>,
  thumbnailUrls: Record<string, string>,
  mediaInfoBySource: Record<string, ObjectMediaInfo>,
};

export function normalizeObjectMediaUrls(urls: unknown): string[] {
  return (Array.isArray(urls) ? urls : [urls])
    .map((value: unknown) => String(value || '').trim())
    .filter(Boolean);
}

export function mergeObjectMediaUrls(...groups: unknown[]): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const url of normalizeObjectMediaUrls(group)) {
      if (seen.has(url)) continue;
      seen.add(url);
      next.push(url);
    }
  }
  return next;
}

function isLocalObjectMediaUri(value: unknown): boolean {
  return /^file:\/\//i.test(String(value || '').trim());
}

export function mergeObjectMediaUrlMapPreservingLocal(
  current: unknown,
  incoming: unknown,
): Record<string, string> {
  const currentMap = current && typeof current === 'object' ? current as Record<string, unknown> : {};
  const incomingMap = incoming && typeof incoming === 'object' ? incoming as Record<string, unknown> : {};
  const next: Record<string, string> = {};

  for (const [key, value] of Object.entries(currentMap)) {
    const normalizedKey = String(key || '').trim();
    const normalizedValue = String(value || '').trim();
    if (normalizedKey && normalizedValue) next[normalizedKey] = normalizedValue;
  }

  for (const [key, value] of Object.entries(incomingMap)) {
    const normalizedKey = String(key || '').trim();
    const normalizedValue = String(value || '').trim();
    if (!normalizedKey || !normalizedValue) continue;
    const currentValue = next[normalizedKey];
    if (isLocalObjectMediaUri(currentValue) && !isLocalObjectMediaUri(normalizedValue)) continue;
    next[normalizedKey] = normalizedValue;
  }

  return next;
}

function normalizeObjectMediaUrlMap(value: unknown): Record<string, string> {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const next: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(source)) {
    const normalizedKey = String(key || '').trim();
    const normalizedValue = String(rawValue || '').trim();
    if (!normalizedKey || !normalizedValue || isYandexPublicPageUrl(normalizedValue)) continue;
    next[normalizedKey] = normalizedValue;
  }

  return next;
}

export function isYandexPublicPageUrl(value: unknown): boolean {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return false;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === 'yadi.sk' || host.endsWith('.yadi.sk') || host.startsWith('disk.yandex.');
  } catch {
    return /^(https?:\/\/)?yadi\.sk\//i.test(raw) || /^(https?:\/\/)?disk\.yandex\.[^/]+\//i.test(raw);
  }
}

export function isRenderableObjectMediaUrl(value: unknown): boolean {
  const raw = String(value || '').trim();
  if (!raw || isYandexPublicPageUrl(raw)) return false;
  return HTTP_URI_RE.test(raw) || LOCAL_RENDERABLE_MEDIA_URI_RE.test(raw) || DATA_IMAGE_URI_RE.test(raw);
}

export async function resolveObjectMediaUrls({
  objectId,
  categories,
  mediaByCategory,
}: {
  objectId: string,
  categories: string[],
  mediaByCategory?: Record<string, unknown>,
}): Promise<ObjectMediaAssetMaps> {
  const id = String(objectId || '').trim();
  const safeCategories = Array.isArray(categories)
    ? categories.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (!id || !safeCategories.length) {
    return { displayUrls: {}, thumbnailUrls: {}, mediaInfoBySource: {} };
  }

  const assetsPromise: Promise<ObjectMediaAssetMaps> = listMediaAssets({
    entityType: 'object',
    entityId: id,
    categories: safeCategories,
  })
    .then((assets: unknown[]): ObjectMediaAssetMaps => {
      return {
        displayUrls: normalizeObjectMediaUrlMap(buildMediaAssetDisplayMap(assets)),
        thumbnailUrls: normalizeObjectMediaUrlMap(buildMediaAssetThumbMap(assets)),
        mediaInfoBySource: buildMediaAssetInfoMap(assets) as Record<string, ObjectMediaInfo>,
      };
    })
    .catch((): ObjectMediaAssetMaps => ({ displayUrls: {}, thumbnailUrls: {}, mediaInfoBySource: {} }));

  const inspectPromises = safeCategories.map(async (category) => {
    const urls = normalizeObjectMediaUrls(mediaByCategory?.[category]);
    if (!urls.length) return {};
    try {
      const data = await objectMediaStorage('inspect_urls', {
        object_id: id,
        category,
        urls,
      });
      return normalizeObjectMediaUrlMap(data?.resolved_urls);
    } catch {
      return {};
    }
  });

  const [assetMaps, ...inspectedDisplayMaps] = await Promise.all([assetsPromise, ...inspectPromises]);
  const displayUrls = inspectedDisplayMaps.reduce(
    (next, map) => mergeObjectMediaUrlMapPreservingLocal(next, map),
    assetMaps.displayUrls,
  );
  return {
    displayUrls,
    thumbnailUrls: assetMaps.thumbnailUrls,
    mediaInfoBySource: assetMaps.mediaInfoBySource,
  };
}

export async function uploadObjectMediaPhoto(
  objectId: string,
  category: string,
  uri: string,
  mime = 'image/jpeg',
) {
  const object_id = String(objectId || '').trim();
  const mediaCategory = String(category || '').trim();
  if (!object_id) throw new Error('object_id is required');
  if (!mediaCategory) throw new Error('category is required');

  const normalizedMime = String(mime || 'image/jpeg').trim() || 'image/jpeg';
  const isDirectUploadSupported = Platform.OS !== 'web';
  let directUploadCompleted = false;

  if (isDirectUploadSupported) {
    try {
      const prepared = await objectMediaStorage('prepare_upload', {
        object_id,
        category: mediaCategory,
        mime: normalizedMime,
      });

      const uploadUrl = String(prepared?.upload_url || '').trim();
      const uploadMethod = String(prepared?.upload_method || 'PUT').trim() || 'PUT';
      const uploadHeaders =
        prepared?.upload_headers && typeof prepared.upload_headers === 'object'
          ? Object.fromEntries(
              Object.entries(prepared.upload_headers)
                .map(([key, value]) => [String(key || '').trim(), String(value || '').trim()])
                .filter(([key, value]) => key && value),
            )
          : {};

      if (!uploadUrl) {
        throw new Error(T('object_media_prepare_upload_failed'));
      }

      await uploadPreparedImageFile(uploadUrl, uri, {
        method: uploadMethod,
        headers: uploadHeaders,
      });
      directUploadCompleted = true;

      const committed = await objectMediaStorage('commit_upload', {
        object_id,
        category: mediaCategory,
        object_key: prepared?.object_key || null,
        public_url: prepared?.public_url || null,
        external_path: prepared?.external_path || null,
      });
      const publicUrl = String(committed?.url || '').trim();
      if (!publicUrl) {
        throw new Error(T('object_media_link_save_failed'));
      }
      return {
        publicUrl,
        displayUrl: String(committed?.display_url || '').trim(),
        mediaUrls: Array.isArray(committed?.media_urls) ? normalizeObjectMediaUrls(committed.media_urls) : null,
        objectUpdatedAt: committed?.object_updated_at ? String(committed.object_updated_at) : null,
      };
    } catch (error) {
      if (directUploadCompleted) throw error;
      console.warn(
        '[object-media] direct upload fallback:',
        String((error as { message?: string })?.message || error || 'unknown'),
      );
    }
  }

  const response = await fetch(uri);
  if (!response.ok) throw new Error(T('object_media_read_file_failed'));
  const fileBody = await response.arrayBuffer();
  const data = await objectMediaStorage('upload', {
    object_id,
    category: mediaCategory,
    file_base64: encodeBase64(fileBody),
    mime: normalizedMime,
  });
  const publicUrl = String(data?.url || '').trim();
  if (!publicUrl) throw new Error(T('object_media_link_save_failed'));
  return {
    publicUrl,
    displayUrl: String(data?.display_url || '').trim(),
    mediaUrls: Array.isArray(data?.media_urls) ? normalizeObjectMediaUrls(data.media_urls) : null,
    objectUpdatedAt: data?.object_updated_at ? String(data.object_updated_at) : null,
  };
}

export async function deleteObjectMediaPhotoByUrl(objectId: string, category: string, url: string) {
  const object_id = String(objectId || '').trim();
  const mediaCategory = String(category || '').trim();
  const mediaUrl = String(url || '').trim();
  if (!object_id || !mediaCategory || !mediaUrl) return false;

  const data = await objectMediaStorage('delete', {
    object_id,
    category: mediaCategory,
    url: mediaUrl,
  });
  return {
    success: true,
    mediaUrls: Array.isArray(data?.media_urls) ? normalizeObjectMediaUrls(data.media_urls) : null,
    objectUpdatedAt: data?.object_updated_at ? String(data.object_updated_at) : null,
  };
}
