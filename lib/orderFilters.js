import { supabase } from './supabase';

/**
 * Helper used in screens that query orders_secure where `work_type_id`
 * might be missing. Returns the list of order IDs that match the requested
 * work type IDs by querying the base `orders` table.
 */
export async function getOrderIdsByWorkTypes(workTypeIds = []) {
  if (!Array.isArray(workTypeIds) || workTypeIds.length === 0) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('orders')
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
  return key;
}

export function getStatusDbAliases(statusKey) {
  const normalized = normalizeOrderStatusFilterKey(statusKey);
  return ORDER_STATUS_DB_ALIASES[normalized] || [];
}

export function mapStatusToDb(statusKey) {
  const normalized = normalizeOrderStatusFilterKey(statusKey);
  if (!normalized) return null;
  return ORDER_STATUS_DB_MAP[normalized] || null;
}
