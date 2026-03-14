import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { ensureVisibleField } from '../../../lib/ensureVisibleField';

const FormAutoScrollContext = createContext(null);

export function FormAutoScrollProvider({
  children,
  scrollRef,
  scrollYRef,
  insetsBottom = 0,
  headerHeight = 56,
  enabled = true,
}) {
  const lastScrollAtRef = useRef(0);

  const requestScrollToField = useCallback(
    (fieldRef, { focus = false, cooldownMs = 450 } = {}) => {
      if (!enabled || !fieldRef?.current || !scrollRef?.current) return false;

      const now = Date.now();
      if (now - lastScrollAtRef.current < cooldownMs) return false;
      lastScrollAtRef.current = now;

      ensureVisibleField({
        fieldRef,
        scrollRef,
        scrollYRef,
        insetsBottom,
        headerHeight,
      });

      if (focus && typeof fieldRef.current?.focus === 'function') {
        try {
          fieldRef.current.focus();
        } catch {}
      }
      return true;
    },
    [enabled, headerHeight, insetsBottom, scrollRef, scrollYRef],
  );

  const value = useMemo(
    () => ({
      enabled,
      requestScrollToField,
    }),
    [enabled, requestScrollToField],
  );

  return <FormAutoScrollContext.Provider value={value}>{children}</FormAutoScrollContext.Provider>;
}

export function useFormAutoScrollContext() {
  return useContext(FormAutoScrollContext);
}

export function useAutoScrollOnInvalid({
  fieldRef,
  isInvalid,
  shouldAutoScroll = true,
  focus = false,
}) {
  const context = useFormAutoScrollContext();
  const prevInvalidRef = useRef(false);

  React.useEffect(() => {
    const nextInvalid = !!isInvalid;
    const becameInvalid = nextInvalid && !prevInvalidRef.current;
    prevInvalidRef.current = nextInvalid;

    if (!becameInvalid || !shouldAutoScroll) return;
    context?.requestScrollToField?.(fieldRef, { focus });
  }, [context, fieldRef, focus, isInvalid, shouldAutoScroll]);
}
