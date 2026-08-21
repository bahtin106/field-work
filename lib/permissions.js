/* global console */

// lib/permissions.js
// Глобальный провайдер прав + хук usePermissions.
// Источник прав: таблица app_role_permissions (company_id, role, key, value).
// JS-версия (без TS).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, InteractionManager } from 'react-native';
import { useAuthContext } from '../providers/SimpleAuthProvider';
import { withReadDeadline } from '../src/shared/network/readDeadline';
import { getOfflineSnapshot, useOfflineSnapshot } from '../src/shared/offline/offlineStatus';
import {
  readPermissionsSnapshot,
  writePermissionsSnapshot,
} from './accessSnapshot';
import { supabase } from './supabase';

const deepClone = (obj) => JSON.parse(JSON.stringify(obj));
const deepEqual = (a, b) => {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

export const ROLES = ['admin', 'dispatcher', 'worker'];
export const CONFIGURABLE_PERMISSION_KEYS = [
  'canCreateOrders',
  'canEditOrders',
  'canCompleteOwnOrders',
  'canCompleteOtherOrders',
  'canAssignExecutors',
  'canViewAllOrders',
  'canDeleteOrders',
  'canViewOrderPhotos',
  'canAddGalleryPhotos',
  'canAddCameraPhotos',
  'canViewOrderHistory',
  'canViewOrderAmount',
  'canEditOrderAmount',
  'canViewFinanceOwn',
  'canViewFinanceAll',
  'canEditFinanceEntries',
  'canManageFinanceRules',
  'canViewFinanceStatsAll',
  'canViewClients',
  'canViewClientPhones',
  'canCreateClients',
  'canEditClients',
  'canDeleteClients',
  'canViewObjects',
  'canViewObjectPhones',
  'canCreateObjects',
  'canEditObjects',
  'canDeleteObjects',
  'canViewTrash',
  'canRestoreTrash',
  'canPurgeTrash',
];
const PERMISSIONS_BROADCAST_CHANNEL = 'permissions';
const PERMISSIONS_BROADCAST_EVENT = 'perm_changed';
const SAFETY_POLL_INTERVAL_MS = 4000;
const SAFETY_POLL_TICKS = 2;
const REALTIME_REFRESH_MIN_INTERVAL_MS = 5000;
const PERMISSIONS_BOOTSTRAP_REFRESH_DELAY_MS = 3000;
const METADATA_PROFILE_SOURCE_RE = /metadata|user-metadata/i;

export const START_PRESET = {
  admin: {
    canCreateOrders: true,
    canEditOrders: true,
    canCompleteOwnOrders: true,
    canCompleteOtherOrders: true,
    canAssignExecutors: true,
    canViewAllOrders: true,
    canDeleteOrders: true,
    canAddGalleryPhotos: true,
    canAddCameraPhotos: true,
    canViewOrderPhotos: true,
    canViewOrderHistory: true,
    canViewOrderAmount: true,
    canEditOrderAmount: true,
    canViewFinanceOwn: true,
    canViewFinanceAll: true,
    canEditFinanceEntries: true,
    canManageFinanceRules: true,
    canViewFinanceStatsAll: true,
    canViewClients: true,
    canViewClientPhones: true,
    canCreateClients: true,
    canEditClients: true,
    canDeleteClients: true,
    canViewObjects: true,
    canViewObjectPhones: true,
    canCreateObjects: true,
    canEditObjects: true,
    canDeleteObjects: true,
    canViewTrash: true,
    canRestoreTrash: true,
    canPurgeTrash: true,
    canAccessFormBuilder: true,
    phoneAlwaysVisible: true,
    phoneVisibleMinus1Day: true,
  },
  dispatcher: {
    canCreateOrders: true,
    canEditOrders: true,
    canCompleteOwnOrders: true,
    canCompleteOtherOrders: true,
    canAssignExecutors: true,
    canViewAllOrders: true,
    canDeleteOrders: true,
    canAddGalleryPhotos: true,
    canAddCameraPhotos: true,
    canViewOrderPhotos: true,
    canViewOrderHistory: true,
    canViewOrderAmount: true,
    canEditOrderAmount: true,
    canViewFinanceOwn: true,
    canViewFinanceAll: true,
    canEditFinanceEntries: true,
    canManageFinanceRules: false,
    canViewFinanceStatsAll: true,
    canViewClients: true,
    canViewClientPhones: true,
    canCreateClients: true,
    canEditClients: true,
    canDeleteClients: true,
    canViewObjects: true,
    canViewObjectPhones: true,
    canCreateObjects: true,
    canEditObjects: true,
    canDeleteObjects: true,
    canViewTrash: true,
    canRestoreTrash: true,
    canPurgeTrash: false,
    canAccessFormBuilder: true,
    phoneAlwaysVisible: true,
    phoneVisibleMinus1Day: true,
  },
  worker: {
    canCreateOrders: false,
    canEditOrders: false,
    canCompleteOwnOrders: false,
    canCompleteOtherOrders: false,
    canAssignExecutors: false,
    canViewAllOrders: false,
    canDeleteOrders: false,
    canAddGalleryPhotos: false,
    canAddCameraPhotos: true,
    canViewOrderPhotos: true,
    canViewOrderHistory: false,
    canViewOrderAmount: true,
    canEditOrderAmount: false,
    canViewFinanceOwn: true,
    canViewFinanceAll: false,
    canEditFinanceEntries: false,
    canManageFinanceRules: false,
    canViewFinanceStatsAll: false,
    canViewClients: true,
    canViewClientPhones: true,
    canCreateClients: true,
    canEditClients: false,
    canDeleteClients: false,
    canViewObjects: true,
    canViewObjectPhones: true,
    canCreateObjects: true,
    canEditObjects: false,
    canDeleteObjects: false,
    canViewTrash: false,
    canRestoreTrash: false,
    canPurgeTrash: false,
    canAccessFormBuilder: false,
    phoneAlwaysVisible: false,
    phoneVisibleMinus1Day: true,
  },
};

function mergeWithDefaults(data) {
  const merged = deepClone(START_PRESET);
  for (const r of ROLES) merged[r] = { ...merged[r], ...(data?.[r] || {}) };
  // The sole company administrator is the recovery boundary for every role.
  // Stored legacy overrides must never lock that account out of company data.
  merged.admin = { ...START_PRESET.admin };
  return merged;
}

function toBool(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['1', 'true', 't', 'yes', 'y'].includes(s)) return true;
    if (['0', 'false', 'f', 'no', 'n'].includes(s)) return false;
    return null;
  }
  return null;
}

