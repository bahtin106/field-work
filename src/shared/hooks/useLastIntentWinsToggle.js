import React from 'react';

/**
 * Queue-based toggle handler with "last intent wins" semantics.
 * Useful for fast user re-toggles while async persistence is in flight.
 */
export function useLastIntentWinsToggle({
  value,
  setValue,
  beforeCommit,
  commit,
  onCommitted,
  rollback,
  onError,
}) {
  const inFlightRef = React.useRef(null);
  const queuedRef = React.useRef(null);
  const valueRef = React.useRef(!!value);

  React.useEffect(() => {
    valueRef.current = !!value;
  }, [value]);

  return React.useCallback(
    (nextValue) => {
      const next = !!nextValue;
      queuedRef.current = next;
      setValue(next);

      const pumpQueue = async () => {
        if (inFlightRef.current !== null) return;

        while (queuedRef.current !== null) {
          const target = queuedRef.current;
          queuedRef.current = null;
          inFlightRef.current = target;
          const previous = valueRef.current;

          try {
            await beforeCommit?.(target, previous);
            await commit(target, previous);
            valueRef.current = target;
            onCommitted?.(target, previous);
          } catch (error) {
            if (queuedRef.current === null) {
              rollback?.(previous);
              setValue(previous);
              valueRef.current = previous;
            }
            onError?.(error, target, previous);
          } finally {
            inFlightRef.current = null;
          }
        }
      };

      pumpQueue().catch(() => {});
    },
    [beforeCommit, commit, onCommitted, onError, rollback, setValue],
  );
}

