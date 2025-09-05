// lib/permissions.js
// Глобальный провайдер прав + хук usePermissions.
// Источник прав: таблица app_role_permissions (company_id, role, key, value).
// JS-версия (без TS).

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';

const deepClone = (obj) => JSON.parse(JSON.stringify(obj));

export const ROLES = ['admin', 'dispatcher', 'worker'];

export const START_PRESET = {
  admin: {
    canCreateOrders: true,
    canEditOrders: true,
    canAssignExecutors: true,
    canViewAllOrders: true,
    canDeleteOrders: true,
    canAccessFormBuilder: true,
    phoneAlwaysVisible: true,
    phoneVisibleMinus1Day: true,
  },
  dispatcher: {
    canCreateOrders: true,
    canEditOrders: true,
    canAssignExecutors: true,
    canViewAllOrders: true,
    canDeleteOrders: false,
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

async function getCurrentProfile() {
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const user = userRes?.user;
  if (!user) throw new Error('Пользователь не найден');

  const { data: prof, error: profErr } = await supabase
    .from('profiles')
    .select('id, role, full_name, company_id')
    .eq('id', user.id)
    .maybeSingle();
  if (profErr) throw profErr;
  if (!prof) throw new Error('Профиль не найден');
  return prof;
}

async function loadPermissionsFromCloud(companyId) {
  const { data: rows, error } = await supabase
    .from('app_role_permissions')
    .select('role, key, value')
    .eq('company_id', companyId);

  if (error) throw error;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const acc = { admin: {}, dispatcher: {}, worker: {} };
  for (const r of rows) {
    if (!acc[r.role]) acc[r.role] = {};
    acc[r.role][r.key] = !!r.value;
  }
  return mergeWithDefaults(acc);
}

const PermissionsContext = createContext(null);

export function PermissionsProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState(null);
  const [companyId, setCompanyId] = useState(null);
  const [fullName, setFullName] = useState('');
  const [matrix, setMatrix] = useState(deepClone(START_PRESET));
  const [source, setSource] = useState('defaults'); // defaults | cloud

  const refresh = async () => {
    setLoading(true);
    try {
      const prof = await getCurrentProfile();
      setRole(prof.role || null);
      setCompanyId(prof.company_id || null);
      setFullName(prof.full_name || '');

      if (prof.company_id) {
        try {
          const cloud = await loadPermissionsFromCloud(prof.company_id);
          if (cloud) {
            setMatrix(cloud);
            setSource('cloud');
            return;
          }
        } catch {}
      }

      setMatrix(deepClone(START_PRESET));
      setSource('defaults');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh().catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    let subscription = null;
    let authSub = null;
    let mounted = true;

    (async () => {
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const user = userRes?.user;
        if (!user) return;
        const { data: prof } = await supabase
          .from('profiles')
          .select('company_id')
          .eq('id', user.id)
          .maybeSingle();
        const cid = prof?.company_id;
        if (!cid) return;

        subscription = supabase
          .channel(`perm:company:${cid}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'app_role_permissions', filter: `company_id=eq.${cid}` },
            () => { if (mounted) refresh(); }
          )
          .subscribe();
      } catch {}

      authSub = supabase.auth.onAuthStateChange(() => { if (mounted) refresh(); });
    })();

    return () => {
      mounted = false;
      try { subscription && supabase.removeChannel(subscription); } catch {}
      try { authSub && authSub.data && authSub.data.subscription && authSub.data.subscription.unsubscribe(); } catch {}
    };
  }, [companyId]);

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
