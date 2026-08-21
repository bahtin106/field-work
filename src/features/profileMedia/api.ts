import { encode as encodeBase64 } from 'base64-arraybuffer';
import { FileSystemUploadType, uploadAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { supabase } from '../../../lib/supabase';
import { getCachedSupabaseAccessToken } from '../../../lib/supabaseSessionCache';
import { t as T } from '../../i18n';
import { canRunDeferredNetworkWork } from '../../shared/offline/offlineStatus';

type EntityType = 'employee' | 'client' | 'object' | 'feedback' | 'feedback_attachment';

const PROFILE_MEDIA_RESOLUTION_TTL_MS = 25 * 24 * 60 * 60 * 1000;
const PROFILE_MEDIA_SIGNED_URL_EXPIRY_SKEW_MS = 5 * 60 * 1000;
const profileMediaResolutionCache = new Map<
  string,
  { cleaned: boolean; resolvedUrl: string; expiresAt: number }
>();
const profileMediaInspectInFlight = new Map<
  string,
  Promise<{ cleanedUrls: string[]; resolvedUrls: Record<string, string> }>
>();

function inferMimeFromUri(uri: string) {
  const raw = String(uri || '').trim().toLowerCase();
  if (raw.endsWith('.png')) return 'image/png';
  if (raw.endsWith('.webp')) return 'image/webp';
  if (raw.endsWith('.heic') || raw.endsWith('.heif')) return 'image/heic';
  return 'image/jpeg';
}

function isLikelyYandexMediaUrl(url: string) {
  const raw = String(url || '').trim();
  if (!raw) return false;
  if (raw.toLowerCase().startsWith('yadisk://')) return true;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    return host === 'yadi.sk' || host.endsWith('.yadi.sk') || host === 'disk.yandex.ru';
  } catch {
    const lower = raw.toLowerCase();
    return (
      lower.includes('yadi.sk') ||
      lower.startsWith('disk.yandex.ru') ||
      /^https?:\/\/disk\.yandex\.ru(?:[/:?#]|$)/i.test(lower)
    );
  }
}

function hasAwsSignatureParams(parsed: URL) {
  for (const key of parsed.searchParams.keys()) {
    const lower = String(key || '').toLowerCase();
    if (lower === 'x-amz-signature' || lower === 'x-amz-algorithm' || lower === 'x-amz-credential') {
      return true;
    }
  }
  return false;
}

function getSearchParamCaseInsensitive(parsed: URL, name: string) {
  const target = String(name || '').toLowerCase();
  for (const [key, value] of parsed.searchParams.entries()) {
    if (String(key || '').toLowerCase() === target) return value;
  }
  return null;
}

function parseAwsDateMs(value: string | null) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return NaN;
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
}

function getSignedUrlCacheTtlMs(resolvedUrl: string) {
  try {
    const parsed = new URL(String(resolvedUrl || '').trim());
    const now = Date.now();

    const exp = Number(getSearchParamCaseInsensitive(parsed, 'exp') || 0);
    const sig = getSearchParamCaseInsensitive(parsed, 'sig');
    if (sig && Number.isFinite(exp) && exp > 0) {
      return Math.max(0, exp * 1000 - now - PROFILE_MEDIA_SIGNED_URL_EXPIRY_SKEW_MS);
    }

    if (hasAwsSignatureParams(parsed)) {
      const awsDateMs = parseAwsDateMs(getSearchParamCaseInsensitive(parsed, 'X-Amz-Date'));
      const awsExpiresSec = Number(getSearchParamCaseInsensitive(parsed, 'X-Amz-Expires') || 0);
      if (Number.isFinite(awsDateMs) && awsDateMs > 0 && Number.isFinite(awsExpiresSec) && awsExpiresSec > 0) {
        return Math.max(0, awsDateMs + awsExpiresSec * 1000 - now - PROFILE_MEDIA_SIGNED_URL_EXPIRY_SKEW_MS);
      }
      return 60 * 60 * 1000;
    }
  } catch {}

  return PROFILE_MEDIA_RESOLUTION_TTL_MS;
}

function isLikelyPrivateBegetMediaUrl(url: string) {
  const raw = String(url || '').trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (hasAwsSignatureParams(parsed)) return false;
    if (host === 'media.monitorapp.ru') return true;
    if (host === 's3.ru1.storage.beget.cloud' || host.endsWith('.storage.beget.cloud')) return true;
  } catch {}
  return false;
}

function isExpiredSignedProfileMediaUrl(url: string) {
  const raw = String(url || '').trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    const hasSignedRenderUrl =
      !!getSearchParamCaseInsensitive(parsed, 'sig') &&
      Number(getSearchParamCaseInsensitive(parsed, 'exp') || 0) > 0;
    if (!hasSignedRenderUrl && !hasAwsSignatureParams(parsed)) return false;
    return getSignedUrlCacheTtlMs(raw) <= 0;
  } catch {}
  return false;
}

