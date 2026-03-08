// components/hooks/useFilters.js
/**
 * Hook for managing filter state and persistence across screens.
 *
 * The state is persisted per screen key with a short TTL so filters stay
 * temporarily while user navigates around, but expire automatically.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import logger from '../../lib/logger';

// TTL default: 1 minute (in ms).
const DEFAULT_TTL = 60 * 1000;
const FILTERS_SESSION_KEY = '__FW_FILTERS_SESSION_ID__';

function getFiltersSessionId() {
  if (!globalThis[FILTERS_SESSION_KEY]) {
    const randomPart = Math.random().toString(36).slice(2);
    globalThis[FILTERS_SESSION_KEY] = `${Date.now()}-${randomPart}`;
  }
  return globalThis[FILTERS_SESSION_KEY];
}

const RUNTIME_FILTERS_SESSION_ID = getFiltersSessionId();

function shallowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    const va = a[key];
    const vb = b[key];
    if (Array.isArray(va) && Array.isArray(vb)) {
      if (va.length !== vb.length) return false;
      for (let i = 0; i < va.length; i += 1) {
        if (va[i] !== vb[i]) return false;
      }
      continue;
    }
    if (va !== vb) return false;
  }
  return true;
}

export function useFilters({ screenKey, defaults = {}, ttl = DEFAULT_TTL }) {
  const storageKey = useMemo(() => `filters:${screenKey}`, [screenKey]);

  const [visible, setVisible] = useState(false);
  const [values, setValues] = useState(() => ({ ...defaults }));
  const valuesRef = useRef(values);
  const defaultsRef = useRef(defaults);

  useEffect(() => {
    valuesRef.current = values;
  }, [values]);
  useEffect(() => {
    defaultsRef.current = defaults;
  }, [defaults]);

  const persistValues = useCallback(
    async (nextValues, ts = Date.now()) => {
      try {
        await AsyncStorage.setItem(
          storageKey,
          JSON.stringify({
            ts,
            values: nextValues,
            sessionId: RUNTIME_FILTERS_SESSION_ID,
          }),
        );
      } catch (err) {
        logger?.warn?.('[useFilters] failed to save filters:', err?.message || err);
      }
    },
    [storageKey],
  );

  // Revalidate persisted filters: restore if fresh and same session, otherwise reset/clear.
  const revalidate = useCallback(
    async ({ extend = false } = {}) => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (!raw) return false;

        const parsed = JSON.parse(raw);
        const hasShape = parsed && typeof parsed === 'object' && parsed.ts && parsed.values;
        if (!hasShape) {
          await AsyncStorage.removeItem(storageKey);
          return false;
        }

        const isCurrentSession = parsed.sessionId === RUNTIME_FILTERS_SESSION_ID;
        const age = Date.now() - Number(parsed.ts || 0);
        const isFresh = age >= 0 && age < ttl;

        if (!isCurrentSession || !isFresh) {
          await AsyncStorage.removeItem(storageKey);
          const resetValues = { ...defaultsRef.current };
          setValues((prev) => (shallowEqual(prev, resetValues) ? prev : resetValues));
          return false;
        }

        const hydratedValues = { ...defaultsRef.current, ...parsed.values };
        setValues((prev) => (shallowEqual(prev, hydratedValues) ? prev : hydratedValues));

        if (extend) {
          await persistValues(hydratedValues);
        }

        return true;
      } catch (err) {
        logger?.warn?.('[useFilters] failed to revalidate filters:', err?.message || err);
        return false;
      }
    },
    [persistValues, storageKey, ttl],
  );

  useEffect(() => {
    revalidate({ extend: true });
  }, [revalidate]);

  // If app returns from background, validate TTL against current time.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        revalidate({ extend: true });
      }
    });

    return () => {
      sub.remove();
    };
  }, [revalidate]);

  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);

  const setValue = useCallback((key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => {
    const resetValues = { ...defaultsRef.current };
    setValues(resetValues);
    return resetValues;
  }, []);

  const apply = useCallback(
    async (valuesToPersist) => {
      const finalValues = valuesToPersist || valuesRef.current;
      await persistValues(finalValues);
      setVisible(false);
    },
    [persistValues],
  );

  // Refresh filter TTL without changing selected values.
  const touch = useCallback(async () => {
    await persistValues(valuesRef.current);
  }, [persistValues]);

  return useMemo(
    () => ({
      visible,
      open,
      close,
      values,
      setValue,
      reset,
      apply,
      touch,
      revalidate,
    }),
    [visible, open, close, values, setValue, reset, apply, touch, revalidate],
  );
}
