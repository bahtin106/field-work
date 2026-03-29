import { encode as encodeBase64 } from 'base64-arraybuffer';
import { FileSystemUploadType, uploadAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { supabase } from '../../../lib/supabase';

type EntityType = 'employee' | 'client' | 'object' | 'feedback' | 'feedback_attachment';

function inferMimeFromUri(uri: string) {
  const raw = String(uri || '').trim().toLowerCase();
  if (raw.endsWith('.png')) return 'image/png';
  if (raw.endsWith('.webp')) return 'image/webp';
  if (raw.endsWith('.heic') || raw.endsWith('.heif')) return 'image/heic';
  return 'image/jpeg';
}

async function invokeProfileMedia(action: string, payload: Record<string, any> = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token ? String(session.access_token) : '';
  if (!token) throw new Error('Сессия истекла. Войдите снова.');

  const { data, error } = await supabase.functions.invoke('profile-media-storage', {
    headers: { Authorization: `Bearer ${token}` },
    body: { action, ...payload },
  });

  if (error) {
    const response = error?.context;
    if (response && typeof response === 'object') {
      const source = typeof response.clone === 'function' ? response.clone() : response;
      if (typeof source.json === 'function') {
        try {
          const payload = await source.json();
          throw new Error(String(payload?.message || payload?.error || error.message || 'Profile media failed'));
        } catch (parseError) {
          if (parseError instanceof Error && parseError.message) throw parseError;
        }
      }
    }
    throw new Error(String(error?.message || 'Profile media failed'));
  }

  if (!data?.success) {
    throw new Error(String(data?.message || data?.error || 'Profile media failed'));
  }

  return data;
}

function isRecoverableProfileMediaError(error: unknown) {
  const message = String((error as { message?: string })?.message || error || '').toLowerCase();
  return (
    message.includes('profile media failed') ||
    message.includes('name resolution failed') ||
    message.includes('dns error') ||
    message.includes('temporary failure in name resolution') ||
    message.includes('failed to lookup address information') ||
    message.includes('permission denied for table profile_media_external_map') ||
    message.includes('permission denied for table clients') ||
    message.includes('permission denied for table client_objects') ||
    message.includes('permission denied for table profiles') ||
    message.includes('failed to send a request to the edge function') ||
    message.includes('edge function returned a non-2xx status code') ||
    message.includes('functions fetch error') ||
    message.includes('function not found') ||
    message.includes('not found') ||
    message.includes('network request failed')
  );
}

export async function uploadProfileMedia(entityType: EntityType, entityId: string, uri: string) {
  if (!entityType || !entityId || !uri) return null;
  let mime = inferMimeFromUri(uri);
  let buffer: ArrayBuffer | null = null;

  const ensureFileData = async () => {
    if (buffer) return;
    const response = await fetch(uri);
    if (!response.ok) {
      throw new Error('Не удалось прочитать файл аватара');
    }
    mime = String(response.headers?.get?.('content-type') || '').trim() || mime || 'image/jpeg';
    buffer = await response.arrayBuffer();
  };

  const tryDirectUpload = Platform.OS !== 'web';
  if (tryDirectUpload) {
    let directUploadCompleted = false;
    try {
      const prepared = await invokeProfileMedia('prepare_upload', {
        entity_type: entityType,
        entity_id: String(entityId),
        mime,
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

      const committed = await invokeProfileMedia('commit_upload', {
        entity_type: entityType,
        entity_id: String(entityId),
        object_key: prepared?.object_key || null,
        public_url: prepared?.public_url || null,
        external_path: prepared?.external_path || null,
      });

      const directUrl = String(committed?.url || '').trim();
      if (!directUrl) {
        throw new Error('Медиа загружено, но ссылка не сохранена');
      }
      return directUrl;
    } catch (error) {
      if (directUploadCompleted) {
        throw error;
      }
      console.warn('[profile-media] direct upload fallback:', String((error as { message?: string })?.message || error || 'unknown'));
    }
  }

  await ensureFileData();
  const data = await invokeProfileMedia('upload', {
    entity_type: entityType,
    entity_id: String(entityId),
    file_base64: encodeBase64(buffer as ArrayBuffer),
    mime,
  });

  const url = String(data?.url || '').trim();
  if (!url) {
    throw new Error('Медиа загружено, но ссылка не сохранена');
  }

  return url;
}

export async function deleteProfileMedia(entityType: EntityType, entityId: string) {
  if (!entityType || !entityId) return;
  await invokeProfileMedia('delete', {
    entity_type: entityType,
    entity_id: String(entityId),
  });
}

export async function cleanupProfileMediaEntity(entityType: EntityType, entityId: string) {
  if (!entityType || !entityId) return;
  return invokeProfileMedia('cleanup_entity', {
    entity_type: entityType,
    entity_id: String(entityId),
  });
}

export async function inspectProfileMedia(urls: string[]) {
  const normalized = Array.isArray(urls)
    ? urls.map((url) => String(url || '').trim()).filter(Boolean)
    : [];
  if (!normalized.length) {
    return { cleanedUrls: [], resolvedUrls: {} as Record<string, string> };
  }

  try {
    const data = await invokeProfileMedia('inspect_urls', { urls: normalized });
    return {
      cleanedUrls: Array.isArray(data?.cleaned_urls)
        ? data.cleaned_urls.map((url: unknown) => String(url || '').trim()).filter(Boolean)
        : [],
      resolvedUrls:
        data?.resolved_urls && typeof data.resolved_urls === 'object'
          ? Object.fromEntries(
              Object.entries(data.resolved_urls)
                .map(([sourceUrl, resolvedUrl]) => [
                  String(sourceUrl || '').trim(),
                  String(resolvedUrl || '').trim(),
                ])
                .filter(([sourceUrl, resolvedUrl]) => sourceUrl && resolvedUrl),
            )
          : {},
    };
  } catch (error) {
    if (isRecoverableProfileMediaError(error)) {
      console.warn('[profile-media] inspect skipped:', String((error as { message?: string })?.message || error || 'unknown'));
      return { cleanedUrls: [], resolvedUrls: {} as Record<string, string> };
    }
    throw error;
  }
}

export async function inspectProfileMediaUrls(urls: string[]) {
  const result = await inspectProfileMedia(urls);
  return result.cleanedUrls;
}
