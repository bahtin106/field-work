import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

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

const DEFAULT_YANDEX_ROOT = '/\u041c\u043e\u043d\u0438\u0442\u043e\u0440';
const ALLOWED_CATEGORIES = new Set(['media_file_1', 'media_file_2', 'media_file_3', 'media_file_4', 'media_file_5']);
const ORDERS_ROOT_DIR = '\u0417\u0430\u044f\u0432\u043a\u0438';
const INTERNAL_URL_PREFIX = 'yadisk://';
const CATEGORY_DIR: Record<string, string> = {
  media_file_1: 'Media_1',
  media_file_2: 'Media_2',
  media_file_3: 'Media_3',
  media_file_4: 'Media_4',
  media_file_5: 'Media_5',
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
    try {
      return JSON.stringify(anyErr);
    } catch (_e) {}
  }
  return 'Unknown error';
}

function toBase64UrlSafeName() {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}

function normalizeFolderPath(input: string | null | undefined) {
  const raw = String(input || '').trim();
  if (!raw) return DEFAULT_YANDEX_ROOT;
  if (!raw.startsWith('/')) return `/${raw}`;
  return raw;
}

function normalizeUrl(input: string) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    u.hash = '';
    return u.toString();
  } catch (_e) {
    return raw;
  }
}

function canonicalUrl(input: string) {
  const raw = normalizeUrl(input);
  if (!raw) return '';
  try {
    const u = new URL(raw);
    u.search = '';
    const normalizedPath = u.pathname.replace(/\/+$/, '');
    return `${u.origin}${normalizedPath}`.toLowerCase();
  } catch (_e) {
    return raw.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
  }
}

function toYandexDisplayCandidate(url: string) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (raw.startsWith(INTERNAL_URL_PREFIX)) return raw;
  try {
    const u = new URL(raw);
    if (!u.searchParams.has('download')) {
      u.searchParams.set('download', '1');
    }
    return u.toString();
  } catch (_e) {
    return raw;
  }
}

function internalUrlFromPath(path: string) {
  return `${INTERNAL_URL_PREFIX}${encodeURIComponent(String(path || '').trim())}`;
}

function pathFromInternalUrl(sourceUrl: string) {
  const raw = String(sourceUrl || '').trim();
  if (!raw.startsWith(INTERNAL_URL_PREFIX)) return '';
  try {
    return decodeURIComponent(raw.slice(INTERNAL_URL_PREFIX.length));
  } catch (_e) {
    return '';
  }
}

function sanitizePathSegment(input: string, fallback: string) {
  const normalized = String(input || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/[.]+$/g, '')
    .replace(/^[_-]+|[_-]+$/g, '');
  const compact = normalized.slice(0, 64);
  return compact || fallback;
}

function buildObjectAddressSummary(objectRow: {
  city?: string | null;
  street?: string | null;
  house?: string | null;
}) {
  return [objectRow.city, objectRow.street, objectRow.house]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(', ');
}

function mapYandexApiError(status: number, payload: string) {
  const text = String(payload || '').toLowerCase();
  if (status === 401 || status === 403 || text.includes('unauthorized') || text.includes('invalid_grant')) {
    return 'Yandex authorization expired. Reconnect disk';
  }
  if (status === 423 || text.includes('resource is locked') || text.includes('пїЅпїЅпїЅпїЅпїЅпїЅ пїЅпїЅпїЅпїЅпїЅпїЅпїЅпїЅпїЅпїЅпїЅпїЅ')) {
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isYandexPathMissingError(error: unknown) {
  const msg = String(
    (error as { message?: string })?.message || error || '',
  ).toLowerCase();
  return msg.includes('diskpathdoesntexistserror') || msg.includes("doesn't exists");
}

function getFileExtensionByMime(mime: string) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('heic')) return 'heic';
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('quicktime') || m.includes('mov')) return 'mov';
  if (m.includes('pdf')) return 'pdf';
  return 'jpg';
}

