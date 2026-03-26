import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import {
  buildBegetPublicUrl,
  createBegetPresignedPutUrl,
  deleteBegetKeys,
  getBegetS3Config,
  headBegetObject,
  listBegetKeys,
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

const ALLOWED_CATEGORIES = new Set(['media_file_1', 'media_file_2', 'media_file_3', 'media_file_4', 'media_file_5']);
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
}) {
  return [objectRow.city, objectRow.street, objectRow.house]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(', ');
}

function canonicalUrl(raw: string) {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    return `${url.origin}${decodeURIComponent(url.pathname).replace(/\/+$/, '')}`;
  } catch {
    return value.replace(/\/+$/, '');
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

function parentKeyPrefix(key: string) {
  const value = String(key || '').replace(/\/+$/, '').trim();
  if (!value) return '';
  return value.replace(/\/[^/]+$/, '');
}

async function purgeBegetCategoryOrphans(
  admin: ReturnType<typeof createClient>,
  args: {
    companyId: string;
    orderId: string;
    category: string;
    folderPrefix: string;
  },
) {
  const folderPrefix = String(args.folderPrefix || '').replace(/^\/+/, '').replace(/\/+$/, '').trim();
  if (!folderPrefix) return 0;

  const { data: rows, error } = await admin
    .from('order_media_external_map')
    .select('external_path')
    .eq('company_id', args.companyId)
    .eq('order_id', args.orderId)
    .eq('category', args.category)
    .eq('provider', 'beget_s3');
  if (error) throw error;

  const activeKeys = new Set(
    Array.isArray(rows)
      ? rows.map((row) => String(row?.external_path || '').replace(/^\/+/, '').trim()).filter(Boolean)
      : [],
  );
  const folderKeys = await listBegetKeys(folderPrefix);
  const orphanKeys = folderKeys.filter((key) => {
    const normalized = String(key || '').replace(/^\/+/, '').trim();
    return normalized && !activeKeys.has(normalized);
  });
  if (!orphanKeys.length) return 0;
  await deleteBegetKeys(orphanKeys);
  return orphanKeys.length;
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

async function getCallerContext(admin: ReturnType<typeof createClient>, token: string) {
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

  return {
    userId: String(user.id),
    companyId: String(profile.company_id),
    role: String(profile.role || '').toLowerCase(),
  };
}

async function getCallerAndOrderContext(admin: ReturnType<typeof createClient>, token: string, orderId: string) {
  const caller = await getCallerContext(admin, token);
  const { data: order, error: orderErr } = await admin
    .from('orders')
    .select('id, company_id, title, created_at, time_window_start, object:client_objects(name, city, street, house)')
    .eq('id', orderId)
    .maybeSingle();
  if (orderErr || !order) throw new Error('Order not found');
  if (String(order.company_id || '') !== caller.companyId) throw new Error('Forbidden');

  const { data: company, error: companyErr } = await admin
    .from('companies')
    .select('name, media_provider')
    .eq('id', caller.companyId)
    .maybeSingle();
  if (companyErr || !company) throw new Error('Company not found');

  return {
    ...caller,
    orderId: String(order.id),
    order: {
      ...order,
      object: order?.object
        ? {
            name: order.object.name || null,
            summary: buildObjectAddressSummary(order.object),
          }
        : null,
    },
    companyName: String(company.name || '').trim() || 'Компания',
    mediaProvider: String(company.media_provider || 'beget_s3'),
  };
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
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    media_urls: Array.isArray(row?.media_urls) ? row.media_urls.map((x: unknown) => String(x || '')) : [],
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
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    media_urls: Array.isArray(row?.media_urls) ? row.media_urls.map((x: unknown) => String(x || '')) : [],
    updated_at: row?.updated_at ? String(row.updated_at) : null,
  };
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
  object?: { name?: string | null; summary?: string | null } | null;
}) {
  const shortId = String(order.id || '').slice(0, 8) || 'order';
  const titleCandidate = String(order.title || '').trim();
  const objectCandidate = [order.object?.name, order.object?.summary]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('_');
  const base = titleCandidate || objectCandidate || `заявка_${shortId}`;
  const safeBase = sanitizePathSegment(base, `заявка_${shortId}`);
  return `${safeBase}_${shortId}`;
}

