import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import Expo from 'https://esm.sh/expo-server-sdk@3.11.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const expo = new Expo({ useFcmV1: true });

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const PUSH_WORKER_KEY = Deno.env.get('PUSH_WORKER_KEY') || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } },
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-worker-key',
};

type EventType = 'feed_new_order' | 'assigned_new_order' | 'feed_stale_reminder';

type NotificationEvent = {
  id: number;
  event_type: EventType;
  company_id: string;
  order_id: string;
  recipient_user_id: string | null;
  payload: Record<string, unknown> | null;
  attempt_count: number;
};

type NotificationPrefs = {
  user_id: string;
  allow: boolean;
  new_orders: boolean;
  feed_orders: boolean;
  reminders: boolean;
  quiet_start: string | null;
  quiet_end: string | null;
};

type PushTokenRow = {
  user_id: string;
  token: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, tries = 3, baseDelayMs = 500): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const retriable = e?.statusCode === 429 || e?.statusCode >= 500;
      if (!retriable || i === tries - 1) throw e;
      await sleep(baseDelayMs * 2 ** i);
    }
  }
  throw lastErr as Error;
}

function parseTimeToMinutes(value: string | null): number | null {
  if (!value) return null;
  const match = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function isInQuietHours(nowUtc: Date, quietStart: string | null, quietEnd: string | null): boolean {
  const start = parseTimeToMinutes(quietStart);
  const end = parseTimeToMinutes(quietEnd);
  if (start == null || end == null) return false;

  const nowMinutes = nowUtc.getUTCHours() * 60 + nowUtc.getUTCMinutes();
  if (start === end) return false;
  if (start < end) return nowMinutes >= start && nowMinutes < end;
  return nowMinutes >= start || nowMinutes < end;
}

function getEventTitle(event: NotificationEvent): string {
  if (event.event_type === 'feed_stale_reminder') return 'Request reminder';
  return 'New request';
}

function getEventBody(event: NotificationEvent): string {
  if (event.event_type === 'feed_new_order') return `Request #${event.order_id} is now in feed`;
  if (event.event_type === 'assigned_new_order') return `Request #${event.order_id} was assigned to you`;
  return `Request #${event.order_id} is still in feed for over 30 minutes`;
}

function getEventPrefKey(
  eventType: EventType,
): keyof Pick<NotificationPrefs, 'new_orders' | 'feed_orders' | 'reminders'> {
  if (eventType === 'assigned_new_order') return 'new_orders';
  if (eventType === 'feed_stale_reminder') return 'reminders';
  return 'feed_orders';
}

async function invalidateTokens(tokens: string[], reason: string) {
  if (!tokens.length) return;
  const { error } = await sb
    .from('push_tokens')
    .update({ is_valid: false, invalid_reason: reason })
    .in('token', tokens)
    .eq('is_valid', true);
  if (error) console.warn('invalidateTokens error:', error.message);
}

async function claimEvents(limit: number): Promise<NotificationEvent[]> {
  const { data, error } = await sb.rpc('claim_notification_events', { p_limit: limit });
  if (error) throw new Error(`claim_notification_events failed: ${error.message}`);
  return Array.isArray(data) ? (data as NotificationEvent[]) : [];
}

async function finishEvent(
  eventId: number,
  success: boolean,
  errorMessage: string | null,
  retryDelayMinutes: number,
) {
  const delay = `${Math.max(1, retryDelayMinutes)} minutes`;
  const { error } = await sb.rpc('finish_notification_event', {
    p_event_id: eventId,
    p_success: success,
    p_error: errorMessage,
    p_retry_delay: delay,
  });
  if (error) {
    console.error('finish_notification_event failed:', eventId, error.message);
  }
}

async function enqueueReminders() {
  const { error } = await sb.rpc('enqueue_stale_feed_reminders', {
    p_delay: '30 minutes',
  });
  if (error) {
    console.error('enqueue_stale_feed_reminders failed:', error.message);
  }
}

async function resolveRecipients(event: NotificationEvent): Promise<string[]> {
  if (event.recipient_user_id) return [event.recipient_user_id];

  if (event.event_type !== 'feed_new_order') return [];

  const { data, error } = await sb.rpc('get_company_notification_recipients', {
    p_company_id: event.company_id,
  });

  if (error) throw new Error(`profiles recipients fetch failed: ${error.message}`);
  return (data ?? []).map((r: any) => r.user_id).filter(Boolean);
}

async function filterRecipientsByPrefs(recipientIds: string[], eventType: EventType): Promise<string[]> {
  if (!recipientIds.length) return [];

  const { data, error } = await sb.rpc('get_notification_prefs_bulk', {
    p_user_ids: recipientIds,
  });

  if (error) throw new Error(`notification_prefs fetch failed: ${error.message}`);

  const prefByUser = new Map<string, NotificationPrefs>();
  for (const row of (data ?? []) as NotificationPrefs[]) {
    prefByUser.set(row.user_id, row);
  }

  const nowUtc = new Date();
  const prefKey = getEventPrefKey(eventType);
  const eligible: string[] = [];

  for (const userId of recipientIds) {
    const prefs = prefByUser.get(userId);
    if (!prefs) {
      eligible.push(userId);
      continue;
    }
    if (!prefs.allow) continue;
    if (!prefs[prefKey]) continue;
    if (isInQuietHours(nowUtc, prefs.quiet_start, prefs.quiet_end)) continue;
    eligible.push(userId);
  }

  return eligible;
}

async function fetchTokensForUsers(userIds: string[]): Promise<PushTokenRow[]> {
  if (!userIds.length) return [];
  const { data, error } = await sb.rpc('get_push_tokens_bulk', {
    p_user_ids: userIds,
  });
  if (error) throw new Error(`push_tokens fetch failed: ${error.message}`);
  return (data ?? []) as PushTokenRow[];
}

async function sendEventPush(event: NotificationEvent, tokenRows: PushTokenRow[]) {
  const invalidTokens = tokenRows.map((t) => t.token).filter((token) => !Expo.isExpoPushToken(token));

  if (invalidTokens.length) {
    await invalidateTokens(invalidTokens, 'NotExpoToken');
  }

  const validTokenRows = tokenRows.filter((row) => Expo.isExpoPushToken(row.token));
  if (!validTokenRows.length) return { sentUsers: 0 };

  const messages = validTokenRows.map((row) => ({
    to: row.token,
    title: getEventTitle(event),
    body: getEventBody(event),
    data: {
      order_id: event.order_id,
      event_type: event.event_type,
      ...(event.payload || {}),
    },
    sound: 'default' as const,
    priority: 'high' as const,
  }));

  const sentUserIds = new Set<string>();
  const tokenByTicketId = new Map<string, { token: string; userId: string }>();
  const chunks = expo.chunkPushNotifications(messages);

  let offset = 0;
  for (const chunk of chunks) {
    const tickets = await withRetry(() => expo.sendPushNotificationsAsync(chunk));
    tickets.forEach((ticket: any, i: number) => {
      const source = validTokenRows[offset + i];
      if (!source) return;

      if (ticket?.status === 'ok') {
        sentUserIds.add(source.user_id);
      } else if (ticket?.details?.error === 'DeviceNotRegistered') {
        void invalidateTokens([source.token], 'DeviceNotRegistered');
      }

      if (ticket?.id) {
        tokenByTicketId.set(ticket.id, { token: source.token, userId: source.user_id });
      }
    });
    offset += chunk.length;
  }

  const receiptIds = Array.from(tokenByTicketId.keys());
  const receiptChunks = expo.chunkPushNotificationReceiptIds(receiptIds);
  for (const receiptChunk of receiptChunks) {
    const receipts = await withRetry(() => expo.getPushNotificationReceiptsAsync(receiptChunk));
    for (const [receiptId, receipt] of Object.entries(receipts)) {
      const meta = tokenByTicketId.get(receiptId);
      if (!meta) continue;
      const r: any = receipt;
      if (r?.status === 'ok') {
        sentUserIds.add(meta.userId);
        continue;
      }
      const errCode = r?.details?.error || r?.message || r?.status;
      if (errCode === 'DeviceNotRegistered') {
        await invalidateTokens([meta.token], 'DeviceNotRegistered');
      }
    }
  }

  return { sentUsers: sentUserIds.size };
}

async function processEvents(limit: number) {
  await enqueueReminders();
  const events = await claimEvents(limit);
  const stats = { claimed: events.length, sent: 0, skipped: 0, failed: 0 };

  for (const event of events) {
    try {
      const recipients = await resolveRecipients(event);
      const recipientsWithPrefs = await filterRecipientsByPrefs(recipients, event.event_type);

      if (!recipientsWithPrefs.length) {
        await finishEvent(event.id, true, null, 1);
        stats.skipped += 1;
        continue;
      }

      const tokenRows = await fetchTokensForUsers(recipientsWithPrefs);
      if (!tokenRows.length) {
        await finishEvent(event.id, true, null, 1);
        stats.skipped += 1;
        continue;
      }

      const result = await sendEventPush(event, tokenRows);
      if (result.sentUsers > 0) {
        await finishEvent(event.id, true, null, 1);
        stats.sent += 1;
      } else {
        const retryDelay = Math.min(60, 2 ** Math.max(1, event.attempt_count || 1));
        await finishEvent(event.id, false, 'No devices accepted notification', retryDelay);
        stats.failed += 1;
      }
    } catch (error: any) {
      const retryDelay = Math.min(60, 2 ** Math.max(1, event.attempt_count || 1));
      await finishEvent(event.id, false, error?.message || 'unknown error', retryDelay);
      stats.failed += 1;
      console.error('Event processing failed:', event.id, error?.message || error);
    }
  }

  return stats;
}

export async function handlePushSendRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('POST only', { status: 405, headers: corsHeaders });
  }

  if (PUSH_WORKER_KEY) {
    const incoming = req.headers.get('x-worker-key') || '';
    if (incoming !== PUSH_WORKER_KEY) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const limitRaw = Number(payload?.limit ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50;

    const stats = await processEvents(limit);
    return Response.json({ ok: true, stats }, { headers: corsHeaders });
  } catch (e: any) {
    console.error(e);
    return Response.json(
      { ok: false, error: e?.message || 'internal error' },
      { status: 500, headers: corsHeaders },
    );
  }
}

if (import.meta.main) {
  serve(handlePushSendRequest);
}
