const marks = new Map();
const renderCounters = new Map<string, { count: number; startedAt: number }>();

const isDev = () => {
  try {
    return typeof __DEV__ !== 'undefined' && __DEV__;
  } catch {
    return false;
  }
};

const isPerfLoggingEnabled = () => {
  if (!isDev()) return false;
  try {
    return globalThis?.__DEV_PERF_METRICS__ === true;
  } catch {
    return false;
  }
};

export function markScreenMount(screenName) {
  if (!isDev() || !screenName) return;
  marks.set(`screen:${screenName}`, Date.now());
}

export function markFirstContent(screenName) {
  if (!isDev() || !screenName) return;
  const key = `screen:${screenName}`;
  const startedAt = marks.get(key);
  if (!startedAt) return;
  const ms = Date.now() - startedAt;
  if (isPerfLoggingEnabled()) {
    console.log(`[perf] ${screenName} first-content: ${ms}ms`);
  }
  marks.delete(key);
}

export async function measureNetwork(label, fn) {
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    if (isPerfLoggingEnabled() && label) {
      console.log(`[perf] ${label} fetch: ${Date.now() - startedAt}ms`);
    }
  }
}

export function trackRender(screenName, logEvery = 20) {
  if (!isPerfLoggingEnabled() || !screenName) return;
  const key = `render:${screenName}`;
  const prev = renderCounters.get(key) || { count: 0, startedAt: Date.now() };
  const next = { count: prev.count + 1, startedAt: prev.startedAt };
  renderCounters.set(key, next);
  if (next.count % Math.max(1, logEvery) === 0) {
    const elapsed = Date.now() - next.startedAt;
    const rps = elapsed > 0 ? ((next.count / elapsed) * 1000).toFixed(1) : '0.0';
    console.log(`[perf] ${screenName} renders: ${next.count} (${rps}/s)`); 
  }
}

export function startFpsProbe(screenName, durationMs = 3000) {
  if (!isPerfLoggingEnabled() || !screenName || durationMs <= 0) return () => {};
  let rafId = 0;
  let frames = 0;
  const startedAt = Date.now();
  const tick = () => {
    frames += 1;
    if (Date.now() - startedAt < durationMs) {
      rafId = requestAnimationFrame(tick);
      return;
    }
    const fps = (frames / (durationMs / 1000)).toFixed(1);
    console.log(`[perf] ${screenName} fps-probe(${durationMs}ms): ${fps} fps`);
  };
  rafId = requestAnimationFrame(tick);
  return () => {
    try {
      cancelAnimationFrame(rafId);
    } catch {}
  };
}
