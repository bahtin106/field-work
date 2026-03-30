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

function isMissingRpcError(error: unknown) {
  const msg = String((error as { message?: string })?.message || error || '').toLowerCase();
  return msg.includes('function') && (msg.includes('does not exist') || msg.includes('not found'));
}

function normalizeKey(value: string | null | undefined) {
  return String(value || '').replace(/^\/+/, '').trim();
}

const FEEDBACK_DELETE_REASON_PREFIX = 'feedback_delete:';
const FEEDBACK_DELETE_MAX_ATTEMPTS = 5;
const DEFAULT_MAX_ATTEMPTS = 40;
const DEFAULT_RETRY_DELAY_MS = 5 * 60 * 1000;
const DEFAULT_LOCK_TIMEOUT_MS = 10 * 60 * 1000;

function envInt(name: string, fallback: number, min: number, max: number) {
  const raw = Number(Deno.env.get(name) || fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

function isNonRetryableCleanupError(errorMessage: string) {
  const msg = String(errorMessage || '').toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('yandex disk not connected') ||
    msg.includes('missing company_id for yandex cleanup') ||
    msg.includes('invalid token. service role key required') ||
    msg.includes('invalid x-cleanup-key') ||
    msg.includes('unsupported provider')
  );
}

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

    const maxAttempts = envInt('MEDIA_CLEANUP_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS, 1, 500);
    const retryDelayMs = envInt('MEDIA_CLEANUP_RETRY_DELAY_MS', DEFAULT_RETRY_DELAY_MS, 1_000, 24 * 60 * 60 * 1000);
    const lockTimeoutMs = envInt(
      'MEDIA_CLEANUP_LOCK_TIMEOUT_MS',
      DEFAULT_LOCK_TIMEOUT_MS,
      10_000,
      24 * 60 * 60 * 1000,
    );
    const workerId = `media-cleanup@${Deno.env.get('HOSTNAME') || 'edge'}`;

    const nowIso = new Date().toISOString();
    const staleLockIso = new Date(Date.now() - lockTimeoutMs).toISOString();
    let usingV2Queue = false;
    let reclaimedLocks = 0;

    const claimPayload = {
      p_limit: limit,
      p_provider: provider || null,
      p_lock_ms: lockTimeoutMs,
      p_worker: workerId,
    };
    const { data: claimedRows, error: claimError } = await admin.rpc('claim_media_cleanup_jobs', claimPayload);
    if (claimError && !isMissingRpcError(claimError)) throw claimError;

    let queueRows: Array<{
      id: number;
      provider: string;
      object_key: string | null;
      company_id: string | null;
      entity_type?: string | null;
      entity_id?: string | null;
      order_id?: string | null;
      attempts?: number | null;
      reason?: string | null;
      max_attempts?: number | null;
      status?: string | null;
    }> = [];

    if (!claimError) {
      usingV2Queue = true;
      queueRows = Array.isArray(claimedRows) ? (claimedRows as typeof queueRows) : [];
    } else {
      const { count, error: reclaimError } = await admin
        .from('media_cleanup_queue')
        .update({
          locked_at: null,
          updated_at: nowIso,
        })
        .is('processed_at', null)
        .lt('locked_at', staleLockIso)
        .select('id', { count: 'exact', head: true });
      if (reclaimError) {
        console.error('[media-cleanup] reclaim stale locks failed:', toErrorMessage(reclaimError));
      }
      reclaimedLocks = Number(count || 0);

      let query = admin
        .from('media_cleanup_queue')
        .select('id, provider, object_key, company_id, entity_type, entity_id, order_id, attempts, reason')
        .is('processed_at', null)
        .lte('not_before', nowIso)
        .is('locked_at', null)
        .order('id', { ascending: true })
        .limit(limit);
      if (provider) query = query.eq('provider', provider);
      const { data: rows, error } = await query;
      if (error) throw error;
      queueRows = Array.isArray(rows) ? (rows as typeof queueRows) : [];
    }

    if (!queueRows.length) {
      return json(200, {
        success: true,
        dry_run: dryRun,
        provider: provider || 'all',
        queued: 0,
        processed: 0,
        retried: 0,
        failed_final: 0,
        skipped_lock_conflict: 0,
        reclaimed_stale_locks: Number(reclaimedLocks || 0),
      });
    }

    let processed = 0;
    let retried = 0;
    let failedFinal = 0;
    let lockConflicts = 0;
    const yandexTokenCache = new Map<string, string>();
    for (const row of queueRows) {
      const reasonFeedbackId = feedbackIdFromReason(row.reason);
      const nextAttempt = Math.max(0, Number(row.attempts || 0));
      if (!usingV2Queue) {
        const lockIso = new Date().toISOString();
        const lockQuery = admin
          .from('media_cleanup_queue')
          .update({
            attempts: nextAttempt + 1,
            locked_at: lockIso,
            updated_at: lockIso,
          })
          .eq('id', Number(row.id))
          .is('processed_at', null)
          .is('locked_at', null)
          .select('id');
        const { data: lockRows, error: lockError } = await lockQuery;
        if (lockError) throw lockError;
        if (!Array.isArray(lockRows) || !lockRows.length) {
          lockConflicts += 1;
          continue;
        }
      }
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

        if (usingV2Queue) {
          const { data: finalizeState, error: finalizeError } = await admin.rpc('finalize_media_cleanup_job', {
            p_id: Number(row.id),
            p_success: true,
            p_error_message: null,
            p_error_code: null,
            p_retry_delay_ms: retryDelayMs,
            p_force_dead_letter: false,
          });
          if (finalizeError) throw finalizeError;
          if (String(finalizeState || '') !== 'succeeded') {
            throw new Error(`Unexpected finalize state: ${String(finalizeState || 'unknown')}`);
          }
        } else {
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
        }
        if (reasonFeedbackId) {
          await finalizeQueuedFeedbackDeletion(admin, reasonFeedbackId).catch((finalizeError) => {
            console.error('[media-cleanup] finalize feedback delete failed:', toErrorMessage(finalizeError));
          });
        }
        processed += 1;
      } catch (error) {
        const errorMessage = toErrorMessage(error);
        const configuredMax = Number(row.max_attempts || maxAttempts);
        const reasonMaxAttempts = reasonFeedbackId
          ? Math.min(FEEDBACK_DELETE_MAX_ATTEMPTS, Math.max(1, configuredMax))
          : Math.max(1, configuredMax);
        const nonRetryable = isNonRetryableCleanupError(errorMessage);
        const stopRetry = nonRetryable || nextAttempt >= reasonMaxAttempts;
        if (usingV2Queue) {
          const errorCode = nonRetryable ? 'non_retryable' : 'retryable';
          const { data: finalizeState, error: finalizeError } = await admin.rpc('finalize_media_cleanup_job', {
            p_id: Number(row.id),
            p_success: false,
            p_error_message: errorMessage,
            p_error_code: errorCode,
            p_retry_delay_ms: retryDelayMs,
            p_force_dead_letter: stopRetry,
          });
          if (finalizeError) {
            console.error('[media-cleanup] finalize failure state failed:', toErrorMessage(finalizeError));
          } else {
            const nextState = String(finalizeState || '');
            if (nextState === 'dead_letter') {
              failedFinal += 1;
            } else if (nextState === 'retrying') {
              retried += 1;
            }
          }
        } else {
          const retryIso = new Date(Date.now() + retryDelayMs).toISOString();
          const patch = stopRetry
            ? {
                locked_at: null,
                last_error: `[final] ${errorMessage}`,
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
          if (stopRetry) {
            failedFinal += 1;
          } else {
            retried += 1;
          }
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
      retried,
      failed_final: failedFinal,
      skipped_lock_conflict: lockConflicts,
      reclaimed_stale_locks: Number(reclaimedLocks || 0),
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
