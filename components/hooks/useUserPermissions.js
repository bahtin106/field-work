// components/hooks/useUserPermissions.js
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, InteractionManager } from 'react-native';
import { supabase } from '../../lib/supabase';
import { getUserRole } from '../../lib/getUserRole';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '../../providers/SimpleAuthProvider';

const VALID_ROLES = new Set(['admin', 'dispatcher', 'worker']);
const PERMISSION_NETWORK_BOOTSTRAP_DELAY_MS = 2200;

const normalizeRole = (role) => {
  if (typeof role !== 'string') return null;
  const safe = role.trim().toLowerCase();
  return VALID_ROLES.has(safe) ? safe : null;
};

function getProfileSeed(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const role = normalizeRole(profile.role);
  const companyId = String(profile.company_id || '').trim();
  if (!role || !companyId) return null;
  return { role, company_id: companyId };
}

async function fetchMyProfile(profileSeed = null) {
  const seeded = getProfileSeed(profileSeed);
  if (seeded) return seeded;

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

async function __fetchCanViewAll(profileSeed = null) {
  try {
    const prof = await fetchMyProfile(profileSeed);
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
  const profileRole = profile?.role;
  const profileCompanyId = profile?.company_id;
  const fallbackRole = useMemo(() => normalizeRole(profileRole) || 'worker', [profileRole]);
  const profilePermissionSeed = useMemo(
    () => getProfileSeed({ role: profileRole, company_id: profileCompanyId }),
    [profileCompanyId, profileRole],
  );
  const [permissionNetworkEnabled, setPermissionNetworkEnabled] = useState(false);

  const lastRoleRef = useRef(normalizeRole(qc.getQueryData(['userRole'])) || fallbackRole);
  const { data: roleRaw, isLoading: roleLoading, error: roleError } = useQuery({
    queryKey: ['userRole'],
    queryFn: () => getUserRole(),
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    placeholderData: (p) => p,
    enabled: isAuthenticated && !normalizeRole(profileRole),
  });
  const resolvedRoleFromQuery = normalizeRole(profileRole) || normalizeRole(roleRaw);

  useEffect(() => {
    const roleFromProfile = normalizeRole(profileRole);
    if (!roleFromProfile) return;
    lastRoleRef.current = roleFromProfile;
    qc.setQueryData(['userRole'], roleFromProfile);
  }, [profileRole, qc]);

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

  useEffect(() => {
    setPermissionNetworkEnabled(false);
    if (!isAuthenticated || !role) {
      return undefined;
    }

    let task = null;
    const timer = setTimeout(() => {
      task = InteractionManager.runAfterInteractions(() => {
        setPermissionNetworkEnabled(true);
      });
    }, PERMISSION_NETWORK_BOOTSTRAP_DELAY_MS);

    return () => {
      clearTimeout(timer);
      try {
        task?.cancel?.();
      } catch {}
    };
  }, [isAuthenticated, role]);

  const cachedCanAll = qc.getQueryData(['perm-canViewAll']);
  const initialCanAll =
    typeof cachedCanAll === 'boolean'
      ? cachedCanAll
      : fallbackRole === 'admin' || fallbackRole === 'dispatcher'
        ? true
        : false;
  const lastCanAllRef = useRef(initialCanAll);
  const { data: canAllRaw, isLoading: canAllLoading, error: canAllError } = useQuery({
    queryKey: ['perm-canViewAll'],
    queryFn: () => __fetchCanViewAll(profilePermissionSeed),
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    placeholderData: (p) => p,
    enabled: permissionNetworkEnabled && !!role,
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
      const fallbackCanAll = role === 'admin' || role === 'dispatcher';
      lastCanAllRef.current = fallbackCanAll;
      qc.setQueryData(['perm-canViewAll'], fallbackCanAll);
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

  const doRefresh = useCallback(async () => {
    try {
      await qc.invalidateQueries({ queryKey: ['perm-canViewAll'] });
    } catch {}
  }, [qc]);

  const pollTimer = useRef(null);
  const lastRealtimeRefreshAtRef = useRef(0);
  const REALTIME_REFRESH_MIN_INTERVAL_MS = 5000;
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
    }, 4000);
  }, [doRefresh]);

  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    if (!permissionNetworkEnabled || !isAuthenticated || !role) return undefined;
    let alive = true;
    let ch, chDb;
    (async () => {
      if (!alive) return;

      ch = supabase.channel('permissions', { config: { broadcast: { self: true } } });
      ch.on('broadcast', { event: 'perm_changed' }, () => {
        const now = Date.now();
        if (now - lastRealtimeRefreshAtRef.current < REALTIME_REFRESH_MIN_INTERVAL_MS) return;
        lastRealtimeRefreshAtRef.current = now;
        doRefresh();
        kickoffSafetyPoll();
      });
      ch.subscribe();

      const prof = await fetchMyProfile(profilePermissionSeed);
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
              const now = Date.now();
              if (now - lastRealtimeRefreshAtRef.current < REALTIME_REFRESH_MIN_INTERVAL_MS) return;
              lastRealtimeRefreshAtRef.current = now;
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
  }, [doRefresh, isAuthenticated, kickoffSafetyPoll, permissionNetworkEnabled, profilePermissionSeed, role]);

  return {
    role,
    canAll,
    roleLoading: roleLoadingSafe,
    canAllLoading: canAllLoadingSafe,
  };
}
