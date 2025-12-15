// lib/navigation/patchRouter.js
// Lightweight router patch to prevent duplicate rapid navigations to the same target.
// Usage: call patchRouter(router) once (e.g. in root layout). It will wrap
// router.push and router.replace (if present) and ignore repeat calls to the
// same destination within `debounceMs` milliseconds.

function _serializeTarget(args) {
  try {
    if (args.length === 0) return '__unknown__';
    const a = args[0];
    if (typeof a === 'string') return a;
    if (a && typeof a === 'object') {
      // prefer pathname if present
      if (a.pathname) {
        // stable serialization for pathname+params
        const params = a.params ? JSON.stringify(a.params) : '';
        return `${a.pathname}|${params}`;
      }
      return JSON.stringify(a);
    }
    return String(a);
  } catch (e) {
    return String(args[0]);
  }
}

export default function patchRouter(router, opts = {}) {
  if (!router || router.__navigationPatched) return;
  const debounceMs = typeof opts.debounceMs === 'number' ? opts.debounceMs : 600;

  const state = {
    lastKey: null,
    lastTs: 0,
    lock: false,
  };

  function makeWrapper(orig) {
    return function wrapped(...args) {
      try {
        const key = _serializeTarget(args);
        const now = Date.now();
        // If same key and within debounce window, ignore
        if (state.lastKey === key && now - state.lastTs < debounceMs) {
          return;
        }
        state.lastKey = key;
        state.lastTs = now;
        state.lock = true;
        const res = orig.apply(this, args);
        // release lock after debounce window (do not assume promise resolution)
        setTimeout(() => {
          state.lock = false;
        }, debounceMs);
        return res;
      } catch (e) {
        state.lock = false;
        throw e;
      }
    };
  }

  // Wrap common navigation methods if present
  ['push', 'replace', 'replaceAll', 'pop', 'back'].forEach((name) => {
    if (typeof router[name] === 'function') {
      try {
        router[name] = makeWrapper(router[name].bind(router));
      } catch (_) {}
    }
  });

  // marker
  try {
    router.__navigationPatched = true;
  } catch (_) {}
}
