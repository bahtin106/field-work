import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import {
  buildBegetPublicUrl,
  createBegetPresignedGetUrl,
  createBegetPresignedPutUrl,
  deleteBegetKeys,
  getBegetS3Config,
  headBegetObject,
  listBegetKeys,
  putBegetObject,
} from '../_shared/beget-s3.ts';
import {
  MEDIA_UPLOAD_MAX_BYTES,
  assertBase64MediaUploadSize,
  assertCommittedMediaUpload,
  assertMediaUploadSize,
  assertOwnedMediaUploadPath,
  getMediaFileExtension,
  normalizeMediaUploadMime,
} from '../_shared/media-upload-policy.mjs';
import { handleFinanceEntryMediaStorageRequest } from '../finance-entry-media-storage/index.ts';

type SupabaseAdminClient = SupabaseClient<any, 'public', any>;

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
const ALLOWED_MEDIA_ORIGINS = new Set(['app_camera', 'device_library']);
const MIN_CAPTURE_DATE_MS = Date.UTC(2000, 0, 1);
const MAX_CAPTURE_DATE_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

function normalizeClientMediaMetadata(mediaOrigin: unknown, capturedAt: unknown): Record<string, Json> {
  const origin = String(mediaOrigin || '').trim();
  const metadata: Record<string, Json> = {};
  if (ALLOWED_MEDIA_ORIGINS.has(origin)) metadata.media_origin = origin;
  if (origin !== 'app_camera') return metadata;
  const timestamp = new Date(String(capturedAt || '')).getTime();
  if (
    Number.isFinite(timestamp) &&
    timestamp >= MIN_CAPTURE_DATE_MS &&
    timestamp <= Date.now() + MAX_CAPTURE_DATE_FUTURE_SKEW_MS
  ) metadata.captured_at = new Date(timestamp).toISOString();
  return metadata;
}
const CATEGORY_DIR: Record<string, string> = {
  media_file_1: 'Media_1',
  media_file_2: 'Media_2',
  media_file_3: 'Media_3',
  media_file_4: 'Media_4',
  media_file_5: 'Media_5',
};
const LEGACY_CATEGORY_ALIASES: Record<string, string> = {
  photo_1: 'media_file_1',
  photo_2: 'media_file_2',
  photo_3: 'media_file_3',
  photo_4: 'media_file_4',
  photo_5: 'media_file_5',
  media_1: 'media_file_1',
  media_2: 'media_file_2',
  media_3: 'media_file_3',
  media_4: 'media_file_4',
  media_5: 'media_file_5',
  media_before: 'media_file_1',
  media_after: 'media_file_2',
  photo_before: 'media_file_1',
  photo_after: 'media_file_2',
};

function normalizeMediaCategory(input: string | null | undefined) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return '';
  if (ALLOWED_CATEGORIES.has(raw)) return raw;
  if (LEGACY_CATEGORY_ALIASES[raw]) return LEGACY_CATEGORY_ALIASES[raw];
  const digitMatch = raw.match(/([1-5])$/);
  if (digitMatch?.[1]) return `media_file_${digitMatch[1]}`;
  return '';
}

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

