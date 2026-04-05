import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const SUPABASE_URL =
  Deno.env.get('SUPABASE_URL') ||
  Deno.env.get('PROJECT_URL') ||
  Deno.env.get('SUPABASE_PUBLIC_URL') ||
  '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const PUSH_WORKER_KEY = Deno.env.get('PUSH_WORKER_KEY') || '';
const PUSH_ANDROID_CHANNEL_ID = Deno.env.get('PUSH_ANDROID_CHANNEL_ID') || 'app-notify';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

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

const PUSH_MESSAGE_KEYS = {
  title_new: 'push_title_new',
  title_reminder: 'push_title_reminder',
  body_feed: 'push_body_feed',
  body_assigned: 'push_body_assigned',
  body_reminder: 'push_body_reminder',
  fallback_untitled: 'push_order_untitled',
} as const;

const RU_MESSAGES: Record<(typeof PUSH_MESSAGE_KEYS)[keyof typeof PUSH_MESSAGE_KEYS], string> = {
  push_title_new: 'Новая заявка',
  push_title_reminder: 'Напоминание по заявке',
  push_body_feed: 'В ленте появилась заявка: {order}',
  push_body_assigned: 'Вам назначена заявка: {order}',
  push_body_reminder: 'Заявка {order} больше {minutes} мин в ленте',
  push_order_untitled: 'без названия',
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

function normalizedId(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.toLowerCase();
}

function normalizeTimeZone(value: unknown): string | null {
  const tz = String(value || '').trim();
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return null;
  }
}

type NotificationPrefs = {
  user_id: string;
  allow: boolean;
  new_orders: boolean;
  feed_orders: boolean;
  reminders: boolean;
  reminder_delay_minutes: number;
  quiet_start: string | null;
  quiet_end: string | null;
  quiet_timezone: string | null;
};

