import React from 'react';
import Constants from 'expo-constants';
import {
  Keyboard,
  KeyboardAvoidingView as ReactNativeKeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
} from 'react-native';

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
// Expo SDK 54 pins controller 1.18.5, whose frame-by-frame KAV animation can
// miss its final iOS update. React Native's KAV resets from native keyboard
// notifications; keep the controller implementation unchanged on Android.
export const KeyboardAvoidingView =
  Platform.OS === 'ios'
    ? ReactNativeKeyboardAvoidingView
    : keyboardControllerModule?.KeyboardAvoidingView || ReactNativeKeyboardAvoidingView;
export const SMOOTH_KEYBOARD_DISMISS_MODE =
  Platform.OS === 'ios' ? 'interactive' : 'on-drag';

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
    keyboardDismissMode = SMOOTH_KEYBOARD_DISMISS_MODE,
    disableScrollOnKeyboardHide = false,
    onScroll,
    onFocusCapture,
    onBlurCapture,
    onKeyboardDidShow,
    ...restProps
  } = props || {};
  const fallbackRef = React.useRef(null);
  const fallbackUpdateFrameRef = React.useRef(null);
  const fallbackOwnsFocusRef = React.useRef(false);
  const iosScrollYRef = React.useRef(0);
  const iosPreKeyboardScrollYRef = React.useRef(null);
  const iosOwnsFocusRef = React.useRef(false);
  const iosRestoreFrameRef = React.useRef(null);
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
  const cancelIOSScrollRestore = React.useCallback(() => {
    if (iosRestoreFrameRef.current != null) {
      cancelAnimationFrame(iosRestoreFrameRef.current);
      iosRestoreFrameRef.current = null;
    }
  }, []);
  const restoreIOSScrollPosition = React.useCallback(() => {
    cancelIOSScrollRestore();
    iosRestoreFrameRef.current = requestAnimationFrame(() => {
      iosRestoreFrameRef.current = requestAnimationFrame(() => {
        iosRestoreFrameRef.current = null;
        const restoreY = iosPreKeyboardScrollYRef.current;
        iosPreKeyboardScrollYRef.current = null;
        if (!Number.isFinite(restoreY)) return;
        if (Math.abs(iosScrollYRef.current - restoreY) < 0.5) return;
        fallbackRef.current?.scrollTo?.({ x: 0, y: restoreY, animated: false });
        iosScrollYRef.current = restoreY;
      });
    });
  }, [cancelIOSScrollRestore]);
  const handleNativeScroll = React.useCallback(
    (event) => {
      if (Platform.OS === 'ios') {
        const scrollY = Number(event?.nativeEvent?.contentOffset?.y);
        if (Number.isFinite(scrollY)) {
          iosScrollYRef.current = scrollY;
        }
      }
      onScroll?.(event);
    },
    [onScroll],
  );
  const handleNativeFocusCapture = React.useCallback(
    (event) => {
      if (
        Platform.OS === 'ios' &&
        resolvedEnabled &&
        !disableScrollOnKeyboardHide &&
        iosPreKeyboardScrollYRef.current == null
      ) {
        iosPreKeyboardScrollYRef.current = iosScrollYRef.current;
      }
      iosOwnsFocusRef.current = Platform.OS === 'ios';
      onFocusCapture?.(event);
    },
    [disableScrollOnKeyboardHide, onFocusCapture, resolvedEnabled],
  );
  const handleNativeBlurCapture = React.useCallback(
    (event) => {
      iosOwnsFocusRef.current = false;
      onBlurCapture?.(event);
    },
    [onBlurCapture],
  );

  React.useEffect(
    () => () => {
      if (fallbackUpdateFrameRef.current != null) {
        cancelAnimationFrame(fallbackUpdateFrameRef.current);
      }
      cancelIOSScrollRestore();
      iosPreKeyboardScrollYRef.current = null;
      iosOwnsFocusRef.current = false;
      fallbackOwnsFocusRef.current = false;
    },
    [cancelIOSScrollRestore],
  );
  React.useEffect(() => {
    if (!fallbackAutomaticScrollEnabled) {
      fallbackOwnsFocusRef.current = false;
    }
  }, [fallbackAutomaticScrollEnabled]);

  React.useEffect(() => {
    if (
      Platform.OS !== 'ios' ||
      !NativeKeyboardAwareScrollView ||
      !resolvedEnabled ||
      disableScrollOnKeyboardHide
    ) {
      iosPreKeyboardScrollYRef.current = null;
      iosOwnsFocusRef.current = false;
      cancelIOSScrollRestore();
      return undefined;
    }

    const keyboardWillShow = Keyboard.addListener('keyboardWillShow', () => {
      const interruptedRestore = iosRestoreFrameRef.current != null;
      cancelIOSScrollRestore();
      if (
        iosOwnsFocusRef.current &&
        (iosPreKeyboardScrollYRef.current == null || interruptedRestore)
      ) {
        iosPreKeyboardScrollYRef.current = iosScrollYRef.current;
      }
    });
    const keyboardDidShow = Keyboard.addListener('keyboardDidShow', (event) => {
      onKeyboardDidShow?.(event);
    });
    const keyboardDidHide = Keyboard.addListener('keyboardDidHide', () => {
      restoreIOSScrollPosition();
    });

    return () => {
      keyboardWillShow.remove();
      keyboardDidShow.remove();
      keyboardDidHide.remove();
      cancelIOSScrollRestore();
    };
  }, [
    cancelIOSScrollRestore,
    disableScrollOnKeyboardHide,
    onKeyboardDidShow,
    resolvedEnabled,
    restoreIOSScrollPosition,
  ]);

  // Controller 1.18.5 restores the pre-keyboard offset only from animation
  // move events, which iOS may omit. Reconcile after didHide, once its spacer
  // has been removed, without changing the Android animation path.
  // Prefer the UI-thread controller. The legacy package relies on delayed JS
  // measurements and is kept only for Expo Go / missing native-module builds.
  if (NativeKeyboardAwareScrollView) {
    return React.createElement(NativeKeyboardAwareScrollView, {
      ref: Platform.OS === 'ios' ? attachFallbackRef : ref,
      bottomOffset,
      extraKeyboardSpace,
      enabled: resolvedEnabled,
      disableScrollOnKeyboardHide,
      onScroll: Platform.OS === 'ios' ? handleNativeScroll : onScroll,
      onFocusCapture: Platform.OS === 'ios' ? handleNativeFocusCapture : onFocusCapture,
      onBlurCapture: Platform.OS === 'ios' ? handleNativeBlurCapture : onBlurCapture,
      ...restProps,
      keyboardShouldPersistTaps,
      keyboardDismissMode,
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
      onBlurCapture,
      ...restProps,
      keyboardShouldPersistTaps,
      keyboardDismissMode,
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
      keyboardDismissMode,
      onFocusCapture: (event) => {
        fallbackOwnsFocusRef.current = true;
        onFocusCapture?.(event);
        if (enableFallbackFocusedInputUpdate) {
          scheduleFallbackFocusedInputUpdate();
        }
      },
      onBlurCapture: (event) => {
        fallbackOwnsFocusRef.current = false;
        onBlurCapture?.(event);
      },
      onKeyboardDidShow: (event) => {
        onKeyboardDidShow?.(event);
        if (enableFallbackFocusedInputUpdate && fallbackOwnsFocusRef.current) {
          scheduleFallbackFocusedInputUpdate();
        }
      },
    });
  }

  return React.createElement(ScrollView, {
    ref,
    onFocusCapture,
    onBlurCapture,
    ...restProps,
    keyboardShouldPersistTaps,
    keyboardDismissMode,
  });
});
