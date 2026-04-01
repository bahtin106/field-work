import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import {
  createBegetPresignedGetUrl,
  createBegetPresignedPutUrl,
  buildBegetPublicUrl,
  deleteBegetKeys,
  headBegetObject,
  listBegetKeys,
  putBegetObject,
} from '../_shared/beget-s3.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

const binary = (status: number, body: BodyInit | null, headers: HeadersInit = {}) =>
  new Response(body, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
      ...headers,
    },
  });

const DEFAULT_YANDEX_ROOT = '/monitor';
const PROFILE_MEDIA_ROOT_DIR = 'profiles';
const INTERNAL_URL_PREFIX = 'yadisk://';
const AVATARS_BUCKET = 'avatars';
const STORAGE_ROOT_PREFIX = 'profiles';
const VALID_ENTITY_TYPES = new Set(['employee', 'client', 'object', 'feedback', 'feedback_attachment']);
const RENDER_TTL_SEC = 60 * 60 * 24 * 30;
const BEGET_COMPANIES_DIR = 'companies';
const BEGET_PROFILES_DIR = 'profiles';
const BEGET_SUPPORT_DIR = 'requests';
const BEGET_SUPPORT_REQUEST_PREFIX = 'request';

const ENTITY_META = {
  employee: {
    table: 'profiles',
    column: 'avatar_url',
    yandexDir: 'employees',
    storagePrefix: (entityId: string) => `${STORAGE_ROOT_PREFIX}/${entityId}`,
    begetDir: 'employees',
  },
  client: {
    table: 'clients',
    column: 'avatar_url',
    yandexDir: 'clients',
    storagePrefix: (entityId: string) => `${STORAGE_ROOT_PREFIX}/clients/${entityId}`,
    begetDir: 'clients',
  },
  object: {
    table: 'client_objects',
    column: 'photo_url',
    yandexDir: 'objects',
    storagePrefix: (entityId: string) => `${STORAGE_ROOT_PREFIX}/objects/${entityId}`,
    begetDir: 'objects',
  },
  feedback: {
    table: 'feedbacks',
    column: 'photo_url',
    yandexDir: 'requests',
    storagePrefix: (entityId: string) => `${STORAGE_ROOT_PREFIX}/feedbacks/${entityId}`,
    begetDir: 'requests',
  },
  feedback_attachment: {
    table: 'feedback_attachments',
    column: 'photo_url',
    yandexDir: 'requests',
    storagePrefix: (entityId: string) => `${STORAGE_ROOT_PREFIX}/feedback_attachments/${entityId}`,
    begetDir: 'requests',
  },
} as const;

type EntityType = keyof typeof ENTITY_META;

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
    try {
      return JSON.stringify(anyErr);
    } catch {}
  }
  return 'Unknown error';
}

function normalizeFolderPath(input: string | null | undefined) {
  const raw = String(input || '').trim();
  if (!raw) return DEFAULT_YANDEX_ROOT;
  if (!raw.startsWith('/')) return `/${raw}`;
  return raw;
}

function normalizePath(path: string | null | undefined) {
  return String(path || '').replace(/^\/+/, '').trim();
}

const CYRILLIC_TO_LATIN: Record<string, string> = {
  А: 'A', а: 'a', Б: 'B', б: 'b', В: 'V', в: 'v', Г: 'G', г: 'g',
  Д: 'D', д: 'd', Е: 'E', е: 'e', Ё: 'E', ё: 'e', Ж: 'Zh', ж: 'zh',
  З: 'Z', з: 'z', И: 'I', и: 'i', Й: 'I', й: 'i', К: 'K', к: 'k',
  Л: 'L', л: 'l', М: 'M', м: 'm', Н: 'N', н: 'n', О: 'O', о: 'o',
  П: 'P', п: 'p', Р: 'R', р: 'r', С: 'S', с: 's', Т: 'T', т: 't',
  У: 'U', у: 'u', Ф: 'F', ф: 'f', Х: 'Kh', х: 'kh', Ц: 'Ts', ц: 'ts',
  Ч: 'Ch', ч: 'ch', Ш: 'Sh', ш: 'sh', Щ: 'Sch', щ: 'sch', Ъ: '', ъ: '',
  Ы: 'Y', ы: 'y', Ь: '', ь: '', Э: 'E', э: 'e', Ю: 'Yu', ю: 'yu',
  Я: 'Ya', я: 'ya',
};

function transliterateCyrillic(input: string) {
  return Array.from(String(input || ''))
    .map((ch) => CYRILLIC_TO_LATIN[ch] ?? ch)
    .join('');
}
function sanitizePathSegment(input: string, fallback: string) {
  const normalized = transliterateCyrillic(String(input || ''))
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/[.]+$/g, '')
    .replace(/^[_-]+|[_-]+$/g, '')
    .toLowerCase();
  const compact = normalized.slice(0, 64);
  if (compact) return compact;
  return (
    transliterateCyrillic(String(fallback || 'item'))
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^[_-]+|[_-]+$/g, '')
      .toLowerCase()
      .slice(0, 64) || 'item'
  );
}

function getFileExtensionByMime(mime: string) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('heic')) return 'heic';
  return 'jpg';
}

function toBase64UrlSafeName() {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}

function parentPath(input: string) {
  const normalized = String(input || '').trim().replace(/\/+$/, '');
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return '';
  return normalized.slice(0, idx);
}

function internalUrlFromPath(path: string) {
  return `${INTERNAL_URL_PREFIX}${encodeURIComponent(String(path || '').trim())}`;
}

