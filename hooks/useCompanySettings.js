import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchCompanySettingsByCompanyId, COMPANY_SETTINGS_QUERY_KEY } from '../lib/companySettingsQuery';
import { useAuthContext } from '../providers/SimpleAuthProvider';

/**
 * Хук для получения настроек компании текущего пользователя
 * Использует кеш react-query, который предзагружается через prefetch
 */
export function useCompanySettings(companyIdOverride = null) {
  const queryClient = useQueryClient();
  const { profile } = useAuthContext();
  const companyId = companyIdOverride || profile?.company_id || null;
  const queryKey = [...COMPANY_SETTINGS_QUERY_KEY, companyId || 'no-company'];

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: () => fetchCompanySettingsByCompanyId(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: true,
    placeholderData: (prev) => prev,
  });

  // Функция для принудительного обновления настроек
  const invalidateSettings = async () => {
    await queryClient.invalidateQueries({ queryKey: COMPANY_SETTINGS_QUERY_KEY });
  };

  return {
    settings: data,
    isLoading,
    error,
    useDepartments: Boolean(data?.use_departments),
    refetch,
    invalidateSettings,
  };
}
