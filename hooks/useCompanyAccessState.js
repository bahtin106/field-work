import { useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';

async function fetchCompanyAccessState(companyId) {
  if (!companyId) return null;
  const { data, error } = await supabase.rpc('get_company_access_state', {
    p_company_id: companyId,
  });
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

export function useCompanyAccessState(companyId) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['companyAccessState', companyId],
    enabled: !!companyId,
    queryFn: () => fetchCompanyAccessState(companyId),
    staleTime: 0,
    refetchInterval: companyId ? 5 * 1000 : false,
    refetchIntervalInBackground: false,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
  });

  useFocusEffect(
    React.useCallback(() => {
      if (!companyId) return undefined;
      query.refetch();
      return undefined;
    }, [companyId, query]),
  );

  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && companyId) {
        queryClient.invalidateQueries({ queryKey: ['companyAccessState', companyId] });
      }
    });
    return () => sub.remove();
  }, [companyId, queryClient]);

  return {
    ...query,
    refresh: query.refetch,
  };
}
