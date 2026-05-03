import { useMemo } from 'react';
import { useAuthContext } from '../providers/SimpleAuthProvider';
import { useCompanyEntitlements } from './useCompanyEntitlements';
import { APP_RUNTIME_CONFIG } from '../config/appRuntime';

export function useSubscriptionGuard(companyId) {
  const { profile } = useAuthContext();
  const role = String(profile?.role || '').toLowerCase();
  const isOwner = role === 'admin';

  const { data, isLoading, isFetching, error, refresh, hasFreshData } = useCompanyEntitlements(companyId);
  const hasResolvedEntitlements = data != null || hasFreshData;
  const guardLoading = !!companyId && !hasResolvedEntitlements && (isLoading || isFetching);
  const canEdit = !companyId ? true : (guardLoading ? true : Boolean(data?.can_edit));

  const reason = useMemo(() => {
    if (guardLoading) return 'loading';
    if (error) return 'entitlements_error';
    if (canEdit) return null;
    const status = data?.status;
    if (status === 'expired') return 'subscription_expired';
    if (status === 'past_due') return 'subscription_past_due';
    if (status === 'canceled') return 'subscription_canceled';
    if (status === 'paused') return 'subscription_paused';
    return 'subscription_inactive';
  }, [canEdit, data?.status, error, guardLoading]);

  return {
    canEdit,
    reason,
    isLoading: guardLoading,
    isOwner,
    entitlements: data,
    upgradeUrl: APP_RUNTIME_CONFIG.billingWebsiteUrl || null,
    refresh,
  };
}
