import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { AppState } from 'react-native';
import {
  applyCompanySettingsCachePatch,
  COMPANY_SETTINGS_LIVE_REFETCH_MS,
  COMPANY_SETTINGS_QUERY_KEY,
  COMPANY_SETTINGS_UPDATED_EVENT,
  fetchCompanySettingsByCompanyId,
  getCompanySettingsQueryKey,
} from '../lib/companySettingsQuery';
import { supabase } from '../lib/supabase';
import { useAuthContext } from '../providers/SimpleAuthProvider';

const COMPANY_SETTINGS_GC_MS = 14 * 24 * 60 * 60 * 1000;
const COMPANY_SETTINGS_STALE_MS = 5 * 60 * 1000;

/**
 * Хук для получения настроек компании текущего пользователя
 * Использует кеш react-query, который предзагружается через prefetch
 */
export function useCompanySettings(companyIdOverride = null, options = {}) {
  const {
    enabled = true,
    subscribe = true,
    liveRefetchIntervalMs = COMPANY_SETTINGS_LIVE_REFETCH_MS,
  } = options || {};
  const queryClient = useQueryClient();
  const { profile } = useAuthContext();
  const companyId = companyIdOverride || profile?.company_id || null;
  const queryKey = useMemo(
    () => getCompanySettingsQueryKey(companyId),
    [companyId],
  );
  const queryEnabled = enabled !== false && !!companyId;
  const liveRefetchInterval =
    queryEnabled && subscribe !== false && liveRefetchIntervalMs !== false
      ? Math.max(1000, Number(liveRefetchIntervalMs) || COMPANY_SETTINGS_LIVE_REFETCH_MS)
      : false;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: () => fetchCompanySettingsByCompanyId(companyId),
    enabled: queryEnabled,
    staleTime: COMPANY_SETTINGS_STALE_MS,
    gcTime: COMPANY_SETTINGS_GC_MS,
    refetchOnMount: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
    refetchInterval: liveRefetchInterval,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    if (!companyId || !queryEnabled || subscribe === false) return undefined;

    const refreshSettings = (payload = null) => {
      const rowPatch = payload?.new || payload?.payload?.patch || null;
      applyCompanySettingsCachePatch(queryClient, companyId, rowPatch);
      queryClient.invalidateQueries({
        queryKey: COMPANY_SETTINGS_QUERY_KEY,
        refetchType: 'active',
      }).catch(() => {});
    };

    const channel = supabase
      .channel(`company-settings-${companyId}`)
      .on('broadcast', { event: COMPANY_SETTINGS_UPDATED_EVENT }, (payload) => {
        const payloadCompanyId = String(payload?.payload?.companyId || '').trim();
        if (payloadCompanyId && payloadCompanyId !== String(companyId)) return;
        refreshSettings(payload);
      })
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'companies',
          filter: `id=eq.${companyId}`,
        },
        refreshSettings,
      )
      .subscribe();

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      refreshSettings();
    });

    return () => {
      appStateSub?.remove?.();
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [companyId, queryClient, queryEnabled, subscribe]);

  // Функция для принудительного обновления настроек
  const invalidateSettings = async () => {
    await queryClient.invalidateQueries({ queryKey: COMPANY_SETTINGS_QUERY_KEY, refetchType: 'active' });
    await refetch();
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