const RU_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function toAsciiSlug(input: string, fallback: string) {
  const normalized = String(input || '')
    .trim()
    .toLowerCase()
    .split('')
    .map((ch) => RU_TO_LATIN[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  const safeFallback = String(fallback || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
  return (normalized || safeFallback).slice(0, 64);
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
  admin: SupabaseAdminClient,
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

function toBase64UrlSafeName() {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}

async function getCallerContext(
  admin: SupabaseAdminClient,
  callerDb: SupabaseAdminClient,
  token: string,
) {
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(token);
  if (error || !user) throw new Error('Unauthorized');

  const { data: profile, error: profileErr } = await callerDb
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

async function assertOrderMediaActionAllowed(
  admin: SupabaseAdminClient,
  caller: { companyId: string; role: string },
  action: string,
) {
  const normalizedAction = String(action || '').trim();
  const requiredKeys =
    normalizedAction === 'inspect_urls'
      ? ['canViewOrderPhotos']
      : normalizedAction === 'delete' || normalizedAction === 'cleanup_order'
        ? ['canEditOrders']
        : ['canAddGalleryPhotos', 'canAddCameraPhotos'];

  const checks = await Promise.all(
    requiredKeys.map(async (key) => {
      const { data, error } = await admin.rpc('order_role_has_permission', {
        p_company_id: caller.companyId,
        p_role: caller.role,
        p_key: key,
      });
      if (error) throw error;
      return data === true;
    }),
  );

  const allowed =
    requiredKeys.length === 1 ? checks[0] === true : checks.some((value) => value === true);
  if (!allowed) throw new Error('Forbidden');
}

async function getCallerAndOrderContext(
  admin: SupabaseAdminClient,
  callerDb: SupabaseAdminClient,
  token: string,
  orderId: string,
) {
  const caller = await getCallerContext(admin, callerDb, token);
  const { data: order, error: orderErr } = await callerDb
    .from('orders')
    .select('id, company_id, title, created_at, time_window_start, object:client_objects(name, city, street, house)')
    .eq('id', orderId)
    .maybeSingle();
  if (orderErr || !order) throw new Error('Forbidden');
  if (String(order.company_id || '') !== caller.companyId) throw new Error('Forbidden');

  const orderObjectRelation = order.object as unknown;
  const orderObject = (
    Array.isArray(orderObjectRelation) ? orderObjectRelation[0] : orderObjectRelation
  ) as { name?: string | null; city?: string | null; street?: string | null; house?: string | null } | null | undefined;

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
      object: orderObject
        ? {
            name: orderObject.name || null,
            summary: buildObjectAddressSummary(orderObject),
          }
        : null,
    },
    companyName: String(company.name || '').trim() || 'Компания',
    mediaProvider: String(company.media_provider || 'beget_s3'),
  };
}

async function appendOrderMediaUrlAtomic(
  admin: SupabaseAdminClient,
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
  admin: SupabaseAdminClient,
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
  const base = titleCandidate || objectCandidate || `order-${shortId}`;
  const safeBase = toAsciiSlug(base, `order-${shortId}`);
  return `${safeBase}_${shortId}`;
}

function buildOrderMediaFolder(
  ctx: {
    companyId: string;
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
) {
  const monthDir = formatMonthBucket(ctx.order.time_window_start || ctx.order.created_at || null);
  const companyShort = String(ctx.companyId || '').slice(0, 8) || 'company';
  const companyDir = toAsciiSlug(ctx.companyName || `company-${companyShort}`, `company-${companyShort}`);
  const orderDir = buildOrderLabel(ctx.order);
  const categoryDir = CATEGORY_DIR[category] || toAsciiSlug(category, 'media');
  return `companies/${companyDir}/${companyShort}/orders/${monthDir}/${orderDir}/${categoryDir}`;
}

function buildOrderMediaKey(
  ctx: Parameters<typeof buildOrderMediaFolder>[0],
  category: string,
  mime: string,
) {
  const ext = getMediaFileExtension(mime);
  return `${buildOrderMediaFolder(ctx, category)}/media_${Date.now()}_${toBase64UrlSafeName()}.${ext}`;
}

async function prepareBegetOrderUpload(
  ctx: {
    companyId: string;
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
    const callerDb = createClient(
      supabaseUrl,
      String(Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('ANON_KEY') || serviceRole),
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      },
    );

    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      order_id?: string;
      finance_entry_id?: string;
      category?: string;
      file_base64?: string;
      mime?: string;
      url?: string;
      urls?: string[];
      object_key?: string;
      public_url?: string;
      media_origin?: string;
      captured_at?: string;
    };

    const action = String(body.action || '').trim();
    const clientMediaMetadata = normalizeClientMediaMetadata(body.media_origin, body.captured_at);
    const financeEntryId = String(body.finance_entry_id || '').trim();
    const rawCategory = String(body.category || '').trim().toLowerCase();
    const isLegacyFinanceCategory = rawCategory === 'finance_entry_photo' || rawCategory === 'finance_photo';
    if (financeEntryId && isLegacyFinanceCategory) {
      const delegatedBody = {
        ...body,
        finance_entry_id: financeEntryId,
      };
      return handleFinanceEntryMediaStorageRequest(
        new Request(req.url, {
          method: req.method,
          headers: req.headers,
          body: JSON.stringify(delegatedBody),
        }),
      );
    }

    const orderId = String(body.order_id || '').trim();
    if (!action || !orderId) return json(400, { success: false, message: 'Missing action or order_id' });

    if (!financeEntryId && isLegacyFinanceCategory && action === 'delete') {
      const ctx = await getCallerAndOrderContext(admin, callerDb, token, orderId);
      const sourceUrl = String(body.url || '').trim();
      if (!sourceUrl) return json(400, { success: false, message: 'url is required' });

      let resolvedFinanceEntryId = '';
      const { data: mappedRow, error: mappedErr } = await admin
        .from('finance_entry_media_external_map')
        .select('finance_entry_id')
        .eq('company_id', ctx.companyId)
        .eq('order_id', orderId)
        .eq('provider', 'beget_s3')
        .or(`source_url.eq.${sourceUrl},display_url.eq.${sourceUrl}`)
        .limit(1)
        .maybeSingle();
      if (mappedErr) throw mappedErr;
      resolvedFinanceEntryId = String(mappedRow?.finance_entry_id || '').trim();

      if (!resolvedFinanceEntryId) {
        const { data: candidates, error: candidatesErr } = await admin
          .from('order_finance_entries')
          .select('id, photo_urls')
          .eq('company_id', ctx.companyId)
          .eq('order_id', orderId);
        if (candidatesErr) throw candidatesErr;
        const needle = canonicalUrl(sourceUrl);
        const candidate = (candidates || []).find((entry) => {
          const photoUrls = (entry as { photo_urls?: unknown[] } | undefined)?.photo_urls;
          const urls = Array.isArray(photoUrls)
            ? photoUrls.map((value) => String(value || '').trim()).filter(Boolean)
            : [];
          return urls.some((value) => value === sourceUrl || (needle && canonicalUrl(value) === needle));
        });
        resolvedFinanceEntryId = String((candidate as { id?: string })?.id || '').trim();
      }

      if (!resolvedFinanceEntryId) {
        return json(404, { success: false, message: 'Finance entry media mapping not found' });
      }

      const delegatedBody = {
        ...body,
        finance_entry_id: resolvedFinanceEntryId,
      };
      return handleFinanceEntryMediaStorageRequest(
        new Request(req.url, {
          method: req.method,
          headers: req.headers,
          body: JSON.stringify(delegatedBody),
        }),
      );
    }

    const category = normalizeMediaCategory(body.category);
    if (String(body.category || '').trim() && !category) {
      if (action === 'delete') {
        const ctx = await getCallerAndOrderContext(admin, callerDb, token, orderId);
        const sourceUrl = String(body.url || '').trim();
        if (!sourceUrl) return json(400, { success: false, message: 'url is required' });

        let resolvedFinanceEntryId = '';
        const { data: mappedRow, error: mappedErr } = await admin
          .from('finance_entry_media_external_map')
          .select('finance_entry_id')
          .eq('company_id', ctx.companyId)
          .eq('order_id', orderId)
          .eq('provider', 'beget_s3')
          .or(`source_url.eq.${sourceUrl},display_url.eq.${sourceUrl}`)
          .limit(1)
          .maybeSingle();
        if (mappedErr) throw mappedErr;
        resolvedFinanceEntryId = String(mappedRow?.finance_entry_id || '').trim();

        if (!resolvedFinanceEntryId) {
          const { data: candidates, error: candidatesErr } = await admin
            .from('order_finance_entries')
            .select('id, photo_urls')
            .eq('company_id', ctx.companyId)
            .eq('order_id', orderId);
          if (candidatesErr) throw candidatesErr;
          const needle = canonicalUrl(sourceUrl);
          const candidate = (candidates || []).find((entry) => {
            const photoUrls = (entry as { photo_urls?: unknown[] } | undefined)?.photo_urls;
            const urls = Array.isArray(photoUrls)
              ? photoUrls.map((value) => String(value || '').trim()).filter(Boolean)
              : [];
            return urls.some((value) => value === sourceUrl || (needle && canonicalUrl(value) === needle));
          });
          resolvedFinanceEntryId = String((candidate as { id?: string })?.id || '').trim();
        }

        if (resolvedFinanceEntryId) {
          const delegatedBody = {
            ...body,
            finance_entry_id: resolvedFinanceEntryId,
          };
          return handleFinanceEntryMediaStorageRequest(
            new Request(req.url, {
              method: req.method,
              headers: req.headers,
              body: JSON.stringify(delegatedBody),
            }),
          );
        }
      }
      return json(400, { success: false, message: 'Invalid category' });
    }

    const ctx = await getCallerAndOrderContext(admin, callerDb, token, orderId);
    await assertOrderMediaActionAllowed(admin, ctx, action);
    const isBegetOnlyAction = action === 'prepare_upload' || action === 'upload';
    if (isBegetOnlyAction && ctx.mediaProvider !== 'beget_s3') {
      return json(400, { success: false, message: 'Media provider is not Beget S3' });
    }

    if (action === 'inspect_urls') {
      if (!category) return json(400, { success: false, message: 'Invalid category' });

      const urls = Array.isArray(body.urls)
        ? body.urls.map((value) => String(value || '').trim()).filter(Boolean)
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

      const { data: rows, error } = await admin
        .from('order_media_external_map')
        .select('source_url, display_url, external_path')
        .eq('company_id', ctx.companyId)
        .eq('order_id', ctx.orderId)
        .eq('category', category)
        .eq('provider', 'beget_s3')
        .in('source_url', urls);
      if (error) throw error;

      let candidates: Array<{ source_url?: string | null; display_url?: string | null; external_path?: string | null }> = [];
      if (!rows?.length) {
        const { data: allRows, error: allErr } = await admin
          .from('order_media_external_map')
          .select('source_url, display_url, external_path')
          .eq('company_id', ctx.companyId)
          .eq('order_id', ctx.orderId)
          .eq('category', category)
          .eq('provider', 'beget_s3');
        if (allErr) throw allErr;
        candidates = allRows || [];
      }

      const rowBySource = new Map<string, { source_url?: string | null; display_url?: string | null; external_path?: string | null }>();
      for (const row of rows || []) {
        const source = String(row?.source_url || '').trim();
        if (source) rowBySource.set(source, row);
      }

      const resolved: Record<string, string> = {};
      for (const url of urls) {
        let row = rowBySource.get(url) || null;
        if (!row && candidates.length) {
          const needle = canonicalUrl(url);
          row =
            candidates.find((candidate) => {
              const source = String(candidate?.source_url || '').trim();
              const display = String(candidate?.display_url || '').trim();
              return (needle && (canonicalUrl(source) === needle || canonicalUrl(display) === needle)) || source === url || display === url;
            }) || null;
        }

        const key = String(row?.external_path || '').trim();
        if (!key) {
          resolved[url] = url;
          continue;
        }
        try {
          const signed = await createBegetPresignedGetUrl({
            key,
            expiresInSec: 60 * 60 * 24,
          });
          resolved[url] = signed.url;
        } catch {
          resolved[url] = url;
        }
      }

      return json(200, {
        success: true,
        resolved_urls: resolved,
        issues: {},
        cleaned_urls: [],
        media_urls: urls,
        order_updated_at: null,
      });
    }

    if (action === 'prepare_upload') {
      if (!category) return json(400, { success: false, message: 'Invalid category' });
      const mime = normalizeMediaUploadMime(body.mime);
      const prepared = await prepareBegetOrderUpload(ctx, category, mime);
      return json(200, {
        success: true,
        provider: 'beget_s3',
        upload_url: prepared.uploadUrl,
        upload_method: prepared.uploadMethod,
        upload_headers: prepared.uploadHeaders as unknown as Json,
        object_key: prepared.objectKey,
        public_url: prepared.publicUrl,
        max_size_bytes: MEDIA_UPLOAD_MAX_BYTES,
      });
    }

    if (action === 'commit_upload') {
      if (!category) return json(400, { success: false, message: 'Invalid category' });
      const objectKey = String(body.object_key || '').trim();
      if (!objectKey) return json(400, { success: false, message: 'object_key is required' });

      const expectedFolder = buildOrderMediaFolder(ctx, category);
      const ownedObjectKey = assertOwnedMediaUploadPath(objectKey, { expectedFolder });
      const headResult = await headBegetObject(ownedObjectKey);
      const committed = assertCommittedMediaUpload(
        {
          path: ownedObjectKey,
          contentLength: headResult?.ContentLength,
          contentType: headResult?.ContentType,
        },
        { expectedFolder },
      );
      const fileSizeBytes = committed.size;
      const publicUrl = buildBegetPublicUrl(committed.path);

      const { error: mapErr } = await admin.from('order_media_external_map').upsert(
        {
          company_id: ctx.companyId,
          order_id: ctx.orderId,
          category,
          provider: 'beget_s3',
          source_url: publicUrl,
          external_path: committed.path,
          display_url: publicUrl,
          display_url_updated_at: new Date().toISOString(),
          created_by: ctx.userId,
          file_size_bytes: fileSizeBytes,
          media_metadata: clientMediaMetadata,
        },
        { onConflict: 'order_id,category,source_url' },
      );
      if (mapErr) throw mapErr;

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

      const mime = normalizeMediaUploadMime(body.mime);
      const compactBase64 = assertBase64MediaUploadSize(b64);
      const bytes = Uint8Array.from(atob(compactBase64), (char) => char.charCodeAt(0));
      assertMediaUploadSize(bytes.length);
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
            media_metadata: clientMediaMetadata,
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

      const { data: atomic, error: trashError } = await admin.rpc('trash_media_asset_v1', {
        p_owner_type: 'order',
        p_owner_id: ctx.orderId,
        p_company_id: ctx.companyId,
        p_category: category,
        p_url: sourceUrl,
        p_deleted_by: ctx.userId,
      });
      if (trashError) throw trashError;

      return json(200, {
        success: true,
        provider: 'trash',
        media_urls: Array.isArray(atomic?.media_urls) ? atomic.media_urls : [],
        order_updated_at: atomic?.updated_at || new Date().toISOString(),
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
