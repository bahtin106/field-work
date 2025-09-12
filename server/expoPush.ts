// server/expoPush.ts
// Node.js + TypeScript (подойдёт и для JS — убрать типы).
// Требует: npm i expo-server-sdk @supabase/supabase-js
// ENV: SUPABASE_URL, SUPABASE_SERVICE_KEY

import { Expo, ExpoPushMessage, ExpoPushTicket, ExpoPushReceipt } from 'expo-server-sdk';
import { createClient } from '@supabase/supabase-js';

const expo = new Expo({ useFcmV1: true });
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
  auth: { persistSession: false },
});

/** Берём все валидные токены юзера (multi-device) */
async function fetchUserTokens(userId: string) {
  const { data, error } = await supabase
    .from('push_tokens')
    .select('token, platform, device_id')
    .eq('user_id', userId)
    .eq('is_valid', true);

  if (error) throw new Error(`DB error (fetch tokens): ${error.message}`);
  return (data || []).map((r) => r.token).filter((t): t is string => typeof t === 'string' && !!t);
}

/** Пометить токен невалидным */
async function invalidateToken(token: string, reason: string) {
  const { error } = await supabase
    .from('push_tokens')
    .update({ is_valid: false, invalid_reason: reason })
    .eq('token', token)
    .eq('is_valid', true);
  if (error) console.warn('invalidate error:', error.message);
}

/** Ретрай с экспоненциальной паузой */
async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
async function withRetry<T>(fn: () => Promise<T>, tries = 3, baseDelayMs = 500): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e: any) {
      lastErr = e;
      const retriable = e?.statusCode === 429 || (e?.statusCode >= 500);
      if (!retriable || i === tries - 1) throw e;
      await sleep(baseDelayMs * Math.pow(2, i));
    }
  }
  throw lastErr;
}

/** Отправка набора сообщений с чанкованием + сбор ticketIds */
async function sendChunks(messages: ExpoPushMessage[]) {
  const tickets: ExpoPushTicket[] = [];
  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    const res = await withRetry(() => expo.sendPushNotificationsAsync(chunk));
    tickets.push(...res);
  }
  return tickets;
}

/** Обработка receipt-ов: инвалидируем токены по DeviceNotRegistered */
async function processReceipts(ticketIds: string[], tokenByTicketId: Map<string, string>) {
  const receiptIdChunks = expo.chunkPushNotificationReceiptIds(ticketIds);
  for (const chunk of receiptIdChunks) {
    const receipts = await withRetry(() => expo.getPushNotificationReceiptsAsync(chunk));
    // receipts: Record<id, ExpoPushReceipt>
    for (const [id, receipt] of Object.entries(receipts as Record<string, ExpoPushReceipt>)) {
      if (receipt.status === 'ok') continue;

      const err = receipt.details?.error || receipt.message || receipt.status;
      const token = tokenByTicketId.get(id); // наш исходный токен
      if (!token) continue;

      // Ключевой кейс чистки:
      if (err === 'DeviceNotRegistered') {
        await invalidateToken(token, 'DeviceNotRegistered');
      } else if (err === 'InvalidCredentials') {
        // глобальная проблема с кредами — токен тут не виноват, не инвалидируем
        console.warn('InvalidCredentials from Expo — проверь FCM / APNs ключи.');
      } else {
        // Для прочих ошибок не трогаем валидность, просто лог
        console.warn('Expo receipt error:', err, 'for token', token);
      }
    }
  }
}

/** Публичное API: отправить юзеру (на все его устройства) */
export async function sendToUser(userId: string, payload: {
  title?: string; body?: string; data?: Record<string, any>;
  sound?: 'default' | null; priority?: 'default' | 'high'; badge?: number;
}) {
  const tokens = await fetchUserTokens(userId);
  if (!tokens.length) return { sent: 0 };

  // валидируем формат Expo-токена
  const valid = tokens.filter((t) => Expo.isExpoPushToken(t));
  const invalid = tokens.filter((t) => !Expo.isExpoPushToken(t));
  // на всякий случай сразу чистим явно не-Expo токены
  await Promise.all(invalid.map((t) => invalidateToken(t, 'NotExpoToken')));

  // собираем сообщения
  const messages: ExpoPushMessage[] = valid.map((to) => ({
    to,
    title: payload.title,
    body: payload.body,
    data: payload.data,
    sound: payload.sound ?? undefined, // Android «звук» управляется каналом; iOS — sound: 'default'
    priority: payload.priority ?? 'high',
    badge: payload.badge,
  }));

  // отправка + карта соответствия ticketId -> token
  const tokenByTicketId = new Map<string, string>();
  const tickets = await sendChunks(messages);
  tickets.forEach((t, i) => {
    // На практике expo возвращает id асинхронной доставки
    if ((t as any).id) tokenByTicketId.set((t as any).id, valid[i]);
    else if (t.status === 'error') {
      // синхронная ошибка на этапе отправки
      const code = (t as any).details?.error;
      if (code === 'DeviceNotRegistered') invalidateToken(valid[i], 'DeviceNotRegistered');
      else console.warn('Ticket error:', code, 'for token', valid[i]);
    }
  });

  // обрабатываем получатели по receipt-ам
  const ticketIds = Array.from(tokenByTicketId.keys());
  if (ticketIds.length) await processReceipts(ticketIds, tokenByTicketId);

  return { sent: valid.length, cleaned: invalid.length };
}

/** Пример: массовая рассылка по готовому списку токенов (если надо) */
export async function sendToTokens(tokens: string[], message: Omit<ExpoPushMessage, 'to'>) {
  const valid = tokens.filter((t) => Expo.isExpoPushToken(t));
  const messages: ExpoPushMessage[] = valid.map((to) => ({ to, ...message }));
  const tokenByTicketId = new Map<string, string>();
  const tickets = await sendChunks(messages);
  tickets.forEach((t, i) => { if ((t as any).id) tokenByTicketId.set((t as any).id, valid[i]); });
  const ticketIds = Array.from(tokenByTicketId.keys());
  if (ticketIds.length) await processReceipts(ticketIds, tokenByTicketId);
}
