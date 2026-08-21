import AsyncStorage from '@react-native-async-storage/async-storage';

const PUBLIC_AUTH_SCREENS = new Set([
  'login',
  'register',
  'register-code',
  'verify-email',
  'set-password',
]);

const LOGIN_ROUTE = '/(auth)/login';
const PUBLIC_AUTH_ROUTE_STORAGE_KEY = '@field-work/public-auth-route';
const REGISTER_PENDING_KEY = 'register_pending_v1';
const PUBLIC_AUTH_ROUTE_HYDRATION_TIMEOUT_MS = 1200;

let lastPublicAuthRoute = LOGIN_ROUTE;
let hydrationPromise = null;

function normalizeAuthPathname(pathname) {
  return String(pathname || '').trim().replace(/\/+$/, '') || '/';
}

export function normalizePublicAuthRoute({ pathname = '', segments = [] } = {}) {
  const seg = Array.isArray(segments) ? segments : [];
  let screen = seg[0] === '(auth)' ? String(seg[1] || '').trim() : '';

  if (!screen) {
    const normalized = normalizeAuthPathname(pathname);
    const match = normalized.match(/^\/(?:\(auth\)\/)?([^/?#]+)/);
    screen = String(match?.[1] || '').trim();
  }

  if (!PUBLIC_AUTH_SCREENS.has(screen)) return null;
  return `/(auth)/${screen}`;
}

export function rememberPublicAuthRoute(input, options = {}) {
  const route = normalizePublicAuthRoute(input);
  if (!route) return null;

  const allowLoginOverwrite = options?.allowLoginOverwrite === true;
  if (route === LOGIN_ROUTE && lastPublicAuthRoute !== LOGIN_ROUTE && !allowLoginOverwrite) {
    return lastPublicAuthRoute;
  }

  lastPublicAuthRoute = route;
  AsyncStorage.setItem(PUBLIC_AUTH_ROUTE_STORAGE_KEY, route).catch(() => {});
  return route;
}

export async function persistPublicAuthRoute(input, options = {}) {
  const route = rememberPublicAuthRoute(input, options);
  if (!route) return null;
  try {
    await AsyncStorage.setItem(PUBLIC_AUTH_ROUTE_STORAGE_KEY, route);
  } catch {}
  return route;
}

export async function hydratePublicAuthRoute() {
  if (hydrationPromise) return hydrationPromise;
  const storageHydration = (async () => {
    try {
      const stored = await AsyncStorage.getItem(PUBLIC_AUTH_ROUTE_STORAGE_KEY);
      const storedRoute = normalizePublicAuthRoute({ pathname: stored });
      if (storedRoute) {
        lastPublicAuthRoute = storedRoute;
        return storedRoute;
      }

      // Backward compatibility for a registration started before route
      // persistence was introduced.
      const pendingRaw = await AsyncStorage.getItem(REGISTER_PENDING_KEY);
      const pending = pendingRaw ? JSON.parse(pendingRaw) : null;
      if (String(pending?.email || '').trim() && String(pending?.password || '')) {
        lastPublicAuthRoute = '/(auth)/register-code';
      }
    } catch {}
    return lastPublicAuthRoute;
  })();
  hydrationPromise = Promise.race([
    storageHydration,
    new Promise((resolve) => {
      setTimeout(() => resolve(lastPublicAuthRoute), PUBLIC_AUTH_ROUTE_HYDRATION_TIMEOUT_MS);
    }),
  ]);
  return hydrationPromise;
}

export function getLastPublicAuthRoute(fallback = LOGIN_ROUTE) {
  return lastPublicAuthRoute || fallback;
}

export function getLastPublicAuthScreen(fallback = 'login') {
  const route = getLastPublicAuthRoute();
  const screen = String(route).split('/').filter(Boolean).pop();
  return PUBLIC_AUTH_SCREENS.has(screen) ? screen : fallback;
}

export function resetPublicAuthRoute() {
  lastPublicAuthRoute = LOGIN_ROUTE;
  AsyncStorage.setItem(PUBLIC_AUTH_ROUTE_STORAGE_KEY, LOGIN_ROUTE).catch(() => {});
}
