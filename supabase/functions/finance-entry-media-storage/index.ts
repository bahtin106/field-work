import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import {
  buildBegetPublicUrl,
  createBegetPresignedPutUrl,
  deleteBegetKeys,
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
  if (!value.includes('://')) return value.replace(/^\/+/, '');
  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname || '').replace(/^\/+/, '');
  } catch {
    return '';
  }
}

function parentKeyPrefix(key: string) {
  const value = String(key || '').replace(/\/+$/, '').trim();
  if (!value) return '';
  return value.replace(/\/[^/]+$/, '');
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
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('_');
  const base = titleCandidate || objectCandidate || `заявка_${shortId}`;
  const safeBase = sanitizePathSegment(base, `заявка_${shortId}`);
  return `${safeBase}_${shortId}`;
}

function buildFinanceEntryLabel(entry: { id: string; title?: string | null }) {
  const shortId = String(entry.id || '').slice(0, 8) || 'entry';
  const title = sanitizePathSegment(String(entry.title || '').trim(), `статья_${shortId}`);
  return `${title}_${shortId}`;
}

async function getCallerContext(admin: ReturnType<typeof createClient>, token: string) {
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(token);
  if (error || !user) throw new Error('Unauthorized');

  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('id, company_id')
    .eq('id', user.id)
    .maybeSingle();
  if (profileErr || !profile?.company_id) throw new Error('Profile not found');

  return {
    userId: String(user.id),
    companyId: String(profile.company_id),
  };
}

async function getCallerAndFinanceEntryContext(
  admin: ReturnType<typeof createClient>,
  token: string,
  financeEntryId: string,
) {
  const caller = await getCallerContext(admin, token);

  const { data: entry, error: entryErr } = await admin
    .from('order_finance_entries')
    .select('id, company_id, order_id, title')
    .eq('id', financeEntryId)
    .maybeSingle();
  if (entryErr || !entry) throw new Error('Finance entry not found');
  if (String(entry.company_id || '') !== caller.companyId) throw new Error('Forbidden');

  const { data: order, error: orderErr } = await admin
    .from('orders')
    .select('id, title, created_at, time_window_start, object:client_objects(name, city, street, house)')
    .eq('id', entry.order_id)
    .maybeSingle();
  if (orderErr || !order) throw new Error('Order not found');

  const { data: company, error: companyErr } = await admin
    .from('companies')
    .select('name, media_provider')
    .eq('id', caller.companyId)
    .maybeSingle();
  if (companyErr || !company) throw new Error('Company not found');

  return {
    ...caller,
    financeEntryId: String(entry.id),
    orderId: String(entry.order_id),
    financeEntry: {
      id: String(entry.id),
      title: entry.title || null,
    },
    order: {
      id: String(order.id || entry.order_id),
      title: order.title || null,
      created_at: order.created_at || null,
      time_window_start: order.time_window_start || null,
      object_name: order.object?.name || null,
      object_summary: buildObjectAddressSummary(order.object || {}) || null,
    },
    companyName: String(company.name || '').trim() || 'Компания',
    mediaProvider: String(company.media_provider || 'beget_s3'),
  };
}

