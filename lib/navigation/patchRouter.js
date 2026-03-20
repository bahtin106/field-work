// lib/navigation/patchRouter.js
// Global navigation guard:
// - blocks duplicate pushes/replaces to the same destination
// - keeps behavior centralized for the whole app

function stableStringify(value) {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${k}:${stableStringify(value[k])}`).join(',')}}`;
}

function normalizePath(path) {
  const raw = String(path || '').trim();
  if (!raw) return '';
  const withoutQuery = raw.split('?')[0].split('#')[0];
  const normalized = withoutQuery.replace(/\/+/g, '/');
  if (normalized === '/') return '/';
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function targetKeyFromArgs(args) {
  try {
    if (!args || args.length === 0) return null;
    const target = args[0];
    if (typeof target === 'string') return normalizePath(target);
    if (target && typeof target === 'object') {
      if (target.pathname) {
        const path = normalizePath(target.pathname);
        const params = target.params ? stableStringify(target.params) : '';
        return params ? `${path}|${params}` : path;
      }
      return stableStringify(target);
    }
    return String(target);
  } catch {
    return null;
  }
}

const patchedRouters = new WeakSet();

export default function patchRouter(router, opts = {}) {
  if (!router || patchedRouters.has(router) || router.__navigationPatched) return;

  const pendingMs = typeof opts.pendingMs === 'number' ? opts.pendingMs : 120;
  const dedupeEnabled = pendingMs > 0;

  const pendingTargets = new Map();

  function cleanupPending() {
    const now = Date.now();
    for (const [key, startedAt] of pendingTargets.entries()) {
      if (now - startedAt >= pendingMs) {
        pendingTargets.delete(key);
      }
    }
  }

  function makeWrapper(orig, methodName) {
    return function wrapped(...args) {
      if (!dedupeEnabled) {
        return orig.apply(this, args);
      }
      cleanupPending();

      const targetKey = targetKeyFromArgs(args);
      const isDedupedMethod = methodName === 'push' || methodName === 'navigate';

      if (isDedupedMethod && targetKey && pendingTargets.has(targetKey)) {
        return;
      }

      if (isDedupedMethod && targetKey) {
        pendingTargets.set(targetKey, Date.now());
      }

      let result;
      try {
        result = orig.apply(this, args);
      } catch (error) {
        if (targetKey) pendingTargets.delete(targetKey);
        throw error;
      }

      const release = () => {
        if (!targetKey) return;
        setTimeout(() => pendingTargets.delete(targetKey), pendingMs);
      };

      if (result && typeof result.then === 'function') {
        return result.finally(release);
      }
      release();
      return result;
    };
  }

  ['push', 'replace', 'replaceAll', 'navigate'].forEach((name) => {
    if (typeof router[name] === 'function') {
      try {
        router[name] = makeWrapper(router[name].bind(router), name);
      } catch {}
    }
  });

  try {
    router.__navigationPatched = true;
  } catch {}
  patchedRouters.add(router);
}