function buildOrderMediaKey(
  ctx: {
    orderId: string;
    order: {
      id: string;
      title?: string | null;
      created_at?: string | null;
      time_window_start?: string | null;
      object?: { name?: string | null; summary?: string | null } | null;
    };
    companyName: string;
  },
  category: string,
  mime: string,
) {
  const ext = getFileExtensionByMime(mime);
  const monthDir = formatMonthBucket(ctx.order.time_window_start || ctx.order.created_at || null);
  const companyDir = sanitizePathSegment(ctx.companyName || 'Компания', 'Компания');
  const orderDir = buildOrderLabel(ctx.order);
  const categoryDir = CATEGORY_DIR[category] || sanitizePathSegment(category, 'media');
  return `Компании/${companyDir}/Заявки/${monthDir}/${orderDir}/${categoryDir}/медиа_${Date.now()}_${toBase64UrlSafeName()}.${ext}`;
}

async function prepareBegetOrderUpload(
  ctx: {
    orderId: string;
    order: {
      id: string;
      title?: string | null;
      created_at?: string | null;
      time_window_start?: string | null;
      object?: { name?: string | null; summary?: string | null } | null;
    };
    companyName: string;
  },
  category: string,
  mime: string,
) {
  const objectKey = buildOrderMediaKey(ctx, category, mime);
  const publicUrl = buildBegetPublicUrl(objectKey);
  const signed = await createBegetPresignedPutUrl({
    key: objectKey,
    contentType: mime,
    expiresInSec: 900,
  });
  return {
    objectKey,
    publicUrl,
    uploadUrl: signed.url,
    uploadMethod: signed.method,
    uploadHeaders: signed.headers,
  };
}

