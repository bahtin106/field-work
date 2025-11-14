// components/hooks/useFilters.js
/**
 * Hook for managing filter state and persistence across screens.
 *
 * This hook provides a consistent API for opening and closing a filter
 * modal, updating filter values, resetting to defaults, and applying
 * changes. When filters are applied, they are stored in AsyncStorage
 * under a namespaced key derived from the provided `screenKey`. On
 * re‑entry to a screen, previously applied filters are restored if
 * they were saved within the `ttl` (time to live) window. This gives
 * users the feeling that filters "stick" when navigating back and
 * forth without permanently persisting obsolete values.
 *
 * Example usage:
 *
 *   const {
 *     visible,
 *     open,
 *     close,
 *     values,
 *     setValue,
 *     reset,
 *     apply,
 *   } = useFilters({
 *     screenKey: 'orders',
 *     defaults: { status: null, dateFrom: null },
 *     ttl: 1000 * 60 * 30, // 30 minutes
 *   });
 *
 *   // then pass visible/open/close/values/etc to your FilterModal component
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';

// TTL default: 1 hour (in ms). If the stored filter state is older than
// this, defaults will be used instead.
const DEFAULT_TTL = 60 * 60 * 1000;

export function useFilters({ screenKey, defaults = {}, ttl = DEFAULT_TTL }) {
  // Internal key for AsyncStorage
  const storageKey = useMemo(() => `filters:${screenKey}`, [screenKey]);

  // Modal visibility
  const [visible, setVisible] = useState(false);

  // Filter values (merged from defaults + persisted state)
  const [values, setValues] = useState(() => ({ ...defaults }));

  // On mount, attempt to hydrate from storage
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        // Ensure parsed object has expected structure
        if (parsed && typeof parsed === 'object' && parsed.ts && parsed.values) {
          const age = Date.now() - parsed.ts;
          if (age < ttl) {
            // Only update if still fresh and the hook has not unmounted
            if (!cancelled) {
              setValues((prev) => ({ ...prev, ...parsed.values }));
            }
          }
        }
      } catch (err) {
        // Fail silently – invalid JSON or storage errors should not break UI
        console.warn('[useFilters] failed to load filters:', err?.message || err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storageKey, ttl]);

  // Open and close modal handlers
  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);

  // Update a single filter value by key
  const setValue = useCallback((key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Reset all values back to defaults and return them for immediate use
  const reset = useCallback(() => {
    const resetValues = { ...defaults };
    setValues(resetValues);
    return resetValues;
  }, [defaults]);

  // Apply – persist current values (or provided values) to storage and close the modal.
  // Returns a promise to allow callers to await completion.
  const apply = useCallback(
    async (valuesToPersist) => {
      const finalValues = valuesToPersist || values;
      try {
        await AsyncStorage.setItem(
          storageKey,
          JSON.stringify({ ts: Date.now(), values: finalValues }),
        );
      } catch (err) {
        console.warn('[useFilters] failed to save filters:', err?.message || err);
      }
      setVisible(false);
    },
    [storageKey, values],
  );

  // Expose API to consumer
  return useMemo(
    () => ({
      visible,
      open,
      close,
      values,
      setValue,
      reset,
      apply,
    }),
    [visible, open, close, values, setValue, reset, apply],
  );
}