type PushTokenRow = {
  user_id: string;
  token: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isTransientUpstreamError(error: unknown) {
  const message = String((error as { message?: string })?.message || error || '').toLowerCase();
  if (!message) return false;
  return (
    message.includes('upstream') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('connection') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('network')
  );
}

async function rpcWithRetry<T = unknown>(
  fn: string,
  args: Record<string, unknown>,
  attempts = 3,
): Promise<{ data: T | null; error: { message: string } | null }> {
  let lastError: { message: string } | null = null;
  for (let index = 0; index < attempts; index += 1) {
    const { data, error } = await sb.rpc(fn, args);
    if (!error) return { data: (data ?? null) as T | null, error: null };
    lastError = { message: String(error.message || 'rpc_error') };
    if (!isTransientUpstreamError(error) || index === attempts - 1) {
      return { data: null, error: lastError };
    }
    await sleep(250 * (index + 1));
  }
  return { data: null, error: lastError || { message: 'rpc_error' } };
}

function tr(key: (typeof PUSH_MESSAGE_KEYS)[keyof typeof PUSH_MESSAGE_KEYS], params?: Record<string, string>) {
  let template = RU_MESSAGES[key] || key;
  if (!params) return template;
  for (const [k, v] of Object.entries(params)) {
    template = template.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
  }
  return template;
}

function pad2(value: number) {
  return String(Math.trunc(value)).padStart(2, '0');
}

function buildAutoOrderTitle(dateInput: unknown): string {
  const parsed = dateInput ? new Date(String(dateInput)) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const stamp = `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return `Заявка от ${stamp}`;
}

function normalizeOrderTitle(value: unknown, fallbackDate: unknown = null): string {
  const raw = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  const fallback = buildAutoOrderTitle(fallbackDate);
  if (!raw) return fallback;
  if (raw.length <= 56) return raw;
  return `${raw.slice(0, 55).trimEnd()}...`;
}

function isExpoPushToken(token: string) {
  return /^ExponentPushToken\[[A-Za-z0-9._-]+\]$/.test(token);
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

const timeZoneFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getMinutesForTimeZone(nowUtc: Date, timeZone: string | null): number {
  const zone = String(timeZone || '').trim() || 'UTC';
  let formatter = timeZoneFormatterCache.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    timeZoneFormatterCache.set(zone, formatter);
  }

  const parts = formatter.formatToParts(nowUtc);
  const hourPart = parts.find((part) => part.type === 'hour')?.value ?? '0';
  const minutePart = parts.find((part) => part.type === 'minute')?.value ?? '0';
  const hh = Number(hourPart);
  const mm = Number(minutePart);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) {
    return nowUtc.getUTCHours() * 60 + nowUtc.getUTCMinutes();
  }
  return hh * 60 + mm;
}

function isInQuietHours(
  nowUtc: Date,
  quietStart: string | null,
  quietEnd: string | null,
  quietTimeZone: string | null,
): boolean {
  const start = parseTimeToMinutes(quietStart);
  const end = parseTimeToMinutes(quietEnd);
  if (start == null || end == null) return false;

  let nowMinutes = nowUtc.getUTCHours() * 60 + nowUtc.getUTCMinutes();
  try {
    nowMinutes = getMinutesForTimeZone(nowUtc, quietTimeZone);
  } catch {}
  if (start === end) return false;
  if (start < end) return nowMinutes >= start && nowMinutes < end;
  return nowMinutes >= start || nowMinutes < end;
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
  const { data, error } = await rpcWithRetry<NotificationEvent[]>('claim_notification_events', { p_limit: limit });
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
  const { error } = await rpcWithRetry('finish_notification_event', {
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
  const { error } = await rpcWithRetry('enqueue_stale_feed_reminders', {
    p_delay: '20 minutes',
  });
  if (error) {
    console.error('enqueue_stale_feed_reminders failed:', error.message);
  }
}

async function resolveRecipients(event: NotificationEvent): Promise<string[]> {
  if (event.recipient_user_id) return [event.recipient_user_id];
  if (event.event_type !== 'feed_new_order') return [];

  const { data, error } = await rpcWithRetry<Array<{ user_id: string }>>('get_company_notification_recipients', {
    p_company_id: event.company_id,
  });
  if (error) throw new Error(`profiles recipients fetch failed: ${error.message}`);
  const excluded = new Set<string>();
  excluded.add(normalizedId((event.payload as any)?.creator_user_id));
  excluded.add(normalizedId((event.payload as any)?.actor_user_id));
  excluded.add(normalizedId((event.payload as any)?.updated_by_user_id));

  try {
    const { data: orderRow, error: orderError } = await sb
      .from('orders')
      .select('created_by_user_id, updated_by')
      .eq('id', event.order_id)
      .limit(1)
      .maybeSingle();
    if (!orderError && orderRow) {
      excluded.add(normalizedId((orderRow as any).created_by_user_id));
      excluded.add(normalizedId((orderRow as any).updated_by));
    }
  } catch {}
  excluded.delete('');

  return (data ?? [])
    .map((r: any) => String(r.user_id || '').trim())
    .filter((userId) => userId && !excluded.has(normalizedId(userId)));
}

async function filterRecipientsByPrefs(recipientIds: string[], eventType: EventType): Promise<string[]> {
  if (!recipientIds.length) return [];
  const { data, error } = await rpcWithRetry<NotificationPrefs[]>('get_notification_prefs_bulk', {
    p_user_ids: recipientIds,
  });
  if (error) throw new Error(`notification_prefs fetch failed: ${error.message}`);
  const { data: tzRows, error: tzError } = await sb.from('profiles').select('id, timezone').in('id', recipientIds);
  if (tzError) throw new Error(`profiles timezone fetch failed: ${tzError.message}`);

  const prefByUser = new Map<string, NotificationPrefs>();
  for (const row of (data ?? []) as NotificationPrefs[]) {
    prefByUser.set(row.user_id, row);
  }
  const profileTzByUser = new Map<string, string | null>();
  for (const row of (tzRows ?? []) as Array<{ id: string; timezone: string | null }>) {
    profileTzByUser.set(String(row.id), normalizeTimeZone(row.timezone));
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
    const prefTimeZone = normalizeTimeZone(prefs.quiet_timezone);
    const profileTimeZone = profileTzByUser.get(userId) || null;
    const effectiveTimeZone = prefTimeZone || profileTimeZone || 'UTC';
    if (isInQuietHours(nowUtc, prefs.quiet_start, prefs.quiet_end, effectiveTimeZone)) continue;
    eligible.push(userId);
  }
  return eligible;
}

async function fetchTokensForUsers(userIds: string[]): Promise<PushTokenRow[]> {
  if (!userIds.length) return [];
  const { data, error } = await rpcWithRetry<PushTokenRow[]>('get_push_tokens_bulk', { p_user_ids: userIds });
  if (error) throw new Error(`push_tokens fetch failed: ${error.message}`);
  return (data ?? []) as PushTokenRow[];
}

async function resolveOrderTitle(event: NotificationEvent): Promise<string> {
  const payloadTitle = event.payload?.order_title;
  if (typeof payloadTitle === 'string' && payloadTitle.trim()) {
    return normalizeOrderTitle(payloadTitle, (event.payload as any)?.time_window_start);
  }

  const { data, error } = await sb
    .from('orders')
    .select('title, time_window_start, created_at')
    .eq('id', event.order_id)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('resolveOrderTitle error:', error.message);
    return normalizeOrderTitle(null, null);
  }
  return normalizeOrderTitle(data?.title, data?.time_window_start || data?.created_at || null);
}

async function getEventText(event: NotificationEvent): Promise<{ title: string; body: string; orderLabel: string }> {
  const orderLabel = await resolveOrderTitle(event);

  if (event.event_type === 'feed_stale_reminder') {
    const rawDelay = Number((event.payload as any)?.delay_minutes);
    const delayMinutes = Number.isFinite(rawDelay) && rawDelay > 0 ? Math.floor(rawDelay) : 20;
    return {
      title: tr(PUSH_MESSAGE_KEYS.title_reminder),
      body: tr(PUSH_MESSAGE_KEYS.body_reminder, { order: orderLabel, minutes: String(delayMinutes) }),
      orderLabel,
    };
  }
  if (event.event_type === 'assigned_new_order') {
    return {
      title: tr(PUSH_MESSAGE_KEYS.title_new),
      body: tr(PUSH_MESSAGE_KEYS.body_assigned, { order: orderLabel }),
      orderLabel,
    };
  }
  return {
    title: tr(PUSH_MESSAGE_KEYS.title_new),
    body: tr(PUSH_MESSAGE_KEYS.body_feed, { order: orderLabel }),
    orderLabel,
  };
}

async function sendChunk(messages: unknown[]) {
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    },
    body: JSON.stringify(messages),
  });
  if (!res.ok) throw new Error(`Expo push responded ${res.status}`);
  const data = (await res.json()) as { data?: unknown[] };
  return Array.isArray(data.data) ? data.data : [];
}

async function sendEventPush(event: NotificationEvent, tokenRows: PushTokenRow[]) {
  const invalidTokens: string[] = [];
  const valid = tokenRows.filter((t) => {
    const ok = isExpoPushToken(t.token);
    if (!ok) invalidTokens.push(t.token);
    return ok;
  });
  if (invalidTokens.length) await invalidateTokens(invalidTokens, 'NotExpoToken');
  if (!valid.length) return { sentUsers: 0, firstError: null as string | null };

  const text = await getEventText(event);
  const messages = valid.map((row) => ({
    to: row.token,
    title: text.title,
    body: text.body,
    data: {
      order_id: event.order_id,
      order_title: text.orderLabel,
      event_type: event.event_type,
      route: `/orders/${event.order_id}`,
      params: { id: event.order_id, returnTo: '/orders/my-orders' },
      entity_type: 'order',
      entity_id: event.order_id,
      ...(event.payload || {}),
    },
    sound: 'default' as const,
    channelId: PUSH_ANDROID_CHANNEL_ID,
    priority: 'high' as const,
    ttl: 60,
    expiration: Math.floor(Date.now() / 1000) + 60,
  }));

  const sentUserIds = new Set<string>();
  const errors: string[] = [];
  const chunkSize = 99;

  for (let i = 0; i < messages.length; i += chunkSize) {
    const chunk = messages.slice(i, i + chunkSize);
    const tickets = await sendChunk(chunk);
    for (let j = 0; j < tickets.length; j++) {
      const ticket: any = tickets[j];
      const source = valid[i + j];
      if (!source) continue;

      if (ticket?.status === 'ok') {
        sentUserIds.add(source.user_id);
      } else {
        const ticketError = String(ticket?.details?.error || ticket?.message || 'unknown').trim();
        errors.push(ticketError);
        if (ticket?.details?.error === 'DeviceNotRegistered') {
          invalidTokens.push(source.token);
        }
      }
    }
    await sleep(120);
  }

  if (invalidTokens.length) await invalidateTokens(invalidTokens, 'DeviceNotRegistered');
  return { sentUsers: sentUserIds.size, firstError: errors[0] ?? null };
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
        await finishEvent(event.id, false, result.firstError || 'No devices accepted notification', retryDelay);
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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: corsHeaders });

  if (PUSH_WORKER_KEY) {
    const incoming = req.headers.get('x-worker-key') || '';
    if (incoming !== PUSH_WORKER_KEY) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const limitRaw = Number((payload as any)?.limit ?? 50);
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