function pathFromInternalUrl(sourceUrl: string) {
  const raw = String(sourceUrl || '').trim();
  if (!raw.startsWith(INTERNAL_URL_PREFIX)) return '';
  try {
    return decodeURIComponent(raw.slice(INTERNAL_URL_PREFIX.length));
  } catch {
    return '';
  }
}

function isLikelyPublicYandexUrl(url: string) {
  const raw = String(url || '').trim().toLowerCase();
  return raw.startsWith('https://yadi.sk/') || raw.includes('disk.yandex');
}

function isSupabaseAvatarStorageUrl(url: string | null | undefined) {
  const raw = String(url || '').trim().toLowerCase();
  if (!raw) return false;
  return raw.includes('/storage/v1/object/public/avatars/');
}

async function resolvePublicYandexDownloadUrl(publicUrl: string) {
  const res = await fetch(
    `https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=${encodeURIComponent(publicUrl)}`,
  );
  const text = await res.text();
  if (res.ok) {
    try {
      const data = JSON.parse(text) as { href?: string };
      return { state: 'ok' as const, href: String(data?.href || '').trim() || null };
    } catch {
      return { state: 'error' as const, href: null };
    }
  }
  if (res.status === 404) {
    return { state: 'missing' as const, href: null };
  }
  return { state: 'error' as const, href: null };
}

function toBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(input: string) {
  const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  return atob(padded);
}

async function sha256Base64Url(input: string) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toBase64Url(new Uint8Array(digest));
}

function getRenderSigningSecret() {
  return (
    Deno.env.get('PROFILE_MEDIA_RENDER_SECRET') ||
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
    Deno.env.get('SERVICE_ROLE_KEY') ||
    'profile-media-render-secret'
  );
}

async function signRenderPayload(payload: string) {
  const secret = getRenderSigningSecret();
  return sha256Base64Url(`${secret}:${payload}`);
}

async function buildSignedRenderUrl(
  publicBaseUrl: string,
  params: Record<string, string>,
) {
  const exp = String(Math.floor(Date.now() / 1000) + RENDER_TTL_SEC);
  const search = new URLSearchParams({ ...params, exp });
  const payload = search.toString();
  const sig = await signRenderPayload(payload);
  search.set('sig', sig);
  return `${publicBaseUrl.replace(/\/+$/, '')}/functions/v1/profile-media-storage?${search.toString()}`;
}

function resolvePublicBaseUrl(req: Request, fallbackUrl: string) {
  const envUrl =
    Deno.env.get('SUPABASE_PUBLIC_URL') ||
    Deno.env.get('PROJECT_URL') ||
    Deno.env.get('EXTERNAL_URL') ||
    Deno.env.get('PUBLIC_SUPABASE_URL') ||
    '';
  if (String(envUrl || '').trim()) return String(envUrl).trim().replace(/\/+$/, '');
  try {
    const origin = new URL(req.url).origin;
    if (origin && !origin.includes('kong:8000')) return origin.replace(/\/+$/, '');
  } catch {}
  return String(fallbackUrl || '').trim().replace(/\/+$/, '');
}

async function verifyRenderRequest(url: URL) {
  const sig = String(url.searchParams.get('sig') || '').trim();
  const exp = String(url.searchParams.get('exp') || '').trim();
  if (!sig || !exp) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) return false;

  const signedParams = new URLSearchParams(url.search);
  signedParams.delete('sig');
  const expected = await signRenderPayload(signedParams.toString());
  return expected === sig;
}

