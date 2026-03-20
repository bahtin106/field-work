import { useMemo } from 'react';
import { useAuthContext } from '../providers/SimpleAuthProvider';
import { useCompanyEntitlements } from './useCompanyEntitlements';

export function useSubscriptionGuard(companyId) {
  const { profile } = useAuthContext();
  const role = String(profile?.role || '').toLowerCase();
  const isOwner = role === 'admin';

  const { data, isLoading, isFetching, error, refresh, hasFreshData } = useCompanyEntitlements(companyId);
  const guardLoading = isLoading || isFetching || (!hasFreshData && !!companyId);
  const canEdit = guardLoading ? true : Boolean(data?.can_edit);

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
    upgradeUrl: process.env.EXPO_PUBLIC_BILLING_WEBSITE_URL || 'https://example.com/billing',
    refresh,
  };
}
