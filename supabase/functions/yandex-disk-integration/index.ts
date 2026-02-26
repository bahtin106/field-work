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

const DEFAULT_YANDEX_ROOT = '/Монитор';

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

async function ensureFolderTree(accessToken: string, fullPath: string) {
  const normalized = normalizeFolderPath(fullPath);
  const parts = normalized.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = `${current}/${part}`;
    const res = await fetch(
      `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(current)}`,
      { method: 'PUT', headers: { Authorization: `OAuth ${accessToken}` } },
    );
    if (![201, 409].includes(res.status)) {
      const text = await res.text();
      throw new Error(`Cannot access folder ${current}: ${text}`);
    }
  }
}

async function getCallerContext(admin: ReturnType<typeof createClient>, token: string) {
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

  if (!profile) throw new Error('Profile not found');
  if (String(profile.role || '').toLowerCase() !== 'admin') throw new Error('Forbidden');
  if (!profile.company_id) throw new Error('Company not found');
  return {
    userId: user.id,
    companyId: String(profile.company_id),
  };
}

async function exchangeCodeForTokens(code: string) {
  const clientId = Deno.env.get('YANDEX_OAUTH_CLIENT_ID') || '';
  const clientSecret = Deno.env.get('YANDEX_OAUTH_CLIENT_SECRET') || '';
  const redirectUri = Deno.env.get('YANDEX_OAUTH_REDIRECT_URI') || 'workorders://company_settings/sections/yandex-disk';
  if (!clientId || !clientSecret) throw new Error('Missing Yandex OAuth credentials');

  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('code', code);
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);
  body.set('redirect_uri', redirectUri);

  const res = await fetch('https://oauth.yandex.ru/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${text}`);
  }
  const tokenData = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  if (!tokenData?.access_token || !tokenData?.refresh_token) {
    throw new Error('Invalid token response');
  }
  return tokenData;
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