async function streamRemoteResponse(remoteUrl: string) {
  const res = await fetch(remoteUrl);
  if (!res.ok) {
    const text = await res.text();
    return binary(404, text || 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  return binary(200, res.body, {
    'Content-Type': res.headers.get('content-type') || 'application/octet-stream',
    'Content-Length': res.headers.get('content-length') || undefined,
  });
}

function mapYandexApiError(status: number, payload: string) {
  const text = String(payload || '').toLowerCase();
  if (status === 401 || status === 403 || text.includes('unauthorized') || text.includes('invalid_grant')) {
    return 'Yandex authorization expired. Reconnect disk';
  }
  if (status === 423 || text.includes('resource is locked') || text.includes('РЎР‚Р ВµРЎРѓРЎС“РЎР‚РЎРѓ Р В·Р В°Р В±Р В»Р С•Р С”Р С‘РЎР‚Р С•Р Р†Р В°Р Р…')) {
    return 'Yandex resource is temporarily locked';
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

async function removeStoragePrefixFiles({
  admin,
  bucket,
  prefix,
  keepPaths = [],
  pageSize = 100,
}: {
  admin: ReturnType<typeof createClient>;
  bucket: string;
  prefix: string;
  keepPaths?: string[];
  pageSize?: number;
}) {
  const keep = new Set((keepPaths || []).map(normalizePath).filter(Boolean));
  const safePrefix = normalizePath(prefix).replace(/\/+$/, '');
  if (!safePrefix) return { removed: 0 };

  let offset = 0;
  let removed = 0;

  while (true) {
    const { data, error } = await admin.storage.from(bucket).list(safePrefix, {
      limit: pageSize,
      offset,
    });
    if (error) throw error;

    const files = Array.isArray(data) ? data : [];
    if (!files.length) break;

    const batch = files
      .map((file) => normalizePath(`${safePrefix}/${file?.name || ''}`))
      .filter((path) => path && !keep.has(path));

    if (batch.length) {
      const { error: removeError } = await admin.storage.from(bucket).remove(batch);
      if (removeError) throw removeError;
      removed += batch.length;
    }

    if (files.length < pageSize) break;
    offset += pageSize;
  }

  return { removed };
}

async function removeBegetPrefixFiles({
  prefix,
  keepPaths = [],
}: {
  prefix: string;
  keepPaths?: string[];
}) {
  const keep = new Set((keepPaths || []).map(normalizePath).filter(Boolean));
  const safePrefix = normalizePath(prefix).replace(/\/+$/, '');
  if (!safePrefix) return { removed: 0 };

  const keys = await listBegetKeys(safePrefix);
  const batch = keys
    .map((key) => normalizePath(key))
    .filter((key) => key && !keep.has(key));

  await deleteBegetKeys(batch);
  return { removed: batch.length };
}

async function createYandexFolder(accessToken: string, path: string) {
  const res = await fetch(
    `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(path)}`,
    { method: 'PUT', headers: { Authorization: `OAuth ${accessToken}` } },
  );
  if ([201, 409].includes(res.status)) return;
  const text = await res.text();
  const mapped = mapYandexApiError(res.status, text);
  throw new Error(mapped || `Cannot access folder ${path}: ${text}`);
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

async function uploadToYandex(accessToken: string, path: string, bytes: Uint8Array, mime: string) {
  const linkRes = await fetch(
    `https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent(path)}&overwrite=false`,
    { headers: { Authorization: `OAuth ${accessToken}` } },
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
    const mapped = mapYandexApiError(putRes.status, text);
    throw new Error(mapped || `Upload failed: ${text}`);
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

async function inspectYandexPathStatus(accessToken: string, path: string) {
  const res = await fetch(
    `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(path)}&fields=path,type,name`,
    { headers: { Authorization: `OAuth ${accessToken}` } },
  );
  const text = await res.text();
  if (res.ok) {
    return { state: 'ok' as const };
  }
  if (res.status === 404 || String(text || '').toLowerCase().includes('diskpathdoesntexistserror')) {
    return { state: 'missing' as const };
  }
  if (res.status === 401 || res.status === 403) {
    return { state: 'auth' as const };
  }
  if (res.status === 423 || String(text || '').toLowerCase().includes('resource is locked')) {
    return { state: 'locked' as const };
  }
  return { state: 'error' as const, details: text };
}

async function getYandexResourceDisplayUrl(accessToken: string, path: string) {
  const res = await fetch(
    `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(path)}&fields=file,preview,public_url`,
    { headers: { Authorization: `OAuth ${accessToken}` } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Read display url failed: ${text}`);
  }
  const data = (await res.json()) as {
    file?: string;
    preview?: string;
    public_url?: string;
  };
  return String(data.preview || data.file || data.public_url || '').trim() || null;
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
  const tokenData = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
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
  const nextExpiry = new Date(
    Date.now() + Math.max(60, Number(refreshed.expires_in || 3600)) * 1000,
  ).toISOString();

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

async function getCallerContext(admin: ReturnType<typeof createClient>, token: string) {
  const {
    data: { user },
    error: authErr,
  } = await admin.auth.getUser(token);
  if (authErr || !user?.id) throw new Error('Unauthorized');

  const { data: profile, error } = await admin
    .from('profiles')
    .select('id, role, company_id')
    .eq('id', user.id)
    .maybeSingle();
  if (error || !profile?.id) throw new Error('Profile not found');
  if (!profile.company_id) throw new Error('Company not found');

  return {
    userId: String(profile.id),
    companyId: String(profile.company_id),
    role: String(profile.role || '').toLowerCase(),
  };
}

function buildEntityLabel(entityType: EntityType, row: Record<string, unknown>) {
  const entityId = String(row.id || '').trim();
  const shortId = entityId.slice(0, 8) || 'item';

  if (entityType === 'employee') {
    const firstName = String(row.first_name || '').trim();
    const middleName = String(row.middle_name || '').trim();
    const lastName = String(row.last_name || '').trim();
    const fullName =
      String(row.full_name || '').trim() ||
      [firstName, middleName, lastName].filter(Boolean).join(' ').trim();
    return sanitizePathSegment(fullName || `employee_${shortId}`, `employee_${shortId}`);
  }

  if (entityType === 'client') {
    const fullName = String(row.full_name || '').trim();
    const fallback = [row.first_name, row.middle_name, row.last_name]
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .join(' ')
      .trim();
    return sanitizePathSegment(fullName || fallback || `client_${shortId}`, `client_${shortId}`);
  }

  if (entityType === 'feedback') {
    return sanitizePathSegment(`request_${shortId}`, `request_${shortId}`);
  }
  if (entityType === 'feedback_attachment') {
    const feedbackId = String(row.feedback_id || '').trim().slice(0, 8) || 'feedback';
    return sanitizePathSegment(`request_${feedbackId}_${shortId}`, `request_${feedbackId}_${shortId}`);
  }

  return sanitizePathSegment(String(row.name || '').trim() || `object_${shortId}`, `object_${shortId}`);
}

function buildYandexFolderPath(
  rootFolder: string,
  companyName: string,
  entityType: EntityType,
  entityLabel: string,
) {
  const root = normalizeFolderPath(rootFolder).replace(/\/+$/, '');
  const companyDir = sanitizePathSegment(companyName || 'company', 'company');
  const entityDir = ENTITY_META[entityType].yandexDir;
  return `${root}/${companyDir}/${PROFILE_MEDIA_ROOT_DIR}/${entityDir}/${entityLabel}`;
}

function buildBegetStoragePrefix(
  companyName: string,
  companyId: string,
  entityType: EntityType,
  entityLabel: string,
  entityId: string,
  entityRow?: Record<string, unknown> | null,
) {
  const companyDir = sanitizePathSegment(companyName || 'company', 'company');
  if (entityType === 'feedback_attachment') {
    const feedbackIdRaw = String(entityRow?.feedback_id || '').trim() || String(entityId || '').trim();
    const feedbackShort = sanitizePathSegment(feedbackIdRaw.slice(0, 8) || 'request', 'request');
    return `${BEGET_COMPANIES_DIR}/${companyDir}/${BEGET_SUPPORT_DIR}/${BEGET_SUPPORT_REQUEST_PREFIX}_${feedbackShort}`;
  }
  if (entityType === 'feedback') {
    const feedbackShort = sanitizePathSegment(String(entityId || '').trim().slice(0, 8) || 'request', 'request');
    return `${BEGET_COMPANIES_DIR}/${companyDir}/${BEGET_SUPPORT_DIR}/${BEGET_SUPPORT_REQUEST_PREFIX}_${feedbackShort}`;
  }

  const entityDir = ENTITY_META[entityType].begetDir;
  const shortId = String(entityId || '').trim().slice(0, 8) || 'item';
  const label = sanitizePathSegment(entityLabel || `${entityDir}_${shortId}`, `${entityDir}_${shortId}`);
  return `${BEGET_COMPANIES_DIR}/${companyDir}/${BEGET_PROFILES_DIR}/${entityDir}/${label}_${shortId}`;
}

async function getEntityContext(
  admin: ReturnType<typeof createClient>,
  companyId: string | null,
  entityType: EntityType,
  entityId: string,
) {
  const meta = ENTITY_META[entityType];
  const select =
    entityType === 'employee'
      ? 'id, company_id, first_name, last_name, full_name, avatar_url'
      : entityType === 'client'
        ? 'id, company_id, first_name, last_name, middle_name, full_name, avatar_url'
        : entityType === 'feedback'
          ? 'id, company_id, text, photo_url'
          : entityType === 'feedback_attachment'
            ? 'id, company_id, feedback_id, photo_url'
          : 'id, company_id, name, photo_url';

  const { data, error } = await admin
    .from(meta.table)
    .select(select)
    .eq('id', entityId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Entity not found');
  if (companyId && String((data as any).company_id || '') !== companyId) throw new Error('Forbidden');

  const { data: company, error: companyErr } = await admin
    .from('companies')
    .select('name, profile_media_provider')
    .eq('id', companyId)
    .maybeSingle();
  if (companyErr) throw companyErr;
  if (!company) throw new Error('Company not found');

  const entityLabel = buildEntityLabel(entityType, data as Record<string, unknown>);
  const currentUrl = String((data as any)[meta.column] || '').trim() || null;

  return {
    entity: data as Record<string, unknown>,
    currentUrl,
    companyName: String(company.name || '').trim() || 'company',
    provider: String(company.profile_media_provider || 'beget_s3'),
    table: meta.table,
    column: meta.column,
    storagePrefix: meta.storagePrefix(entityId),
    begetStoragePrefix: buildBegetStoragePrefix(
      String(company.name || '').trim() || 'company',
      String(companyId || (data as any).company_id || '').trim() || 'company',
      entityType,
      entityLabel,
      entityId,
      data as Record<string, unknown>,
    ),
    entityLabel,
  };
}

function assertWriteAccess(caller: { userId: string; role: string }, entityType: EntityType, entityId: string) {
  if (caller.role === 'superadmin') return;
  if (entityType === 'feedback') return;
  if (entityType === 'feedback_attachment') return;
  if (entityType === 'employee') {
    if (caller.role === 'admin' || caller.userId === entityId) return;
    throw new Error('Forbidden');
  }
  if (caller.role === 'admin' || caller.role === 'dispatcher') return;
  throw new Error('Forbidden');
}

async function getExistingExternalMap(
  admin: ReturnType<typeof createClient>,
  companyId: string,
  entityType: EntityType,
  entityId: string,
) {
  const { data, error } = await admin
    .from('profile_media_external_map')
    .select('id, provider, db_url, external_path')
    .eq('company_id', companyId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function getExternalMapById(
  admin: ReturnType<typeof createClient>,
  mapId: number,
) {
  const { data, error } = await admin
    .from('profile_media_external_map')
    .select('id, company_id, entity_type, entity_id, provider, db_url, external_path')
    .eq('id', mapId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function updateEntityUrl(
  admin: ReturnType<typeof createClient>,
  entityType: EntityType,
  entityId: string,
  nextUrl: string | null,
) {
  const meta = ENTITY_META[entityType];
  const { data, error } = await admin
    .from(meta.table)
    .update({ [meta.column]: nextUrl })
    .eq('id', entityId)
    .select(`id, ${meta.column}`)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error(`Failed to persist ${meta.column}`);

  const persistedUrl = String((data as Record<string, unknown>)[meta.column] || '').trim() || null;
  if ((nextUrl || null) !== persistedUrl) {
    throw new Error(`Failed to persist ${meta.column}`);
  }
}

async function clearYandexMapById(admin: ReturnType<typeof createClient>, mapId: number | null | undefined) {
  if (mapId == null) return;
  const { error } = await admin.from('profile_media_external_map').delete().eq('id', Number(mapId));
  if (error) throw error;
}

async function cleanupExistingMedia({
  admin,
  companyId,
  entityType,
  entityId,
  storagePrefix,
  existingMap,
  keepLocalPath,
  keepBegetPath,
  accessToken,
  cleanupLocal = true,
  cleanupBegetPrefix = false,
}: {
  admin: ReturnType<typeof createClient>;
  companyId: string;
  entityType: EntityType;
  entityId: string;
  storagePrefix: string;
  existingMap: { id: number; provider: string; db_url: string; external_path: string } | null;
  keepLocalPath?: string | null;
  keepBegetPath?: string | null;
  accessToken?: string | null;
  cleanupLocal?: boolean;
  cleanupBegetPrefix?: boolean;
}) {
  if (cleanupLocal) {
    await removeStoragePrefixFiles({
      admin,
      bucket: AVATARS_BUCKET,
      prefix: storagePrefix,
      keepPaths: keepLocalPath ? [keepLocalPath] : [],
    });
  }
  if (cleanupBegetPrefix) {
    // External provider cleanup is processed asynchronously from media_cleanup_queue.
  }
  if (existingMap?.id != null) {
    await clearYandexMapById(admin, existingMap.id);
  }
}

async function uploadToBegetStorage(
  storagePrefix: string,
  bytes: Uint8Array,
  mime: string,
) {
  const ext = getFileExtensionByMime(mime);
  const path = `${storagePrefix}/media_${Date.now()}_${toBase64UrlSafeName()}.${ext}`;

  await putBegetObject({
    key: path,
    body: bytes,
    contentType: mime || 'image/jpeg',
  });

  const publicUrl = buildBegetPublicUrl(path);
  if (!publicUrl) throw new Error('Cannot build public url');

  return { publicUrl, path };
}

async function prepareBegetDirectUpload(
  storagePrefix: string,
  mime: string,
) {
  const ext = getFileExtensionByMime(mime);
  const path = `${storagePrefix}/media_${Date.now()}_${toBase64UrlSafeName()}.${ext}`;
  const publicUrl = buildBegetPublicUrl(path);
  const signed = await createBegetPresignedPutUrl({
    key: path,
    contentType: mime || 'image/jpeg',
    expiresInSec: 900,
  });

  return {
    path,
    publicUrl,
    uploadUrl: signed.url,
    uploadMethod: signed.method,
    uploadHeaders: signed.headers,
  };
}

async function commitBegetDirectUpload(args: {
  admin: ReturnType<typeof createClient>;
  companyId: string;
  callerUserId: string;
  entityType: EntityType;
  entityId: string;
  currentUrl: string | null;
  existingMap: { id: number; provider: string; db_url: string; external_path: string } | null;
  storagePrefix: string;
  objectKey: string;
  publicUrl: string;
}) {
  const headResult = await headBegetObject(args.objectKey);
  const fileSizeBytes = Number(headResult?.ContentLength || 0);
  const accessToken =
    args.existingMap?.provider === 'yandex_disk'
      ? (await getValidAccessToken(args.admin, args.companyId)).accessToken
      : null;
  await cleanupExistingMedia({
    admin: args.admin,
    companyId: args.companyId,
    entityType: args.entityType,
    entityId: args.entityId,
    storagePrefix: args.storagePrefix,
    existingMap: args.existingMap,
    keepBegetPath: args.objectKey,
    accessToken,
    cleanupLocal: isSupabaseAvatarStorageUrl(args.currentUrl),
    cleanupBegetPrefix: false,
  });
  await updateEntityUrl(args.admin, args.entityType, args.entityId, args.publicUrl);
  const { error: mapErr } = await args.admin.from('profile_media_external_map').upsert(
    {
      company_id: args.companyId,
      entity_type: args.entityType,
      entity_id: args.entityId,
      provider: 'beget_s3',
      db_url: args.publicUrl,
      external_path: args.objectKey,
      created_by: args.callerUserId,
      updated_at: new Date().toISOString(),
      file_size_bytes: fileSizeBytes,
    },
    { onConflict: 'entity_type,entity_id' },
  );
  if (mapErr) throw mapErr;

}

async function prepareYandexDirectUpload(args: {
  accessToken: string;
  folderPath: string;
  companyName: string;
  entityType: EntityType;
  entityLabel: string;
  mime: string;
}) {
  const folder = buildYandexFolderPath(
    args.folderPath,
    args.companyName,
    args.entityType,
    args.entityLabel,
  );
  await ensureFolderTree(args.accessToken, folder);

  const ext = getFileExtensionByMime(args.mime);
  const filePath = `${folder}/profile_${Date.now()}_${toBase64UrlSafeName()}.${ext}`;
  const linkRes = await fetch(
    `https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent(filePath)}&overwrite=false`,
    { headers: { Authorization: `OAuth ${args.accessToken}` } },
  );
  if (!linkRes.ok) {
    const text = await linkRes.text();
    const mapped = mapYandexApiError(linkRes.status, text);
    throw new Error(mapped || `Upload link failed: ${text}`);
  }
  const linkData = (await linkRes.json()) as { href?: string };
  if (!linkData?.href) throw new Error('Upload href missing');

  return {
    filePath,
    uploadUrl: String(linkData.href),
    uploadMethod: 'PUT',
    uploadHeaders: { 'Content-Type': args.mime || 'application/octet-stream' },
  };
}

async function commitYandexDirectUpload(args: {
  admin: ReturnType<typeof createClient>;
  companyId: string;
  callerUserId: string;
  entityType: EntityType;
  entityId: string;
  existingMap: { id: number; provider: string; db_url: string; external_path: string } | null;
  storagePrefix: string;
  accessToken: string;
  filePath: string;
}) {
  const publicUrl = await publishAndGetPublicUrl(args.accessToken, args.filePath);
  try {
    await cleanupExistingMedia({
      admin: args.admin,
      companyId: args.companyId,
      entityType: args.entityType,
      entityId: args.entityId,
      storagePrefix: args.storagePrefix,
      existingMap: args.existingMap,
      accessToken: args.accessToken,
    });
    await updateEntityUrl(args.admin, args.entityType, args.entityId, publicUrl);
    const { error: mapErr } = await args.admin.from('profile_media_external_map').upsert(
      {
        company_id: args.companyId,
        entity_type: args.entityType,
        entity_id: args.entityId,
        provider: 'yandex_disk',
        db_url: publicUrl,
        external_path: args.filePath,
        created_by: args.callerUserId,
        updated_at: new Date().toISOString(),
        file_size_bytes: 0,
      },
      { onConflict: 'entity_type,entity_id' },
    );
    if (mapErr) throw mapErr;
  } catch (error) {
    await deleteYandexResourceSafe(args.accessToken, args.filePath).catch(() => null);
    throw error;
  }

  return publicUrl;
}

export async function cleanupProfileMediaEntity(
  admin: ReturnType<typeof createClient>,
  args: {
    companyId: string | null;
    entityType: EntityType;
    entityId: string;
  },
) {
  const { companyId, entityType, entityId } = args;
  const ctx = await getEntityContext(admin, companyId, entityType, entityId);
  const effectiveCompanyId =
    String(companyId || (ctx.entity as Record<string, unknown>)?.company_id || '').trim() || null;
  const feedbackIdForAttachment =
    entityType === 'feedback_attachment'
      ? String((ctx.entity as Record<string, unknown>)?.feedback_id || '').trim()
      : null;
  const feedbackId =
    entityType === 'feedback'
      ? entityId
      : feedbackIdForAttachment || '';
  const feedbackAttachmentIds: string[] = [];
  if (feedbackId) {
    const { data: attachmentRows } = await admin
      .from('feedback_attachments')
      .select('id')
      .eq('feedback_id', feedbackId);
    for (const row of Array.isArray(attachmentRows) ? attachmentRows : []) {
      const attachmentId = String(row?.id || '').trim();
      if (attachmentId) feedbackAttachmentIds.push(attachmentId);
    }
  }
  const existingMap = effectiveCompanyId
    ? await getExistingExternalMap(admin, effectiveCompanyId, entityType, entityId)
    : null;
  if (ctx.currentUrl) {
    await updateEntityUrl(admin, entityType, entityId, null);
  }
  if (feedbackId && feedbackAttachmentIds.length) {
    await admin
      .from('feedback_attachments')
      .update({ photo_url: null })
      .in('id', feedbackAttachmentIds)
      .then(() => {})
      .catch(() => {});
  }

  if (feedbackId && effectiveCompanyId) {
    await admin
      .from('profile_media_external_map')
      .delete()
      .eq('company_id', effectiveCompanyId)
      .eq('entity_type', 'feedback')
      .eq('entity_id', feedbackId)
      .then(() => {})
      .catch(() => {});
    if (feedbackAttachmentIds.length) {
      await admin
        .from('profile_media_external_map')
        .delete()
        .eq('company_id', effectiveCompanyId)
        .eq('entity_type', 'feedback_attachment')
        .in('entity_id', feedbackAttachmentIds)
        .then(() => {})
        .catch(() => {});
    }

    const reason = `feedback_delete:${feedbackId}`;
    await admin
      .from('media_cleanup_queue')
      .update({
        reason,
        max_attempts: 5,
        status: 'pending',
        processed_at: null,
        locked_at: null,
        lock_expires_at: null,
        claimed_by: null,
        error_code: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .is('processed_at', null)
      .eq('entity_type', 'feedback')
      .eq('entity_id', feedbackId)
      .then(() => {})
      .catch(() => {});
    if (feedbackAttachmentIds.length) {
      await admin
        .from('media_cleanup_queue')
        .update({
          reason,
          max_attempts: 5,
          status: 'pending',
          processed_at: null,
          locked_at: null,
          lock_expires_at: null,
          claimed_by: null,
          error_code: null,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .is('processed_at', null)
        .eq('entity_type', 'feedback_attachment')
        .in('entity_id', feedbackAttachmentIds)
        .then(() => {})
        .catch(() => {});
    }
    const { count: queuedJobs } = await admin
      .from('media_cleanup_queue')
      .select('id', { count: 'exact', head: true })
      .eq('reason', reason)
      .is('processed_at', null);
    return { success: true, queued_cleanup_jobs: Number(queuedJobs || 0) };
  }

  if (isSupabaseAvatarStorageUrl(ctx.currentUrl)) {
    await removeStoragePrefixFiles({
      admin,
      bucket: AVATARS_BUCKET,
      prefix: ctx.storagePrefix,
    }).catch(() => null);
  }
  if (existingMap?.id != null) {
    await clearYandexMapById(admin, existingMap.id);
  }

  return { success: true };
}

export async function handleProfileMediaStorageRequest(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const publicBaseUrl = resolvePublicBaseUrl(req, supabaseUrl);
    const serviceRole =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
      Deno.env.get('SERVICE_ROLE_KEY') ||
      '';
    if (!supabaseUrl || !serviceRole) throw new Error('Missing Supabase env');

    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (req.method === 'GET') {
      const url = new URL(req.url);
      if (String(url.searchParams.get('mode') || '').trim() !== 'render') {
        return json(405, { success: false, message: 'POST only' });
      }

      const valid = await verifyRenderRequest(url);
      if (!valid) {
        return binary(403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
      }

      const mapId = Number(url.searchParams.get('map_id') || '');
      const publicKey = String(url.searchParams.get('public_key') || '').trim();

      if (Number.isFinite(mapId) && mapId > 0) {
        const row = await getExternalMapById(admin, mapId);
        if (!row?.external_path || row.provider !== 'yandex_disk') {
          return binary(404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
        }
        const { accessToken } = await getValidAccessToken(admin, String(row.company_id || ''));
        if (!accessToken) {
          return binary(404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
        }
        const displayUrl = await getYandexResourceDisplayUrl(accessToken, String(row.external_path || ''));
        if (!displayUrl) {
          return binary(404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
        }
        return streamRemoteResponse(displayUrl);
      }

      if (publicKey) {
        const publicUrl = fromBase64Url(publicKey);
        const legacyState = await resolvePublicYandexDownloadUrl(publicUrl);
        if (legacyState.state !== 'ok' || !legacyState.href) {
          return binary(404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
        }
        return streamRemoteResponse(legacyState.href);
      }

      return binary(400, 'Bad request', { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    if (req.method !== 'POST') return json(405, { success: false, message: 'POST only' });

    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json(401, { success: false, message: 'Unauthorized' });

    const caller = await getCallerContext(admin, token);
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      entity_type?: string;
      entity_id?: string;
      file_base64?: string;
      mime?: string;
      urls?: string[];
      object_key?: string;
      public_url?: string;
      external_path?: string;
    };

    const action = String(body.action || '').trim();
    if (!action) return json(400, { success: false, message: 'Missing action' });

    if (action === 'inspect_urls') {
      const urls = Array.isArray(body.urls)
        ? body.urls.map((url) => String(url || '').trim()).filter(Boolean)
        : [];
      if (!urls.length) {
        return json(200, { success: true, cleaned_urls: [] });
      }

      const { data: rows, error } = await admin
        .from('profile_media_external_map')
        .select('id, entity_type, entity_id, provider, db_url, external_path')
        .eq('company_id', caller.companyId)
        .in('db_url', urls);
      if (error) throw error;

      const mapByUrl = new Map<string, any>();
      for (const row of rows || []) {
        mapByUrl.set(String(row.db_url || ''), row);
      }

      const needsYandexAccess = urls.some((url) => {
        const row = mapByUrl.get(url);
        if (row) return String(row.provider || '').trim() === 'yandex_disk';
        return isLikelyPublicYandexUrl(url);
      });
      const accessToken = needsYandexAccess
        ? (await getValidAccessToken(admin, caller.companyId)).accessToken
        : null;
      const cleaned: string[] = [];
      const resolvedUrls: Record<string, string> = {};

      for (const url of urls) {
        const row = mapByUrl.get(url);
        if (!row) {
          if (!isLikelyPublicYandexUrl(url)) continue;
          try {
            const legacyState = await resolvePublicYandexDownloadUrl(url);
            if (legacyState.state === 'ok') {
              resolvedUrls[url] = await buildSignedRenderUrl(publicBaseUrl, {
                mode: 'render',
                public_key: toBase64Url(new TextEncoder().encode(url)),
              });
            } else if (legacyState.state === 'missing') {
              cleaned.push(url);
            }
          } catch {}
          continue;
        }

        if (String(row.provider || '').trim() === 'beget_s3') {
          const begetKey = String(row.external_path || '').trim();
          if (begetKey) {
            try {
              const signed = await createBegetPresignedGetUrl({
                key: begetKey,
                expiresInSec: 60 * 60 * 24,
              });
              resolvedUrls[url] = signed.url;
              continue;
            } catch {}
          }
          resolvedUrls[url] = url;
          continue;
        }

        if (!accessToken) continue;

        const pathState = await inspectYandexPathStatus(accessToken, String(row.external_path || ''));
        if (pathState.state !== 'missing') {
          try {
            resolvedUrls[url] = await buildSignedRenderUrl(publicBaseUrl, {
              mode: 'render',
              map_id: String(row.id),
            });
          } catch {}
          continue;
        }

        const entityType = String(row.entity_type || '') as EntityType;
        if (!VALID_ENTITY_TYPES.has(entityType)) continue;

        await updateEntityUrl(admin, entityType, String(row.entity_id || ''), null);
        await clearYandexMapById(admin, Number(row.id));
        cleaned.push(url);
      }

      return json(200, { success: true, cleaned_urls: cleaned, resolved_urls: resolvedUrls });
    }

    const entityType = String(body.entity_type || '').trim() as EntityType;
    const entityId = String(body.entity_id || '').trim();
    if (!VALID_ENTITY_TYPES.has(entityType) || !entityId) {
      return json(400, { success: false, message: 'Missing or invalid entity target' });
    }

    assertWriteAccess(caller, entityType, entityId);

    const contextCompanyId = caller.role === 'superadmin' ? null : caller.companyId;
    const ctx = await getEntityContext(admin, contextCompanyId, entityType, entityId);
    const existingMap = await getExistingExternalMap(admin, caller.companyId, entityType, entityId);

    if (action === 'prepare_upload') {
      const mime = String(body.mime || 'image/jpeg').trim() || 'image/jpeg';

      if (ctx.provider === 'yandex_disk') {
        const connState = await getValidAccessToken(admin, caller.companyId);
        const accessToken = connState.accessToken;
        if (!accessToken) {
          return json(400, { success: false, message: 'Yandex Disk not connected' });
        }
        const prepared = await prepareYandexDirectUpload({
          accessToken,
          folderPath: connState.folderPath,
          companyName: ctx.companyName,
          entityType,
          entityLabel: ctx.entityLabel,
          mime,
        });
        return json(200, {
          success: true,
          provider: 'yandex_disk',
          upload_url: prepared.uploadUrl,
          upload_method: prepared.uploadMethod,
          upload_headers: prepared.uploadHeaders as unknown as Json,
          external_path: prepared.filePath,
        });
      }

      const prepared = await prepareBegetDirectUpload(ctx.begetStoragePrefix, mime);
      return json(200, {
        success: true,
        provider: 'beget_s3',
        upload_url: prepared.uploadUrl,
        upload_method: prepared.uploadMethod,
        upload_headers: prepared.uploadHeaders as unknown as Json,
        object_key: prepared.path,
        public_url: prepared.publicUrl,
      });
    }

    if (action === 'commit_upload') {
      const filePath = String(body.external_path || '').trim();
      if (filePath) {
        const accessToken = (await getValidAccessToken(admin, caller.companyId)).accessToken;
        if (!accessToken) {
          return json(400, { success: false, message: 'Yandex Disk not connected' });
        }
        const publicUrl = await commitYandexDirectUpload({
          admin,
          companyId: caller.companyId,
          callerUserId: caller.userId,
          entityType,
          entityId,
          existingMap,
          storagePrefix: ctx.storagePrefix,
          accessToken,
          filePath,
        });
        return json(200, {
          success: true,
          provider: 'yandex_disk',
          url: publicUrl,
          internal_url: internalUrlFromPath(filePath),
        });
      }

      const objectKey = String(body.object_key || '').trim();
      const publicUrl = String(body.public_url || '').trim() || buildBegetPublicUrl(objectKey);
      if (!objectKey) return json(400, { success: false, message: 'object_key is required' });
      await commitBegetDirectUpload({
        admin,
        companyId: caller.companyId,
        callerUserId: caller.userId,
        entityType,
        entityId,
        currentUrl: ctx.currentUrl,
        existingMap,
        storagePrefix: ctx.storagePrefix,
        objectKey,
        publicUrl,
      });
      return json(200, {
        success: true,
        provider: 'beget_s3',
        url: publicUrl,
      });
    }

    if (action === 'delete' || action === 'cleanup_entity') {
      await cleanupProfileMediaEntity(admin, {
        companyId: caller.role === 'superadmin' ? null : caller.companyId,
        entityType,
        entityId,
      });
      return json(200, { success: true });
    }

    if (action !== 'upload') {
      return json(400, { success: false, message: 'Unknown action' });
    }

    const b64raw = String(body.file_base64 || '').trim();
    const b64 = b64raw.includes(',') ? b64raw.split(',').pop() || '' : b64raw;
    if (!b64) return json(400, { success: false, message: 'file_base64 is required' });

    const mime = String(body.mime || 'image/jpeg').trim() || 'image/jpeg';
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

    if (ctx.provider === 'yandex_disk') {
      const connState = await getValidAccessToken(admin, caller.companyId);
      const accessToken = connState.accessToken;
      if (!accessToken) {
        return json(400, { success: false, message: 'Yandex Disk not connected' });
      }

      const folder = buildYandexFolderPath(
        connState.folderPath,
        ctx.companyName,
        entityType,
        ctx.entityLabel,
      );
      await ensureFolderTree(accessToken, folder);

      const ext = getFileExtensionByMime(mime);
      const filePath = `${folder}/profile_${Date.now()}_${toBase64UrlSafeName()}.${ext}`;
      await uploadToYandex(accessToken, filePath, bytes, mime);
      const publicUrl = await publishAndGetPublicUrl(accessToken, filePath);

      try {
        await cleanupExistingMedia({
          admin,
          companyId: caller.companyId,
          entityType,
          entityId,
          storagePrefix: ctx.storagePrefix,
          existingMap,
          accessToken,
        });
        await updateEntityUrl(admin, entityType, entityId, publicUrl);
        const { error: mapErr } = await admin.from('profile_media_external_map').upsert(
          {
            company_id: caller.companyId,
            entity_type: entityType,
            entity_id: entityId,
            provider: 'yandex_disk',
            db_url: publicUrl,
            external_path: filePath,
            created_by: caller.userId,
            updated_at: new Date().toISOString(),
            file_size_bytes: bytes.length,
          },
          { onConflict: 'entity_type,entity_id' },
        );
        if (mapErr) throw mapErr;
      } catch (error) {
        await deleteYandexResourceSafe(accessToken, filePath).catch(() => null);
        throw error;
      }

      return json(200, {
        success: true,
        url: publicUrl,
        provider: 'yandex_disk',
        internal_url: internalUrlFromPath(filePath),
      });
    }

    const uploadResult = await uploadToBegetStorage(ctx.begetStoragePrefix, bytes, mime);
    try {
      const accessToken =
        existingMap?.provider === 'yandex_disk'
          ? (await getValidAccessToken(admin, caller.companyId)).accessToken
          : null;
      await cleanupExistingMedia({
        admin,
        companyId: caller.companyId,
        entityType,
        entityId,
        storagePrefix: ctx.storagePrefix,
        existingMap,
        keepBegetPath: uploadResult.path,
        accessToken,
        cleanupLocal: isSupabaseAvatarStorageUrl(ctx.currentUrl),
      });
      await updateEntityUrl(admin, entityType, entityId, uploadResult.publicUrl);
      const { error: mapErr } = await admin.from('profile_media_external_map').upsert(
        {
          company_id: caller.companyId,
          entity_type: entityType,
          entity_id: entityId,
          provider: 'beget_s3',
          db_url: uploadResult.publicUrl,
          external_path: uploadResult.path,
          created_by: caller.userId,
          updated_at: new Date().toISOString(),
          file_size_bytes: bytes.length,
        },
        { onConflict: 'entity_type,entity_id' },
      );
      if (mapErr) throw mapErr;

    } catch (error) {
      await deleteBegetKeys([uploadResult.path]).catch(() => null);
      throw error;
    }

    return json(200, {
      success: true,
      url: uploadResult.publicUrl,
      provider: 'beget_s3',
    });
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
    console.error('[profile-media-storage]', status, message);
    return json(status, { success: false, message });
  }
}

if (import.meta.main) {
  Deno.serve(handleProfileMediaStorageRequest);
}






