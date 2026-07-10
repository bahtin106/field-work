import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ensureVisibleField } from '../../../lib/ensureVisibleField';

const FormAutoScrollContext = createContext(null);

function measureFieldTop(field) {
  return new Promise((resolve) => {
    const node = field?.fieldRef?.current;
    if (!node || typeof node.measureInWindow !== 'function') {
      resolve({ field, top: null });
      return;
    }

    let settled = false;
    const finish = (top) => {
      if (settled) return;
      settled = true;
      resolve({ field, top: Number.isFinite(top) ? top : null });
    };
    const timeoutId = setTimeout(() => finish(null), 80);
    try {
      node.measureInWindow((_x, top) => {
        clearTimeout(timeoutId);
        finish(Number(top));
      });
    } catch {
      clearTimeout(timeoutId);
      finish(null);
    }
  });
}

export function FormAutoScrollProvider({
  children,
  scrollRef,
  scrollYRef,
  insetsBottom = 0,
  headerHeight = 56,
  enabled = true,
  validationAttempt = 0,
}) {
  const lastScrollAtRef = useRef(0);
  const [internalValidationAttempt, setInternalValidationAttempt] = useState(0);
  const fieldsRef = useRef(new Map());
  const nextFieldOrderRef = useRef(0);
  const pendingScrollRef = useRef(null);

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

  const registerField = useCallback((fieldId, fieldRef) => {
    if (!fieldId) return;
    const current = fieldsRef.current.get(fieldId);
    fieldsRef.current.set(fieldId, {
      fieldRef,
      isInvalid: current?.isInvalid === true,
      order: current?.order ?? nextFieldOrderRef.current++,
    });
  }, []);

  const updateField = useCallback((fieldId, fieldRef, isInvalid) => {
    if (!fieldId) return;
    const current = fieldsRef.current.get(fieldId);
    fieldsRef.current.set(fieldId, {
      fieldRef,
      isInvalid: isInvalid === true,
      order: current?.order ?? nextFieldOrderRef.current++,
    });
  }, []);

  const unregisterField = useCallback((fieldId) => {
    fieldsRef.current.delete(fieldId);
  }, []);

  const requestScrollToFirstInvalid = useCallback(() => {
    if (!enabled || pendingScrollRef.current) return;
    pendingScrollRef.current = setTimeout(async () => {
      pendingScrollRef.current = null;
      const invalidFields = [...fieldsRef.current.values()]
        .filter((field) => field?.isInvalid && field?.fieldRef?.current);
      const measuredFields = await Promise.all(invalidFields.map(measureFieldTop));
      const firstInvalid = measuredFields
        .sort((left, right) => {
          if (left.top != null && right.top != null) return left.top - right.top;
          if (left.top != null) return -1;
          if (right.top != null) return 1;
          return left.field.order - right.field.order;
        })[0]?.field;
      if (!firstInvalid) return;
      requestScrollToField(firstInvalid.fieldRef, { focus: false, cooldownMs: 0 });
    }, 0);
  }, [enabled, requestScrollToField]);

  const beginValidationAttempt = useCallback(() => {
    setInternalValidationAttempt((current) => current + 1);
  }, []);

  const effectiveValidationAttempt =
    Math.max(0, Number(validationAttempt) || 0) + internalValidationAttempt;

  useEffect(() => {
    lastScrollAtRef.current = 0;
  }, [effectiveValidationAttempt]);

  useEffect(
    () => () => {
      if (pendingScrollRef.current) clearTimeout(pendingScrollRef.current);
      pendingScrollRef.current = null;
      fieldsRef.current.clear();
    },
    [],
  );

  const value = useMemo(
    () => ({
      enabled,
      validationAttempt: effectiveValidationAttempt,
      beginValidationAttempt,
      requestScrollToField,
      requestScrollToFirstInvalid,
      registerField,
      updateField,
      unregisterField,
    }),
    [
      enabled,
      beginValidationAttempt,
      effectiveValidationAttempt,
      registerField,
      requestScrollToField,
      requestScrollToFirstInvalid,
      unregisterField,
      updateField,
    ],
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
}) {
  const context = useFormAutoScrollContext();
  const fieldIdRef = useRef(Symbol('form-field'));
  const prevInvalidRef = useRef(false);
  const previousAttemptRef = useRef(0);
  const registerField = context?.registerField;
  const updateField = context?.updateField;
  const unregisterField = context?.unregisterField;
  const requestScrollToFirstInvalid = context?.requestScrollToFirstInvalid;
  const validationAttempt = context?.validationAttempt ?? 0;

  React.useEffect(() => {
    const fieldId = fieldIdRef.current;
    registerField?.(fieldId, fieldRef);
    return () => unregisterField?.(fieldId);
  }, [fieldRef, registerField, unregisterField]);

  React.useEffect(() => {
    const nextInvalid = !!isInvalid;
    const becameInvalid = nextInvalid && !prevInvalidRef.current;
    const submitAttempted = nextInvalid && validationAttempt > previousAttemptRef.current;
    prevInvalidRef.current = nextInvalid;
    previousAttemptRef.current = validationAttempt;
    updateField?.(fieldIdRef.current, fieldRef, nextInvalid);

    if ((!becameInvalid && !submitAttempted) || !shouldAutoScroll) return;
    requestScrollToFirstInvalid?.();
  }, [
    fieldRef,
    isInvalid,
    requestScrollToFirstInvalid,
    shouldAutoScroll,
    updateField,
    validationAttempt,
  ]);
}
