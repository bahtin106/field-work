import { supabase } from './supabase';

/**
 * Returns visible order IDs for the requested work types.
 * The access-controlled view is the sole read path for orders.
 */
export async function getOrderIdsByWorkTypes(workTypeIds = []) {
  if (!Array.isArray(workTypeIds) || workTypeIds.length === 0) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('orders_accessible')
      .select('id')
      .in('work_type_id', workTypeIds)
      .limit(2000);

    if (error) {
      return [];
    }

    return (data || [])
      .map((row) => row?.id)
      .filter(Boolean);
  } catch {
    return [];
  }
}

export const ORDER_STATUS_DB_MAP = {
  feed: 'В ленте',
  new: 'Новый',
  in_progress: 'В работе',
  done: 'Завершённая',
};

const ORDER_STATUS_DB_ALIASES = {
  feed: ['В ленте'],
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
