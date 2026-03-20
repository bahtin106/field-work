import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getMyCompanyId } from '../lib/workTypes';

const companyIdByUserId = new Map();
const errorByUserId = new Map();
const loadingByUserId = new Map();

function isAuthSessionMissing(error) {
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return name.includes('authsessionmissingerror') || message.includes('auth session missing');
}

async function getCurrentUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) {
    if (isAuthSessionMissing(error)) return null;
    throw error;
  }
  return user?.id || null;
}

async function loadCompanyIdForUser(userId) {
  if (!userId) return null;
  if (companyIdByUserId.has(userId)) return companyIdByUserId.get(userId);
  if (loadingByUserId.has(userId)) return loadingByUserId.get(userId);

  const loadingPromise = getMyCompanyId()
    .then((companyId) => {
      companyIdByUserId.set(userId, companyId ?? null);
      errorByUserId.delete(userId);
      return companyId ?? null;
    })
    .catch((error) => {
      errorByUserId.set(userId, error);
      throw error;
    })
    .finally(() => {
      loadingByUserId.delete(userId);
    });

  loadingByUserId.set(userId, loadingPromise);
  return loadingPromise;
}

export const useMyCompanyId = () => {
  const [companyId, setCompanyId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let syncToken = 0;

    const syncCompany = async () => {
      const token = ++syncToken;
      const safeSet = (next) => {
        if (!cancelled && token === syncToken) {
          setCompanyId(next.companyId);
          setLoading(next.loading);
          setError(next.error);
        }
      };

      safeSet({ companyId: null, loading: true, error: null });

      let userId = null;
      try {
        userId = await getCurrentUserId();
      } catch (nextError) {
        safeSet({ companyId: null, loading: false, error: nextError });
        return;
      }

      if (!userId) {
        safeSet({ companyId: null, loading: false, error: null });
        return;
      }

      if (companyIdByUserId.has(userId)) {
        safeSet({
          companyId: companyIdByUserId.get(userId) ?? null,
          loading: false,
          error: null,
        });
        return;
      }

      if (errorByUserId.has(userId)) {
        safeSet({ companyId: null, loading: false, error: errorByUserId.get(userId) });
        return;
      }

      try {
        const nextCompanyId = await loadCompanyIdForUser(userId);
        safeSet({ companyId: nextCompanyId ?? null, loading: false, error: null });
      } catch (nextError) {
        safeSet({ companyId: null, loading: false, error: nextError });
      }
    };

    syncCompany();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      setTimeout(() => {
        syncCompany();
      }, 0);
    });

    return () => {
      cancelled = true;
      subscription?.unsubscribe?.();
    };
  }, []);

  return { companyId, loading, error };
};

export const clearCompanyIdCache = () => {
  companyIdByUserId.clear();
  errorByUserId.clear();
  loadingByUserId.clear();
};
