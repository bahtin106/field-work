import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/**
 * Хук для получения настроек компании текущего пользователя
 * Использует кеш react-query, который предзагружается через prefetch
 */
export function useCompanySettings() {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['companySettings'],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: profile } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', user.id)
        .single();

      if (!profile?.company_id) return null;

      const { data } = await supabase
        .from('companies')
        .select(
          'name, timezone, use_departure_time, worker_phone_mode, worker_phone_window_before_mins, worker_phone_window_after_mins',
        )
        .eq('id', profile.company_id)
        .single();

      return data;
    },
    staleTime: 1000, // Уменьшаем до 1 секунды для быстрого отклика на изменения
    placeholderData: (prev) => prev,
  });

  // Функция для принудительного обновления настроек
  const invalidateSettings = async () => {
    await queryClient.invalidateQueries({ queryKey: ['companySettings'] });
  };

  return {
    settings: data,
    isLoading,
    error,
    useDepartureTime: Boolean(data?.use_departure_time),
    refetch,
    invalidateSettings,
  };
}
