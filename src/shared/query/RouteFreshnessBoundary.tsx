import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { COMPANY_SETTINGS_QUERY_KEY } from '../../../lib/companySettingsQuery';
import { financeQueryKeys } from '../../features/finance/queries';
import { queryKeys } from './queryKeys';
import { requestScreenRefresh } from './screenRefreshRegistry';

type RefreshPlan = {
  intervalKey: string;
  minIntervalMs: number;
  queryKeys?: Array<readonly unknown[] | unknown[]>;
  scopes?: string[];
};

function normalizePath(pathname: string | null | undefined) {
  const raw = String(pathname || '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/, '') || '/';
}

function buildRouteRefreshPlan(pathname: string): RefreshPlan | null {
  const path = normalizePath(pathname);
  if (!path) return null;

  if (path === '/orders') {
    return {
      intervalKey: 'orders-home',
      minIntervalMs: 60_000,
      queryKeys: [
        ['profile'],
        ['counts'],
        ['company'],
        ['department'],
        ['cloud-storage-status'],
        COMPANY_SETTINGS_QUERY_KEY,
      ],
      scopes: ['orders.home'],
    };
  }

  if (path === '/orders/my-orders') {
    return {
      intervalKey: 'orders-my',
      minIntervalMs: 30_000,
      queryKeys: [['requests', 'my'], ['requests']],
      scopes: ['orders.my'],
    };
  }

  if (path === '/orders/all-orders') {
    return {
      intervalKey: 'orders-all',
      minIntervalMs: 30_000,
      queryKeys: [['requests', 'all'], ['requests']],
      scopes: ['orders.all'],
    };
  }

  if (path === '/orders/calendar') {
    return {
      intervalKey: 'orders-calendar',
      minIntervalMs: 30_000,
      queryKeys: [['requests', 'calendar'], ['requests']],
      scopes: ['orders.calendar'],
    };
  }

  const orderDetailMatch = path.match(/^\/orders\/([^/]+)$/);
  if (orderDetailMatch?.[1] && !['my-orders', 'all-orders', 'calendar', 'create-order'].includes(orderDetailMatch[1])) {
    const orderId = String(orderDetailMatch[1]).trim();
    return {
      intervalKey: `orders-detail:${orderId}`,
      minIntervalMs: 20_000,
      queryKeys: [queryKeys.requests.detail(orderId), financeQueryKeys.orderEntries(orderId)],
      scopes: ['orders.detail'],
    };
  }

  if (path === '/clients') {
    return {
      intervalKey: 'clients-list',
      minIntervalMs: 45_000,
      queryKeys: [['clients']],
      scopes: ['clients.list'],
    };
  }

  const clientDetailMatch = path.match(/^\/clients\/([^/]+)$/);
  if (clientDetailMatch?.[1] && !['new'].includes(clientDetailMatch[1])) {
    const clientId = String(clientDetailMatch[1]).trim();
    return {
      intervalKey: `clients-detail:${clientId}`,
      minIntervalMs: 30_000,
      queryKeys: [
        queryKeys.clients.detail(clientId),
        queryKeys.clients.orderCount(clientId),
        queryKeys.objects.byClient(clientId),
      ],
      scopes: ['clients.detail'],
    };
  }

  if (path === '/objects') {
    return {
      intervalKey: 'objects-list',
      minIntervalMs: 45_000,
      queryKeys: [['objects']],
      scopes: ['objects.list'],
    };
  }

  const objectDetailMatch = path.match(/^\/objects\/([^/]+)$/);
  if (objectDetailMatch?.[1]) {
    const objectId = String(objectDetailMatch[1]).trim();
    return {
      intervalKey: `objects-detail:${objectId}`,
      minIntervalMs: 30_000,
      queryKeys: [queryKeys.objects.detail(objectId)],
      scopes: ['objects.detail'],
    };
  }

  if (path === '/users') {
    return {
      intervalKey: 'users-list',
      minIntervalMs: 45_000,
      queryKeys: [['employees']],
      scopes: ['users.list'],
    };
  }

  const userDetailMatch = path.match(/^\/users\/([^/]+)$/);
  if (userDetailMatch?.[1] && !['new'].includes(userDetailMatch[1])) {
    const userId = String(userDetailMatch[1]).trim();
    return {
      intervalKey: `users-detail:${userId}`,
      minIntervalMs: 30_000,
      queryKeys: [queryKeys.employees.detail(userId)],
      scopes: ['users.detail'],
    };
  }

  if (path.startsWith('/company_settings')) {
    return {
      intervalKey: 'company-settings',
      minIntervalMs: 5 * 60 * 1000,
      queryKeys: [COMPANY_SETTINGS_QUERY_KEY, ['cloud-storage-status']],
      scopes: ['company.settings'],
    };
  }

  if (path === '/billing') {
    return {
      intervalKey: 'billing',
      minIntervalMs: 60_000,
      queryKeys: [
        ['companyEntitlements'],
        ['companyStorageUsage'],
        ['companyAccessState'],
        ['companyPaidSeatsTotal'],
        ['billingMemberStats'],
        ['employees'],
        COMPANY_SETTINGS_QUERY_KEY,
      ],
      scopes: ['billing.screen'],
    };
  }

  if (path === '/stats') {
    return {
      intervalKey: 'stats',
      minIntervalMs: 60_000,
      queryKeys: [COMPANY_SETTINGS_QUERY_KEY, ['profile']],
      scopes: ['stats.screen'],
    };
  }

  if (path.startsWith('/app_settings')) {
    return {
      intervalKey: 'app-settings',
      minIntervalMs: 2 * 60 * 1000,
      queryKeys: [['appSettings']],
      scopes: ['app.settings'],
    };
  }

  if (path === '/admin/companies') {
    return {
      intervalKey: 'admin-companies',
      minIntervalMs: 60_000,
      queryKeys: [['adminCompanies']],
    };
  }

  if (path === '/admin/companies/details') {
    return {
      intervalKey: 'admin-company-details',
      minIntervalMs: 60_000,
      queryKeys: [['adminCompany'], ['adminCompanySubscriptionMeta'], ['companyAccessState'], ['adminCompanies']],
    };
  }

  if (path === '/admin/companies/edit') {
    return {
      intervalKey: 'admin-company-edit',
      minIntervalMs: 60_000,
      queryKeys: [['adminCompany'], ['adminCompanySubscriptionMeta'], ['companyAccessState'], ['adminCompanies']],
    };
  }

  if (path === '/admin/users') {
    return {
      intervalKey: 'admin-users',
      minIntervalMs: 60_000,
      queryKeys: [['adminUsers']],
    };
  }

  return null;
}

export function RouteFreshnessBoundary() {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const lastRunRef = useRef(new Map<string, number>());

  const plan = useMemo(() => buildRouteRefreshPlan(pathname), [pathname]);

  const runPlan = useCallback((reason: string) => {
    if (!plan) return;
    if (!onlineManager.isOnline()) return;

    const now = Date.now();
    const lastRunAt = lastRunRef.current.get(plan.intervalKey) || 0;
    if (now - lastRunAt < plan.minIntervalMs) return;
    lastRunRef.current.set(plan.intervalKey, now);

    const invalidateTasks = (plan.queryKeys || []).map((queryKey) =>
      queryClient.invalidateQueries({ queryKey, refetchType: 'active' }),
    );

    Promise.allSettled([
      ...invalidateTasks,
      requestScreenRefresh(plan.scopes || [], {
        reason,
        path: pathname || '',
      }),
    ]).catch(() => {});
  }, [pathname, plan, queryClient]);

  useEffect(() => {
    runPlan('route-focus');
  }, [runPlan]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        runPlan('app-resume');
      }
    });
    return () => sub.remove();
  }, [runPlan]);

  return null;
}

export default RouteFreshnessBoundary;
