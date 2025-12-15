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
  new: 'Новый',
  in_progress: 'В работе',
  done: 'Завершённая',
};

export function mapStatusToDb(statusKey) {
  if (!statusKey) return null;
  return ORDER_STATUS_DB_MAP[statusKey] || null;
}
