// components/hooks/useUserPermissions.js
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../../lib/supabase';
import { getUserRole } from '../../lib/getUserRole';
import { useQuery, useQueryClient, useIsFetching } from '@tanstack/react-query';
import { useAuthContext } from '../../providers/SimpleAuthProvider';

const VALID_ROLES = new Set(['admin', 'dispatcher', 'worker']);

const normalizeRole = (role) => {
  if (typeof role !== 'string') return null;
  const safe = role.trim().toLowerCase();
  return VALID_ROLES.has(safe) ? safe : null;
};

async function fetchMyProfile() {
  const { data: ures } = await supabase.auth.getUser();
  const uid = ures?.user?.id;
  if (!uid) return null;
  try {
    const { data: prof, error } = await supabase
      .from('profiles')
      .select('role, company_id')
      .or(`id.eq.${uid},user_id.eq.${uid}`)
      .maybeSingle();
    if (error && (error.code === '42703' || /user_id/i.test(error.message || ''))) {
      const { data: profFallback } = await supabase
        .from('profiles')
        .select('role, company_id')
        .eq('id', uid)
        .maybeSingle();
      return profFallback || null;
    }
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
  const { profile, isAuthenticated } = useAuthContext();
  const fallbackRole = useMemo(() => normalizeRole(profile?.role) || 'worker', [profile?.role]);

  const lastRoleRef = useRef(normalizeRole(qc.getQueryData(['userRole'])) || fallbackRole);
  const { data: roleRaw, isLoading: roleLoading, error: roleError } = useQuery({
    queryKey: ['userRole'],
    queryFn: getUserRole,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    placeholderData: (p) => p,
    enabled: isAuthenticated,
  });
  const resolvedRoleFromQuery = normalizeRole(roleRaw);

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    if (resolvedRoleFromQuery) {
      lastRoleRef.current = resolvedRoleFromQuery;
      return;
    }

    // If the role request errored or is stuck, force a safe fallback so UI can render.
    if (roleError && lastRoleRef.current) {
      qc.setQueryData(['userRole'], lastRoleRef.current);
      return;
    }

    const timer = setTimeout(() => {
      const cached = normalizeRole(qc.getQueryData(['userRole']));
      if (cached) {
        lastRoleRef.current = cached;
        return;
      }
      lastRoleRef.current = fallbackRole;
      qc.setQueryData(['userRole'], fallbackRole);
    }, 4000);

    return () => clearTimeout(timer);
  }, [fallbackRole, isAuthenticated, qc, resolvedRoleFromQuery, roleError]);

  const role = resolvedRoleFromQuery || lastRoleRef.current || fallbackRole || null;
  const roleLoadingSafe = roleLoading && !role;

  const lastCanAllRef = useRef(qc.getQueryData(['perm-canViewAll']));
  const { data: canAllRaw, isLoading: canAllLoading, error: canAllError } = useQuery({
    queryKey: ['perm-canViewAll'],
    queryFn: __fetchCanViewAll,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    placeholderData: (p) => p,
    enabled: !!role,
  });
  const canAllNormalized = typeof canAllRaw === 'boolean' ? canAllRaw : null;

  useEffect(() => {
    if (!role) return undefined;

    if (canAllNormalized !== null) {
      lastCanAllRef.current = canAllNormalized;
      return;
    }

    // Avoid blocking the bottom bar forever if permissions are slow or errored.
    const timer = setTimeout(() => {
      const cached = qc.getQueryData(['perm-canViewAll']);
      if (typeof cached === 'boolean') {
        lastCanAllRef.current = cached;
        return;
      }
      lastCanAllRef.current = false;
      qc.setQueryData(['perm-canViewAll'], false);
    }, 3000);

    return () => clearTimeout(timer);
  }, [canAllNormalized, qc, role]);

  useEffect(() => {
    if (!role || !canAllError) return;

    const cached = qc.getQueryData(['perm-canViewAll']);
    if (typeof cached === 'boolean') {
      lastCanAllRef.current = cached;
      return;
    }
    lastCanAllRef.current = false;
    qc.setQueryData(['perm-canViewAll'], false);
  }, [canAllError, qc, role]);

  const canAll = canAllNormalized ?? (typeof lastCanAllRef.current === 'boolean' ? lastCanAllRef.current : false);
  const canAllLoadingSafe = canAllLoading && canAllNormalized === null && lastCanAllRef.current == null;

  const isFetching = useIsFetching();

  const doRefresh = useCallback(async () => {
    try {
      await qc.invalidateQueries({ queryKey: ['perm-canViewAll'] });
    } catch {}
  }, [qc]);

  const pollTimer = useRef(null);
  const kickoffSafetyPoll = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    let ticks = 0;
    pollTimer.current = setInterval(async () => {
      ticks += 1;
      await doRefresh();
      if (ticks >= 5) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    }, 1200);
  }, [doRefresh]);

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
            },
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
  }, [doRefresh, kickoffSafetyPoll]);

  return {
    role,
    canAll,
    roleLoading: roleLoadingSafe,
    canAllLoading: canAllLoadingSafe,
    isFetching,
  };
}
