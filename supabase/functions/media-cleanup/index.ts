import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { deleteBegetKeys } from '../_shared/beget-s3.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cleanup-key',
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
    try {
      return JSON.stringify(error);
    } catch {}
  }
  return 'Unknown error';
}

function normalizeKey(value: string | null | undefined) {
  return String(value || '').replace(/^\/+/, '').trim();
}

const FEEDBACK_DELETE_REASON_PREFIX = 'feedback_delete:';
const FEEDBACK_DELETE_MAX_ATTEMPTS = 5;

function feedbackIdFromReason(reason: string | null | undefined) {
  const raw = String(reason || '').trim();
  if (!raw.startsWith(FEEDBACK_DELETE_REASON_PREFIX)) return '';
  return raw.slice(FEEDBACK_DELETE_REASON_PREFIX.length).trim();
}

async function finalizeQueuedFeedbackDeletion(
  admin: ReturnType<typeof createClient>,
  feedbackId: string,
) {
  const normalizedId = String(feedbackId || '').trim();
  if (!normalizedId) return;

  const reasonTag = `${FEEDBACK_DELETE_REASON_PREFIX}${normalizedId}`;
  const { count: pendingCount, error: pendingError } = await admin
    .from('media_cleanup_queue')
    .select('id', { count: 'exact', head: true })
    .eq('reason', reasonTag)
    .is('processed_at', null);
  if (pendingError) throw pendingError;
  if (Number(pendingCount || 0) > 0) return;

  const { error: deleteError } = await admin
    .from('feedbacks')
    .delete()
    .eq('id', normalizedId)
    .eq('deletion_state', 'pending_cleanup');
  if (deleteError) throw deleteError;
}

async function markQueuedFeedbackDeletionFailed(
  admin: ReturnType<typeof createClient>,
  feedbackId: string,
  errorMessage: string,
) {
  const normalizedId = String(feedbackId || '').trim();
  if (!normalizedId) return;

  const { error } = await admin
    .from('feedbacks')
    .update({
      deletion_state: 'cleanup_failed',
      delete_failed_at: new Date().toISOString(),
      delete_error: String(errorMessage || '').trim() || 'media_cleanup_failed',
    })
    .eq('id', normalizedId)
    .eq('deletion_state', 'pending_cleanup');
  if (error) throw error;
}

async function refreshYandexAccessToken(
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
  if (!res.ok) throw new Error(`Yandex token refresh failed: ${await res.text()}`);

  const tokenData = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!tokenData?.access_token) throw new Error('Invalid Yandex refresh response');

  const nextExpiry = new Date(
    Date.now() + Math.max(60, Number(tokenData.expires_in || 3600)) * 1000,
  ).toISOString();
  const { error } = await admin
    .from('company_yandex_disk_connections')
    .update({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || refreshToken,
      token_expires_at: nextExpiry,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', companyId);
  if (error) throw error;
  return String(tokenData.access_token);
}

async function getValidYandexAccessToken(admin: ReturnType<typeof createClient>, companyId: string) {
  const { data, error } = await admin
    .from('company_yandex_disk_connections')
    .select('access_token, refresh_token, token_expires_at')
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.access_token || !data?.refresh_token) throw new Error('Yandex Disk not connected');

  const expiryMs = new Date(String(data.token_expires_at || '')).getTime();
  if (Number.isFinite(expiryMs) && expiryMs > Date.now() + 60_000) {
    return String(data.access_token);
  }
  return refreshYandexAccessToken(admin, companyId, String(data.refresh_token));
}

async function deleteYandexResourceSafe(accessToken: string, path: string) {
  const normalized = String(path || '').trim();
  if (!normalized) return;

  const res = await fetch(
    `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(normalized)}&permanently=true`,
    { method: 'DELETE', headers: { Authorization: `OAuth ${accessToken}` } },
  );
  if ([202, 204, 404, 409, 423].includes(res.status)) return;
  throw new Error(`Yandex delete failed: ${await res.text()}`);
}

