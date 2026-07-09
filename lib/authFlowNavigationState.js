const PUBLIC_AUTH_SCREENS = new Set([
  'login',
  'register',
  'register-code',
  'verify-email',
  'set-password',
]);

let lastPublicAuthRoute = '/(auth)/login';

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

export function rememberPublicAuthRoute(input) {
  const route = normalizePublicAuthRoute(input);
  if (route) lastPublicAuthRoute = route;
  return route;
}

export function getLastPublicAuthRoute(fallback = '/(auth)/login') {
  return lastPublicAuthRoute || fallback;
}

export function getLastPublicAuthScreen(fallback = 'login') {
  const route = getLastPublicAuthRoute();
  const screen = String(route).split('/').filter(Boolean).pop();
  return PUBLIC_AUTH_SCREENS.has(screen) ? screen : fallback;
}

export function resetPublicAuthRoute() {
  lastPublicAuthRoute = '/(auth)/login';
}