function formatMonthBucket(dateIso: string | null | undefined) {
  const d = dateIso ? new Date(dateIso) : new Date();
  const yyyy = String(d.getUTCFullYear());
  const mm = String((d.getUTCMonth() || 0) + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

function buildOrderLabel(order: {
  id: string;
  title?: string | null;
  object_name?: string | null;
  object_summary?: string | null;
}) {
  const shortId = String(order.id || '').slice(0, 8) || 'order';
  const titleCandidate = String(order.title || '').trim();
  const objectCandidate = [order.object_name, order.object_summary]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .join('_');
  const base = titleCandidate || objectCandidate || `\u0437\u0430\u044f\u0432\u043a\u0430_${shortId}`;
  const safeBase = sanitizePathSegment(base, `\u0437\u0430\u044f\u0432\u043a\u0430_${shortId}`);
  return `${safeBase}_${shortId}`;
}

function buildOrderMediaFolder(
  rootFolder: string,
  companyName: string,
  order: {
    id: string;
    title?: string | null;
    object_name?: string | null;
    object_summary?: string | null;
    time_window_start?: string | null;
    created_at?: string | null;
  },
  category: string,
) {
  const root = normalizeFolderPath(rootFolder).replace(/\/+$/, '');
  const companyDir = sanitizePathSegment(companyName || 'Company', 'Company');
  const monthDir = formatMonthBucket(order.time_window_start || order.created_at || null);
  const orderDir = buildOrderLabel(order);
  const categoryDir = CATEGORY_DIR[category] || sanitizePathSegment(category, 'media');
  return `${root}/${companyDir}/${ORDERS_ROOT_DIR}/${monthDir}/${orderDir}/${categoryDir}`;
}

function buildOrderFolderPath(
  rootFolder: string,
  companyName: string,
  order: {
    id: string;
    title?: string | null;
    object_name?: string | null;
    object_summary?: string | null;
    time_window_start?: string | null;
    created_at?: string | null;
  },
) {
  const root = normalizeFolderPath(rootFolder).replace(/\/+$/, '');
  const companyDir = sanitizePathSegment(companyName || 'Company', 'Company');
  const monthDir = formatMonthBucket(order.time_window_start || order.created_at || null);
  const orderDir = buildOrderLabel(order);
  return `${root}/${companyDir}/${ORDERS_ROOT_DIR}/${monthDir}/${orderDir}`;
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

async function getConnection(admin: ReturnType<typeof createClient>, companyId: string) {
  const { data: conn, error } = await admin
    .from('company_yandex_disk_connections')
    .select('access_token, refresh_token, token_expires_at, folder_path')
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw error;
  return conn || null;
}

async function getValidAccessToken(
  admin: ReturnType<typeof createClient>,
  companyId: string,
): Promise<{ accessToken: string | null; folderPath: string }> {
  const conn = await getConnection(admin, companyId);
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

async function getCallerAndOrderContext(
  admin: ReturnType<typeof createClient>,
  token: string,
  orderId: string,
) {
  const {
    data: { user },
    error: authErr,
  } = await admin.auth.getUser(token);
  if (authErr || !user?.id) throw new Error('Unauthorized');

  let profile: { id?: string | null; role?: string | null; company_id?: string | null } | null =
    null;

  const { data: byId, error: byIdErr } = await admin
    .from('profiles')
    .select('id, role, company_id')
    .eq('id', user.id)
    .maybeSingle();
  if (byIdErr) throw byIdErr;
  profile = byId;

  if (!profile && user.email) {
    const { data: byEmail, error: byEmailErr } = await admin
      .from('profiles')
      .select('id, role, company_id')
      .eq('email', String(user.email).toLowerCase())
      .maybeSingle();
    if (byEmailErr) throw byEmailErr;
    profile = byEmail;
  }

  if (!profile?.company_id) throw new Error('Profile not found');

  const { data: order, error: orderErr } = await admin
    .from('orders')
    .select('id, company_id, title, object_id, time_window_start, created_at, object:client_objects(id, name, city, street, house)')
    .eq('id', orderId)
    .maybeSingle();

  if (orderErr || !order) throw new Error('Order not found');
  if (String(order.company_id) !== String(profile.company_id)) throw new Error('Forbidden');

  const { data: company, error: cmpErr } = await admin
    .from('companies')
    .select('name, media_provider')
    .eq('id', profile.company_id)
    .maybeSingle();
  if (cmpErr || !company) throw new Error('Company not found');

  return {
    userId: user.id,
    companyId: String(profile.company_id),
    companyName: String(company.name || 'Company'),
    mediaProvider: String(company.media_provider || 'beget_s3'),
    order: {
      id: String(order.id),
      title: order.title || null,
      object_name: order.object?.name || null,
      object_summary: buildObjectAddressSummary(order.object || {}) || null,
      time_window_start: order.time_window_start || null,
      created_at: order.created_at || null,
    },
  };
}

async function createYandexFolder(accessToken: string, path: string) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await fetch(
      `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(path)}`,
      { method: 'PUT', headers: { Authorization: `OAuth ${accessToken}` } },
    );
    if ([201, 409].includes(res.status)) return;
    const text = await res.text();
    const isLocked = res.status === 423 || String(text || '').toLowerCase().includes('resource is locked');
    if (isLocked && attempt < 4) {
      await sleep(120 * attempt);
      continue;
    }
    const mapped = mapYandexApiError(res.status, text);
    throw new Error(mapped || `Cannot create folder: ${text}`);
  }
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

function parentPath(path: string) {
  const raw = String(path || '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/, '').replace(/\/[^/]+$/, '');
}

function orderFolderPathFromFile(filePath: string) {
  const categoryFolder = parentPath(filePath);
  if (!categoryFolder) return '';
  return parentPath(categoryFolder);
}

async function deleteYandexResourceSafe(accessToken: string, path: string) {
  const normalized = String(path || '').trim();
  if (!normalized) return;
  const maxAttempts = 8;
  let lastStatus = 0;
  let lastPayload = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await fetch(
      `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(normalized)}&permanently=true`,
      { method: 'DELETE', headers: { Authorization: `OAuth ${accessToken}` } },
    );
    if (res.status === 204 || res.status === 404) {
      return;
    }
    if (res.status === 202 || res.status === 409 || res.status === 423) {
      lastStatus = res.status;
      try {
        lastPayload = await res.text();
      } catch (_e) {
        lastPayload = '';
      }
      if (attempt < maxAttempts) {
        await sleep(120 * attempt);
        continue;
      }
      // Never silently continue with DB cleanup when Yandex deletion is not confirmed.
      // This keeps remote and DB states consistent.
      throw new Error(`Delete not confirmed (status ${lastStatus}): ${lastPayload || 'pending/locked'}`);
    }
    const text = await res.text();
    throw new Error(`Delete failed: ${text}`);
  }
}

function isMissingRpcError(error: unknown) {
  const msg = String((error as { message?: string })?.message || error || '').toLowerCase();
  return msg.includes('function') && (msg.includes('does not exist') || msg.includes('not found'));
}

async function appendOrderMediaUrlAtomic(
  admin: ReturnType<typeof createClient>,
  orderId: string,
  companyId: string,
  category: string,
  url: string,
) {
  const { data, error } = await admin.rpc('append_order_media_url_v2', {
    p_order_id: orderId,
    p_company_id: companyId,
    p_category: category,
    p_url: url,
  });
  if (error) {
    if (isMissingRpcError(error)) return null;
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  const urls = Array.isArray(row?.media_urls) ? row.media_urls.map((x: unknown) => String(x || '')) : null;
  return {
    media_urls: urls,
    updated_at: row?.updated_at ? String(row.updated_at) : null,
  };
}

async function removeOrderMediaUrlAtomic(
  admin: ReturnType<typeof createClient>,
  orderId: string,
  companyId: string,
  category: string,
  url: string,
) {
  const { data, error } = await admin.rpc('remove_order_media_url_v2', {
    p_order_id: orderId,
    p_company_id: companyId,
    p_category: category,
    p_url: url,
  });
  if (error) {
    if (isMissingRpcError(error)) return null;
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  const urls = Array.isArray(row?.media_urls) ? row.media_urls.map((x: unknown) => String(x || '')) : [];
  return {
    media_urls: urls,
    updated_at: row?.updated_at ? String(row.updated_at) : null,
  };
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

async function getPathDownloadUrl(accessToken: string, path: string) {
  const dlRes = await fetch(
    `https://cloud-api.yandex.net/v1/disk/resources/download?path=${encodeURIComponent(path)}`,
    { headers: { Authorization: `OAuth ${accessToken}` } },
  );
  if (!dlRes.ok) {
    const text = await dlRes.text();
    const mapped = mapYandexApiError(dlRes.status, text);
    throw new Error(mapped || `Get download link failed: ${text}`);
  }
  const dl = (await dlRes.json()) as { href?: string };
  if (!dl?.href) throw new Error('Download href missing');
  return String(dl.href);
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

export async function handleYandexDiskMediaRequest(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { success: false, message: 'POST only' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRole =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
      Deno.env.get('SERVICE_ROLE_KEY') ||
      '';
    if (!supabaseUrl || !serviceRole) throw new Error('Missing Supabase env');

    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json(401, { success: false, message: 'Unauthorized' });

    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      order_id?: string;
      category?: string;
      file_base64?: string;
      mime?: string;
      url?: string;
      urls?: string[];
      external_path?: string;
    };
    const action = String(body.action || '').trim();
    const orderId = String(body.order_id || '').trim();

    if (!action || !orderId) {
      return json(400, { success: false, message: 'Missing action or order_id' });
    }

    const ctx = await getCallerAndOrderContext(admin, token, orderId);
    const connState = await getValidAccessToken(admin, ctx.companyId);
    const accessToken = connState.accessToken;
    const rootFolder = connState.folderPath;

    const category = String(body.category || '').trim();

    if (action === 'prepare_upload') {
      if (!ALLOWED_CATEGORIES.has(category)) {
        return json(400, { success: false, message: 'Invalid category' });
      }
      if (ctx.mediaProvider !== 'yandex_disk') {
        return json(400, { success: false, message: 'Media provider is not Yandex Disk' });
      }
      if (!accessToken) {
        return json(400, { success: false, message: 'Yandex Disk not connected' });
      }

      const mime = String(body.mime || 'image/jpeg');
      const ext = getFileExtensionByMime(mime);
      const folder = buildOrderMediaFolder(rootFolder, ctx.companyName, ctx.order, category);
      // Folder can be deleted directly in Yandex Disk; always ensure it exists before requesting upload URL.
      await ensureFolderTree(accessToken, folder);

      const filePath = `${folder}/${Date.now()}-${toBase64UrlSafeName()}.${ext}`;
      let linkRes = await fetch(
        `https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent(filePath)}&overwrite=false`,
        { headers: { Authorization: `OAuth ${accessToken}` } },
      );
      if (!linkRes.ok) {
        const text = await linkRes.text();
        const isMissing =
          linkRes.status === 404 ||
          String(text || '').toLowerCase().includes('diskpathdoesntexistserror');
        if (isMissing) {
          await ensureFolderTree(accessToken, folder);
          linkRes = await fetch(
            `https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent(filePath)}&overwrite=false`,
            { headers: { Authorization: `OAuth ${accessToken}` } },
          );
        } else {
          const mapped = mapYandexApiError(linkRes.status, text);
          throw new Error(mapped || `Upload link failed: ${text}`);
        }
      }
      if (!linkRes.ok) {
        const text = await linkRes.text();
        const mapped = mapYandexApiError(linkRes.status, text);
        throw new Error(mapped || `Upload link failed: ${text}`);
      }
      const linkData = (await linkRes.json()) as { href?: string };
      if (!linkData?.href) throw new Error('Upload href missing');

      return json(200, {
        success: true,
        provider: 'yandex_disk',
        upload_url: String(linkData.href),
        upload_method: 'PUT',
        upload_headers: { 'Content-Type': mime || 'application/octet-stream' },
        external_path: filePath,
      });
    }

    if (action === 'commit_upload') {
      if (!ALLOWED_CATEGORIES.has(category)) {
        return json(400, { success: false, message: 'Invalid category' });
      }
      if (!accessToken) {
        return json(400, { success: false, message: 'Yandex Disk not connected' });
      }

      const filePath = String(body.external_path || '').trim();
      if (!filePath) return json(400, { success: false, message: 'external_path is required' });

      const sourceUrl = internalUrlFromPath(filePath);
      let displayUrl = '';
      try {
        displayUrl = await publishAndGetPublicUrl(accessToken, filePath);
      } catch (_e) {
        try {
          displayUrl = await getPathDownloadUrl(accessToken, filePath);
        } catch (_e2) {
          displayUrl = sourceUrl;
        }
      }

      const { error: mapErr } = await admin.from('order_media_external_map').upsert(
        {
          company_id: ctx.companyId,
          order_id: ctx.order.id,
          category,
          provider: 'yandex_disk',
          source_url: sourceUrl,
          external_path: filePath,
          display_url: displayUrl,
          display_url_updated_at: new Date().toISOString(),
          created_by: ctx.userId,
        },
        { onConflict: 'order_id,category,source_url' },
      );
      if (mapErr) throw mapErr;

      const atomicResult = await appendOrderMediaUrlAtomic(
        admin,
        ctx.order.id,
        ctx.companyId,
        category,
        sourceUrl,
      );
      if (!atomicResult) {
        return json(200, {
          success: true,
          url: sourceUrl,
          display_url: displayUrl,
          provider: 'yandex_disk',
        });
      }

      return json(200, {
        success: true,
        url: sourceUrl,
        display_url: displayUrl,
        provider: 'yandex_disk',
        media_urls: atomicResult.media_urls || [],
        order_updated_at: atomicResult.updated_at,
      });
    }

    if (action === 'upload') {
      if (!ALLOWED_CATEGORIES.has(category)) {
        return json(400, { success: false, message: 'Invalid category' });
      }
      if (ctx.mediaProvider !== 'yandex_disk') {
        return json(400, { success: false, message: 'Media provider is not Yandex Disk' });
      }
      if (!accessToken) {
        return json(400, { success: false, message: 'Yandex Disk not connected' });
      }

      const b64raw = String(body.file_base64 || '').trim();
      const b64 = b64raw.includes(',') ? b64raw.split(',').pop() || '' : b64raw;
      if (!b64) return json(400, { success: false, message: 'file_base64 is required' });

      const mime = String(body.mime || 'image/jpeg');
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const ext = getFileExtensionByMime(mime);
      const folder = buildOrderMediaFolder(rootFolder, ctx.companyName, ctx.order, category);
      await ensureFolderTree(accessToken, folder);

      const filePath = `${folder}/${Date.now()}-${toBase64UrlSafeName()}.${ext}`;
      try {
        await uploadToYandex(accessToken, filePath, bytes, mime);
      } catch (e) {
        if (!isYandexPathMissingError(e)) throw e;
        // Folder may be removed externally or by old structure cleanup; recreate and retry once.
        await ensureFolderTree(accessToken, folder);
        await uploadToYandex(accessToken, filePath, bytes, mime);
      }
      const sourceUrl = internalUrlFromPath(filePath);
      // Prefer persistent public URL when possible (cached/display_url), fall back to download link
      let displayUrl = '';
      try {
        // Try to obtain a stable public URL for faster client delivery
        displayUrl = await publishAndGetPublicUrl(accessToken, filePath);
      } catch (e) {
        // Fallback to download href if publishing fails
        try {
          displayUrl = await getPathDownloadUrl(accessToken, filePath);
        } catch (_e) {
          displayUrl = internalUrlFromPath(filePath);
        }
      }

      const { error: mapErr } = await admin.from('order_media_external_map').upsert(
        {
          company_id: ctx.companyId,
          order_id: ctx.order.id,
          category,
          provider: 'yandex_disk',
          source_url: sourceUrl,
          external_path: filePath,
          display_url: displayUrl,
          display_url_updated_at: new Date().toISOString(),
          created_by: ctx.userId,
        },
        { onConflict: 'order_id,category,source_url' },
      );
      if (mapErr) throw mapErr;

      const atomicResult = await appendOrderMediaUrlAtomic(
        admin,
        ctx.order.id,
        ctx.companyId,
        category,
        sourceUrl,
      );
      if (!atomicResult) {
        // Migration with atomic RPC is not applied yet; keep backward-compatible response.
        return json(200, {
          success: true,
          url: sourceUrl,
          display_url: displayUrl,
          provider: 'yandex_disk',
        });
      }

      return json(200, {
        success: true,
        url: sourceUrl,
        display_url: displayUrl,
        provider: 'yandex_disk',
        media_urls: atomicResult.media_urls || [],
        order_updated_at: atomicResult.updated_at,
      });
    }

    if (action === 'resolve_urls') {
      const urls = Array.isArray(body.urls)
        ? body.urls.map((u) => String(u || '').trim()).filter(Boolean)
        : [];
      if (!urls.length) {
        return json(200, { success: true, resolved_urls: {} });
      }

      const directInternalPaths = new Map<string, string>();
      const dbUrls: string[] = [];
      for (const sourceUrl of urls) {
        const directPath = pathFromInternalUrl(sourceUrl);
        if (directPath) {
          directInternalPaths.set(sourceUrl, directPath);
        } else {
          dbUrls.push(sourceUrl);
        }
      }

      let rows: Array<{ source_url: string; external_path: string; display_url?: string | null }> = [];
      if (dbUrls.length) {
        const { data, error } = await admin
          .from('order_media_external_map')
          .select('source_url, external_path, display_url')
          .eq('company_id', ctx.companyId)
          .eq('order_id', ctx.order.id)
          .eq('provider', 'yandex_disk')
          .in('source_url', dbUrls);
        if (error) throw error;
        rows = data || [];
      }

      const resolved: Record<string, string> = {};
      const rowBySource = new Map<string, { source_url: string; external_path: string; display_url?: string | null }>();
      for (const row of rows || []) {
        if (row?.source_url) rowBySource.set(String(row.source_url), row as any);
      }

      for (const sourceUrl of urls) {
        const directPath = directInternalPaths.get(sourceUrl);
        if (directPath && accessToken) {
          try {
            resolved[sourceUrl] = await getPathDownloadUrl(accessToken, directPath);
            continue;
          } catch (_e) {
            resolved[sourceUrl] = sourceUrl;
            continue;
          }
        }

        const row = rowBySource.get(sourceUrl);
        if (!row || !accessToken) {
          resolved[sourceUrl] = toYandexDisplayCandidate(sourceUrl);
          continue;
        }
        // If we already have a cached display URL, use it immediately
        if (row.display_url) {
          resolved[sourceUrl] = String(row.display_url);
          continue;
        }
        try {
          // Try to publish/get a persistent public URL and cache it
          let pubUrl = '';
          try {
            pubUrl = await publishAndGetPublicUrl(accessToken, String(row.external_path));
          } catch (_e) {
            // Fallback to download link
            pubUrl = await getPathDownloadUrl(accessToken, String(row.external_path));
          }
          resolved[sourceUrl] = pubUrl;
          // Best-effort persist to mapping for future requests
          if (row && (row as any).id != null) {
            admin
              .from('order_media_external_map')
              .update({ display_url: pubUrl, display_url_updated_at: new Date().toISOString() })
              .eq('id', Number((row as any).id))
              .then(() => {})
              .catch(() => {});
          }
        } catch (_e) {
          resolved[sourceUrl] = toYandexDisplayCandidate(sourceUrl);
        }
      }

      return json(200, { success: true, resolved_urls: resolved });
    }

    if (action === 'inspect_urls') {
      const category = String(body.category || '').trim();
      if (!ALLOWED_CATEGORIES.has(category)) {
        return json(400, { success: false, message: 'Invalid category' });
      }
      const urls = Array.isArray(body.urls)
        ? body.urls.map((u) => String(u || '').trim()).filter(Boolean)
        : [];
      if (!urls.length) {
        return json(200, {
          success: true,
          resolved_urls: {},
          issues: {},
          cleaned_urls: [],
          media_urls: [],
          order_updated_at: null,
        });
      }

      const directInternalPaths = new Map<string, string>();
      const dbUrls: string[] = [];
      for (const sourceUrl of urls) {
        const directPath = pathFromInternalUrl(sourceUrl);
        if (directPath) {
          directInternalPaths.set(sourceUrl, directPath);
        } else {
          dbUrls.push(sourceUrl);
        }
      }

      let rows: Array<{ id: number; source_url: string; external_path: string; display_url?: string | null }> = [];
      if (dbUrls.length) {
        const { data, error } = await admin
          .from('order_media_external_map')
          .select('id, source_url, external_path, display_url')
          .eq('company_id', ctx.companyId)
          .eq('order_id', ctx.order.id)
          .eq('category', category)
          .eq('provider', 'yandex_disk')
          .in('source_url', dbUrls);
        if (error) throw error;
        rows = data || [];
      }
      let categoryCandidates: Array<{ id: number; source_url: string; external_path: string }> = [];
      if (accessToken) {
        const { data: candidates, error: candidatesErr } = await admin
          .from('order_media_external_map')
          .select('id, source_url, external_path, display_url')
          .eq('company_id', ctx.companyId)
          .eq('order_id', ctx.order.id)
          .eq('category', category)
          .eq('provider', 'yandex_disk');
        if (candidatesErr) throw candidatesErr;
        categoryCandidates = candidates || [];
      }

      const rowBySource = new Map<string, { id: number; source_url: string; external_path: string; display_url?: string | null }>();
      for (const row of rows || []) {
        if (row?.source_url) rowBySource.set(String(row.source_url), row as any);
      }
      const candidateDownloadCanonical = new Map<number, string>();

      const resolved: Record<string, string> = {};
      const issues: Record<string, { code: string; message: string }> = {};
      const cleaned = new Set<string>();
      let lastAtomicResult: { media_urls: string[] | null; updated_at: string | null } | null = null;

      for (const sourceUrl of urls) {
        const directPath = directInternalPaths.get(sourceUrl);
        let mapRow = rowBySource.get(sourceUrl) || null;
        let externalPath = String(mapRow?.external_path || directPath || '').trim();
        const resolvedFallback = toYandexDisplayCandidate(sourceUrl);

        if (!externalPath) {
          const needle = canonicalUrl(sourceUrl);
          if (needle && accessToken) {
            mapRow =
              categoryCandidates.find((row) => canonicalUrl(String(row.source_url || '')) === needle) || null;
            if (!mapRow) {
              for (const candidate of categoryCandidates) {
                  const candidateId = Number(candidate.id);
                  const extPath = String(candidate.external_path || '').trim();
                  if (!extPath) continue;
                  try {
                    // If candidate already has cached display_url, use it for canonical comparison
                    let can = candidateDownloadCanonical.get(candidateId);
                    if (!can) {
                      if ((candidate as any).display_url) {
                        can = canonicalUrl(String((candidate as any).display_url));
                      } else {
                        const dl = await getPathDownloadUrl(accessToken, extPath);
                        can = canonicalUrl(dl);
                      }
                      candidateDownloadCanonical.set(candidateId, can);
                    }
                    if (can && can === needle) {
                      mapRow = candidate;
                      break;
                    }
                  } catch (_e) {}
                }
            }
            externalPath = String(mapRow?.external_path || '').trim();
          }
        }

        if (!externalPath) {
          // Keep legacy/public links as-is if we cannot reliably prove deletion.
          // This is important for mixed providers or old records without map rows.
          resolved[sourceUrl] = sourceUrl;
          continue;
        }

        if (!accessToken) {
          resolved[sourceUrl] = resolvedFallback;
          issues[sourceUrl] = {
            code: 'disk_unavailable',
            message: 'Yandex Disk is temporarily unavailable. Link preserved',
          };
          continue;
        }

        const pathState = await inspectYandexPathStatus(accessToken, externalPath);
        if (pathState.state === 'missing') {
          lastAtomicResult = await removeOrderMediaUrlAtomic(
            admin,
            ctx.order.id,
            ctx.companyId,
            category,
            sourceUrl,
          );
          cleaned.add(sourceUrl);
          if (mapRow?.id != null) {
            await admin.from('order_media_external_map').delete().eq('id', Number(mapRow.id));
          }
          issues[sourceUrl] = {
            code: 'deleted_remote',
            message: 'File deleted from Yandex Disk. Media URL removed from request',
          };
          continue;
        }
        if (pathState.state === 'auth') {
          resolved[sourceUrl] = resolvedFallback;
          issues[sourceUrl] = {
            code: 'disk_auth',
            message: 'Yandex authorization expired. Reconnect disk',
          };
          continue;
        }
        if (pathState.state === 'locked') {
          resolved[sourceUrl] = resolvedFallback;
          issues[sourceUrl] = {
            code: 'disk_locked',
            message: 'Yandex file is temporarily locked',
          };
          continue;
        }
        if (pathState.state === 'error') {
          resolved[sourceUrl] = resolvedFallback;
          issues[sourceUrl] = {
            code: 'disk_error',
            message: 'Temporary Yandex Disk issue. Try again later',
          };
          continue;
        }

        try {
          resolved[sourceUrl] = await getPathDownloadUrl(accessToken, externalPath);
        } catch (e) {
          const msg = toErrorMessage(e).toLowerCase();
          resolved[sourceUrl] = resolvedFallback;
          issues[sourceUrl] = {
            code: msg.includes('unauthorized') ? 'disk_auth' : 'download_error',
            message: msg.includes('unauthorized')
              ? 'Yandex authorization expired. Reconnect disk'
              : 'Temporary download link error. Try again later',
          };
        }
      }

      const cleanedUrls = Array.from(cleaned);
      const currentMedia = Array.isArray(lastAtomicResult?.media_urls)
        ? lastAtomicResult?.media_urls || []
        : urls.filter((u) => !cleaned.has(u));

      return json(200, {
        success: true,
        resolved_urls: resolved,
        issues,
        cleaned_urls: cleanedUrls,
        media_urls: currentMedia,
        order_updated_at: lastAtomicResult?.updated_at ?? null,
      });
    }

    if (action === 'delete') {
      const category = String(body.category || '').trim();
      if (!ALLOWED_CATEGORIES.has(category)) {
        return json(400, { success: false, message: 'Invalid category' });
      }
      const sourceUrl = String(body.url || '').trim();
      if (!sourceUrl) return json(400, { success: false, message: 'url is required' });

      let { data: mapRow, error: mapErr } = await admin
        .from('order_media_external_map')
        .select('id, source_url, external_path, display_url')
        .eq('company_id', ctx.companyId)
        .eq('order_id', ctx.order.id)
        .eq('category', category)
        .eq('provider', 'yandex_disk')
        .eq('source_url', sourceUrl)
        .maybeSingle();
      if (mapErr) throw mapErr;
      if (!mapRow) {
        const { data: displayRow, error: displayErr } = await admin
          .from('order_media_external_map')
          .select('id, source_url, external_path, display_url')
          .eq('company_id', ctx.companyId)
          .eq('order_id', ctx.order.id)
          .eq('category', category)
          .eq('provider', 'yandex_disk')
          .eq('display_url', sourceUrl)
          .maybeSingle();
        if (displayErr) throw displayErr;
        mapRow = displayRow;
      }

      if (!mapRow && accessToken) {
        const { data: candidates, error: listErr } = await admin
          .from('order_media_external_map')
          .select('id, source_url, external_path, display_url')
          .eq('company_id', ctx.companyId)
          .eq('order_id', ctx.order.id)
          .eq('category', category)
          .eq('provider', 'yandex_disk');
        if (listErr) throw listErr;
        const needle = canonicalUrl(sourceUrl);
        mapRow =
          (candidates || []).find((row) => {
            return (
              canonicalUrl(String(row.source_url || '')) === needle ||
              canonicalUrl(String((row as any).display_url || '')) === needle
            );
          }) || null;
        if (!mapRow && needle) {
          for (const row of candidates || []) {
            const extPath = String((row as any)?.external_path || '').trim();
            if (!extPath) continue;
            try {
              const downloadUrl = await getPathDownloadUrl(accessToken, extPath);
              if (canonicalUrl(downloadUrl) === needle) {
                mapRow = row as any;
                break;
              }
            } catch (_e) {}
          }
        }
      }

      if (!mapRow) {
        const directPath = pathFromInternalUrl(sourceUrl);
        if (directPath) {
          mapRow = {
            id: null,
            source_url: sourceUrl,
            external_path: directPath,
          } as any;
        }
      }

      if (!mapRow) {
        return json(404, { success: false, message: 'Media mapping not found' });
      }

      const externalPath = String((mapRow as any).external_path || '').trim();
      if (!externalPath) {
        return json(404, { success: false, message: 'Media mapping not found' });
      }
      if (!accessToken) {
        return json(400, { success: false, message: 'Yandex Disk not connected' });
      }

      await deleteYandexResourceSafe(accessToken, externalPath);

      const preferredSourceUrl = String(mapRow.source_url || '').trim() || sourceUrl;
      let atomicResult = await removeOrderMediaUrlAtomic(
        admin,
        ctx.order.id,
        ctx.companyId,
        category,
        preferredSourceUrl,
      );
      // Backward compatibility: if row wasn't removed (old/public/download URL mismatch),
      // retry with the originally requested URL once.
      if (
        atomicResult &&
        Array.isArray(atomicResult.media_urls) &&
        atomicResult.media_urls.includes(preferredSourceUrl) &&
        sourceUrl !== preferredSourceUrl
      ) {
        atomicResult = await removeOrderMediaUrlAtomic(
          admin,
          ctx.order.id,
          ctx.companyId,
          category,
          sourceUrl,
        );
      }

      if (mapRow.id != null) {
        const { error: delMapErr } = await admin
          .from('order_media_external_map')
          .delete()
          .eq('id', Number(mapRow.id));
        if (delMapErr) throw delMapErr;
      } else {
        const { error: delBySourceErr } = await admin
          .from('order_media_external_map')
          .delete()
          .eq('company_id', ctx.companyId)
          .eq('order_id', ctx.order.id)
          .eq('category', category)
          .eq('provider', 'yandex_disk')
          .eq('source_url', sourceUrl);
        if (delBySourceErr) throw delBySourceErr;
      }

      return json(200, {
        success: true,
        media_urls: atomicResult?.media_urls ?? null,
        order_updated_at: atomicResult?.updated_at ?? null,
      });
    }

    if (action === 'cleanup_order') {
      const { data: mapRows, error: rowsErr } = await admin
        .from('order_media_external_map')
        .select('id, external_path')
        .eq('company_id', ctx.companyId)
        .eq('order_id', ctx.order.id)
        .eq('provider', 'yandex_disk');
      if (rowsErr) throw rowsErr;

      const rows = mapRows || [];
      if (rows.length && !accessToken) {
        return json(400, { success: false, message: 'Yandex Disk not connected' });
      }

      let removedRemote = 0;
      for (const row of rows) {
        const externalPath = String(row?.external_path || '').trim();
        if (!externalPath) continue;
        await deleteYandexResourceSafe(accessToken, externalPath);
        removedRemote += 1;
      }

      if (rows.length) {
        const ids = rows.map((r) => Number(r.id)).filter((x) => Number.isFinite(x));
        if (ids.length) {
          const { error: delMapErr } = await admin
            .from('order_media_external_map')
            .delete()
            .in('id', ids);
          if (delMapErr) throw delMapErr;
        }
      }

      return json(200, {
        success: true,
        removed_remote: removedRemote,
        removed_mappings: rows.length,
      });
    }

    return json(400, { success: false, message: 'Unknown action' });
  } catch (e) {
    const message = toErrorMessage(e);
    const lowered = message.toLowerCase();
    const status = lowered.includes('unauthorized')
      ? 401
      : lowered.includes('forbidden')
        ? 403
        : lowered.includes('missing') || lowered.includes('invalid')
          ? 400
          : 500;
    console.error('[yandex-disk-media]', status, message);
    return json(status, { success: false, message });
  }
}

if (import.meta.main) {
  Deno.serve(handleYandexDiskMediaRequest);
}

