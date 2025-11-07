// supabase/functions/push-send/index.ts
// Edge Function для отправки пушей + авто-чистка токенов.
// Зависимости уже встроены (импорты через ESM), ничего ставить не нужно.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import Expo from 'https://esm.sh/expo-server-sdk@3.11.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const expo = new Expo({ useFcmV1: true });

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('supabaseKey is required (set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY)');
}
const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY')!,
);

type Payload = {
  userId: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  priority?: 'default' | 'high';
  badge?: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function withRetry<T>(fn: () => Promise<T>, tries = 3, base = 500): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      last = e;
      const retriable = e?.statusCode === 429 || e?.statusCode >= 500;
      if (!retriable || i === tries - 1) throw e;
      await sleep(base * 2 ** i);
    }
  }
  throw last as Error;
}

async function fetchUserTokens(userId: string) {
  const { data, error } = await sb
    .from('push_tokens')
    .select('token')
    .eq('user_id', userId)
    .eq('is_valid', true);
  if (error) throw new Error('DB fetch tokens: ' + error.message);
  return (data ?? []).map((r: any) => r.token as string).filter(Boolean);
}

async function invalidateToken(token: string, reason: string) {
  const { error } = await sb
    .from('push_tokens')
    .update({ is_valid: false, invalid_reason: reason })
    .eq('token', token)
    .eq('is_valid', true);
  if (error) console.warn('invalidate error:', error.message);
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });

  try {
    const p = (await req.json()) as Payload;
    if (!p?.userId) return new Response('userId required', { status: 400 });

    const tokens = await fetchUserTokens(p.userId);
    if (!tokens.length) return Response.json({ ok: true, result: { sent: 0, cleaned: 0 } });

    const valid = tokens.filter((t) => Expo.isExpoPushToken(t));
    const invalid = tokens.filter((t) => !Expo.isExpoPushToken(t));
    await Promise.all(invalid.map((t) => invalidateToken(t, 'NotExpoToken')));

    const messages = valid.map((to) => ({
      to,
      title: p.title,
      body: p.body,
      data: p.data,
      sound: p.sound ?? undefined, // iOS
      priority: p.priority ?? 'high', // Android
      badge: p.badge,
    }));

    const tokenByTicketId = new Map<string, string>();
    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      const tickets = await withRetry(() => expo.sendPushNotificationsAsync(chunk));
      tickets.forEach((t: any, i: number) => {
        if (t?.id) tokenByTicketId.set(t.id, chunk[i].to as string);
        else if (t?.status === 'error' && t?.details?.error === 'DeviceNotRegistered') {
          invalidateToken(chunk[i].to as string, 'DeviceNotRegistered');
        }
      });
    }

    const receiptIdChunks = expo.chunkPushNotificationReceiptIds([...tokenByTicketId.keys()]);
    for (const chunk of receiptIdChunks) {
      const receipts = await withRetry(() => expo.getPushNotificationReceiptsAsync(chunk));
      for (const [id, receipt] of Object.entries(receipts)) {
        // @ts-ignore
        if (receipt.status === 'ok') continue;
        // @ts-ignore
        const err = receipt.details?.error || receipt.message || receipt.status;
        const token = tokenByTicketId.get(id);
        if (!token) continue;
        if (err === 'DeviceNotRegistered') await invalidateToken(token, 'DeviceNotRegistered');
        else if (err === 'InvalidCredentials') console.warn('InvalidCredentials: проверь FCM/APNs');
        else console.warn('Expo receipt error:', err, 'for token', token);
      }
    }

    return Response.json({ ok: true, result: { sent: valid.length, cleaned: invalid.length } });
  } catch (e: any) {
    console.error(e);
    return new Response(e?.message ?? 'Error', { status: 500 });
  }
});
