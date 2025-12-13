/**
 * useDepartments - Хук для работы со списком отделов
 *
 * ПРОФЕССИОНАЛЬНОЕ РЕШЕНИЕ:
 * - Отделы кешируются на 60 минут (отделы меняются очень редко)
 * - staleTime = 30 минут (показываем кэш, обновляем в фоне)
 * - Используется глобальный кэш для переиспользования между компонентами
 * - Данные загружаются один раз при первом обращении и переиспользуются
 */

import { useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from './useAuth';
import { useQueryWithCache } from './useQueryWithCache';
import { useRealtimeSync } from './useRealtimeSync';

export function useDepartments(options = {}) {
  const { companyId, enabled = true, onlyEnabled = true } = options;
  const { isAuthenticated } = useAuth();

  const queryKey = `departments:${companyId}:${onlyEnabled}`;

  // Функция загрузки отделов
  const fetchDepartments = useCallback(async () => {
    if (!companyId) return [];

    let query = supabase
      .from('departments')
      .select('id, name, is_enabled, company_id')
      .eq('company_id', companyId)
      .order('name');

    const { data, error } = await query;

    if (error) throw error;

    const departments = Array.isArray(data) ? data : [];

    // Фильтруем только активные, если нужно
    if (onlyEnabled) {
      return departments.filter((d) => d.is_enabled !== false);
    }

    return departments;
  }, [companyId, onlyEnabled]);

  // ПРОФЕССИОНАЛЬНОЕ КЕШИРОВАНИЕ:
  // - TTL: 60 минут (отделы практически не меняются)
  // - staleTime: 30 минут (обновляем в фоне если старше 30 минут)
  // - Данные между компонентами переиспользуются из глобального кеша
  const { data, isLoading, isRefreshing, refresh, error } = useQueryWithCache({
    queryKey,
    queryFn: fetchDepartments,
    ttl: 60 * 60 * 1000, // 60 минут - отделы меняются редко
    staleTime: 30 * 60 * 1000, // 30 минут - обновляем в фоне
    enabled: enabled && !!companyId && isAuthenticated, // КРИТИЧНО: загружаем только если есть авторизация
    placeholderData: [], // Показываем пустой массив пока грузятся данные из кеша
  });

  // Автоматическая синхронизация через Realtime
  // ⚠️ Важно: не подписываемся если пользователь не аутентифицирован
  useRealtimeSync({
    supabaseClient: supabase,
    table: 'departments',
    queryKey,
    onUpdate: refresh,
    enabled: enabled && !!companyId && isAuthenticated,
  });

  return {
    departments: data || [],
    isLoading,
    isRefreshing,
    refresh,
    error,
  };
}
