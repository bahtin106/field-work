import { supabase } from './supabase';

/**
 * Returns visible order IDs for the requested work types.
 * The access-controlled view is the sole read path for orders.
 */
export async function getOrderIdsByWorkTypes(workTypeIds = [], signal = undefined) {
  if (!Array.isArray(workTypeIds) || workTypeIds.length === 0) {
    return [];
  }

  let query = supabase
    .from('orders_accessible')
    .select('id')
    .in('work_type_id', workTypeIds)
    .limit(2000);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data || [])
    .map((row) => row?.id)
    .filter(Boolean);
}

export const ORDER_STATUS_DB_MAP = {
  feed: '\u0412 \u043b\u0435\u043d\u0442\u0435',
  new: 'Новый',
  in_progress: 'В работе',
  done: 'Завершённая',
};

const ORDER_STATUS_DB_ALIASES = {
  feed: ['feed', 'in_feed', '\u0412 \u043b\u0435\u043d\u0442\u0435', '\u041b\u0435\u043d\u0442\u0430'],
  new: ['Новый', 'Новая'],
  in_progress: ['В работе'],
  done: ['Завершённая'],
};

export function normalizeOrderStatusFilterKey(statusKey) {
  const key = String(statusKey || '').trim();
  if (!key) return '';
  if (key === 'progress') return 'in_progress';
  if (key === 'completed' || key === 'complete') return 'done';
  if (key === 'in_feed') return 'feed';
  return key;
}

export function getStatusDbAliases(statusKey) {
  const normalized = normalizeOrderStatusFilterKey(statusKey);
  if (!normalized || normalized === 'all') return [];
  const aliases = ORDER_STATUS_DB_ALIASES[normalized] || [];
  return Array.from(new Set([normalized, ...aliases]));
}

export function mapStatusToDb(statusKey) {
  const normalized = normalizeOrderStatusFilterKey(statusKey);
  if (!normalized) return null;
  return ORDER_STATUS_DB_MAP[normalized] || null;
}
