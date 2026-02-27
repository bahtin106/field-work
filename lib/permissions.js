/* global console */

// lib/permissions.js
// Глобальный провайдер прав + хук usePermissions.
// Источник прав: таблица app_role_permissions (company_id, role, key, value).
// JS-версия (без TS).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAuthContext } from '../providers/SimpleAuthProvider';
import { supabase } from './supabase';

const deepClone = (obj) => JSON.parse(JSON.stringify(obj));

export const ROLES = ['admin', 'dispatcher', 'worker'];
const PERMISSIONS_BROADCAST_CHANNEL = 'permissions';
const PERMISSIONS_BROADCAST_EVENT = 'perm_changed';
const SAFETY_POLL_INTERVAL_MS = 1200;
const SAFETY_POLL_TICKS = 5;

export const START_PRESET = {
  admin: {
    canCreateOrders: true,
    canEditOrders: true,
    canAssignExecutors: true,
    canViewAllOrders: true,
    canDeleteOrders: true,
    canAddGalleryPhotos: true,
    canAddCameraPhotos: true,
    canViewOrderPhotos: true,
    canViewOrderAmount: true,
    canEditOrderAmount: true,
    canViewOrderFuelCost: true,
    canEditOrderFuelCost: true,
    canViewClients: true,
    canCreateClients: true,
    canEditClients: true,
    canDeleteClients: true,
    canAccessFormBuilder: true,
    phoneAlwaysVisible: true,
    phoneVisibleMinus1Day: true,
  },
  dispatcher: {
    canCreateOrders: true,
    canEditOrders: true,
    canAssignExecutors: true,
    canViewAllOrders: true,
    canDeleteOrders: true,
    canAddGalleryPhotos: true,
    canAddCameraPhotos: true,
    canViewOrderPhotos: true,
    canViewOrderAmount: true,
    canEditOrderAmount: true,
    canViewOrderFuelCost: true,
    canEditOrderFuelCost: true,
    canViewClients: true,
    canCreateClients: true,
    canEditClients: true,
    canDeleteClients: true,
    canAccessFormBuilder: true,
    phoneAlwaysVisible: true,
    phoneVisibleMinus1Day: true,
  },
  worker: {
    canCreateOrders: false,
    canEditOrders: false,
    canAssignExecutors: false,
    canViewAllOrders: false,
    canDeleteOrders: false,
    canAddGalleryPhotos: false,
    canAddCameraPhotos: true,
    canViewOrderPhotos: true,
    canViewOrderAmount: true,
    canEditOrderAmount: false,
    canViewOrderFuelCost: true,
    canEditOrderFuelCost: false,
    canViewClients: true,
    canCreateClients: false,
    canEditClients: false,
    canDeleteClients: false,
    canAccessFormBuilder: false,
    phoneAlwaysVisible: false,
    phoneVisibleMinus1Day: true,
  },
};

function mergeWithDefaults(data) {
  const merged = deepClone(START_PRESET);
  for (const r of ROLES) merged[r] = { ...merged[r], ...(data?.[r] || {}) };
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

async function getCurrentProfile() {
  // Возвращаем null если сессии нет или профиль не найден, вместо выбрасывания ошибок — это нормальная ситуация на экране логина
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr) {
    // Реальные сетевые/SDK ошибки покажем, но отсутствие сессии (user=null) не считаем ошибкой
    return null;
  }
  const user = userRes?.user;
  if (!user) return null;

  const { data: prof, error: profErr } = await supabase
    .from('profiles')
    .select('id, user_id, role, full_name, company_id')
    .or(`id.eq.${user.id},user_id.eq.${user.id}`)
    .maybeSingle();
  if (profErr && (profErr.code === '42703' || /user_id/i.test(profErr.message || ''))) {
    const { data: profFallback, error: profErrFallback } = await supabase
      .from('profiles')
      .select('id, role, full_name, company_id')
      .eq('id', user.id)
      .maybeSingle();
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

async function loadPermissionsFromCloud(companyId, roleFilter = null) {
  let q = supabase
    .from('app_role_permissions')
    .select('role, key, value')
    .eq('company_id', companyId);

  if (roleFilter) q = q.eq('role', roleFilter);

  const { data: rows, error } = await q;
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
  const { profile, isAuthenticated, isInitializing } = useAuthContext();
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState(profile?.role || null);
  const [companyId, setCompanyId] = useState(profile?.company_id || null);
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [matrix, setMatrix] = useState(deepClone(START_PRESET));
  const [source, setSource] = useState('defaults'); // defaults | cloud
  const appStateRef = useRef(AppState.currentState);
  const pollTimerRef = useRef(null);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);

    const doRefresh = async () => {
      try {
        const prof = profile || (isAuthenticated ? await getCurrentProfile() : null);
        if (!prof) {
          // Нет авторизации — оставляем дефолтные права без варнинга
          setRole(null);
          setCompanyId(null);
          setFullName('');
          setMatrix(deepClone(START_PRESET));
          setSource('defaults');
          return;
        }

        setRole(prof.role || null);
        setCompanyId(prof.company_id || null);
        setFullName(prof.full_name || '');

        if (prof.company_id) {
          try {
            const cloud = await loadPermissionsFromCloud(prof.company_id, prof.role || null);
            if (cloud) {
              setMatrix(cloud);
              setSource('cloud');
              return;
            }
          } catch (e) {
            console.warn('permissions refresh cloud fetch failed:', e?.message || e);
          }
        }

        setMatrix(deepClone(START_PRESET));
        setSource('defaults');
      } finally {
        if (!silent) setLoading(false);
      }
    };

    try {
      await doRefresh();
    } catch (error) {
      // Сетевые/неожиданные ошибки покажем, отсутствие сессии сюда больше не попадает
      console.warn('refresh error:', error?.message || error);
      // Keep last known matrix on transient failures to avoid permission flapping.
      if (!silent) setLoading(false);
    }
  }, [isAuthenticated, profile]);

  useEffect(() => {
    if (isInitializing) return;
    if (!isAuthenticated || !profile) {
      setRole(null);
      setCompanyId(null);
      setFullName('');
      setMatrix(deepClone(START_PRESET));
      setSource('defaults');
      setLoading(false);
      return;
    }

    setRole(profile.role || null);
    setCompanyId(profile.company_id || null);
    setFullName(profile.full_name || '');
    refresh().catch(() => setLoading(false));
  }, [isAuthenticated, isInitializing, profile, refresh]);

  useEffect(() => {
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
      refresh({ silent: true });
      kickoffSafetyPoll();
    };

    (async () => {
      try {
        const cid = profile?.company_id || companyId;
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
  }, [companyId, profile?.company_id, refresh]);

  const rolePerms = useMemo(() => {
    if (!role) return {};
    return matrix?.[role] || {};
  }, [matrix, role]);

  const has = (permKey) => !!rolePerms?.[permKey];
  const hasAny = (keys = []) => Array.isArray(keys) && keys.some((k) => has(k));
  const hasAll = (keys = []) => Array.isArray(keys) && keys.every((k) => has(k));

  const value = {
    loading,
    role,
    fullName,
    companyId,
    source,
    matrix,
    rolePerms,
    has,
    hasAny,
    hasAll,
    getMatrix: () => matrix,
    refresh,
  };

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions должен использоваться внутри <PermissionsProvider>');
  return ctx;
}
