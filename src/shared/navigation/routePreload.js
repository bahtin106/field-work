import { preloadLazyRouteScreen } from '../../../components/layout/LazyRouteScreen';

const ROUTE_PRELOAD_CONFIG = Object.freeze({
  '/orders/my-orders': {
    cacheKey: 'routes.orders/my-orders',
    load: () => import('../../../screens/orders/MyOrdersScreen'),
  },
  '/orders/all-orders': {
    cacheKey: 'routes.orders/all-orders',
    load: () => import('../../../screens/orders/AllOrdersScreen'),
  },
  '/orders/calendar': {
    cacheKey: 'routes.orders/calendar',
    load: () => import('../../../screens/orders/CalendarScreen'),
  },
  '/orders/create-order': {
    cacheKey: 'routes.orders/create-order',
    load: () => import('../../../screens/orders/CreateOrderScreen'),
  },
  '/app_settings/AppSettings': {
    cacheKey: 'routes.app_settings/AppSettings',
    load: () => import('../../../screens/app_settings/AppSettingsScreen'),
  },
  '/company_settings': {
    cacheKey: 'company_settings_title',
    load: () => import('../../../screens/company_settings/CompanySettingsScreen'),
  },
  '/billing': {
    cacheKey: 'routes.billing/index',
    load: () => import('../../../screens/billing/BillingScreen'),
  },
});

function normalizePath(path) {
  const raw = String(path || '').trim();
  if (!raw) return '';
  return raw.length > 1 ? raw.replace(/\/+$/, '') : raw;
}

export function preloadRouteScreen(path) {
  const config = ROUTE_PRELOAD_CONFIG[normalizePath(path)];
  if (!config) return Promise.resolve(null);
  return preloadLazyRouteScreen(config.cacheKey, config.load).catch(() => null);
}

export function hasRoutePreloader(path) {
  return !!ROUTE_PRELOAD_CONFIG[normalizePath(path)];
}

export function preloadOrderDetailScreen() {
  return preloadLazyRouteScreen(
    'routes.orders/[id]',
    () => import('../../../screens/orders/OrderDetailsScreen'),
  ).catch(() => null);
}
