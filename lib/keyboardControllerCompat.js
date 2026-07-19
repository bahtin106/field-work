import React from 'react';
import Constants from 'expo-constants';
import { Platform, ScrollView, StyleSheet } from 'react-native';

let keyboardControllerModule = null;
let keyboardAwareScrollViewModule = null;

const isExpoGo = Constants?.appOwnership === 'expo';

const canUseKeyboardController = !isExpoGo && (Platform.OS === 'ios' || Platform.OS === 'android');

if (canUseKeyboardController) {
  try {
    keyboardControllerModule = require('react-native-keyboard-controller');
  } catch {
    keyboardControllerModule = null;
  }
}

try {
  keyboardAwareScrollViewModule = require('react-native-keyboard-aware-scroll-view');
} catch {
  keyboardAwareScrollViewModule = null;
}

export const KeyboardProvider =
  keyboardControllerModule?.KeyboardProvider || (({ children }) => children);

const NativeKeyboardAwareScrollView = keyboardControllerModule?.KeyboardAwareScrollView || null;
const FallbackKeyboardAwareScrollView = keyboardAwareScrollViewModule?.KeyboardAwareScrollView || null;

function assignRef(ref, value) {
  if (typeof ref === 'function') {
    ref(value);
  } else if (ref && typeof ref === 'object') {
    ref.current = value;
  }
}

export const KeyboardAwareScrollView = React.forwardRef(function KeyboardAwareScrollViewCompat(
  props,
  ref,
) {
  const {
    bottomOffset = 20,
    extraKeyboardSpace = 0,
    enableAutomaticScroll,
    enableOnAndroid,
    enabled,
    enableFallbackAutomaticScroll = true,
    enableFallbackFocusedInputUpdate = true,
    usePlainScrollViewFallback = false,
    enableResetScrollToCoords,
    keyboardOpeningTime,
    keyboardShouldPersistTaps = 'always',
    onFocusCapture,
    onKeyboardDidShow,
    ...restProps
  } = props || {};
  const fallbackRef = React.useRef(null);
  const fallbackUpdateFrameRef = React.useRef(null);
  const resolvedEnabled =
    typeof enabled === 'boolean'
      ? enabled
      : typeof enableAutomaticScroll === 'boolean'
        ? enableAutomaticScroll
        : Platform.OS !== 'android' || enableOnAndroid !== false;
  const fallbackAutomaticScrollEnabled = resolvedEnabled && enableFallbackAutomaticScroll;

  const scheduleFallbackFocusedInputUpdate = React.useCallback(() => {
    if (!fallbackAutomaticScrollEnabled) return;
    if (fallbackUpdateFrameRef.current != null) {
      cancelAnimationFrame(fallbackUpdateFrameRef.current);
    }
    fallbackUpdateFrameRef.current = requestAnimationFrame(() => {
      fallbackUpdateFrameRef.current = null;
      fallbackRef.current?.update?.();
    });
  }, [fallbackAutomaticScrollEnabled]);
  const attachFallbackRef = React.useCallback(
    (instance) => {
      fallbackRef.current = instance;
      assignRef(ref, instance);
    },
    [ref],
  );

  React.useEffect(
    () => () => {
      if (fallbackUpdateFrameRef.current != null) {
        cancelAnimationFrame(fallbackUpdateFrameRef.current);
      }
    },
    [],
  );

  // Prefer the UI-thread controller. The legacy package relies on delayed JS
  // measurements and is kept only for Expo Go / missing native-module builds.
  if (NativeKeyboardAwareScrollView) {
    return React.createElement(NativeKeyboardAwareScrollView, {
      ref,
      bottomOffset,
      extraKeyboardSpace,
      enabled: resolvedEnabled,
      onFocusCapture,
      ...restProps,
      keyboardShouldPersistTaps,
    });
  }

  // Some legacy fallback paths still call React Native's deprecated
  // scrollResponderScrollNativeHandleToKeyboard API even when automatic
  // scrolling is disabled. A plain ScrollView is the safe Expo Go fallback
  // for modals that already resize themselves around the keyboard.
  if (usePlainScrollViewFallback) {
    return React.createElement(ScrollView, {
      ref,
      onFocusCapture,
      ...restProps,
      keyboardShouldPersistTaps,
    });
  }

  if (FallbackKeyboardAwareScrollView) {
    const contentContainerStyle = StyleSheet.flatten(restProps.contentContainerStyle);
    const extraScrollHeight = Number.isFinite(Number(bottomOffset)) ? Number(bottomOffset) : 0;
    const extraHeight = Number.isFinite(Number(extraKeyboardSpace)) ? Number(extraKeyboardSpace) : 0;
    return React.createElement(FallbackKeyboardAwareScrollView, {
      ref: attachFallbackRef,
      ...restProps,
      contentContainerStyle,
      enableOnAndroid: enableOnAndroid !== false,
      enableAutomaticScroll: fallbackAutomaticScrollEnabled,
      enableResetScrollToCoords: enableResetScrollToCoords ?? false,
      keyboardOpeningTime: keyboardOpeningTime ?? 0,
      extraHeight,
      extraScrollHeight,
      keyboardShouldPersistTaps,
      onFocusCapture: (event) => {
        onFocusCapture?.(event);
        if (enableFallbackFocusedInputUpdate) {
          scheduleFallbackFocusedInputUpdate();
        }
      },
      onKeyboardDidShow: (event) => {
        onKeyboardDidShow?.(event);
        if (enableFallbackFocusedInputUpdate) {
          scheduleFallbackFocusedInputUpdate();
        }
      },
    });
  }

  return React.createElement(ScrollView, {
    ref,
    ...restProps,
    keyboardShouldPersistTaps,
  });
});
