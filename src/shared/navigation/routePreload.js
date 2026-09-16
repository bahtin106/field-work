import { preloadLazyRouteScreen } from '../../../components/layout/LazyRouteScreen';

// Metro resolves every dynamic import as a separate graph in development.
// Keep speculative route warmups sequential so they cannot overwhelm its
// filesystem cache. Foreground navigation does not use this queue.
const queuedPreloads = new Map();
const preloadQueue = [];
let preloadQueueRunning = false;

function drainPreloadQueue() {
  if (preloadQueueRunning) return;
  preloadQueueRunning = true;

  const run = async () => {
    while (preloadQueue.length) {
      const item = preloadQueue.shift();
      let screen = null;
      try {
        screen = await preloadLazyRouteScreen(item.cacheKey, item.load);
      } catch {}
      queuedPreloads.delete(item.cacheKey);
      item.resolve(screen);
    }
    preloadQueueRunning = false;
  };

  run().catch(() => {
    preloadQueueRunning = false;
    drainPreloadQueue();
  });
}

function enqueueRoutePreload(cacheKey, load) {
  const key = String(cacheKey || '').trim();
  if (!key || typeof load !== 'function') return Promise.resolve(null);

  const queued = queuedPreloads.get(key);
  if (queued) return queued;

  const promise = new Promise((resolve) => {
    preloadQueue.push({ cacheKey: key, load, resolve });
    drainPreloadQueue();
  });
  queuedPreloads.set(key, promise);
  return promise;
}

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
  return enqueueRoutePreload(config.cacheKey, config.load);
}

export function hasRoutePreloader(path) {
  return !!ROUTE_PRELOAD_CONFIG[normalizePath(path)];
}

export function preloadOrderDetailScreen() {
  return enqueueRoutePreload(
    'routes.orders/[id]',
    () => import('../../../screens/orders/OrderDetailsScreen'),
  );
}
