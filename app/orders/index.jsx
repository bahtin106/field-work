/* global console, __DEV__ */

// app/orders/index.jsx
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { useAuth } from '../../components/hooks/useAuth';
import UniversalHome from '../../components/UniversalHome';
import appReadyState from '../../lib/appReadyState';
import {
  COMPANY_SETTINGS_QUERY_KEY,
  fetchCompanySettingsByCompanyId,
} from '../../lib/companySettingsQuery';
import { getUserRole, subscribeAuthRole } from '../../lib/getUserRole';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeProvider';

const VERBOSE_ORDERS_BOOT_LOGS =
  __DEV__ && globalThis?.__VERBOSE_ORDERS_BOOT_LOGS__ === true;
const BOOT_FALLBACK_TIMEOUT_MS = 6000;

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

async function fetchMyProfile() {
  const { data: ures } = await supabase.auth.getUser();
  const uid = ures?.user?.id;
  if (!uid) return null;
  const { data: prof } = await supabase
    .from('profiles')
    .select('role, company_id')
    .eq('id', uid)
    .maybeSingle();
  return prof || null;
}

async function fetchCanViewAll() {
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
    const parsed = toBool(perm?.value);
    return parsed === null ? true : parsed;
  } catch {
    return false;
  }
}

export default function IndexScreen() {
  const { theme } = useTheme();
  const qc = useQueryClient();
  const router = useRouter();
  const { user: authUser, profile: authProfile } = useAuth();
  const [homeReady, setHomeReady] = React.useState(false);

  const { data: _canViewAll, isLoading: isPermLoading } = useQuery({
    queryKey: ['perm-canViewAll'],
    queryFn: fetchCanViewAll,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    placeholderData: (prev) => prev,
    enabled: !!authUser,
  });

  React.useEffect(() => {
    if (!isPermLoading) return;

    const timeout = setTimeout(() => {
      qc.setQueryData(['perm-canViewAll'], true);
    }, 3000);

    return () => clearTimeout(timeout);
  }, [isPermLoading, qc]);

  const criticalFetching = useIsFetching({
    predicate: (q) => {
      const key0 = Array.isArray(q.queryKey) ? q.queryKey[0] : null;
      return key0 === 'userRole' || key0 === 'perm-canViewAll';
    },
  });

  const profileRole = authProfile?.role ?? null;
  const profileSource = authProfile?.__source ?? null;
  const profileRoleIsFallback =
    profileSource === 'fallback' || profileSource === 'optimistic';
  const hasTrustedProfileRole = !!profileRole && !profileRoleIsFallback;

  const { data: roleFromQuery, isLoading: roleQueryLoading } = useQuery({
    queryKey: ['userRole'],
    queryFn: getUserRole,
    enabled: !hasTrustedProfileRole,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: 'stale',
    placeholderData: (prev) => prev,
  });
  const role = hasTrustedProfileRole ? profileRole : roleFromQuery || profileRole || 'worker';
  const companyId = authProfile?.company_id || null;
  const isRoleLoading = hasTrustedProfileRole ? false : roleQueryLoading;

  React.useEffect(() => {
    if (!isRoleLoading) return;

    const timeout = setTimeout(() => {
      qc.setQueryData(['userRole'], 'worker');
    }, 4000);

    return () => clearTimeout(timeout);
  }, [isRoleLoading, qc]);

  React.useEffect(() => {
    const unsub = subscribeAuthRole((r) => {
      qc.setQueryData(['userRole'], r);
    });
    return () => unsub && unsub();
  }, [qc]);

  React.useEffect(() => {
    const effectiveRole = String(authProfile?.role || role || '').toLowerCase();
    if (effectiveRole !== 'admin') return;
    try {
      router?.prefetch?.('/company_settings');
      router?.prefetch?.('/app_settings');
    } catch {}
  }, [router, authProfile?.role, role]);

  React.useEffect(() => {
    if (!companyId) return;
    const effectiveRole = String(authProfile?.role || role || '').toLowerCase();
    if (effectiveRole !== 'admin') return;

    const timer = setTimeout(() => {
      qc
        .prefetchQuery({
          queryKey: [...COMPANY_SETTINGS_QUERY_KEY, companyId],
          queryFn: () => fetchCompanySettingsByCompanyId(companyId),
          staleTime: 5 * 60 * 1000,
        })
        .catch(() => {});
    }, 120);

    return () => {
      clearTimeout(timer);
    };
  }, [qc, companyId, authProfile?.role, role]);

  const [bootState, setBootState] = React.useState(() => appReadyState.getBootState());

  React.useEffect(() => {
    const unsubscribe = appReadyState.subscribe((newState) => {
      setBootState(newState);
    });
    return unsubscribe;
  }, []);

  React.useEffect(() => {
    setHomeReady(false);
  }, [authUser?.id]);

  React.useEffect(() => {
    if (!authUser?.id) {
      if (appReadyState.getBootState() !== 'boot') {
        appReadyState.reset();
      }
      return;
    }

    if (appReadyState.getBootState() === 'ready') {
      return;
    }

    if (appReadyState.getBootState() !== 'fetching') {
      appReadyState.setBootState('fetching');
    }

    const timer = setTimeout(() => {
      if (appReadyState.getBootState() !== 'ready') {
        appReadyState.setBootState('ready');
      }
    }, BOOT_FALLBACK_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [authUser?.id]);

  React.useEffect(() => {
    if (!VERBOSE_ORDERS_BOOT_LOGS) return;
    if (bootState !== 'ready') {
      console.debug('[Orders] Spinner visible:', {
        bootState,
        hasTrustedRole: hasTrustedProfileRole,
        profileRole,
        profileSource,
        isRoleLoading,
        isPermLoading,
        criticalFetching,
        elapsed: Date.now() - appReadyState.getMountTs(),
      });
    } else if (bootState === 'ready') {
      console.debug('[Orders] Spinner hidden, showing content');
    }
  }, [
    bootState,
    hasTrustedProfileRole,
    profileRole,
    profileSource,
    isRoleLoading,
    isPermLoading,
    criticalFetching,
  ]);

  const bootDataReady = criticalFetching === 0 && !isRoleLoading && !isPermLoading;
  const bootUiReady = bootDataReady && homeReady;

  React.useEffect(() => {
    if (!authUser?.id) return;
    if (!bootUiReady) return;
    if (appReadyState.getBootState() === 'ready') return;
    requestAnimationFrame(() => {
      if (appReadyState.getBootState() !== 'ready') {
        appReadyState.setBootState('ready');
      }
    });
  }, [authUser?.id, bootUiReady]);

  const handleRootLayout = React.useCallback(() => {
    if (!authUser?.id) return;
    if (!bootUiReady) return;
    if (appReadyState.getBootState() === 'ready') return;
    appReadyState.setBootState('ready');
  }, [authUser?.id, bootUiReady]);

  return (
    <View
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      onLayout={handleRootLayout}
    >
      <UniversalHome
        role={role || 'worker'}
        user={authUser}
        profile={authProfile}
        onInitialReady={() => setHomeReady(true)}
      />
    </View>
  );
}
