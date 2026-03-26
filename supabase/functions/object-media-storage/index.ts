import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import {
  buildBegetPublicUrl,
  createBegetPresignedPutUrl,
  deleteBegetKeys,
  getBegetS3Config,
  headBegetObject,
  putBegetObject,
} from '../_shared/beget-s3.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

const json = (status: number, body: Record<string, Json>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const DEFAULT_YANDEX_ROOT = '/Монитор';
const OBJECTS_ROOT_DIR = 'Объекты';
const ALLOWED_CATEGORIES = new Set(['media_file_1', 'media_file_2', 'media_file_3']);
const CATEGORY_DIR: Record<string, string> = {
  media_file_1: 'Media_1',
  media_file_2: 'Media_2',
  media_file_3: 'Media_3',
};

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error && typeof error === 'object') {
    const anyErr = error as Record<string, unknown>;
    const message =
      (typeof anyErr.message === 'string' && anyErr.message) ||
      (typeof anyErr.error_description === 'string' && anyErr.error_description) ||
      (typeof anyErr.details === 'string' && anyErr.details) ||
      (typeof anyErr.hint === 'string' && anyErr.hint) ||
      '';
    if (message) return message;
  }
  return 'Unknown error';
}

function sanitizePathSegment(input: string, fallback: string) {
  const normalized = String(input || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/[.]+$/g, '')
    .replace(/^[_-]+|[_-]+$/g, '');
  return normalized.slice(0, 64) || fallback;
}

function buildObjectAddressSummary(objectRow: {
  city?: string | null;
  street?: string | null;
  house?: string | null;
  apartment?: string | null;
}) {
  return [objectRow.city, objectRow.street, objectRow.house]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(', ');
}

function normalizeFolderPath(input: string | null | undefined) {
  const raw = String(input || '').trim();
  if (!raw) return DEFAULT_YANDEX_ROOT;
  if (!raw.startsWith('/')) return `/${raw}`;
  return raw;
}

function getFileExtensionByMime(mime: string) {
  const value = String(mime || '').toLowerCase();
  if (value.includes('png')) return 'png';
  if (value.includes('webp')) return 'webp';
  if (value.includes('heic')) return 'heic';
  if (value.includes('pdf')) return 'pdf';
  if (value.includes('mp4')) return 'mp4';
  if (value.includes('quicktime') || value.includes('mov')) return 'mov';
  return 'jpg';
}

function toBase64UrlSafeName() {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}

function canonicalUrl(raw: string) {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    return `${url.origin}${decodeURIComponent(url.pathname).replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return value.replace(/\/+$/, '').toLowerCase();
  }
}

function keyFromBegetUrl(raw: string) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (!value.includes('://')) {
    return value.replace(/^\/+/, '');
  }
  try {
    const url = new URL(value);
    const cfg = getBegetS3Config();
    const path = decodeURIComponent(url.pathname || '').replace(/^\/+/, '');
    if (!path) return '';

    if (cfg.publicBaseUrl) {
      const publicBase = new URL(cfg.publicBaseUrl);
      const basePath = decodeURIComponent(publicBase.pathname || '').replace(/\/+$/, '').replace(/^\/+/, '');
      if (url.origin === publicBase.origin) {
        if (!basePath) return path;
        if (path === basePath) return '';
        if (path.startsWith(`${basePath}/`)) return path.slice(basePath.length + 1);
      }
    }

    const endpointHost = new URL(cfg.endpoint).host;
    if (url.host === `${cfg.bucket}.${endpointHost}`) {
      return path;
    }
    if (url.host === endpointHost) {
      if (path === cfg.bucket) return '';
      if (path.startsWith(`${cfg.bucket}/`)) return path.slice(cfg.bucket.length + 1);
    }
  } catch {}
  return '';
}

function mapYandexApiError(status: number, payload: string) {
  const text = String(payload || '').toLowerCase();
  if (status === 401 || status === 403 || text.includes('unauthorized') || text.includes('invalid_grant')) {
    return 'Yandex authorization expired. Reconnect disk';
  }
  if (
    status === 507 ||
    text.includes('diskfull') ||
    text.includes('quota') ||
    text.includes('insufficient storage') ||
    text.includes('no space left')
  ) {
    return 'Yandex Disk quota exceeded';
  }
  return '';
}

async function getCallerAndObjectContext(
  admin: ReturnType<typeof createClient>,
  token: string,
  objectId: string,
) {
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(token);
  if (error || !user) throw new Error('Unauthorized');

  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('id, role, company_id')
    .eq('id', user.id)
    .maybeSingle();
  if (profileErr || !profile?.company_id) throw new Error('Profile not found');

  const { data: objectRow, error: objectErr } = await admin
    .from('client_objects')
    .select('id, company_id, name, city, street, house, apartment, created_at')
    .eq('id', objectId)
    .maybeSingle();
  if (objectErr || !objectRow) throw new Error('Object not found');
  if (String(objectRow.company_id || '') !== String(profile.company_id || '')) throw new Error('Forbidden');

  const { data: company, error: companyErr } = await admin
    .from('companies')
    .select('name, media_provider')
    .eq('id', profile.company_id)
    .maybeSingle();
  if (companyErr || !company) throw new Error('Company not found');

  return {
    userId: String(user.id),
    companyId: String(profile.company_id),
    companyName: String(company.name || '').trim() || 'Компания',
    mediaProvider: String(company.media_provider || 'beget_s3'),
    object: {
      id: String(objectRow.id),
      name: String(objectRow.name || '').trim(),
      summary: buildObjectAddressSummary(objectRow),
      created_at: objectRow.created_at ? String(objectRow.created_at) : null,
    },
  };
}

async function refreshAccessToken(refreshToken: string) {
  const clientId = Deno.env.get('YANDEX_OAUTH_CLIENT_ID') || '';
  const clientSecret = Deno.env.get('YANDEX_OAUTH_CLIENT_SECRET') || '';
  if (!clientId || !clientSecret) throw new Error('Missing Yandex OAuth credentials');

  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', refreshToken);
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);

  const res = await fetch('https://oauth.yandex.ru/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${text}`);
  }
  const tokenData = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  if (!tokenData?.access_token) throw new Error('Invalid refresh response');
  return tokenData;
}