async function getCurrentProfile(expectedUserId = null) {
  // Возвращаем null если сессии нет или профиль не найден, вместо выбрасывания ошибок — это нормальная ситуация на экране логина
  let userId = String(expectedUserId || '').trim();
  if (!userId) {
    const { data: userRes, error: userErr } = await withReadDeadline(
      supabase.auth.getUser(),
      { label: 'Permissions auth user' },
    );
    if (userErr) {
      // Реальные сетевые/SDK ошибки покажем, но отсутствие сессии (user=null) не считаем ошибкой
      return null;
    }
    userId = String(userRes?.user?.id || '').trim();
  }
  if (!userId) return null;

  const { data: prof, error: profErr } = await withReadDeadline(
    supabase
      .from('profiles')
      .select('id, user_id, role, full_name, company_id')
      .or(`id.eq.${userId},user_id.eq.${userId}`)
      .maybeSingle(),
    { label: 'Permissions profile' },
  );
  if (profErr && (profErr.code === '42703' || /user_id/i.test(profErr.message || ''))) {
    const { data: profFallback, error: profErrFallback } = await withReadDeadline(
      supabase
        .from('profiles')
        .select('id, role, full_name, company_id')
        .eq('id', userId)
        .maybeSingle(),
      { label: 'Permissions profile fallback' },
    );
    if (profErrFallback) {
      if (profErrFallback.code === 'PGRST301' || /permission denied/i.test(profErrFallback.message)) return null;
      return null;
    }
    return profFallback || null;
  }
  if (profErr) {
    // permission denied до авторизации — вернём null чтобы не шуметь
    if (profErr.code === 'PGRST301' || /permission denied/i.test(profErr.message)) return null;
    return null;
  }
  return prof || null;
}