export function isRenderableProfileMediaUrl(url: string) {
  const raw = String(url || '').trim();
  if (!raw) return false;
  if (/^(file|content|asset|ph|assets-library):\/\//i.test(raw) || /^data:image\//i.test(raw)) {
    return true;
  }
  if (!/^https?:\/\//i.test(raw)) return false;
  if (isExpiredSignedProfileMediaUrl(raw)) return false;
  if (isLikelyPrivateBegetMediaUrl(raw)) return false;
  return !isLikelyYandexMediaUrl(raw);
}

function uniqueUrls(urls: string[]) {
  return Array.from(new Set(urls.map((url) => String(url || '').trim()).filter(Boolean)));
}

function cacheProfileMediaResolution(sourceUrl: string, resolvedUrl: string, cleaned = false) {
  const source = String(sourceUrl || '').trim();
  const resolved = String(resolvedUrl || '').trim();
  if (!source) return;
  if (!cleaned && !isRenderableProfileMediaUrl(resolved)) return;
  profileMediaResolutionCache.set(source, {
    cleaned,
    resolvedUrl: cleaned ? '' : resolved,
    expiresAt: Date.now() + (cleaned ? PROFILE_MEDIA_RESOLUTION_TTL_MS : getSignedUrlCacheTtlMs(resolved)),
  });
}

export function primeProfileMediaResolution(sourceUrl: string, resolvedUrl: string) {
  cacheProfileMediaResolution(sourceUrl, resolvedUrl, false);
}

export function getCachedProfileMediaResolution(sourceUrl: string) {
  const source = String(sourceUrl || '').trim();
  if (!source) return null;
  if (isRenderableProfileMediaUrl(source)) {
    return { cleaned: false, resolvedUrl: source };
  }

  const cached = profileMediaResolutionCache.get(source);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    profileMediaResolutionCache.delete(source);
    return null;
  }
  return { cleaned: cached.cleaned, resolvedUrl: cached.resolvedUrl };
}

async function invokeProfileMedia(action: string, payload: Record<string, any> = {}) {
  if (!canRunDeferredNetworkWork()) {
    const error = new Error(T('errors_network')) as Error & { code?: string };
    error.code = 'NETWORK_QUALITY_REQUIRED';
    throw error;
  }
  const token = await getCachedSupabaseAccessToken();
  if (!token) throw new Error(T('profile_media_session_expired'));

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
      throw new Error(T('profile_media_read_avatar_failed'));
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
        throw new Error(T('profile_media_prepare_upload_failed'));
      }

      const uploadResult = await uploadAsync(uploadUrl, uri, {
        httpMethod: uploadMethod as any,
        headers: uploadHeaders,
        uploadType: FileSystemUploadType.BINARY_CONTENT,
      });
      if (!uploadResult || Number(uploadResult.status || 0) < 200 || Number(uploadResult.status || 0) >= 300) {
        throw new Error(String(uploadResult?.body || T('profile_media_direct_upload_failed')));
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
        throw new Error(T('profile_media_link_save_failed'));
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
    throw new Error(T('profile_media_link_save_failed'));
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

export async function inspectProfileMedia(urls: string[], options: { forceRefresh?: boolean } = {}) {
  const normalized = Array.isArray(urls) ? uniqueUrls(urls) : [];
  if (!normalized.length) {
    return { cleanedUrls: [], resolvedUrls: {} as Record<string, string> };
  }

  const cleanedUrls: string[] = [];
  const resolvedUrls: Record<string, string> = {};
  const urlsToInspect: string[] = [];
  const forceRefresh = options?.forceRefresh === true;

  for (const url of normalized) {
    const cached = forceRefresh ? null : getCachedProfileMediaResolution(url);
    if (cached?.cleaned) {
      cleanedUrls.push(url);
      continue;
    }
    if (cached?.resolvedUrl) {
      resolvedUrls[url] = cached.resolvedUrl;
      continue;
    }
    urlsToInspect.push(url);
  }

  if (!urlsToInspect.length) {
    return { cleanedUrls, resolvedUrls };
  }

  try {
    const requestKey = urlsToInspect.slice().sort().join('\n');
    let request = profileMediaInspectInFlight.get(requestKey);
    if (!request) {
      request = invokeProfileMedia('inspect_urls', { urls: urlsToInspect }).then((data) => {
        const nextCleanedUrls = Array.isArray(data?.cleaned_urls)
          ? data.cleaned_urls.map((url: unknown) => String(url || '').trim()).filter(Boolean)
          : [];
        const nextResolvedUrls =
          data?.resolved_urls && typeof data.resolved_urls === 'object'
            ? Object.fromEntries(
                Object.entries(data.resolved_urls)
                  .map(([sourceUrl, resolvedUrl]) => [
                    String(sourceUrl || '').trim(),
                    String(resolvedUrl || '').trim(),
                  ])
                  .filter(([sourceUrl, resolvedUrl]) => sourceUrl && resolvedUrl),
              )
            : {};

        for (const cleanedUrl of nextCleanedUrls) {
          cacheProfileMediaResolution(cleanedUrl, '', true);
        }
        for (const [sourceUrl, resolvedUrl] of Object.entries(nextResolvedUrls)) {
          cacheProfileMediaResolution(sourceUrl, String(resolvedUrl || ''), false);
        }

        return { cleanedUrls: nextCleanedUrls, resolvedUrls: nextResolvedUrls };
      });
      profileMediaInspectInFlight.set(requestKey, request);
      request.then(
        () => profileMediaInspectInFlight.delete(requestKey),
        () => profileMediaInspectInFlight.delete(requestKey),
      );
    }

    const inspected = await request;
    return {
      cleanedUrls: [...cleanedUrls, ...inspected.cleanedUrls],
      resolvedUrls: { ...resolvedUrls, ...inspected.resolvedUrls },
    };
  } catch (error) {
    if (isRecoverableProfileMediaError(error)) {
      console.warn('[profile-media] inspect skipped:', String((error as { message?: string })?.message || error || 'unknown'));
      return { cleanedUrls, resolvedUrls };
    }
    throw error;
  }
}

export async function inspectProfileMediaUrls(urls: string[]) {
  const result = await inspectProfileMedia(urls);
  return result.cleanedUrls;
}
