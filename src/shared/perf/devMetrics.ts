const marks = new Map();

const isDev = () => {
  try {
    return typeof __DEV__ !== 'undefined' && __DEV__;
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
  console.log(`[perf] ${screenName} first-content: ${ms}ms`);
  marks.delete(key);
}

export async function measureNetwork(label, fn) {
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    if (isDev() && label) {
      console.log(`[perf] ${label} fetch: ${Date.now() - startedAt}ms`);
    }
  }
}
