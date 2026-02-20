const DEFAULT_TTL_MS = 2 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 200;

class PrefetchRegistry {
  constructor({ ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  _cleanup(now = Date.now()) {
    for (const [key, entry] of this.entries) {
      const expired = now - (entry?.timestamp || 0) > this.ttlMs;
      const settled = entry?.status === 'fulfilled' || entry?.status === 'rejected';
      if (expired && settled) {
        this.entries.delete(key);
      }
    }

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next()?.value;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }

  async run(key, runner, { force = false } = {}) {
    const now = Date.now();
    this._cleanup(now);
    const current = this.entries.get(key);

    if (!force && current) {
      const isFresh = now - (current.timestamp || 0) <= this.ttlMs;
      if (current.status === 'pending') {
        return current.promise;
      }
      if (isFresh && current.status === 'fulfilled') {
        return current.value;
      }
    }

    const entry = {
      timestamp: now,
      status: 'pending',
      promise: null,
      value: undefined,
    };

    entry.promise = Promise.resolve()
      .then(runner)
      .then((value) => {
        entry.status = 'fulfilled';
        entry.value = value;
        entry.timestamp = Date.now();
        return value;
      })
      .catch((error) => {
        entry.status = 'rejected';
        entry.timestamp = Date.now();
        throw error;
      });

    this.entries.set(key, entry);
    this._cleanup();
    return entry.promise;
  }
}

export const prefetchRegistry = new PrefetchRegistry();

export function getPrefetchRegistry() {
  return prefetchRegistry;
}

