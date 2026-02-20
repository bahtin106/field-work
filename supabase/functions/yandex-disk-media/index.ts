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

const ALLOWED_CATEGORIES = new Set(['contract_file', 'photo_before', 'photo_after', 'act_file']);

function toBase64UrlSafeName() {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
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

async function getValidConnection(admin: ReturnType<typeof createClient>, companyId: string) {
  const { data: conn, error } = await admin
    .from('company_yandex_disk_connections')
    .select('access_token, refresh_token, token_expires_at, folder_path')
    .eq('company_id', companyId)
    .maybeSingle();
  if (error || !conn) throw new Error('Yandex Disk not connected');

  const expiryMs = new Date(conn.token_expires_at).getTime();
  const nowMs = Date.now();
  if (Number.isFinite(expiryMs) && expiryMs > nowMs + 60_000) return conn;

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
  return { ...conn, access_token: refreshed.access_token, refresh_token: nextRefresh };
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
    .select('id, company_id')
    .eq('id', orderId)
    .maybeSingle();
  if (orderErr || !order) throw new Error('Order not found');
  if (String(order.company_id) !== String(profile.company_id)) throw new Error('Forbidden');

  const { data: company, error: cmpErr } = await admin
    .from('companies')
    .select('media_provider')
    .eq('id', profile.company_id)
    .maybeSingle();
  if (cmpErr || !company) throw new Error('Company not found');
  if (String(company.media_provider) !== 'yandex_disk') {
    throw new Error('Media provider is not Yandex Disk');
  }

  return {
    userId: user.id,
    companyId: String(profile.company_id),
    orderId: String(order.id),
  };
}

async function createYandexFolder(accessToken: string, path: string) {
  const res = await fetch(
    `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(path)}`,
    { method: 'PUT', headers: { Authorization: `OAuth ${accessToken}` } },
  );
  if (![201, 409].includes(res.status)) {
    const text = await res.text();
    throw new Error(`Cannot create folder: ${text}`);
  }
}

async function uploadToYandex(accessToken: string, path: string, bytes: Uint8Array, mime: string) {
  const linkRes = await fetch(
    `https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent(path)}&overwrite=false`,
    { headers: { Authorization: `OAuth ${accessToken}` } },
  );
  if (!linkRes.ok) {
    const text = await linkRes.text();
    throw new Error(`Upload link failed: ${text}`);
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
    `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(path)}&fields=public_url,path`,
    { headers: { Authorization: `OAuth ${accessToken}` } },
  );
  if (!metaRes.ok) {
    const text = await metaRes.text();
    throw new Error(`Read metadata failed: ${text}`);
  }
  const meta = (await metaRes.json()) as { public_url?: string };
  if (meta?.public_url) return meta.public_url;

  const dlRes = await fetch(
    `https://cloud-api.yandex.net/v1/disk/resources/download?path=${encodeURIComponent(path)}`,
    { headers: { Authorization: `OAuth ${accessToken}` } },
  );
  if (!dlRes.ok) {
    const text = await dlRes.text();
    throw new Error(`Get download link failed: ${text}`);
  }
  const dl = (await dlRes.json()) as { href?: string };
  if (!dl?.href) throw new Error('No public url available');
  return dl.href;
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
    };
    const action = String(body.action || '').trim();
    const orderId = String(body.order_id || '').trim();
    const category = String(body.category || '').trim();
    if (!action || !orderId || !category) {
      return json(400, { success: false, message: 'Missing required fields' });
    }
    if (!ALLOWED_CATEGORIES.has(category)) {
      return json(400, { success: false, message: 'Invalid category' });
    }

    const ctx = await getCallerAndOrderContext(admin, token, orderId);
    const conn = await getValidConnection(admin, ctx.companyId);
    const accessToken = String(conn.access_token);
    const rootFolder = String(conn.folder_path || '/apps/field-work');

    if (action === 'upload') {
      const b64 = String(body.file_base64 || '').trim();
      if (!b64) return json(400, { success: false, message: 'file_base64 is required' });
      const mime = String(body.mime || 'image/jpeg');
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

      const folder = `${rootFolder}/orders/${ctx.orderId}/${category}`;
      await createYandexFolder(accessToken, folder);
      const filePath = `${folder}/${Date.now()}-${toBase64UrlSafeName()}.jpg`;
      await uploadToYandex(accessToken, filePath, bytes, mime);
      const publicUrl = await publishAndGetPublicUrl(accessToken, filePath);

      const { error: mapErr } = await admin.from('order_media_external_map').upsert(
        {
          company_id: ctx.companyId,
          order_id: ctx.orderId,
          category,
          provider: 'yandex_disk',
          source_url: publicUrl,
          external_path: filePath,
          created_by: ctx.userId,
        },
        { onConflict: 'order_id,category,source_url' },
      );
      if (mapErr) throw mapErr;

      return json(200, {
        success: true,
        url: publicUrl,
        provider: 'yandex_disk',
      });
    }

    if (action === 'delete') {
      const sourceUrl = String(body.url || '').trim();
      if (!sourceUrl) return json(400, { success: false, message: 'url is required' });

      const { data: mapRow, error: mapErr } = await admin
        .from('order_media_external_map')
        .select('id, external_path')
        .eq('company_id', ctx.companyId)
        .eq('order_id', ctx.orderId)
        .eq('category', category)
        .eq('provider', 'yandex_disk')
        .eq('source_url', sourceUrl)
        .maybeSingle();
      if (mapErr) throw mapErr;
      if (!mapRow) return json(404, { success: false, message: 'Media mapping not found' });

      const delRes = await fetch(
        `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(mapRow.external_path)}&permanently=true`,
        { method: 'DELETE', headers: { Authorization: `OAuth ${accessToken}` } },
      );
      if (![202, 204, 404].includes(delRes.status)) {
        const text = await delRes.text();
        throw new Error(`Delete failed: ${text}`);
      }

      const { error: delMapErr } = await admin
        .from('order_media_external_map')
        .delete()
        .eq('id', mapRow.id);
      if (delMapErr) throw delMapErr;

      return json(200, { success: true });
    }

    return json(400, { success: false, message: 'Unknown action' });
  } catch (e) {
    const message = toErrorMessage(e);
    const lowered = message.toLowerCase();
    const status = lowered.includes('unauthorized')
      ? 401
      : lowered.includes('forbidden')
        ? 403
        : lowered.includes('missing')
          ? 400
          : 500;
    console.error('[yandex-disk-media]', status, message);
    return json(status, { success: false, message });
  }
}

if (import.meta.main) {
  Deno.serve(handleYandexDiskMediaRequest);
}
