/**
 * useDepartments - Хук для работы со списком отделов
 * Использует систему кэширования и автоматическую синхронизацию
 */

import { useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useQueryWithCache } from './useQueryWithCache';
import { useRealtimeSync } from './useRealtimeSync';

export function useDepartments(options = {}) {
  const { companyId, enabled = true, onlyEnabled = true } = options;

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

  // Используем систему кэширования
  const { data, isLoading, isRefreshing, refresh, error } = useQueryWithCache({
    queryKey,
    queryFn: fetchDepartments,
    ttl: 10 * 60 * 1000, // 10 минут (отделы меняются реже)
    enabled: enabled && !!companyId,
  });

  // Автоматическая синхронизация через Realtime
  useRealtimeSync({
    supabaseClient: supabase,
    table: 'departments',
    queryKey,
    onUpdate: refresh,
    enabled: enabled && !!companyId,
  });

  return {
    departments: data || [],
    isLoading,
    isRefreshing,
    refresh,
    error,
  };
}
