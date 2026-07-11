import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ensureVisibleField } from '../../../lib/ensureVisibleField';

const FormAutoScrollContext = createContext(null);
const DEFAULT_FORM_SCOPE = '__default-form-scope__';

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
  scopeKey = null,
}) {
  const lastScrollAtRef = useRef(0);
  const [validationAttemptsByScope, setValidationAttemptsByScope] = useState(() => new Map());
  const fieldsRef = useRef(new Map());
  const nextFieldOrderRef = useRef(0);
  const inputsRef = useRef(new Map());
  const nextInputOrderRef = useRef(0);
  const submitActionsRef = useRef(new Map());
  const nextSubmitActionOrderRef = useRef(0);
  const pendingScrollRef = useRef(null);
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;

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
      scopeKey: scopeKeyRef.current,
    });
  }, []);

  const updateField = useCallback((fieldId, fieldRef, isInvalid) => {
    if (!fieldId) return;
    const current = fieldsRef.current.get(fieldId);
    fieldsRef.current.set(fieldId, {
      fieldRef,
      isInvalid: isInvalid === true,
      order: current?.order ?? nextFieldOrderRef.current++,
      scopeKey: scopeKeyRef.current,
    });
  }, []);

  const unregisterField = useCallback((fieldId) => {
    fieldsRef.current.delete(fieldId);
  }, []);

  const registerInput = useCallback((inputId, inputRef, { disabled = false } = {}) => {
    if (!inputId) return;
    const current = inputsRef.current.get(inputId);
    inputsRef.current.set(inputId, {
      inputRef,
      disabled: disabled === true,
      order: current?.order ?? nextInputOrderRef.current++,
      scopeKey: scopeKeyRef.current,
    });
  }, []);

  const unregisterInput = useCallback((inputId) => {
    inputsRef.current.delete(inputId);
  }, []);

  const registerSubmitAction = useCallback((actionId, action, { disabled = false } = {}) => {
    if (!actionId || typeof action !== 'function') return;
    const current = submitActionsRef.current.get(actionId);
    submitActionsRef.current.set(actionId, {
      action,
      disabled: disabled === true,
      order: current?.order ?? nextSubmitActionOrderRef.current++,
      scopeKey: scopeKeyRef.current,
    });
  }, []);

  const unregisterSubmitAction = useCallback((actionId) => {
    submitActionsRef.current.delete(actionId);
  }, []);

  const focusNextInputOrSubmit = useCallback((inputId) => {
    const current = inputsRef.current.get(inputId);
    if (!current) return false;
    const nextInput = [...inputsRef.current.values()]
      .filter(
        (input) =>
          input.scopeKey === scopeKeyRef.current &&
          !input.disabled &&
          input.order > current.order &&
          input.inputRef?.current,
      )
      .sort((left, right) => left.order - right.order)[0];
    if (nextInput?.inputRef?.current?.focus) {
      nextInput.inputRef.current.focus();
      return true;
    }

    const submitAction = [...submitActionsRef.current.values()]
      .filter(
        (entry) =>
          entry.scopeKey === scopeKeyRef.current &&
          !entry.disabled &&
          typeof entry.action === 'function',
      )
      .sort((left, right) => right.order - left.order)[0];
    if (!submitAction) return false;
    submitAction.action();
    return true;
  }, []);

  const requestScrollToFirstInvalid = useCallback(() => {
    if (!enabled || pendingScrollRef.current) return;
    pendingScrollRef.current = setTimeout(async () => {
      pendingScrollRef.current = null;
      const invalidFields = [...fieldsRef.current.values()]
        .filter(
          (field) =>
            field?.scopeKey === scopeKeyRef.current &&
            field?.isInvalid &&
            field?.fieldRef?.current,
        );
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
    const activeScope = scopeKeyRef.current ?? DEFAULT_FORM_SCOPE;
    setValidationAttemptsByScope((current) => {
      const next = new Map(current);
      next.set(activeScope, Number(next.get(activeScope) || 0) + 1);
      return next;
    });
  }, []);

  const activeValidationScope = scopeKey ?? DEFAULT_FORM_SCOPE;
  const internalValidationAttempt = Number(
    validationAttemptsByScope.get(activeValidationScope) || 0,
  );
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
      inputsRef.current.clear();
      submitActionsRef.current.clear();
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
      registerInput,
      unregisterInput,
      registerSubmitAction,
      unregisterSubmitAction,
      focusNextInputOrSubmit,
    }),
    [
      enabled,
      beginValidationAttempt,
      effectiveValidationAttempt,
      registerField,
      requestScrollToField,
      requestScrollToFirstInvalid,
      unregisterField,
      registerInput,
      unregisterInput,
      registerSubmitAction,
      unregisterSubmitAction,
      focusNextInputOrSubmit,
      updateField,
    ],
  );

  return <FormAutoScrollContext.Provider value={value}>{children}</FormAutoScrollContext.Provider>;
}

export function useFormAutoScrollContext() {
  return useContext(FormAutoScrollContext);
}

export function useValidationAttemptSinceMount(validationAttempt = 0) {
  const normalizedAttempt = Math.max(0, Number(validationAttempt) || 0);
  const initialAttemptRef = useRef(normalizedAttempt);
  return normalizedAttempt > initialAttemptRef.current;
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
