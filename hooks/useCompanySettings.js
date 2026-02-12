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

      // Try selecting extended set of fields (including currency fields).
      // If DB schema older (missing cols) Supabase will return error; in that case
      // fallback to the safe minimal set.
      const extended =
        'name, timezone, use_departure_time, worker_phone_mode, worker_phone_window_before_mins, worker_phone_window_after_mins, currency, currency_rate, currency_rate_updated_at, recalc_in_progress';
      try {
        const { data } = await supabase
          .from('companies')
          .select(extended)
          .eq('id', profile.company_id)
          .single();
        return data;
      } catch {
        // If the extended select failed due to unknown column, fallback to legacy select
        try {
          const { data } = await supabase
            .from('companies')
            .select(
              'name, timezone, use_departure_time, worker_phone_mode, worker_phone_window_before_mins, worker_phone_window_after_mins',
            )
            .eq('id', profile.company_id)
            .single();
          return data;
        } catch (err) {
          throw err;
        }
      }
    },
    staleTime: 60 * 1000,
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
