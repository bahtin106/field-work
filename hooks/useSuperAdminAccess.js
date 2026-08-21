import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { readSuperAdminSnapshot, writeSuperAdminSnapshot } from '../lib/accessSnapshot';
import { supabase } from '../lib/supabase';
import { useAuthContext } from '../providers/SimpleAuthProvider';
import { withReadDeadline } from '../src/shared/network/readDeadline';
import { useOfflineSnapshot } from '../src/shared/offline/offlineStatus';
import { purgePrivilegedAdminQueryCache } from '../src/shared/query/queryClient';

async function fetchSuperAdminAccess(signal = undefined) {
  let request = supabase.rpc('is_super_admin');
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return data === true;
}

export function useSuperAdminAccess() {
  const { user, profile, isAuthenticated } = useAuthContext();
  const offlineSnapshot = useOfflineSnapshot();
  const networkRefreshable =
    offlineSnapshot.isNetworkKnown &&
    offlineSnapshot.isOnline &&
    !offlineSnapshot.isPoorConnection;
  const userId = useMemo(
    () => String(user?.id || profile?.id || '').trim().toLowerCase(),
    [profile?.id, user?.id],
  );
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const serverRevisionRef = useRef(0);
  const liveResultRef = useRef(null);
  const liveResultSequenceRef = useRef(0);
  const lastPurgedLiveResultRef = useRef(0);
  const networkRefreshableRef = useRef(networkRefreshable);
  const [localSnapshot, setLocalSnapshot] = useState({
    userId: null,
    value: null,
    hydrated: false,
  });

  useEffect(() => {
    let active = true;
    if (!isAuthenticated || !userId) {
      setLocalSnapshot({ userId: null, value: null, hydrated: true });
      return () => {
        active = false;
      };
    }

    setLocalSnapshot((previous) =>
      previous.userId === userId
        ? previous
        : { userId, value: null, hydrated: false },
    );
    const serverRevisionAtStart = serverRevisionRef.current;
    const applyLocalSnapshot = (snapshot) => {
      if (!active || userIdRef.current !== userId) return false;
      if (serverRevisionRef.current !== serverRevisionAtStart) return false;
      setLocalSnapshot({
        userId,
        value: typeof snapshot?.value === 'boolean' ? snapshot.value : null,
        hydrated: true,
      });
      return true;
    };
    readSuperAdminSnapshot(userId, { onLateValue: applyLocalSnapshot }).then((snapshot) => {
      applyLocalSnapshot(snapshot);
    });

    return () => {
      active = false;
    };
  }, [isAuthenticated, userId]);

  const query = useQuery({
    queryKey: ['superAdminAccess', userId],
    queryFn: async ({ signal }) => {
      const value = await withReadDeadline(
        (readSignal) => fetchSuperAdminAccess(readSignal),
        { label: 'Super admin access', signal },
      );
      liveResultSequenceRef.current += 1;
      liveResultRef.current = {
        userId,
        value,
        revision: liveResultSequenceRef.current,
      };
      return value;
    },
    enabled: Boolean(isAuthenticated && userId && networkRefreshable),
    placeholderData: () => undefined,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const refetchSuperAdminAccess = query.refetch;

  useEffect(() => {
    const liveResult = liveResultRef.current;
    if (
      !userId ||
      typeof query.data !== 'boolean' ||
      liveResult?.userId !== userId ||
      liveResult.value !== query.data
    ) {
      return;
    }
    serverRevisionRef.current += 1;
    setLocalSnapshot({ userId, value: query.data, hydrated: true });
    writeSuperAdminSnapshot(userId, query.data).catch(() => {});
    if (
      query.data === false &&
      lastPurgedLiveResultRef.current !== liveResult.revision
    ) {
      lastPurgedLiveResultRef.current = liveResult.revision;
      purgePrivilegedAdminQueryCache().catch(() => {});
    }
  }, [query.data, query.dataUpdatedAt, userId]);

  useEffect(() => {
    const becameRefreshable = !networkRefreshableRef.current && networkRefreshable;
    networkRefreshableRef.current = networkRefreshable;
    if (becameRefreshable && isAuthenticated && userId) {
      refetchSuperAdminAccess({ cancelRefetch: false }).catch(() => {});
    }
  }, [isAuthenticated, networkRefreshable, refetchSuperAdminAccess, userId]);

  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const becameActive = /inactive|background/.test(previousState) && nextState === 'active';
      previousState = nextState;
      if (becameActive && isAuthenticated && userId && networkRefreshable) {
        refetchSuperAdminAccess({ cancelRefetch: false }).catch(() => {});
      }
    });
    return () => subscription.remove();
  }, [isAuthenticated, networkRefreshable, refetchSuperAdminAccess, userId]);

  const hasHydratedSnapshot = localSnapshot.userId === userId && localSnapshot.hydrated;
  const cachedValue = hasHydratedSnapshot ? localSnapshot.value : null;
  const resolvedValue = typeof query.data === 'boolean' ? query.data : cachedValue;

  return {
    isSuperAdmin: resolvedValue === true,
    isLoading: Boolean(
      isAuthenticated &&
        userId &&
        resolvedValue === null &&
        (!hasHydratedSnapshot || (networkRefreshable && query.isPending)),
    ),
    error: query.error,
    refetch: query.refetch,
  };
}
