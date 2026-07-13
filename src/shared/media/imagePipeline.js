import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { FileSystemUploadType, uploadAsync as uploadFileAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';

export const DEFAULT_MEDIA_MIME = 'image/jpeg';
export const DEFAULT_MEDIA_MAX_WIDTH = 1280;
export const DEFAULT_MEDIA_QUALITY = 0.8;
export const DEFAULT_MEDIA_UPLOAD_CONCURRENCY = 3;

export function getImagePickerMediaTypesImages() {
  try {
    if (ImagePicker.MediaType?.Images) return ImagePicker.MediaType.Images;
    if (ImagePicker.MediaType?.images) return ImagePicker.MediaType.images;
    if (ImagePicker.MediaType?.image) return ImagePicker.MediaType.image;
  } catch {}
  return ['images'];
}

export async function ensureImageLibraryPermission() {
  // Android's system photo picker grants access only to the files selected by the
  // user. Requesting broad media-library access here breaks clean installs where
  // READ_MEDIA_IMAGES is intentionally excluded from the app manifest.
  if (Platform.OS !== 'ios') return true;

  let permission = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (!permission?.granted) {
    permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  }
  return permission?.granted === true || permission?.accessPrivileges === 'limited';
}

export async function ensureCameraPermission() {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  return permission?.granted === true;
}

export function normalizePickedImageAssets(assets = [], seenIds) {
  const next = [];
  for (const asset of Array.isArray(assets) ? assets : []) {
    const uri = String(asset?.uri || '').trim();
    if (!uri) continue;
    const id = String(asset?.assetId || asset?.fileName || uri);
    if (seenIds?.has(id)) continue;
    seenIds?.add(id);
    next.push({
      id,
      uri,
      width: Number(asset?.width || 0) || null,
      height: Number(asset?.height || 0) || null,
      mimeType: String(asset?.mimeType || DEFAULT_MEDIA_MIME).trim() || DEFAULT_MEDIA_MIME,
      fileName: String(asset?.fileName || '').trim() || null,
    });
  }
  return next;
}

export async function pickGalleryImages({
  selectionLimit = 20,
  quality = 1,
  orderedSelection = true,
  seenIds,
} = {}) {
  const granted = await ensureImageLibraryPermission();
  if (!granted) {
    const error = new Error('media_library_permission_denied');
    error.code = 'media_library_permission_denied';
    throw error;
  }

  const mediaTypes = getImagePickerMediaTypesImages();
  let result;
  try {
    result = await ImagePicker.launchImageLibraryAsync({
      quality,
      allowsMultipleSelection: true,
      mediaTypes,
      orderedSelection,
      selectionLimit,
      shouldDownloadFromNetwork: true,
    });
  } catch {
    result = await ImagePicker.launchImageLibraryAsync({
      quality,
      allowsMultipleSelection: false,
      mediaTypes,
      shouldDownloadFromNetwork: true,
    });
  }

  if (!result || result.canceled) return [];
  return normalizePickedImageAssets(result.assets, seenIds);
}

export async function prepareImageForUpload(
  uri,
  {
    maxWidth = DEFAULT_MEDIA_MAX_WIDTH,
    quality = DEFAULT_MEDIA_QUALITY,
    format = ImageManipulator.SaveFormat.JPEG,
  } = {},
) {
  const sourceUri = String(uri || '').trim();
  if (!sourceUri) throw new Error('Image URI is required');
  const manipulated = await ImageManipulator.manipulateAsync(
    sourceUri,
    [{ resize: { width: Math.max(1, Number(maxWidth || DEFAULT_MEDIA_MAX_WIDTH)) } }],
    {
      compress: Math.max(0.1, Math.min(1, Number(quality || DEFAULT_MEDIA_QUALITY))),
      format,
    },
  );
  return {
    ...manipulated,
    uri: manipulated.uri,
    mime: DEFAULT_MEDIA_MIME,
  };
}

export function normalizeUploadHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  return Object.fromEntries(
    Object.entries(headers)
      .map(([key, value]) => [String(key || '').trim(), String(value || '').trim()])
      .filter(([key, value]) => key && value),
  );
}

/**
 * @param {string} uploadUrl
 * @param {string} uri
 * @param {{ method?: string, headers?: Record<string, string> }} [options]
 */
export async function uploadPreparedImageFile(uploadUrl, uri, { method = 'PUT', headers } = {}) {
  const targetUrl = String(uploadUrl || '').trim();
  const fileUri = String(uri || '').trim();
  if (!targetUrl) throw new Error('prepare upload failed');
  if (!fileUri) throw new Error('Image URI is required');
  const result = await uploadFileAsync(targetUrl, fileUri, {
    httpMethod: String(method || 'PUT').trim() || 'PUT',
    headers: normalizeUploadHeaders(headers),
    uploadType: FileSystemUploadType.BINARY_CONTENT,
  });
  if (!result || Number(result.status || 0) < 200 || Number(result.status || 0) >= 300) {
    throw new Error(String(result?.body || 'direct upload failed'));
  }
  return result;
}

export async function runMediaUploadQueue(items, worker, { concurrency = DEFAULT_MEDIA_UPLOAD_CONCURRENCY, onItemSettled } = {}) {
  const queue = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.min(queue.length || 1, Number(concurrency || DEFAULT_MEDIA_UPLOAD_CONCURRENCY)));
  const results = new Array(queue.length);
  let cursor = 0;

  async function runNext() {
    while (cursor < queue.length) {
      const index = cursor;
      cursor += 1;
      const item = queue[index];
      try {
        results[index] = {
          status: 'fulfilled',
          value: await worker(item, index),
          item,
          index,
        };
      } catch (reason) {
        results[index] = { status: 'rejected', reason, item, index };
      } finally {
        try {
          onItemSettled?.(item, index, results[index]);
        } catch {}
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, runNext));
  return results;
}

export async function prefetchMediaUrls(urls, { cachePolicy = 'memory-disk', batchSize = 8 } = {}) {
  const targets = Array.from(
    new Set(
      (Array.isArray(urls) ? urls : [urls])
        .map((url) => String(url || '').trim())
        .filter((url) => url && (/^https?:\/\//i.test(url) || /^file:\/\//i.test(url))),
    ),
  );
  if (!targets.length) return false;
  const size = Math.max(1, Math.min(Number(batchSize || 8), 16));
  let ok = true;
  try {
    for (let index = 0; index < targets.length; index += size) {
      const batch = targets.slice(index, index + size);
      const result = await Image.prefetch(batch, cachePolicy);
      if (result === false) ok = false;
    }
    return ok;
  } catch {
    return false;
  }
}
