import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { createBegetPresignedGetUrl } from '../_shared/beget-s3.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value || '');
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isHttpUrl(value: string) {
  return /^https?:\/\/[^\s]+$/i.test(String(value || '').trim());
}

function encodePlainSourceUrl(value: string) {
  return encodeURIComponent(value);
}

function isYandexPublicPageUrl(value: string) {
  const raw = String(value || '').trim().toLowerCase();
  return raw.includes('yadi.sk/') || raw.includes('disk.yandex.');
}

async function refreshYandexAccessToken(refreshToken: string) {
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
  if (!res.ok) throw new Error(`Yandex token refresh failed: ${await res.text()}`);
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!data?.access_token) throw new Error('Invalid Yandex refresh response');
  return data;
}

async function getYandexAccessToken(admin: ReturnType<typeof createClient>, companyId: string) {
  const { data, error } = await admin
    .from('company_yandex_disk_connections')
    .select('access_token, refresh_token, token_expires_at')
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.access_token || !data?.refresh_token) return '';

  const expiryMs = new Date(data.token_expires_at).getTime();
  if (Number.isFinite(expiryMs) && expiryMs > Date.now() + 60_000) {
    return String(data.access_token);
  }

  const refreshed = await refreshYandexAccessToken(String(data.refresh_token));
  const nextRefresh = refreshed.refresh_token || data.refresh_token;
  const nextExpiry = new Date(
    Date.now() + Math.max(60, Number(refreshed.expires_in || 3600)) * 1000,
  ).toISOString();
  const { error: updateError } = await admin
    .from('company_yandex_disk_connections')
    .update({
      access_token: refreshed.access_token,
      refresh_token: nextRefresh,
      token_expires_at: nextExpiry,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', companyId);
  if (updateError) throw updateError;
  return String(refreshed.access_token);
}

async function getYandexPathDownloadUrl(accessToken: string, path: string) {
  const cleanPath = String(path || '').trim();
  if (!accessToken || !cleanPath) return '';
  const res = await fetch(
    `https://cloud-api.yandex.net/v1/disk/resources/download?path=${encodeURIComponent(cleanPath)}`,
    { headers: { Authorization: `OAuth ${accessToken}` } },
  );
  if (!res.ok) return '';
  const data = (await res.json()) as { href?: string };
  return String(data?.href || '').trim();
}

async function getYandexPublicDownloadUrl(publicUrl: string) {
  const res = await fetch(
    `https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=${encodeURIComponent(publicUrl)}`,
  );
  if (!res.ok) return '';
  const data = (await res.json()) as { href?: string };
  return String(data?.href || '').trim();
}

async function getYandexExternalPath(
  admin: ReturnType<typeof createClient>,
  asset: {
    entity_type?: string | null;
    entity_id?: string | null;
    category?: string | null;
    source_url?: string | null;
    company_id?: string | null;
  },
) {
  const entityType = String(asset.entity_type || '').trim();
  const entityId = String(asset.entity_id || '').trim();
  const category = String(asset.category || '').trim();
  const sourceUrl = String(asset.source_url || '').trim();
  const companyId = String(asset.company_id || '').trim();
  if (!entityType || !entityId || !category || !sourceUrl || !companyId) return '';

  let table = '';
  let entityColumn = '';
  if (entityType === 'order') {
    table = 'order_media_external_map';
    entityColumn = 'order_id';
  } else if (entityType === 'object' || entityType === 'client_object') {
    table = 'object_media_external_map';
    entityColumn = 'object_id';
  } else if (entityType === 'finance_entry') {
    table = 'finance_entry_media_external_map';
    entityColumn = 'finance_entry_id';
  } else {
    return '';
  }

  let query = admin
    .from(table)
    .select('external_path')
    .eq('company_id', companyId)
    .eq(entityColumn, entityId)
    .eq('provider', 'yandex_disk')
    .eq('source_url', sourceUrl);
  if (entityType !== 'finance_entry') query = query.eq('category', category);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return String(data?.external_path || '').trim();
}

export async function handleMediaThumbnailRequest(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return json(405, { success: false, message: 'Method not allowed' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';
  const imgproxyUrl = (Deno.env.get('IMGPROXY_URL') || 'http://imgproxy:5001').replace(/\/+$/, '');
  if (!supabaseUrl || !serviceRole) return json(500, { success: false, message: 'Server is not configured' });

  const url = new URL(req.url);
  const id = String(url.searchParams.get('id') || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return json(400, { success: false, message: 'Invalid media id' });
  }

  const width = clampInt(url.searchParams.get('w'), 512, 64, 1024);
  const height = clampInt(url.searchParams.get('h'), width, 64, 1024);
  const fit = String(url.searchParams.get('fit') || 'fill').trim() === 'fit' ? 'fit' : 'fill';

  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: asset, error } = await admin
    .from('media_assets')
    .select('id, company_id, entity_type, entity_id, category, source_url, display_url, thumb_url, status, provider, storage_path')
    .eq('id', id)
    .neq('status', 'deleted')
    .maybeSingle();

  if (error || !asset) return json(404, { success: false, message: 'Media not found' });

  let sourceUrl = String(asset.thumb_url || asset.display_url || asset.source_url || '').trim();
  const storagePath = String(asset.storage_path || '').replace(/^\/+/, '').trim();
  if (String(asset.provider || '') === 'beget_s3' && storagePath) {
    const signed = await createBegetPresignedGetUrl({
      key: storagePath,
      expiresInSec: 300,
      responseContentType: 'image/jpeg',
    });
    sourceUrl = String(signed.url || '').trim() || sourceUrl;
  }
  if (String(asset.provider || '') === 'yandex_disk') {
    const externalPath = await getYandexExternalPath(admin, asset).catch(() => '');
    if (externalPath) {
      const accessToken = await getYandexAccessToken(admin, String(asset.company_id || '')).catch(() => '');
      sourceUrl = (await getYandexPathDownloadUrl(accessToken, externalPath).catch(() => '')) || sourceUrl;
    }
    if (isYandexPublicPageUrl(sourceUrl)) {
      sourceUrl = await getYandexPublicDownloadUrl(sourceUrl) || sourceUrl;
    }
  }
  if (!isHttpUrl(sourceUrl)) return json(422, { success: false, message: 'Media source is not renderable' });

  const imgproxyRequest = `${imgproxyUrl}/unsafe/rs:${fit}:${width}:${height}:1/plain/${encodePlainSourceUrl(sourceUrl)}@webp`;
  const upstream = await fetch(imgproxyRequest, {
    headers: {
      Accept: 'image/avif,image/webp,image/jpeg,image/*,*/*',
    },
  });

  if (!upstream.ok || !upstream.body) {
    return json(upstream.status || 502, { success: false, message: 'Thumbnail render failed' });
  }

  const headers = new Headers(corsHeaders);
  headers.set('Content-Type', upstream.headers.get('Content-Type') || 'image/webp');
  headers.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  headers.set('Vary', 'Accept');
  const etag = upstream.headers.get('ETag');
  if (etag) headers.set('ETag', etag);

  return new Response(upstream.body, {
    status: 200,
    headers,
  });
}

if (import.meta.main) {
  Deno.serve(handleMediaThumbnailRequest);
}
