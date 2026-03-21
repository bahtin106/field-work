import { encode as encodeBase64 } from 'base64-arraybuffer';
import { FileSystemUploadType, uploadAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { objectMediaStorage } from '../../../lib/objectMediaStorage';

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
        throw new Error('Не удалось подготовить загрузку');
      }

      const uploadResult = await uploadAsync(uploadUrl, uri, {
        httpMethod: uploadMethod,
        headers: uploadHeaders,
        uploadType: FileSystemUploadType.BINARY_CONTENT,
      });
      if (!uploadResult || Number(uploadResult.status || 0) < 200 || Number(uploadResult.status || 0) >= 300) {
        throw new Error(String(uploadResult?.body || 'Прямая загрузка не удалась'));
      }
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
        throw new Error('Медиа загружено, но ссылка не сохранена');
      }
      return { publicUrl };
    } catch (error) {
      if (directUploadCompleted) throw error;
      console.warn(
        '[object-media] direct upload fallback:',
        String((error as { message?: string })?.message || error || 'unknown'),
      );
    }
  }

  const response = await fetch(uri);
  if (!response.ok) throw new Error('Не удалось прочитать файл');
  const fileBody = await response.arrayBuffer();
  const data = await objectMediaStorage('upload', {
    object_id,
    category: mediaCategory,
    file_base64: encodeBase64(fileBody),
    mime: normalizedMime,
  });
  const publicUrl = String(data?.url || '').trim();
  if (!publicUrl) throw new Error('Медиа загружено, но ссылка не сохранена');
  return { publicUrl };
}

export async function deleteObjectMediaPhotoByUrl(objectId: string, category: string, url: string) {
  const object_id = String(objectId || '').trim();
  const mediaCategory = String(category || '').trim();
  const mediaUrl = String(url || '').trim();
  if (!object_id || !mediaCategory || !mediaUrl) return false;

  await objectMediaStorage('delete', {
    object_id,
    category: mediaCategory,
    url: mediaUrl,
  });
  return true;
}