async function getYandexUserInfo(accessToken: string) {
  const infoRes = await fetch('https://login.yandex.ru/info?format=json', {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (!infoRes.ok) {
    const text = await infoRes.text();
    throw new Error(`Yandex profile fetch failed: ${text}`);
  }
  const profile = (await infoRes.json()) as {
    id?: string;
    login?: string;
    display_name?: string;
    real_name?: string;
  };
  return profile;
}

async function ensureValidYandexToken(admin: ReturnType<typeof createClient>, companyId: string) {
  const { data: conn, error } = await admin
    .from('company_yandex_disk_connections')
    .select('access_token, refresh_token, token_expires_at')
    .eq('company_id', companyId)
    .maybeSingle();
  if (error || !conn) throw new Error('Yandex Disk not connected');

  const expiryMs = new Date(conn.token_expires_at).getTime();
  const nowMs = Date.now();
  if (Number.isFinite(expiryMs) && expiryMs > nowMs + 60_000) {
    return conn.access_token;
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
  return refreshed.access_token;
}

async function getYandexDiskStorageInfo(accessToken: string) {
  const res = await fetch('https://cloud-api.yandex.net/v1/disk?fields=total_space,used_space', {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Yandex disk info failed: ${text}`);
  }
  const payload = (await res.json()) as { total_space?: number; used_space?: number };
  const total = Number(payload?.total_space || 0);
  const used = Number(payload?.used_space || 0);
  const free = Math.max(0, total - used);
  return { totalBytes: total, usedBytes: used, freeBytes: free };
}

export async function handleYandexDiskIntegrationRequest(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
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
    const caller = await getCallerContext(admin, token);

    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      code?: string;
      state?: string;
      folder_path?: string;
      provider?: string;
      redirect_to?: string;
    };
    const action = String(body.action || '').trim();
    if (!action) return json(400, { success: false, message: 'Missing action' });

    if (action === 'status') {
      const { data: company } = await admin
        .from('companies')
        .select('media_provider')
        .eq('id', caller.companyId)
        .maybeSingle();
      const { data: conn } = await admin
        .from('company_yandex_disk_connections')
        .select('yandex_login, yandex_display_name, folder_path, connected_at')
        .eq('company_id', caller.companyId)
        .maybeSingle();

      let health:
        | 'ok'
        | 'reconnect_required'
        | 'quota_exceeded'
        | 'error'
        | 'unknown'
        | 'not_connected' = conn
        ? 'unknown'
        : 'not_connected';
      let storage:
        | {
            free_bytes: number;
            used_bytes: number;
            total_bytes: number;
          }
        | null = null;

      if (conn) {
        try {
          const accessToken = await ensureValidYandexToken(admin, caller.companyId);
          const info = await getYandexDiskStorageInfo(accessToken);
          storage = {
            free_bytes: info.freeBytes,
            used_bytes: info.usedBytes,
            total_bytes: info.totalBytes,
          };
          health = info.freeBytes <= 0 ? 'quota_exceeded' : 'ok';
        } catch (e) {
          const err = toErrorMessage(e).toLowerCase();
          if (
            err.includes('invalid_grant') ||
            err.includes('unauthorized') ||
            err.includes('token refresh failed')
          ) {
            health = 'reconnect_required';
          } else {
            health = 'error';
          }
        }
      }

      return json(200, {
        success: true,
        connected: !!conn,
        health,
        media_provider: (company?.media_provider as string) || 'app_storage',
        storage,
        account: conn
          ? {
              login: conn.yandex_login || '',
              display_name: conn.yandex_display_name || '',
              folder_path: conn.folder_path || DEFAULT_YANDEX_ROOT,
              connected_at: conn.connected_at || null,
            }
          : null,
      });
    }

    if (action === 'start') {
      const clientId = Deno.env.get('YANDEX_OAUTH_CLIENT_ID') || '';
      const redirectUri = Deno.env.get('YANDEX_OAUTH_REDIRECT_URI') || 'workorders://company_settings/sections/yandex-disk';
      if (!clientId) return json(500, { success: false, message: 'Missing Yandex OAuth client id' });

      const state = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const requestedRedirect = String(body.redirect_to || '').trim() || redirectUri;

      const { error: stErr } = await admin.from('company_integration_oauth_states').upsert(
        {
          state,
          company_id: caller.companyId,
          provider: 'yandex_disk',
          requested_by: caller.userId,
          redirect_to: requestedRedirect,
          expires_at: expiresAt,
        },
        { onConflict: 'state' },
      );
      if (stErr) throw stErr;

      const authUrl = new URL('https://oauth.yandex.ru/authorize');
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('force_confirm', 'yes');

      return json(200, {
        success: true,
        state,
        auth_url: authUrl.toString(),
      });
    }

    if (action === 'complete') {
      const code = String(body.code || '').trim();
      const state = String(body.state || '').trim();
      if (!code || !state) return json(400, { success: false, message: 'Missing code or state' });

      const { data: stateRow, error: stateErr } = await admin
        .from('company_integration_oauth_states')
        .select('state, company_id, provider, requested_by, expires_at')
        .eq('state', state)
        .maybeSingle();
      if (stateErr || !stateRow) return json(400, { success: false, message: 'Invalid state' });
      if (stateRow.provider !== 'yandex_disk') return json(400, { success: false, message: 'Invalid provider state' });
      if (String(stateRow.company_id) !== caller.companyId) return json(403, { success: false, message: 'State mismatch' });
      if (String(stateRow.requested_by) !== caller.userId) return json(403, { success: false, message: 'State owner mismatch' });
      if (new Date(stateRow.expires_at).getTime() < Date.now()) {
        return json(400, { success: false, message: 'State expired' });
      }

      const tokenData = await exchangeCodeForTokens(code);
      const profile = await getYandexUserInfo(tokenData.access_token);
      const expiresAt = new Date(Date.now() + Math.max(60, Number(tokenData.expires_in || 3600)) * 1000).toISOString();
      const { data: prevConn } = await admin
        .from('company_yandex_disk_connections')
        .select('folder_path')
        .eq('company_id', caller.companyId)
        .maybeSingle();
      const folderPath = normalizeFolderPath(prevConn?.folder_path || DEFAULT_YANDEX_ROOT);

      const { error: upErr } = await admin.from('company_yandex_disk_connections').upsert(
        {
          company_id: caller.companyId,
          yandex_user_id: profile?.id || null,
          yandex_login: profile?.login || null,
          yandex_display_name: profile?.display_name || profile?.real_name || null,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          token_expires_at: expiresAt,
          folder_path: folderPath,
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          created_by: caller.userId,
        },
        { onConflict: 'company_id' },
      );
      if (upErr) throw upErr;

      await admin
        .from('company_integration_oauth_states')
        .delete()
        .eq('state', state);

      const { error: providerErr } = await admin
        .from('companies')
        .update({ media_provider: 'yandex_disk' })
        .eq('id', caller.companyId);
      if (providerErr) throw providerErr;

      return json(200, { success: true });
    }

    if (action === 'disconnect') {
      const { error: delErr } = await admin
        .from('company_yandex_disk_connections')
        .delete()
        .eq('company_id', caller.companyId);
      if (delErr) throw delErr;

      const { error: upErr } = await admin
        .from('companies')
        .update({ media_provider: 'app_storage' })
        .eq('id', caller.companyId);
      if (upErr) throw upErr;

      return json(200, { success: true });
    }

    if (action === 'set_folder') {
      const folderPath = normalizeFolderPath(body.folder_path);
      const accessToken = await ensureValidYandexToken(admin, caller.companyId);
      await ensureFolderTree(accessToken, folderPath);

      const { error: upErr } = await admin
        .from('company_yandex_disk_connections')
        .update({ folder_path: folderPath, updated_at: new Date().toISOString() })
        .eq('company_id', caller.companyId);
      if (upErr) throw upErr;
      return json(200, { success: true, folder_path: folderPath });
    }

    if (action === 'set_provider') {
      const provider = String(body.provider || '').trim();
      if (!['app_storage', 'yandex_disk'].includes(provider)) {
        return json(400, { success: false, message: 'Unsupported provider' });
      }
      if (provider === 'yandex_disk') {
        const { data: conn } = await admin
          .from('company_yandex_disk_connections')
          .select('company_id')
          .eq('company_id', caller.companyId)
          .maybeSingle();
        if (!conn) return json(400, { success: false, message: 'Yandex Disk not connected' });
        await ensureValidYandexToken(admin, caller.companyId);
      }
      const { error: upErr } = await admin
        .from('companies')
        .update({ media_provider: provider })
        .eq('id', caller.companyId);
      if (upErr) throw upErr;
      return json(200, { success: true, media_provider: provider });
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
    console.error('[yandex-disk-integration]', status, message);
    return json(status, { success: false, message });
  }
}

if (import.meta.main) {
  Deno.serve(handleYandexDiskIntegrationRequest);
}
