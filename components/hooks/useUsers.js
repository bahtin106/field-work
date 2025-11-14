/**
 * useUsers - Хук для работы со списком пользователей
 * Использует систему кэширования и автоматическую синхронизацию
 */

import { useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useQueryWithCache } from './useQueryWithCache';
import { useRealtimeSync } from './useRealtimeSync';

export function useUsers(options = {}) {
  const { filters = {}, enabled = true } = options;

  // Генерируем уникальный ключ кэша на основе фильтров
  const queryKey = useMemo(() => {
    const filterStr = JSON.stringify(filters);
    return `users:${filterStr}`;
  }, [filters]);

  // Функция загрузки пользователей
  const fetchUsers = useCallback(async () => {
    let query = supabase
      .from('profiles')
      .select(
        'id, first_name, last_name, full_name, role, department_id, last_seen_at, is_suspended, suspended_at',
      )
      .order('full_name', { ascending: true, nullsFirst: false });

    // Применяем фильтры
    if (Array.isArray(filters.departments) && filters.departments.length > 0) {
      const deptIds = filters.departments.map((d) => (typeof d === 'number' ? d : String(d)));
      query = query.in('department_id', deptIds);
    }

    if (Array.isArray(filters.roles) && filters.roles.length > 0) {
      query = query.in('role', filters.roles);
    }

    if (filters.suspended === true) {
      query = query.or('is_suspended.eq.true,suspended_at.not.is.null');
    } else if (filters.suspended === false) {
      query = query.eq('is_suspended', false).is('suspended_at', null);
    }

    const { data, error } = await query;

    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }, [filters]);

  // Используем систему кэширования
  const { data, isLoading, isRefreshing, refresh, error } = useQueryWithCache({
    queryKey,
    queryFn: fetchUsers,
    ttl: 5 * 60 * 1000, // 5 минут
    enabled,
  });

  // Автоматическая синхронизация через Realtime
  useRealtimeSync({
    supabaseClient: supabase,
    table: 'profiles',
    queryKey,
    onUpdate: refresh,
    enabled,
  });

  return {
    users: data || [],
    isLoading,
    isRefreshing,
    refresh,
    error,
  };
}
