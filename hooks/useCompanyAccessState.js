import { useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useOfflineSnapshot } from '../src/shared/offline/offlineStatus';
import { withReadDeadline } from '../src/shared/network/readDeadline';

async function fetchCompanyAccessState(companyId, signal = undefined) {
  if (!companyId) return null;
  let request = supabase.rpc('get_company_access_state', {
    p_company_id: companyId,
  });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) return null;

  const head = rows[0];
  const members = rows
    .filter((row) => !!row.member_id)
    .map((row) => ({
      user_id: row.member_id,
      name: row.member_name,
      role: row.member_role,
      admin_blocked: !!row.admin_blocked,
      license_state: row.license_state || 'active',
      has_seat: !!row.has_seat,
    }));

  return {
    company_id: head.company_id,
    paid_seats_total: Number(head.paid_seats_total || 0),
    used_seats: Number(head.used_seats || 0),
    free_seats: Number(head.free_seats || 0),
    subscription_status: head.subscription_status || 'expired',
    period_end: head.period_end || null,
    needs_seat_release: !!head.needs_seat_release,
    required_release_count: Number(head.required_release_count || 0),
    members,
  };
}

export function useCompanyAccessState(
  companyId,
  { adminScope = false, enabled = true } = {},
) {
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const offlineSnapshot = useOfflineSnapshot();
  const networkRefreshable =
    offlineSnapshot.isNetworkKnown &&
    offlineSnapshot.isOnline &&
    !offlineSnapshot.isPoorConnection;
  const queryKey = React.useMemo(
    () => [adminScope ? 'adminCompanyAccessState' : 'companyAccessState', companyId],
    [adminScope, companyId],
  );
  const canRefresh = enabled && !!companyId && networkRefreshable;
  const query = useQuery({
    queryKey,
    enabled: canRefresh,
    queryFn: ({ signal }) =>
      withReadDeadline(
        (readSignal) => fetchCompanyAccessState(companyId, readSignal),
        { label: 'Company access state', signal },
      ),
    staleTime: 30 * 1000,
    refetchInterval: canRefresh && isFocused ? 30 * 1000 : false,
    refetchIntervalInBackground: false,
    refetchOnMount: 'stale',
    refetchOnReconnect: false,
  });
  const { refetch, dataUpdatedAt } = query;

  useFocusEffect(
    React.useCallback(() => {
      if (!canRefresh) return undefined;
      if (!dataUpdatedAt || Date.now() - dataUpdatedAt >= 30 * 1000) refetch();
      return undefined;
    }, [canRefresh, dataUpdatedAt, refetch]),
  );

  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && canRefresh) {
        queryClient.invalidateQueries({ queryKey });
      }
    });
    return () => sub.remove();
  }, [canRefresh, queryClient, queryKey]);

  return {
    ...query,
    refresh: refetch,
  };
}
