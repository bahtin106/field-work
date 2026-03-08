import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-reconcile-key',
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

const ALLOWED_CATEGORIES = new Set(['contract_file', 'photo_before', 'photo_after', 'act_file']);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error && typeof error === 'object') {
    try {
      return JSON.stringify(error);
    } catch {}
  }
  return 'Unknown error';
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

async function refreshAccessToken(
  admin: ReturnType<typeof createClient>,
  companyId: string,
  refreshToken: string,
) {
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

  const nextRefresh = tokenData.refresh_token || refreshToken;
  const nextExpiry = new Date(
    Date.now() + Math.max(60, Number(tokenData.expires_in || 3600)) * 1000,
  ).toISOString();

  const { error: upErr } = await admin
    .from('company_yandex_disk_connections')
    .update({
      access_token: tokenData.access_token,
      refresh_token: nextRefresh,
      token_expires_at: nextExpiry,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', companyId);
  if (upErr) throw upErr;

  return tokenData.access_token;
}

async function getValidAccessToken(admin: ReturnType<typeof createClient>, companyId: string) {
  const { data: conn, error } = await admin
    .from('company_yandex_disk_connections')
    .select('access_token, refresh_token, token_expires_at')
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw error;
  if (!conn?.access_token || !conn?.refresh_token) return null;

  const expiryMs = new Date(conn.token_expires_at).getTime();
  if (Number.isFinite(expiryMs) && expiryMs > Date.now() + 60_000) {
    return String(conn.access_token);
  }
  return refreshAccessToken(admin, companyId, String(conn.refresh_token));
}

async function deleteYandexResourceSafe(accessToken: string, path: string) {
  const normalized = String(path || '').trim();
  if (!normalized) return;
  const maxAttempts = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await fetch(
      `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(normalized)}&permanently=true`,
      { method: 'DELETE', headers: { Authorization: `OAuth ${accessToken}` } },
    );
    if (res.status === 204 || res.status === 404) return;
    if (res.status === 202 || res.status === 409 || res.status === 423) {
      if (attempt < maxAttempts) {
        await sleep(150 * attempt);
        continue;
      }
      return;
    }
    const text = await res.text();
    throw new Error(`Delete failed: ${text}`);
  }
}

function isMappingReferenced(row: {
  category: string;
  source_url: string;
  order: {
    contract_file: string[] | null;
    photo_before: string[] | null;
    photo_after: string[] | null;
    act_file: string[] | null;
  };
}) {
  const target = String(row.source_url || '').trim();
  if (!target) return false;
  const order = row.order || ({} as any);
  const list =
    row.category === 'contract_file'
      ? order.contract_file
      : row.category === 'photo_before'
        ? order.photo_before
        : row.category === 'photo_after'
          ? order.photo_after
          : row.category === 'act_file'
            ? order.act_file
            : null;
  if (!Array.isArray(list) || !list.length) return false;
  return list.some((x) => String(x || '').trim() === target);
}

export async function handleYandexDiskReconcileRequest(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { success: false, message: 'POST only' });

  try {
    // 1. Validate JWT token from Authorization header
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return json(401, { success: false, message: 'Missing Authorization header' });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRole =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
      Deno.env.get('SERVICE_ROLE_KEY') ||
      '';
    if (!supabaseUrl || !serviceRole) throw new Error('Missing Supabase env');

    // 2. Verify the provided token matches SERVICE_ROLE_KEY exactly
    if (token !== serviceRole) {
      return json(401, { 
        success: false, 
        message: 'Invalid token. Service role key required.'
      });
    }

    // 3. Additional layer: verify x-reconcile-key if configured (defense-in-depth)
    const expectedKey = String(Deno.env.get('YANDEX_RECONCILE_KEY') || '').trim();
    if (expectedKey) {
      const gotKey = String(req.headers.get('x-reconcile-key') || '').trim();
      if (gotKey !== expectedKey) {
        return json(401, { success: false, message: 'Invalid x-reconcile-key' });
      }
    }

    const body = (await req.json().catch(() => ({}))) as {
      company_id?: string;
      limit?: number;
      dry_run?: boolean;
    };
    const companyId = String(body.company_id || '').trim() || null;
    const dryRun = Boolean(body.dry_run);
    const limitRaw = Number(body.limit || 300);
    const limit = Math.max(1, Math.min(2000, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 300));

    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let query = admin
      .from('order_media_external_map')
      .select(
        'id, company_id, order_id, category, source_url, external_path, order:orders!inner(contract_file,photo_before,photo_after,act_file)',
      )
      .eq('provider', 'yandex_disk')
      .in('category', Array.from(ALLOWED_CATEGORIES))
      .order('id', { ascending: true })
      .limit(limit);
    if (companyId) {
      query = query.eq('company_id', companyId);
    }

    const { data: rows, error } = await query;
    if (error) throw error;

    const staleRows = (rows || []).filter((row) => !isMappingReferenced(row as any));
    if (!staleRows.length) {
      return json(200, {
        success: true,
        dry_run: dryRun,
        scanned: (rows || []).length,
        stale_mappings: 0,
        deleted_mappings: 0,
        deleted_files: 0,
        deleted_order_folders: 0,
      });
    }

    const companyTokens = new Map<string, string | null>();
    const affectedFoldersByCompany = new Map<string, Set<string>>();
    let deletedMappings = 0;
    let deletedFiles = 0;
    let deletedOrderFolders = 0;

    for (const row of staleRows as Array<{
      id: number;
      company_id: string;
      order_id: string;
      category: string;
      source_url: string;
      external_path: string;
    }>) {
      const cid = String(row.company_id);
      if (!companyTokens.has(cid)) {
        try {
          companyTokens.set(cid, await getValidAccessToken(admin, cid));
        } catch {
          companyTokens.set(cid, null);
        }
      }
      const accessToken = companyTokens.get(cid) || null;

      const folder = orderFolderPathFromFile(String(row.external_path || ''));
      if (folder) {
        if (!affectedFoldersByCompany.has(cid)) affectedFoldersByCompany.set(cid, new Set());
        affectedFoldersByCompany.get(cid)?.add(folder);
      }

      if (!dryRun && accessToken && row.external_path) {
        try {
          await deleteYandexResourceSafe(accessToken, String(row.external_path));
          deletedFiles += 1;
        } catch {}
      }

      if (!dryRun) {
        const { error: delErr } = await admin
          .from('order_media_external_map')
          .delete()
          .eq('id', Number(row.id));
        if (!delErr) deletedMappings += 1;
      }
    }

    if (!dryRun) {
      for (const [cid, folders] of affectedFoldersByCompany.entries()) {
        const accessToken = companyTokens.get(cid);
        if (!accessToken) continue;
        for (const folder of folders.values()) {
          try {
            await deleteYandexResourceSafe(accessToken, folder);
            deletedOrderFolders += 1;
          } catch {}
        }
      }
    }

    return json(200, {
      success: true,
      dry_run: dryRun,
      scanned: (rows || []).length,
      stale_mappings: staleRows.length,
      deleted_mappings: deletedMappings,
      deleted_files: deletedFiles,
      deleted_order_folders: deletedOrderFolders,
    });
  } catch (e) {
    const message = toErrorMessage(e);
    console.error('[yandex-disk-reconcile]', message);
    return json(500, { success: false, message });
  }
}

if (import.meta.main) {
  Deno.serve(handleYandexDiskReconcileRequest);
}

