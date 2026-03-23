import React from 'react';
import Constants from 'expo-constants';
import { Platform, ScrollView } from 'react-native';

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

export const KeyboardAwareScrollView = React.forwardRef(function KeyboardAwareScrollViewCompat(
  props,
  ref,
) {
  const {
    bottomOffset,
    extraKeyboardSpace,
    ...restProps
  } = props || {};

  if (NativeKeyboardAwareScrollView) {
    return React.createElement(NativeKeyboardAwareScrollView, { ref, ...props });
  }

  if (FallbackKeyboardAwareScrollView) {
    const extraScrollHeight =
      (Number.isFinite(Number(bottomOffset)) ? Number(bottomOffset) : 0) +
      (Number.isFinite(Number(extraKeyboardSpace)) ? Number(extraKeyboardSpace) : 0);

    return React.createElement(FallbackKeyboardAwareScrollView, {
      ref,
      ...restProps,
      enableOnAndroid: true,
      keyboardOpeningTime: 0,
      extraScrollHeight,
    });
  }

  return React.createElement(ScrollView, { ref, ...restProps });
});
