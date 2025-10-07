// components/hooks/useUserPermissions.js
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../../lib/supabase';
import { getUserRole } from '../../lib/getUserRole';
import { useQuery, useQueryClient, useIsFetching } from '@tanstack/react-query';

async function fetchMyProfile() {
  const { data: ures } = await supabase.auth.getUser();
  const uid = ures?.user?.id;
  if (!uid) return null;
  try {
    const { data: prof } = await supabase
      .from('profiles')
      .select('role, company_id')
      .eq('id', uid)
      .maybeSingle();
    return prof || null;
  } catch {
    return null;
  }
}

function toBool(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s === 'true' || s === '1' || s === 't' || s === 'yes' || s === 'y';
  }
  return false;
}

async function __fetchCanViewAll() {
  try {
    const prof = await fetchMyProfile();
    if (!prof?.role || !prof?.company_id) return false;
    const { data: perm } = await supabase
      .from('app_role_permissions')
      .select('value')
      .eq('company_id', prof.company_id)
      .eq('role', prof.role)
      .eq('key', 'canViewAllOrders')
      .maybeSingle();
    const val = perm?.value;
    const parsed = toBool(val);
    return parsed === null ? true : parsed;
  } catch {
    return false;
  }
}

export function useUserPermissions() {
  const qc = useQueryClient();
  const { data: role, isLoading: roleLoading } = useQuery({
    queryKey: ['userRole'],
    queryFn: getUserRole,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    placeholderData: (p) => p,
  });
  const { data: canAll, isLoading: canAllLoading } = useQuery({
    queryKey: ['perm-canViewAll'],
    queryFn: __fetchCanViewAll,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    placeholderData: (p) => p,
    enabled: !!role,
  });

  const isFetching = useIsFetching();

  const doRefresh = async () => {
    try { await qc.invalidateQueries({ queryKey: ['perm-canViewAll'] }); } catch {}
  };

  const pollTimer = useRef(null);
  const kickoffSafetyPoll = () => {
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
    let ticks = 0;
    pollTimer.current = setInterval(async () => {
      ticks += 1;
      await doRefresh();
      if (ticks >= 5) { clearInterval(pollTimer.current); pollTimer.current = null; }
    }, 1200);
  };

  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    let alive = true;
    let ch, chDb;
    (async () => {
      if (!alive) return;
      await doRefresh();

      ch = supabase.channel('permissions', { config: { broadcast: { self: true } } });
      ch.on('broadcast', { event: 'perm_changed' }, () => {
        doRefresh();
        kickoffSafetyPoll();
      });
      ch.subscribe();

      const prof = await fetchMyProfile();
      chDb = supabase.channel('perm-db');
      if (prof?.company_id && prof?.role) {
        const filter = [
          `company_id=eq.${prof.company_id}`,
          `role=eq.${prof.role}`,
          `key=eq.canViewAllOrders`,
        ].join(',');
        ['INSERT', 'UPDATE', 'DELETE'].forEach((evt) => {
          chDb.on(
            'postgres_changes',
            { event: evt, schema: 'public', table: 'app_role_permissions', filter },
            () => {
              doRefresh();
              kickoffSafetyPoll();
            }
          );
        });
      }
      chDb.subscribe();
    })();

    const onAppStateChange = (nextState) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        doRefresh();
      }
      appStateRef.current = nextState;
    };
    const sub = AppState.addEventListener('change', onAppStateChange);

    return () => {
      alive = false;
      sub.remove();
      try {
        if (ch) supabase.removeChannel(ch);
        if (chDb) supabase.removeChannel(chDb);
      } catch {}
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, []);

  return { role, canAll, roleLoading, canAllLoading, isFetching };
}