function normalizeScopeId(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase();
  return ROLES.includes(role) ? role : null;
}

function getProfileScope(profile, expectedUserId) {
  if (!profile || typeof profile !== 'object') return null;
  const normalizedExpectedUserId = normalizeScopeId(expectedUserId);
  const profileId = normalizeScopeId(profile.id);
  const legacyUserId = normalizeScopeId(profile.user_id);
  const userId =
    normalizedExpectedUserId &&
    (profileId === normalizedExpectedUserId || legacyUserId === normalizedExpectedUserId)
      ? normalizedExpectedUserId
      : legacyUserId || profileId || normalizedExpectedUserId;
  if (!userId || (normalizedExpectedUserId && userId !== normalizedExpectedUserId)) return null;
  return {
    userId,
    companyId: normalizeScopeId(profile.company_id),
    role: normalizeRole(profile.role),
    fullName: String(profile.full_name || '').trim(),
    authoritative: !METADATA_PROFILE_SOURCE_RE.test(String(profile.__source || '')),
  };
}

function scopesMatch(left, right) {
  return Boolean(
    left?.userId &&
      right?.userId &&
      left.userId === right.userId &&
      left.companyId &&
      left.companyId === right.companyId &&
      left.role &&
      left.role === right.role,
  );
}

async function loadPermissionsFromCloud(companyId, roleFilter = null) {
  let q = supabase
    .from('app_role_permissions')
    .select('role, key, value')
    .eq('company_id', companyId);

  if (roleFilter) q = q.eq('role', roleFilter);

  const { data: rows, error } = await withReadDeadline(q, {
    label: 'Role permissions',
  });
  if (error) throw error;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const acc = { admin: {}, dispatcher: {}, worker: {} };
  for (const r of rows) {
    if (!acc[r.role]) acc[r.role] = {};
    const parsed = toBool(r.value);
    if (parsed !== null) acc[r.role][r.key] = parsed;
  }
  return mergeWithDefaults(acc);
}
const PermissionsContext = createContext(null);

