import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const rawUsageCache = new Map();
const usageLoadPromises = new Map();

function getCachedSnapshot(storageKey) {
  if (rawUsageCache.has(storageKey)) {
    return { storageKey, loaded: true, raw: rawUsageCache.get(storageKey) };
  }
  return { storageKey, loaded: false, raw: null };
}

async function loadRawUsage(storageKey) {
  if (rawUsageCache.has(storageKey)) return rawUsageCache.get(storageKey);
  if (usageLoadPromises.has(storageKey)) return usageLoadPromises.get(storageKey);

  const promise = AsyncStorage.getItem(storageKey)
    .then((raw) => {
      rawUsageCache.set(storageKey, raw);
      return raw;
    })
    .finally(() => {
      usageLoadPromises.delete(storageKey);
    });
  usageLoadPromises.set(storageKey, promise);
  return promise;
}

export function usePersistedOrderStatusUsage(storageKey, allowedIds, normalizeUsage) {
  const [snapshot, setSnapshot] = useState(() => getCachedSnapshot(storageKey));
  const isReady = snapshot.storageKey === storageKey && snapshot.loaded;
  const usage = useMemo(
    () => (isReady ? normalizeUsage(snapshot.raw, allowedIds) : {}),
    [allowedIds, isReady, normalizeUsage, snapshot.raw],
  );
  const usageRef = useRef(usage);

  useEffect(() => {
    usageRef.current = usage;
  }, [usage]);

  useEffect(() => {
    let active = true;
    const cached = getCachedSnapshot(storageKey);
    if (cached.loaded) {
      setSnapshot((previous) =>
        previous.storageKey === cached.storageKey &&
        previous.loaded === cached.loaded &&
        previous.raw === cached.raw
          ? previous
          : cached,
      );
      return () => {
        active = false;
      };
    }

    setSnapshot((previous) =>
      previous.storageKey === cached.storageKey && previous.loaded === cached.loaded
        ? previous
        : cached,
    );
    loadRawUsage(storageKey)
      .then((raw) => {
        if (active) setSnapshot({ storageKey, loaded: true, raw });
      })
      .catch(() => {
        if (active) setSnapshot({ storageKey, loaded: true, raw: null });
      });

    return () => {
      active = false;
    };
  }, [storageKey]);

  const persistUsage = useCallback(
    (items, metadata = null) => {
      const payload = JSON.stringify({
        ...(metadata && typeof metadata === 'object' ? metadata : null),
        items,
      });
      rawUsageCache.set(storageKey, payload);
      AsyncStorage.setItem(storageKey, payload).catch(() => {});
    },
    [storageKey],
  );

  const refreshUsage = useCallback(() => {
    const cached = getCachedSnapshot(storageKey);
    if (!cached.loaded) return;
    setSnapshot((previous) =>
      previous.storageKey === cached.storageKey &&
      previous.loaded === cached.loaded &&
      previous.raw === cached.raw
        ? previous
        : cached,
    );
  }, [storageKey]);

  return { usage, usageRef, isReady, persistUsage, refreshUsage };
}
