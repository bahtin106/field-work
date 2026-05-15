import { useMemo } from 'react';
import { useAuthContext } from '../providers/SimpleAuthProvider';
import { useCompanyEntitlements } from './useCompanyEntitlements';
import { APP_RUNTIME_CONFIG } from '../config/appRuntime';

function isExpiredByPeriod(entitlements) {
  if (!entitlements || typeof entitlements !== 'object') return false;
  const rawPeriodEnd = String(entitlements?.current_period_end || '').trim();
  if (!rawPeriodEnd) return false;
  const parsed = new Date(rawPeriodEnd);
  if (Number.isNaN(parsed.getTime())) return false;
  return Date.now() >= parsed.getTime();
}

export function useSubscriptionGuard(companyId) {
  const { profile } = useAuthContext();
  const role = String(profile?.role || '').toLowerCase();
  const isOwner = role === 'admin';

  const { data, isLoading, isFetching, error, refresh, hasFreshData } = useCompanyEntitlements(companyId);
  const hasEntitlements = data != null;
  const hasResolvedEntitlements = hasEntitlements || hasFreshData;
  const guardLoading = !!companyId && !hasResolvedEntitlements && (isLoading || isFetching);
  const periodExpired = useMemo(() => isExpiredByPeriod(data), [data]);
  const canEdit = !companyId || guardLoading || !hasEntitlements
    ? true
    : (periodExpired ? false : Boolean(data?.can_edit));

  const reason = useMemo(() => {
    if (guardLoading) return 'loading';
    if (!hasEntitlements) return error ? 'entitlements_error' : null;
    if (periodExpired) return 'subscription_expired';
    if (canEdit) return null;
    const status = data?.status;
    if (status === 'expired') return 'subscription_expired';
    if (status === 'past_due') return 'subscription_past_due';
    if (status === 'canceled') return 'subscription_canceled';
    if (status === 'paused') return 'subscription_paused';
    return 'subscription_inactive';
  }, [canEdit, data?.status, error, guardLoading, hasEntitlements, periodExpired]);

  return {
    canEdit,
    reason,
    isLoading: guardLoading,
    hasFreshData,
    isOwner,
    entitlements: data,
    upgradeUrl: APP_RUNTIME_CONFIG.billingWebsiteUrl || null,
    refresh,
  };
}
