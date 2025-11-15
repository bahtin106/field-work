/**
 * Предзагрузка отделов в глобальный кэш при инициализации
 * Это гарантирует, что отделы будут мгновенно доступны при открытии страницы
 */

import { globalCache } from './cache/DataCache';
import logger from './logger';
import { supabase } from './supabase';

export async function preloadDepartments(companyId) {
  if (!companyId) return null;

  const queryKey = `departments:${companyId}:true`;

  try {
    // Проверяем, есть ли уже в кеше свежие данные
    const cached = globalCache.get(queryKey);
    if (cached?.data && !cached.isStale) {
      return cached.data; // Уже есть свежие данные
    }

    // Загружаем отделы
    const { data, error } = await supabase
      .from('departments')
      .select('id, name, is_enabled, company_id')
      .eq('company_id', companyId)
      .eq('is_enabled', true)
      .order('name');

    if (error) {
      logger?.warn?.('preloadDepartments error:', error.message);
      return null;
    }

    const departments = Array.isArray(data) ? data : [];

    // Сохраняем в кэш с длинным TTL
    globalCache.set(queryKey, departments, 10 * 60 * 1000); // 10 минут

    return departments;
  } catch (e) {
    logger?.warn?.('preloadDepartments exception:', e?.message || e);
    return null;
  }
}