export function PermissionsProvider({ children }) {
  const { profile, user, isAuthenticated, isInitializing, refreshProfile } = useAuthContext();
  const network = useOfflineSnapshot();
  const canUseLiveNetwork =
    network.isNetworkKnown && network.isOnline && !network.isPoorConnection;
  const authUserId = normalizeScopeId(user?.id || profile?.id);
  const profileScope = useMemo(
    () => getProfileScope(profile, authUserId),
    [authUserId, profile],
  );
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState(normalizeRole(profile?.role));
  const [companyId, setCompanyId] = useState(normalizeScopeId(profile?.company_id) || null);
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [roleAuthoritative, setRoleAuthoritative] = useState(false);
  const [matrix, setMatrix] = useState(deepClone(START_PRESET));
  const [source, setSource] = useState('defaults'); // defaults | cache | cloud
  const authUserIdRef = useRef(authUserId);
  authUserIdRef.current = authUserId;
  const activeScopeRef = useRef(null);
  const hydratedUserIdRef = useRef(null);
  const remoteRevisionRef = useRef(0);
  const sourceRef = useRef(source);
  const appStateRef = useRef(AppState.currentState);
  const pollTimerRef = useRef(null);
  const lastRealtimeRefreshAtRef = useRef(0);
  const liveNetworkRef = useRef(canUseLiveNetwork);
  const setMatrixIfChanged = useCallback((next) => {
    setMatrix((prev) => (deepEqual(prev, next) ? prev : next));
  }, []);
  const setSourceIfChanged = useCallback((next) => {
    sourceRef.current = next;
    setSource((prev) => (prev === next ? prev : next));
  }, []);
  const setRoleIfChanged = useCallback((next) => {
    setRole((prev) => (prev === next ? prev : next));
  }, []);
  const setCompanyIdIfChanged = useCallback((next) => {
    setCompanyId((prev) => (prev === next ? prev : next));
  }, []);
  const setFullNameIfChanged = useCallback((next) => {
    setFullName((prev) => (prev === next ? prev : next));
  }, []);
  const setRoleAuthoritativeIfChanged = useCallback((next) => {
    setRoleAuthoritative((prev) => (prev === next ? prev : next));
  }, []);

  const applyScope = useCallback(
    (scope) => {
      if (!scope?.userId || !scope?.companyId || !scope?.role) return false;
      if (scope.userId !== authUserIdRef.current) return false;
      activeScopeRef.current = scope;
      setRoleIfChanged(scope.role);
      setCompanyIdIfChanged(scope.companyId);
      setFullNameIfChanged(scope.fullName || '');
      setRoleAuthoritativeIfChanged(scope.authoritative === true);
      return true;
    },
    [
      setCompanyIdIfChanged,
      setFullNameIfChanged,
      setRoleAuthoritativeIfChanged,
      setRoleIfChanged,
    ],
  );

  const persistSnapshot = useCallback((scope, nextMatrix) => {
    if (scope?.userId !== authUserIdRef.current) return;
    if (!scopesMatch(activeScopeRef.current, scope)) return;
    writePermissionsSnapshot({
      user_id: scope.userId,
      company_id: scope.companyId,
      role: scope.role,
      matrix: nextMatrix,
    }).catch(() => {});
  }, []);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    void silent;
    if (!isAuthenticated || !authUserId) return;
    const currentNetwork = getOfflineSnapshot();
    if (
      !currentNetwork.isNetworkKnown ||
      !currentNetwork.isOnline ||
      currentNetwork.isPoorConnection
    ) {
      setLoading(false);
      return;
    }

    const doRefresh = async () => {
      try {
        let prof = profile;
        let resolvedScope = getProfileScope(prof, authUserId);
        const cachedScope = activeScopeRef.current;
        const hasCompleteScope = (scope) => Boolean(scope?.companyId && scope?.role);
        const hasTrustedCachedScope = Boolean(
          cachedScope?.lastKnown || cachedScope?.authoritative,
        );

        // A profile object already loaded from Supabase is authoritative for
        // its moment in time, not forever. Re-read it on every quality-gated
        // SWR pass so server-side role/company changes invalidate privileged
        // caches before the new scope is applied.
        let freshProfile = null;
        try {
          freshProfile =
            typeof refreshProfile === 'function'
              ? await refreshProfile({ reason: 'permissions-profile-refresh' })
              : await getCurrentProfile(authUserId);
        } catch {}
        const freshScope = getProfileScope(freshProfile, authUserId);
        if (freshScope?.authoritative) {
          if (!hasCompleteScope(freshScope)) {
            activeScopeRef.current = null;
            remoteRevisionRef.current += 1;
            setRoleIfChanged(freshScope.role);
            setCompanyIdIfChanged(freshScope.companyId || null);
            setFullNameIfChanged(freshScope.fullName || '');
            setRoleAuthoritativeIfChanged(true);
            setMatrixIfChanged(deepClone(START_PRESET));
            setSourceIfChanged('defaults');
            return;
          }
          resolvedScope = freshScope;
        }

        if (
          (!resolvedScope?.authoritative || !hasCompleteScope(resolvedScope)) &&
          cachedScope?.userId === authUserId &&
          hasTrustedCachedScope &&
          hasCompleteScope(cachedScope)
        ) {
          resolvedScope = {
            ...cachedScope,
            fullName: resolvedScope?.fullName || cachedScope.fullName || '',
          };
        }

        if (!resolvedScope?.authoritative && !resolvedScope?.lastKnown) return;

        prof = hasCompleteScope(resolvedScope)
          ? {
              id: resolvedScope.userId,
              role: resolvedScope.role,
              company_id: resolvedScope.companyId,
              full_name: resolvedScope.fullName || '',
            }
          : null;
        if (!prof) {
          // Нет авторизации — оставляем дефолтные права без варнинга
          return;
        }

        const scopeChanged = !scopesMatch(activeScopeRef.current, resolvedScope);
        if (scopeChanged) remoteRevisionRef.current += 1;
        if (!applyScope(resolvedScope)) return;
        if (scopeChanged) {
          setMatrixIfChanged(deepClone(START_PRESET));
          setSourceIfChanged('defaults');
        }

        if (prof.company_id) {
          try {
            const cloud = await loadPermissionsFromCloud(prof.company_id, prof.role || null);
            if (cloud) {
              if (!scopesMatch(activeScopeRef.current, resolvedScope)) return;
              remoteRevisionRef.current += 1;
              setMatrixIfChanged(cloud);
              setSourceIfChanged('cloud');
              persistSnapshot(resolvedScope, cloud);
              return;
            }
          } catch (e) {
            console.warn('permissions refresh cloud fetch failed:', e?.message || e);
            return;
          }
        }

        if (!scopesMatch(activeScopeRef.current, resolvedScope)) return;
        remoteRevisionRef.current += 1;
        const defaults = deepClone(START_PRESET);
        setMatrixIfChanged(defaults);
        setSourceIfChanged('cloud');
        persistSnapshot(resolvedScope, defaults);
      } finally {
        if (authUserIdRef.current === authUserId) setLoading(false);
      }
    };

    try {
      await doRefresh();
    } catch (error) {
      // Сетевые/неожиданные ошибки покажем, отсутствие сессии сюда больше не попадает
      console.warn('refresh error:', error?.message || error);
      // Keep last known matrix on transient failures to avoid permission flapping.
      if (authUserIdRef.current === authUserId) setLoading(false);
    }
  }, [
    applyScope,
    authUserId,
    isAuthenticated,
    persistSnapshot,
    profile,
    refreshProfile,
    setCompanyIdIfChanged,
    setFullNameIfChanged,
    setMatrixIfChanged,
    setRoleAuthoritativeIfChanged,
    setRoleIfChanged,
    setSourceIfChanged,
  ]);

  useEffect(() => {
    if (isInitializing) return;
    if (!isAuthenticated || !authUserId) {
      activeScopeRef.current = null;
      hydratedUserIdRef.current = null;
      setRole(null);
      setCompanyId(null);
      setFullName('');
      setRoleAuthoritative(false);
      setMatrixIfChanged(deepClone(START_PRESET));
      setSourceIfChanged('defaults');
      setLoading(false);
      return;
    }

    let refreshTask = null;
    let refreshTimer = null;
    let active = true;
    const scheduleRefresh = (delayMs = PERMISSIONS_BOOTSTRAP_REFRESH_DELAY_MS) => {
      refreshTimer = setTimeout(() => {
        refreshTask = InteractionManager.runAfterInteractions(() => {
          refresh({ silent: true }).catch(() => {});
        });
      }, delayMs);
    };

    const hydrate = async () => {
      const requestedUserId = authUserId;
      const currentScope = activeScopeRef.current;
      const completeProfileScope =
        profileScope?.companyId && profileScope?.role ? profileScope : null;
      const currentScopeStillValid =
        currentScope?.userId === requestedUserId &&
        (!completeProfileScope?.authoritative || scopesMatch(currentScope, completeProfileScope));

      if (currentScopeStillValid) {
        applyScope({
          ...currentScope,
          fullName: completeProfileScope?.fullName || currentScope.fullName || '',
          authoritative:
            completeProfileScope?.authoritative === true || currentScope.authoritative === true,
        });
        hydratedUserIdRef.current = requestedUserId;
        setLoading(false);
        scheduleRefresh(
          sourceRef.current === 'defaults' ? 0 : PERMISSIONS_BOOTSTRAP_REFRESH_DELAY_MS,
        );
        return;
      }

      setLoading(true);
      const remoteRevisionAtStart = remoteRevisionRef.current;
      const applyCachedSnapshot = (snapshot) => {
        if (!active || authUserIdRef.current !== requestedUserId || !snapshot) return false;
        if (remoteRevisionRef.current !== remoteRevisionAtStart) return false;
        const snapshotScope = {
          userId: snapshot.user_id,
          companyId: snapshot.company_id,
          role: snapshot.role,
          fullName: profileScope?.fullName || '',
          lastKnown: true,
        };
        if (
          completeProfileScope?.authoritative &&
          !scopesMatch(snapshotScope, completeProfileScope)
        ) {
          return false;
        }
        if (!applyScope(snapshotScope)) return false;
        setMatrixIfChanged(mergeWithDefaults(snapshot.matrix));
        setSourceIfChanged('cache');
        return true;
      };
      const snapshot = await readPermissionsSnapshot(requestedUserId, {
        onLateValue: (lateSnapshot) => {
          applyCachedSnapshot(lateSnapshot);
        },
      });
      if (!active || authUserIdRef.current !== requestedUserId) return;

      const didApplySnapshot = applyCachedSnapshot(snapshot);
      if (!didApplySnapshot && completeProfileScope && applyScope(completeProfileScope)) {
        setMatrixIfChanged(deepClone(START_PRESET));
        setSourceIfChanged('defaults');
      } else if (!didApplySnapshot) {
        activeScopeRef.current = null;
        setRoleIfChanged(normalizeRole(profile?.role));
        setCompanyIdIfChanged(normalizeScopeId(profile?.company_id) || null);
        setFullNameIfChanged(profile?.full_name || '');
        setRoleAuthoritativeIfChanged(false);
        setMatrixIfChanged(deepClone(START_PRESET));
        setSourceIfChanged('defaults');
      }

      hydratedUserIdRef.current = requestedUserId;
      setLoading(false);
      scheduleRefresh(didApplySnapshot ? PERMISSIONS_BOOTSTRAP_REFRESH_DELAY_MS : 0);
    };

    hydrate().catch(() => {
      if (!active || authUserIdRef.current !== authUserId) return;
      hydratedUserIdRef.current = authUserId;
      setLoading(false);
      scheduleRefresh(0);
    });
    return () => {
      active = false;
      if (refreshTimer) clearTimeout(refreshTimer);
      try {
        refreshTask?.cancel?.();
      } catch (e) {
        void e;
      }
    };
  }, [
    applyScope,
    authUserId,
    isAuthenticated,
    isInitializing,
    profile,
    profileScope,
    refresh,
    setCompanyIdIfChanged,
    setFullNameIfChanged,
    setMatrixIfChanged,
    setRoleAuthoritativeIfChanged,
    setRoleIfChanged,
    setSourceIfChanged,
  ]);

  useEffect(() => {
    const becameUsable = !liveNetworkRef.current && canUseLiveNetwork;
    liveNetworkRef.current = canUseLiveNetwork;
    if (becameUsable) refresh({ silent: true }).catch(() => {});
  }, [canUseLiveNetwork, refresh]);

  useEffect(() => {
    if (!canUseLiveNetwork) return undefined;
    let subscription = null;
    let broadcastChannel = null;
    let mounted = true;

    const stopSafetyPoll = () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
    const kickoffSafetyPoll = () => {
      stopSafetyPoll();
      let ticks = 0;
      pollTimerRef.current = setInterval(() => {
        ticks += 1;
        if (mounted) refresh({ silent: true });
        if (ticks >= SAFETY_POLL_TICKS) stopSafetyPoll();
      }, SAFETY_POLL_INTERVAL_MS);
    };
    const refreshNow = () => {
      if (!mounted) return;
      const now = Date.now();
      if (now - lastRealtimeRefreshAtRef.current < REALTIME_REFRESH_MIN_INTERVAL_MS) return;
      lastRealtimeRefreshAtRef.current = now;
      refresh({ silent: true });
      kickoffSafetyPoll();
    };

    (async () => {
      try {
        const cid = companyId;
        if (!cid) return;

        subscription = supabase
          .channel(`perm:company:${cid}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'app_role_permissions',
              filter: `company_id=eq.${cid}`,
            },
            () => {
              refreshNow();
            },
          )
          .subscribe();

        broadcastChannel = supabase.channel(PERMISSIONS_BROADCAST_CHANNEL, {
          config: { broadcast: { self: true } },
        });
        broadcastChannel.on('broadcast', { event: PERMISSIONS_BROADCAST_EVENT }, (payload) => {
          const changedCompanyId = payload?.payload?.company_id;
          if (changedCompanyId && changedCompanyId !== cid) return;
          refreshNow();
        });
        broadcastChannel.subscribe();
      } catch (e) {
        void e;
      }
    })();

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        if (mounted) refresh({ silent: true });
      }
      appStateRef.current = nextState;
    });

    return () => {
      mounted = false;
      stopSafetyPoll();
      appStateSub?.remove?.();
      try {
        subscription && supabase.removeChannel(subscription);
      } catch (e) {
        void e;
      }
      try {
        broadcastChannel && supabase.removeChannel(broadcastChannel);
      } catch (e) {
        void e;
      }
      try {
      } catch (e) {
        void e;
      }
    };
  }, [canUseLiveNetwork, companyId, refresh]);

  const authoritativeProfileScope =
    profileScope?.authoritative && profileScope?.companyId && profileScope?.role
      ? profileScope
      : null;
  const accessScopeReady = Boolean(
    isAuthenticated &&
      authUserId &&
      hydratedUserIdRef.current === authUserId &&
      (!authoritativeProfileScope || scopesMatch(activeScopeRef.current, authoritativeProfileScope)),
  );
  const exposedLoading = Boolean(isAuthenticated && authUserId && (loading || !accessScopeReady));
  const exposedRole = accessScopeReady ? role : null;
  const exposedCompanyId = accessScopeReady ? companyId : null;
  const exposedFullName = accessScopeReady ? fullName : '';
  const exposedRoleAuthoritative = accessScopeReady ? roleAuthoritative : false;
  const exposedSource = accessScopeReady ? source : 'defaults';
  const exposedMatrix = accessScopeReady ? matrix : START_PRESET;

  const rolePerms = useMemo(() => {
    if (!exposedRole) {
      // Optimistic defaults: пока роль загружается, используем базовые права worker
      // Это предотвращает мигание "недоступно" при холодном старте
      return exposedMatrix?.worker || START_PRESET.worker || {};
    }
    return exposedMatrix?.[exposedRole] || {};
  }, [exposedMatrix, exposedRole]);

  const has = useCallback((permKey) => !!rolePerms?.[permKey], [rolePerms]);
  const hasAny = useCallback(
    (keys = []) => Array.isArray(keys) && keys.some((key) => has(key)),
    [has],
  );
  const hasAll = useCallback(
    (keys = []) => Array.isArray(keys) && keys.every((key) => has(key)),
    [has],
  );
  const getMatrix = useCallback(() => exposedMatrix, [exposedMatrix]);

  const value = useMemo(
    () => ({
      loading: exposedLoading,
      role: exposedRole,
      roleAuthoritative: exposedRoleAuthoritative,
      fullName: exposedFullName,
      companyId: exposedCompanyId,
      source: exposedSource,
      matrix: exposedMatrix,
      rolePerms,
      has,
      hasAny,
      hasAll,
      getMatrix,
      refresh,
    }),
    [
      exposedCompanyId,
      exposedFullName,
      getMatrix,
      has,
      hasAll,
      hasAny,
      exposedLoading,
      exposedMatrix,
      exposedRole,
      exposedRoleAuthoritative,
      exposedSource,
      refresh,
      rolePerms,
    ],
  );

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions должен использоваться внутри <PermissionsProvider>');
  return ctx;
}
