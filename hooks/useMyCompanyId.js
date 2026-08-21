import { useEffect, useState } from 'react';
import { cacheCompanyIdForUser, loadCompanyIdForUser, readCompanyIdCache } from '../lib/myCompanyIdCache';
import { useAuthContext } from '../providers/SimpleAuthProvider';
import { useOfflineSnapshot } from '../src/shared/offline/offlineStatus';

export const useMyCompanyId = () => {
  const { user, profile } = useAuthContext();
  const authUserId = String(user?.id || profile?.id || '').trim();
  const authCompanyId = String(profile?.company_id || '').trim();
  const network = useOfflineSnapshot();
  const [companyId, setCompanyId] = useState(() => authCompanyId || null);
  const [loading, setLoading] = useState(() => !authCompanyId);
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

      if (authUserId && authCompanyId) {
        cacheCompanyIdForUser(authUserId, authCompanyId);
        safeSet({ companyId: authCompanyId, loading: false, error: null });
        return;
      }

      safeSet({ companyId: authCompanyId || null, loading: !authCompanyId, error: null });

      const userId = authUserId;
      if (!userId) {
        safeSet({ companyId: null, loading: false, error: null });
        return;
      }

      const cached = readCompanyIdCache(userId);
      if (cached.status === 'value') {
        safeSet({
          companyId: cached.companyId ?? null,
          loading: false,
          error: null,
        });
        return;
      }

      if (!network.isNetworkKnown || !network.isOnline || network.isPoorConnection) {
        safeSet({ companyId: null, loading: false, error: null });
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

    return () => {
      cancelled = true;
    };
  }, [authCompanyId, authUserId, network.isNetworkKnown, network.isOnline, network.isPoorConnection]);

  return { companyId, loading, error };
};
