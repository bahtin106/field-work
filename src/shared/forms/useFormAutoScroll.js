import { useCallback } from 'react';
import { ensureVisibleField } from '../../../lib/ensureVisibleField';

/**
 * Shared form auto-scroll helper.
 * Use this in screens with required fields to keep UX consistent.
 */
export function useFormAutoScroll({
  scrollRef,
  scrollYRef,
  insetsBottom = 0,
  headerHeight = 56,
}) {
  const scrollToFieldRef = useCallback(
    (fieldRef, { focus = true } = {}) => {
      if (!fieldRef?.current) return false;

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
    [headerHeight, insetsBottom, scrollRef, scrollYRef],
  );

  const scrollToFirstInvalid = useCallback(
    (rules = []) => {
      for (const rule of rules) {
        if (!rule?.invalid) continue;
        if (rule.ref?.current) {
          scrollToFieldRef(rule.ref, { focus: rule.focus !== false });
          return true;
        }
        if (Number.isFinite(rule?.fallbackY)) {
          try {
            scrollRef?.current?.scrollTo?.({ y: Math.max(0, Number(rule.fallbackY) || 0), animated: true });
            return true;
          } catch {}
        }
      }
      return false;
    },
    [scrollRef, scrollToFieldRef],
  );

  return {
    scrollToFieldRef,
    scrollToFirstInvalid,
  };
}