export async function handleMediaCleanupRequest(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { success: false, message: 'POST only' });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return json(401, { success: false, message: 'Missing Authorization header' });
    }

    const supabaseUrl = String(Deno.env.get('SUPABASE_URL') || '').trim();
    const serviceRole =
      String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim() ||
      String(Deno.env.get('SERVICE_ROLE_KEY') || '').trim();
    if (!supabaseUrl || !serviceRole) throw new Error('Missing Supabase env');
    if (token !== serviceRole) {
      return json(401, { success: false, message: 'Invalid token. Service role key required.' });
    }

    const expectedKey = String(Deno.env.get('MEDIA_CLEANUP_KEY') || '').trim();
    if (expectedKey) {
      const gotKey = String(req.headers.get('x-cleanup-key') || '').trim();
      if (gotKey !== expectedKey) {
        return json(401, { success: false, message: 'Invalid x-cleanup-key' });
      }
    }

    const body = (await req.json().catch(() => ({}))) as {
      limit?: number;
      provider?: string;
      dry_run?: boolean;
    };
    const dryRun = Boolean(body.dry_run);
    const limitRaw = Number(body.limit || 200);
    const limit = Math.max(1, Math.min(1000, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 200));
    const provider = String(body.provider || '').trim().toLowerCase();
    if (provider && provider !== 'beget_s3' && provider !== 'yandex_disk') {
      return json(400, { success: false, message: 'Unsupported provider' });
    }

    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const nowIso = new Date().toISOString();
    let query = admin
      .from('media_cleanup_queue')
      .select('id, provider, object_key, company_id, entity_type, entity_id, order_id, attempts, reason')
      .is('processed_at', null)
      .lte('not_before', nowIso)
      .order('id', { ascending: true })
      .limit(limit);
    if (provider) query = query.eq('provider', provider);
    const { data: rows, error } = await query;
    if (error) throw error;

    const queueRows = Array.isArray(rows) ? rows : [];
    if (!queueRows.length) {
      return json(200, {
        success: true,
        dry_run: dryRun,
        provider: provider || 'all',
        queued: 0,
        processed: 0,
      });
    }

    let processed = 0;
    const yandexTokenCache = new Map<string, string>();
    for (const row of queueRows as Array<{
      id: number;
      provider: string;
      object_key: string | null;
      company_id: string | null;
      entity_type?: string | null;
      entity_id?: string | null;
      order_id?: string | null;
      attempts?: number | null;
      reason?: string | null;
    }>) {
      const reasonFeedbackId = feedbackIdFromReason(row.reason);
      const nextAttempt = Math.max(0, Number(row.attempts || 0)) + 1;
      const lockIso = new Date().toISOString();
      const { error: lockError } = await admin
        .from('media_cleanup_queue')
        .update({
          attempts: nextAttempt,
          locked_at: lockIso,
          updated_at: lockIso,
        })
        .eq('id', Number(row.id));
      if (lockError) throw lockError;
      try {
        const objectKey = normalizeKey(row.object_key);
        if (!dryRun && objectKey) {
          if (String(row.provider || '') === 'beget_s3') {
            await deleteBegetKeys([objectKey]);
          } else if (String(row.provider || '') === 'yandex_disk') {
            const companyId = String(row.company_id || '').trim();
            if (!companyId) throw new Error('Missing company_id for Yandex cleanup');
            let accessToken = yandexTokenCache.get(companyId) || '';
            if (!accessToken) {
              accessToken = await getValidYandexAccessToken(admin, companyId);
              yandexTokenCache.set(companyId, accessToken);
            }
            await deleteYandexResourceSafe(accessToken, objectKey);
          }
        }

        const doneIso = new Date().toISOString();
        const { error: doneError } = await admin
          .from('media_cleanup_queue')
          .update({
            processed_at: doneIso,
            locked_at: null,
            last_error: null,
            updated_at: doneIso,
          })
          .eq('id', Number(row.id));
        if (doneError) throw doneError;
        if (reasonFeedbackId) {
          await finalizeQueuedFeedbackDeletion(admin, reasonFeedbackId).catch((finalizeError) => {
            console.error('[media-cleanup] finalize feedback delete failed:', toErrorMessage(finalizeError));
          });
        }
        processed += 1;
      } catch (error) {
        const errorMessage = toErrorMessage(error);
        const stopRetry = reasonFeedbackId && nextAttempt >= FEEDBACK_DELETE_MAX_ATTEMPTS;
        const retryIso = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        const patch = stopRetry
          ? {
              locked_at: null,
              last_error: errorMessage,
              processed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }
          : {
              locked_at: null,
              last_error: errorMessage,
              not_before: retryIso,
              updated_at: new Date().toISOString(),
            };
        const { error: failError } = await admin
          .from('media_cleanup_queue')
          .update(patch)
          .eq('id', Number(row.id));
        if (failError) {
          console.error('[media-cleanup] failed to persist retry state:', toErrorMessage(failError));
        }
        if (stopRetry && reasonFeedbackId) {
          await markQueuedFeedbackDeletionFailed(admin, reasonFeedbackId, errorMessage).catch((markError) => {
            console.error('[media-cleanup] mark feedback cleanup_failed failed:', toErrorMessage(markError));
          });
        }
      }
    }

    return json(200, {
      success: true,
      dry_run: dryRun,
      provider: provider || 'all',
      queued: queueRows.length,
      processed,
    });
  } catch (error) {
    const message = toErrorMessage(error);
    console.error('[media-cleanup]', message);
    return json(500, { success: false, message });
  }
}

if (import.meta.main) {
  Deno.serve(handleMediaCleanupRequest);
}