export async function handleOrderMediaStorageRequest(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { success: false, message: 'POST only' });

  try {
    const supabaseUrl = String(Deno.env.get('SUPABASE_URL') || '').trim();
    const serviceRole =
      String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim() ||
      String(Deno.env.get('SERVICE_ROLE_KEY') || '').trim();
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
      object_key?: string;
      public_url?: string;
    };

    const action = String(body.action || '').trim();
    const orderId = String(body.order_id || '').trim();
    const category = String(body.category || '').trim();
    if (!action || !orderId) return json(400, { success: false, message: 'Missing action or order_id' });
    if (category && !ALLOWED_CATEGORIES.has(category)) {
      return json(400, { success: false, message: 'Invalid category' });
    }

    const ctx = await getCallerAndOrderContext(admin, token, orderId);
    const isBegetOnlyAction = action === 'prepare_upload' || action === 'upload';
    if (isBegetOnlyAction && ctx.mediaProvider !== 'beget_s3') {
      return json(400, { success: false, message: 'Media provider is not Beget S3' });
    }

    if (action === 'prepare_upload') {
      if (!category) return json(400, { success: false, message: 'Invalid category' });
      const mime = String(body.mime || 'image/jpeg').trim() || 'image/jpeg';
      const prepared = await prepareBegetOrderUpload(ctx, category, mime);
      return json(200, {
        success: true,
        provider: 'beget_s3',
        upload_url: prepared.uploadUrl,
        upload_method: prepared.uploadMethod,
        upload_headers: prepared.uploadHeaders as unknown as Json,
        object_key: prepared.objectKey,
        public_url: prepared.publicUrl,
      });
    }

    if (action === 'commit_upload') {
      if (!category) return json(400, { success: false, message: 'Invalid category' });
      const objectKey = String(body.object_key || '').trim();
      const publicUrl = String(body.public_url || '').trim() || buildBegetPublicUrl(objectKey);
      if (!objectKey) return json(400, { success: false, message: 'object_key is required' });

      const headResult = await headBegetObject(objectKey);
      const fileSizeBytes = Number(headResult?.ContentLength || 0);

      try {
        const { error: mapErr } = await admin.from('order_media_external_map').upsert(
          {
            company_id: ctx.companyId,
            order_id: ctx.orderId,
            category,
            provider: 'beget_s3',
            source_url: publicUrl,
            external_path: objectKey,
            display_url: publicUrl,
            display_url_updated_at: new Date().toISOString(),
            created_by: ctx.userId,
            file_size_bytes: fileSizeBytes,
          },
          { onConflict: 'order_id,category,source_url' },
        );
        if (mapErr) throw mapErr;
      } catch (error) {
        await deleteBegetKeys([objectKey]).catch(() => null);
        throw error;
      }

      const atomic = await appendOrderMediaUrlAtomic(admin, ctx.orderId, ctx.companyId, category, publicUrl);
      return json(200, {
        success: true,
        url: publicUrl,
        provider: 'beget_s3',
        media_urls: atomic.media_urls,
        order_updated_at: atomic.updated_at,
      });
    }

    if (action === 'upload') {
      if (!category) return json(400, { success: false, message: 'Invalid category' });

      const b64raw = String(body.file_base64 || '').trim();
      const b64 = b64raw.includes(',') ? b64raw.split(',').pop() || '' : b64raw;
      if (!b64) return json(400, { success: false, message: 'file_base64 is required' });

      const mime = String(body.mime || 'image/jpeg').trim() || 'image/jpeg';
      const bytes = Uint8Array.from(atob(b64), (char) => char.charCodeAt(0));
      const objectKey = buildOrderMediaKey(ctx, category, mime);
      const publicUrl = buildBegetPublicUrl(objectKey);

      await putBegetObject({
        key: objectKey,
        body: bytes,
        contentType: mime,
      });

      try {
        const { error: mapErr } = await admin.from('order_media_external_map').upsert(
          {
            company_id: ctx.companyId,
            order_id: ctx.orderId,
            category,
            provider: 'beget_s3',
            source_url: publicUrl,
            external_path: objectKey,
            display_url: publicUrl,
            display_url_updated_at: new Date().toISOString(),
            created_by: ctx.userId,
            file_size_bytes: bytes.length,
          },
          { onConflict: 'order_id,category,source_url' },
        );
        if (mapErr) throw mapErr;
      } catch (error) {
        await deleteBegetKeys([objectKey]).catch(() => null);
        throw error;
      }

      const atomic = await appendOrderMediaUrlAtomic(admin, ctx.orderId, ctx.companyId, category, publicUrl);
      return json(200, {
        success: true,
        url: publicUrl,
        provider: 'beget_s3',
        media_urls: atomic.media_urls,
        order_updated_at: atomic.updated_at,
      });
    }

    if (action === 'delete') {
      if (!category) return json(400, { success: false, message: 'Invalid category' });
      const sourceUrl = String(body.url || '').trim();
      if (!sourceUrl) return json(400, { success: false, message: 'url is required' });

      let { data: row, error: rowErr } = await admin
        .from('order_media_external_map')
        .select('id, external_path, source_url, display_url')
        .eq('company_id', ctx.companyId)
        .eq('order_id', ctx.orderId)
        .eq('category', category)
        .eq('provider', 'beget_s3')
        .eq('source_url', sourceUrl)
        .maybeSingle();
      if (rowErr) throw rowErr;
      if (!row) {
        const { data: displayRow, error: displayErr } = await admin
          .from('order_media_external_map')
          .select('id, external_path, source_url, display_url')
          .eq('company_id', ctx.companyId)
          .eq('order_id', ctx.orderId)
          .eq('category', category)
          .eq('provider', 'beget_s3')
          .eq('display_url', sourceUrl)
          .maybeSingle();
        if (displayErr) throw displayErr;
        row = displayRow;
      }
      if (!row) {
        const derivedKey = keyFromBegetUrl(sourceUrl);
        const canonicalSourceUrl = canonicalUrl(sourceUrl);
        const { data: candidates, error: listErr } = await admin
          .from('order_media_external_map')
          .select('id, external_path, source_url, display_url')
          .eq('company_id', ctx.companyId)
          .eq('order_id', ctx.orderId)
          .eq('category', category)
          .eq('provider', 'beget_s3');
        if (listErr) throw listErr;
        row =
          (candidates || []).find((candidate) => {
            const candidateKey = String(candidate?.external_path || '').trim();
            const candidateSource = String(candidate?.source_url || '').trim();
            const candidateDisplay = String((candidate as { display_url?: string | null })?.display_url || '').trim();
            return (
              (derivedKey && candidateKey === derivedKey) ||
              (canonicalSourceUrl &&
                (canonicalUrl(candidateSource) === canonicalSourceUrl ||
                  canonicalUrl(candidateDisplay) === canonicalSourceUrl))
            );
          }) || null;
      }
      const fallbackObjectKey = keyFromBegetUrl(sourceUrl);
      if (!row && !fallbackObjectKey) return json(404, { success: false, message: 'Media mapping not found' });

      const objectKey = String(row?.external_path || fallbackObjectKey || '').trim();
      if (objectKey) {
        await deleteBegetKeys([objectKey]);
      }

      const preferredSourceUrl = String(row?.source_url || '').trim() || sourceUrl;
      let atomic = await removeOrderMediaUrlAtomic(admin, ctx.orderId, ctx.companyId, category, preferredSourceUrl);
      if (
        atomic &&
        Array.isArray(atomic.media_urls) &&
        atomic.media_urls.includes(preferredSourceUrl) &&
        sourceUrl !== preferredSourceUrl
      ) {
        atomic = await removeOrderMediaUrlAtomic(admin, ctx.orderId, ctx.companyId, category, sourceUrl);
      }
      if (row?.id != null) {
        await admin.from('order_media_external_map').delete().eq('id', Number(row.id));
      } else {
        await admin
          .from('order_media_external_map')
          .delete()
          .eq('company_id', ctx.companyId)
          .eq('order_id', ctx.orderId)
          .eq('category', category)
          .eq('provider', 'beget_s3')
          .or(`source_url.eq.${sourceUrl},display_url.eq.${sourceUrl},external_path.eq.${objectKey}`);
      }
      const orphanFolder = parentKeyPrefix(objectKey);
      if (orphanFolder) {
        await purgeBegetCategoryOrphans(admin, {
          companyId: ctx.companyId,
          orderId: ctx.orderId,
          category,
          folderPrefix: orphanFolder,
        });
      }

      return json(200, {
        success: true,
        provider: 'beget_s3',
        media_urls: atomic.media_urls,
        order_updated_at: atomic.updated_at,
      });
    }

    if (action === 'cleanup_order') {
      const { data: rows, error } = await admin
        .from('order_media_external_map')
        .select('id, category, external_path')
        .eq('company_id', ctx.companyId)
        .eq('order_id', ctx.orderId)
        .eq('provider', 'beget_s3');
      if (error) throw error;

      const keys = Array.isArray(rows)
        ? rows.map((row) => String(row?.external_path || '').trim()).filter(Boolean)
        : [];
      const folderEntries = Array.isArray(rows)
        ? Array.from(
            new Map(
              rows
                .map((row) => ({
                  category: String((row as { category?: string | null })?.category || '').trim(),
                  folderPrefix: parentKeyPrefix(
                    String((row as { external_path?: string | null })?.external_path || ''),
                  ),
                }))
                .filter((entry) => entry.category && entry.folderPrefix)
                .map((entry) => [`${entry.category}::${entry.folderPrefix}`, entry] as const),
            ).values(),
          )
        : [];
      await deleteBegetKeys(keys);

      await admin
        .from('order_media_external_map')
        .delete()
        .eq('company_id', ctx.companyId)
        .eq('order_id', ctx.orderId)
        .eq('provider', 'beget_s3');

      let removedOrphans = 0;
      for (const entry of folderEntries) {
        removedOrphans += await purgeBegetCategoryOrphans(admin, {
          companyId: ctx.companyId,
          orderId: ctx.orderId,
          category: entry.category,
          folderPrefix: entry.folderPrefix,
        }).catch(() => 0);
      }

      return json(200, {
        success: true,
        removed: keys.length,
        removed_remote: keys.length + removedOrphans,
        provider: 'beget_s3',
      });
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
    console.error('[order-media-storage]', status, message);
    return json(status, { success: false, message });
  }
}

if (import.meta.main) {
  Deno.serve(handleOrderMediaStorageRequest);
}