async function appendFinanceEntryPhotoUrlAtomic(
  admin: ReturnType<typeof createClient>,
  financeEntryId: string,
  companyId: string,
  url: string,
) {
  const { data, error } = await admin.rpc('append_order_finance_entry_photo_url', {
    p_finance_entry_id: financeEntryId,
    p_company_id: companyId,
    p_url: url,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    photo_urls: Array.isArray(row?.photo_urls) ? row.photo_urls.map((x: unknown) => String(x || '')) : [],
    updated_at: row?.updated_at ? String(row.updated_at) : null,
  };
}

async function removeFinanceEntryPhotoUrlAtomic(
  admin: ReturnType<typeof createClient>,
  financeEntryId: string,
  companyId: string,
  url: string,
) {
  const { data, error } = await admin.rpc('remove_order_finance_entry_photo_url', {
    p_finance_entry_id: financeEntryId,
    p_company_id: companyId,
    p_url: url,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    photo_urls: Array.isArray(row?.photo_urls) ? row.photo_urls.map((x: unknown) => String(x || '')) : [],
    updated_at: row?.updated_at ? String(row.updated_at) : null,
  };
}

async function removeFinanceEntryPhotoUrlAtomicCanonical(
  admin: ReturnType<typeof createClient>,
  financeEntryId: string,
  companyId: string,
  url: string,
) {
  const direct = String(url || '').trim();
  let atomic = await removeFinanceEntryPhotoUrlAtomic(admin, financeEntryId, companyId, direct);
  if (!direct) return atomic;
  if (!Array.isArray(atomic.photo_urls) || !atomic.photo_urls.includes(direct)) return atomic;

  const needle = canonicalUrl(direct);
  if (!needle) return atomic;

  const { data: entry, error: entryErr } = await admin
    .from('order_finance_entries')
    .select('photo_urls')
    .eq('id', financeEntryId)
    .maybeSingle();
  if (entryErr) throw entryErr;

  const existingUrls = Array.isArray(entry?.photo_urls)
    ? entry.photo_urls.map((value: unknown) => String(value || '').trim()).filter(Boolean)
    : [];
  const canonicalMatch = existingUrls.find((existingUrl) => canonicalUrl(existingUrl) === needle);
  if (!canonicalMatch || canonicalMatch === direct) return atomic;

  atomic = await removeFinanceEntryPhotoUrlAtomic(admin, financeEntryId, companyId, canonicalMatch);
  return atomic;
}

function buildFinanceEntryMediaKey(
  ctx: {
    companyName: string;
    order: {
      id: string;
      title?: string | null;
      created_at?: string | null;
      time_window_start?: string | null;
      object_name?: string | null;
      object_summary?: string | null;
    };
    financeEntry: {
      id: string;
      title?: string | null;
    };
  },
  mime: string,
) {
  const ext = getFileExtensionByMime(mime);
  const monthDir = formatMonthBucket(ctx.order.time_window_start || ctx.order.created_at || null);
  const companyDir = sanitizePathSegment(ctx.companyName || 'Компания', 'Компания');
  const orderDir = buildOrderLabel(ctx.order);
  const financeDir = buildFinanceEntryLabel(ctx.financeEntry);
  return `Компании/${companyDir}/Заявки/${monthDir}/${orderDir}/Финансы/${financeDir}/медиа_${Date.now()}_${toBase64UrlSafeName()}.${ext}`;
}

async function prepareBegetFinanceUpload(
  ctx: {
    companyName: string;
    order: {
      id: string;
      title?: string | null;
      created_at?: string | null;
      time_window_start?: string | null;
      object_name?: string | null;
      object_summary?: string | null;
    };
    financeEntry: {
      id: string;
      title?: string | null;
    };
  },
  mime: string,
) {
  const objectKey = buildFinanceEntryMediaKey(ctx, mime);
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

async function purgeBegetFinanceEntryOrphans(
  admin: ReturnType<typeof createClient>,
  args: {
    companyId: string;
    financeEntryId: string;
    folderPrefix: string;
  },
) {
  const folderPrefix = String(args.folderPrefix || '').replace(/^\/+/, '').replace(/\/+$/, '').trim();
  if (!folderPrefix) return 0;

  const { data: rows, error } = await admin
    .from('finance_entry_media_external_map')
    .select('external_path')
    .eq('company_id', args.companyId)
    .eq('finance_entry_id', args.financeEntryId)
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

export async function handleFinanceEntryMediaStorageRequest(req: Request) {
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
      finance_entry_id?: string;
      file_base64?: string;
      mime?: string;
      url?: string;
      object_key?: string;
      public_url?: string;
    };

    const action = String(body.action || '').trim();
    const financeEntryId = String(body.finance_entry_id || '').trim();
    if (!action || !financeEntryId) {
      return json(400, { success: false, message: 'Missing action or finance_entry_id' });
    }

    const ctx = await getCallerAndFinanceEntryContext(admin, token, financeEntryId);
    if ((action === 'prepare_upload' || action === 'upload') && ctx.mediaProvider !== 'beget_s3') {
      return json(400, { success: false, message: 'Media provider is not Beget S3' });
    }

    if (action === 'prepare_upload') {
      const mime = String(body.mime || 'image/jpeg').trim() || 'image/jpeg';
      const prepared = await prepareBegetFinanceUpload(ctx, mime);
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
      const objectKey = String(body.object_key || '').trim();
      const publicUrl = String(body.public_url || '').trim() || buildBegetPublicUrl(objectKey);
      if (!objectKey) return json(400, { success: false, message: 'object_key is required' });

      const headResult = await headBegetObject(objectKey);
      const fileSizeBytes = Number(headResult?.ContentLength || 0);

      try {
        const { error: mapErr } = await admin.from('finance_entry_media_external_map').upsert(
          {
            company_id: ctx.companyId,
            order_id: ctx.orderId,
            finance_entry_id: ctx.financeEntryId,
            provider: 'beget_s3',
            source_url: publicUrl,
            external_path: objectKey,
            display_url: publicUrl,
            display_url_updated_at: new Date().toISOString(),
            created_by: ctx.userId,
            file_size_bytes: fileSizeBytes,
          },
          { onConflict: 'finance_entry_id,source_url' },
        );
        if (mapErr) throw mapErr;
      } catch (error) {
        await deleteBegetKeys([objectKey]).catch(() => null);
        throw error;
      }

      const atomic = await appendFinanceEntryPhotoUrlAtomic(
        admin,
        ctx.financeEntryId,
        ctx.companyId,
        publicUrl,
      );
      return json(200, {
        success: true,
        url: publicUrl,
        provider: 'beget_s3',
        photo_urls: atomic.photo_urls,
        finance_entry_updated_at: atomic.updated_at,
      });
    }

    if (action === 'upload') {
      const b64raw = String(body.file_base64 || '').trim();
      const b64 = b64raw.includes(',') ? b64raw.split(',').pop() || '' : b64raw;
      if (!b64) return json(400, { success: false, message: 'file_base64 is required' });

      const mime = String(body.mime || 'image/jpeg').trim() || 'image/jpeg';
      const bytes = Uint8Array.from(atob(b64), (char) => char.charCodeAt(0));
      const objectKey = buildFinanceEntryMediaKey(ctx, mime);
      const publicUrl = buildBegetPublicUrl(objectKey);

      await putBegetObject({
        key: objectKey,
        body: bytes,
        contentType: mime,
      });

      try {
        const { error: mapErr } = await admin.from('finance_entry_media_external_map').upsert(
          {
            company_id: ctx.companyId,
            order_id: ctx.orderId,
            finance_entry_id: ctx.financeEntryId,
            provider: 'beget_s3',
            source_url: publicUrl,
            external_path: objectKey,
            display_url: publicUrl,
            display_url_updated_at: new Date().toISOString(),
            created_by: ctx.userId,
            file_size_bytes: bytes.length,
          },
          { onConflict: 'finance_entry_id,source_url' },
        );
        if (mapErr) throw mapErr;
      } catch (error) {
        await deleteBegetKeys([objectKey]).catch(() => null);
        throw error;
      }

      const atomic = await appendFinanceEntryPhotoUrlAtomic(
        admin,
        ctx.financeEntryId,
        ctx.companyId,
        publicUrl,
      );
      return json(200, {
        success: true,
        url: publicUrl,
        provider: 'beget_s3',
        photo_urls: atomic.photo_urls,
        finance_entry_updated_at: atomic.updated_at,
      });
    }

    if (action === 'delete') {
      const sourceUrl = String(body.url || '').trim();
      if (!sourceUrl) return json(400, { success: false, message: 'url is required' });

      let { data: row, error: rowErr } = await admin
        .from('finance_entry_media_external_map')
        .select('id, external_path, source_url, display_url')
        .eq('company_id', ctx.companyId)
        .eq('finance_entry_id', ctx.financeEntryId)
        .eq('provider', 'beget_s3')
        .eq('source_url', sourceUrl)
        .maybeSingle();
      if (rowErr) throw rowErr;

      if (!row) {
        const { data: displayRow, error: displayErr } = await admin
          .from('finance_entry_media_external_map')
          .select('id, external_path, source_url, display_url')
          .eq('company_id', ctx.companyId)
          .eq('finance_entry_id', ctx.financeEntryId)
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
          .from('finance_entry_media_external_map')
          .select('id, external_path, source_url, display_url')
          .eq('company_id', ctx.companyId)
          .eq('finance_entry_id', ctx.financeEntryId)
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
      const objectKey = String(row?.external_path || fallbackObjectKey || '').trim();
      const preferredSourceUrl = String(row?.source_url || '').trim() || sourceUrl;
      let atomic = await removeFinanceEntryPhotoUrlAtomicCanonical(
        admin,
        ctx.financeEntryId,
        ctx.companyId,
        preferredSourceUrl,
      );
      if (
        atomic &&
        Array.isArray(atomic.photo_urls) &&
        atomic.photo_urls.includes(preferredSourceUrl) &&
        sourceUrl !== preferredSourceUrl
      ) {
        atomic = await removeFinanceEntryPhotoUrlAtomicCanonical(
          admin,
          ctx.financeEntryId,
          ctx.companyId,
          sourceUrl,
        );
      }

      if (row?.id != null) {
        await admin.from('finance_entry_media_external_map').delete().eq('id', Number(row.id));
      } else {
        let deleteQuery = admin
          .from('finance_entry_media_external_map')
          .delete()
          .eq('company_id', ctx.companyId)
          .eq('finance_entry_id', ctx.financeEntryId)
          .eq('provider', 'beget_s3');
        const orConditions = [`source_url.eq.${sourceUrl}`, `display_url.eq.${sourceUrl}`];
        if (objectKey) orConditions.push(`external_path.eq.${objectKey}`);
        deleteQuery = deleteQuery.or(orConditions.join(','));
        await deleteQuery;
      }

      if (objectKey) {
        try {
          await deleteBegetKeys([objectKey]);
        } catch (storageError) {
          console.warn('[finance-entry-media-storage] beget delete warning:', toErrorMessage(storageError));
        }
      }

      const orphanFolder = parentKeyPrefix(objectKey);
      if (orphanFolder) {
        try {
          await purgeBegetFinanceEntryOrphans(admin, {
            companyId: ctx.companyId,
            financeEntryId: ctx.financeEntryId,
            folderPrefix: orphanFolder,
          });
        } catch (cleanupError) {
          console.warn('[finance-entry-media-storage] beget orphan cleanup warning:', toErrorMessage(cleanupError));
        }
      }

      return json(200, {
        success: true,
        provider: 'beget_s3',
        photo_urls: atomic.photo_urls,
        finance_entry_updated_at: atomic.updated_at,
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
    console.error('[finance-entry-media-storage]', status, message);
    return json(status, { success: false, message });
  }
}

if (import.meta.main) {
  Deno.serve(handleFinanceEntryMediaStorageRequest);
}