async function getValidAccessToken(
  admin: ReturnType<typeof createClient>,
  companyId: string,
): Promise<{ accessToken: string | null; folderPath: string }> {
  const { data: conn, error } = await admin
    .from('company_yandex_disk_connections')
    .select('access_token, refresh_token, token_expires_at, folder_path')
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw error;

  const folderPath = normalizeFolderPath(conn?.folder_path || DEFAULT_YANDEX_ROOT);
  if (!conn) return { accessToken: null, folderPath };

  const expiryMs = new Date(conn.token_expires_at).getTime();
  const nowMs = Date.now();
  if (Number.isFinite(expiryMs) && expiryMs > nowMs + 60_000) {
    return { accessToken: String(conn.access_token), folderPath };
  }

  const refreshed = await refreshAccessToken(conn.refresh_token);
  const nextRefresh = refreshed.refresh_token || conn.refresh_token;
  const nextExpiry = new Date(Date.now() + Math.max(60, Number(refreshed.expires_in || 3600)) * 1000).toISOString();

  const { error: upErr } = await admin
    .from('company_yandex_disk_connections')
    .update({
      access_token: refreshed.access_token,
      refresh_token: nextRefresh,
      token_expires_at: nextExpiry,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', companyId);
  if (upErr) throw upErr;

  return { accessToken: refreshed.access_token, folderPath };
}

async function createYandexFolder(accessToken: string, path: string) {
  const res = await fetch(`https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if ([201, 409].includes(res.status)) return;
  const text = await res.text();
  const mapped = mapYandexApiError(res.status, text);
  throw new Error(mapped || `Cannot create folder: ${text}`);
}

async function ensureFolderTree(accessToken: string, fullPath: string) {
  const normalized = normalizeFolderPath(fullPath);
  const parts = normalized.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = `${current}/${part}`;
    await createYandexFolder(accessToken, current);
  }
}

async function publishAndGetPublicUrl(accessToken: string, path: string) {
  const pubRes = await fetch(
    `https://cloud-api.yandex.net/v1/disk/resources/publish?path=${encodeURIComponent(path)}`,
    { method: 'PUT', headers: { Authorization: `OAuth ${accessToken}` } },
  );
  if (![200, 201, 202, 409].includes(pubRes.status)) {
    const text = await pubRes.text();
    throw new Error(`Publish failed: ${text}`);
  }

  const metaRes = await fetch(
    `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(path)}&fields=public_url`,
    { headers: { Authorization: `OAuth ${accessToken}` } },
  );
  if (!metaRes.ok) {
    const text = await metaRes.text();
    throw new Error(`Read metadata failed: ${text}`);
  }
  const meta = (await metaRes.json()) as { public_url?: string };
  if (!meta?.public_url) throw new Error('No public url available');
  return String(meta.public_url);
}

async function deleteYandexResourceSafe(accessToken: string, path: string) {
  const normalized = String(path || '').trim();
  if (!normalized) return;
  const res = await fetch(
    `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(normalized)}&permanently=true`,
    { method: 'DELETE', headers: { Authorization: `OAuth ${accessToken}` } },
  );
  if (res.status === 204 || res.status === 404) return;
  if (res.status === 202 || res.status === 409 || res.status === 423) return;
  const text = await res.text();
  const mapped = mapYandexApiError(res.status, text);
  throw new Error(mapped || `Delete failed: ${text}`);
}

function buildObjectLabel(objectRow: { id: string; name: string; summary: string }) {
  const shortId = String(objectRow.id || '').slice(0, 8) || 'object';
  const base = objectRow.name || objectRow.summary || `объект_${shortId}`;
  const safeBase = sanitizePathSegment(base, `объект_${shortId}`);
  return `${safeBase}_${shortId}`;
}

function buildObjectMediaKey(
  ctx: { companyName: string; object: { id: string; name: string; summary: string } },
  category: string,
  mime: string,
) {
  const ext = getFileExtensionByMime(mime);
  const companyDir = sanitizePathSegment(ctx.companyName || 'Компания', 'Компания');
  const objectDir = buildObjectLabel(ctx.object);
  const categoryDir = CATEGORY_DIR[category] || sanitizePathSegment(category, 'media');
  return `Компании/${companyDir}/Объекты/${objectDir}/${categoryDir}/медиа_${Date.now()}_${toBase64UrlSafeName()}.${ext}`;
}

function buildObjectYandexPath(
  rootFolder: string,
  ctx: { companyName: string; object: { id: string; name: string; summary: string } },
  category: string,
  mime: string,
) {
  const root = normalizeFolderPath(rootFolder).replace(/\/+$/, '');
  const companyDir = sanitizePathSegment(ctx.companyName || 'Компания', 'Компания');
  const objectDir = buildObjectLabel(ctx.object);
  const categoryDir = CATEGORY_DIR[category] || sanitizePathSegment(category, 'media');
  const ext = getFileExtensionByMime(mime);
  return `${root}/${companyDir}/${OBJECTS_ROOT_DIR}/${objectDir}/${categoryDir}/медиа_${Date.now()}_${toBase64UrlSafeName()}.${ext}`;
}

export async function handleObjectMediaStorageRequest(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { success: false, message: 'POST only' });

  try {
    const supabaseUrl = String(Deno.env.get('SUPABASE_URL') || '').trim();
    const serviceRole =
      String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim() || String(Deno.env.get('SERVICE_ROLE_KEY') || '').trim();
    if (!supabaseUrl || !serviceRole) throw new Error('Missing Supabase env');

    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json(401, { success: false, message: 'Unauthorized' });

    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      object_id?: string;
      category?: string;
      file_base64?: string;
      mime?: string;
      url?: string;
      object_key?: string;
      public_url?: string;
      external_path?: string;
    };

    const action = String(body.action || '').trim();
    const objectId = String(body.object_id || '').trim();
    const category = String(body.category || '').trim();
    if (!action || !objectId || !category) return json(400, { success: false, message: 'Missing action/object_id/category' });
    if (!ALLOWED_CATEGORIES.has(category)) return json(400, { success: false, message: 'Invalid category' });

    const ctx = await getCallerAndObjectContext(admin, token, objectId);

    if (action === 'prepare_upload') {
      const mime = String(body.mime || 'image/jpeg').trim() || 'image/jpeg';
      if (ctx.mediaProvider === 'yandex_disk') {
        const yandex = await getValidAccessToken(admin, ctx.companyId);
        if (!yandex.accessToken) return json(400, { success: false, message: 'Yandex Disk not connected' });

        const yandexPath = buildObjectYandexPath(yandex.folderPath, ctx, category, mime);
        const folderPath = yandexPath.replace(/\/[^/]+$/, '');
        await ensureFolderTree(yandex.accessToken, folderPath);
        const uploadLinkRes = await fetch(
          `https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent(yandexPath)}&overwrite=false`,
          { headers: { Authorization: `OAuth ${yandex.accessToken}` } },
        );
        if (!uploadLinkRes.ok) {
          const text = await uploadLinkRes.text();
          const mapped = mapYandexApiError(uploadLinkRes.status, text);
          throw new Error(mapped || `Upload link failed: ${text}`);
        }
        const linkData = (await uploadLinkRes.json()) as { href?: string };
        return json(200, {
          success: true,
          provider: 'yandex_disk',
          upload_url: String(linkData?.href || ''),
          upload_method: 'PUT',
          upload_headers: { 'Content-Type': mime },
          external_path: yandexPath,
        });
      }

      const objectKey = buildObjectMediaKey(ctx, category, mime);
      const publicUrl = buildBegetPublicUrl(objectKey);
      const signed = await createBegetPresignedPutUrl({
        key: objectKey,
        contentType: mime,
        expiresInSec: 900,
      });
      return json(200, {
        success: true,
        provider: 'beget_s3',
        upload_url: signed.url,
        upload_method: signed.method,
        upload_headers: signed.headers as unknown as Json,
        object_key: objectKey,
        public_url: publicUrl,
      });
    }

    if (action === 'commit_upload') {
      const externalPath = String(body.external_path || '').trim();
      if (externalPath) {
        const yandex = await getValidAccessToken(admin, ctx.companyId);
        if (!yandex.accessToken) return json(400, { success: false, message: 'Yandex Disk not connected' });
        const publicUrl = await publishAndGetPublicUrl(yandex.accessToken, externalPath);
        try {
          const { error: mapErr } = await admin.from('object_media_external_map').upsert(
            {
              company_id: ctx.companyId,
              object_id: ctx.object.id,
              category,
              provider: 'yandex_disk',
              source_url: publicUrl,
              external_path: externalPath,
              display_url: publicUrl,
              display_url_updated_at: new Date().toISOString(),
              created_by: ctx.userId,
            },
            { onConflict: 'object_id,category,source_url' },
          );
          if (mapErr) throw mapErr;
        } catch (error) {
          await deleteYandexResourceSafe(yandex.accessToken, externalPath).catch(() => null);
          throw error;
        }
        return json(200, { success: true, provider: 'yandex_disk', url: publicUrl });
      }

      const objectKey = String(body.object_key || '').trim();
      const publicUrl = String(body.public_url || '').trim() || buildBegetPublicUrl(objectKey);
      if (!objectKey) return json(400, { success: false, message: 'object_key is required' });
      const headResult = await headBegetObject(objectKey);
      const fileSizeBytes = Number(headResult?.ContentLength || 0);
      try {
        const { error: mapErr } = await admin.from('object_media_external_map').upsert(
          {
            company_id: ctx.companyId,
            object_id: ctx.object.id,
            category,
            provider: 'beget_s3',
            source_url: publicUrl,
            external_path: objectKey,
            display_url: publicUrl,
            display_url_updated_at: new Date().toISOString(),
            created_by: ctx.userId,
            file_size_bytes: fileSizeBytes,
          },
          { onConflict: 'object_id,category,source_url' },
        );
        if (mapErr) throw mapErr;
      } catch (error) {
        await deleteBegetKeys([objectKey]).catch(() => null);
        throw error;
      }
      return json(200, { success: true, provider: 'beget_s3', url: publicUrl });
    }

    if (action === 'upload') {
      const b64raw = String(body.file_base64 || '').trim();
      const b64 = b64raw.includes(',') ? b64raw.split(',').pop() || '' : b64raw;
      if (!b64) return json(400, { success: false, message: 'file_base64 is required' });
      const mime = String(body.mime || 'image/jpeg').trim() || 'image/jpeg';
      const bytes = Uint8Array.from(atob(b64), (char) => char.charCodeAt(0));

      if (ctx.mediaProvider === 'yandex_disk') {
        const yandex = await getValidAccessToken(admin, ctx.companyId);
        if (!yandex.accessToken) return json(400, { success: false, message: 'Yandex Disk not connected' });
        const yandexPath = buildObjectYandexPath(yandex.folderPath, ctx, category, mime);
        const folderPath = yandexPath.replace(/\/[^/]+$/, '');
        await ensureFolderTree(yandex.accessToken, folderPath);

        const linkRes = await fetch(
          `https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent(yandexPath)}&overwrite=false`,
          { headers: { Authorization: `OAuth ${yandex.accessToken}` } },
        );
        if (!linkRes.ok) {
          const text = await linkRes.text();
          const mapped = mapYandexApiError(linkRes.status, text);
          throw new Error(mapped || `Upload link failed: ${text}`);
        }
        const linkData = (await linkRes.json()) as { href?: string };
        if (!linkData?.href) throw new Error('Upload href missing');
        const putRes = await fetch(linkData.href, {
          method: 'PUT',
          headers: { 'Content-Type': mime || 'application/octet-stream' },
          body: bytes,
        });
        if (!putRes.ok) {
          const text = await putRes.text();
          throw new Error(`Upload failed: ${text}`);
        }
        const publicUrl = await publishAndGetPublicUrl(yandex.accessToken, yandexPath);
        try {
          const { error: mapErr } = await admin.from('object_media_external_map').upsert(
            {
              company_id: ctx.companyId,
              object_id: ctx.object.id,
              category,
              provider: 'yandex_disk',
              source_url: publicUrl,
              external_path: yandexPath,
              display_url: publicUrl,
              display_url_updated_at: new Date().toISOString(),
              created_by: ctx.userId,
              file_size_bytes: bytes.length,
            },
            { onConflict: 'object_id,category,source_url' },
          );
          if (mapErr) throw mapErr;
        } catch (error) {
          await deleteYandexResourceSafe(yandex.accessToken, yandexPath).catch(() => null);
          throw error;
        }
        return json(200, { success: true, provider: 'yandex_disk', url: publicUrl });
      }

      const objectKey = buildObjectMediaKey(ctx, category, mime);
      const publicUrl = buildBegetPublicUrl(objectKey);
      await putBegetObject({
        key: objectKey,
        body: bytes,
        contentType: mime,
      });
      try {
        const { error: mapErr } = await admin.from('object_media_external_map').upsert(
          {
            company_id: ctx.companyId,
            object_id: ctx.object.id,
            category,
            provider: 'beget_s3',
            source_url: publicUrl,
            external_path: objectKey,
            display_url: publicUrl,
            display_url_updated_at: new Date().toISOString(),
            created_by: ctx.userId,
            file_size_bytes: bytes.length,
          },
          { onConflict: 'object_id,category,source_url' },
        );
        if (mapErr) throw mapErr;
      } catch (error) {
        await deleteBegetKeys([objectKey]).catch(() => null);
        throw error;
      }
      return json(200, { success: true, provider: 'beget_s3', url: publicUrl });
    }

    if (action === 'delete') {
      const sourceUrl = String(body.url || '').trim();
      if (!sourceUrl) return json(400, { success: false, message: 'url is required' });
      const sourceCanonical = canonicalUrl(sourceUrl);

      const { data: candidates, error: candidatesErr } = await admin
        .from('object_media_external_map')
        .select('id, provider, source_url, display_url, external_path')
        .eq('company_id', ctx.companyId)
        .eq('object_id', ctx.object.id)
        .eq('category', category);
      if (candidatesErr) throw candidatesErr;

      const row =
        (candidates || []).find((item) => {
          const source = canonicalUrl(String(item?.source_url || ''));
          const display = canonicalUrl(String((item as { display_url?: string | null })?.display_url || ''));
          return source === sourceCanonical || display === sourceCanonical;
        }) || null;

      const provider = String(row?.provider || '').trim();
      const externalPath = String(row?.external_path || '').trim();
      if (provider === 'yandex_disk' && externalPath) {
        const yandex = await getValidAccessToken(admin, ctx.companyId);
        if (!yandex.accessToken) return json(400, { success: false, message: 'Yandex Disk not connected' });
        await deleteYandexResourceSafe(yandex.accessToken, externalPath);
      } else {
        const begetKey = externalPath || keyFromBegetUrl(sourceUrl);
        if (begetKey) {
          await deleteBegetKeys([begetKey]).catch(() => null);
        }
      }

      if (row?.id != null) {
        await admin.from('object_media_external_map').delete().eq('id', Number(row.id));
      } else {
        await admin
          .from('object_media_external_map')
          .delete()
          .eq('company_id', ctx.companyId)
          .eq('object_id', ctx.object.id)
          .eq('category', category)
          .or(`source_url.eq.${sourceUrl},display_url.eq.${sourceUrl}`);
      }

      return json(200, { success: true });
    }

    return json(400, { success: false, message: 'Unknown action' });
  } catch (error) {
    const message = toErrorMessage(error);
    const lowered = message.toLowerCase();
    const status = lowered.includes('unauthorized')
      ? 401
      : lowered.includes('forbidden')
        ? 403
        : lowered.includes('missing') || lowered.includes('invalid')
          ? 400
          : 500;
    console.error('[object-media-storage]', status, message);
    return json(status, { success: false, message });
  }
}

if (import.meta.main) {
  Deno.serve(handleObjectMediaStorageRequest);
}
