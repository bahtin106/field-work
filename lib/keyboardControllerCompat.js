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

export const KeyboardAwareScrollView = React.forwardRef(function KeyboardAwareScrollViewCompat(
  props,
  ref,
) {
  const {
    bottomOffset,
    extraKeyboardSpace,
    ...restProps
  } = props || {};

  if (FallbackKeyboardAwareScrollView) {
    const contentContainerStyle = StyleSheet.flatten(restProps.contentContainerStyle);
    const extraScrollHeight = Number.isFinite(Number(bottomOffset)) ? Number(bottomOffset) : 0;
    const extraHeight = Number.isFinite(Number(extraKeyboardSpace)) ? Number(extraKeyboardSpace) : 0;
    const enableOnAndroid =
      typeof restProps.enableOnAndroid === 'boolean'
        ? restProps.enableOnAndroid
        : true;
    const enableAutomaticScroll =
      typeof restProps.enableAutomaticScroll === 'boolean'
        ? restProps.enableAutomaticScroll
        : true;

    return React.createElement(FallbackKeyboardAwareScrollView, {
      ref,
      ...restProps,
      contentContainerStyle,
      enableOnAndroid,
      enableAutomaticScroll,
      keyboardOpeningTime: 0,
      extraHeight,
      extraScrollHeight,
    });
  }

  if (NativeKeyboardAwareScrollView) {
    return React.createElement(NativeKeyboardAwareScrollView, { ref, ...props });
  }

  return React.createElement(ScrollView, { ref, ...restProps });
});
