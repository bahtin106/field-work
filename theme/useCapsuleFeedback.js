import React from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useTheme } from './ThemeProvider';

export function useCapsuleFeedback(opts = {}) {
  const { theme } = useTheme();
  const interactive = theme.components?.interactive || {};
  const scaleIn = opts.scaleIn ?? interactive.pressedScale ?? 0.98;
  const tintTo = opts.tintTo ?? interactive.pressedTint ?? 0.12;
  const inDuration = opts.inDuration ?? interactive.pressInDuration ?? 80;
  const outDuration = opts.outDuration ?? interactive.pressOutDuration ?? 140;
  const spring = React.useMemo(
    () => opts.spring ?? { speed: 20, bounciness: 8 },
    [opts.spring],
  );
  const disabled = opts.disabled ?? false;
  const scale = React.useRef(new Animated.Value(1)).current;
  const tint = React.useRef(new Animated.Value(0)).current;

  const onPressIn = React.useCallback(() => {
    if (disabled) return;
    Animated.parallel([
      Animated.timing(scale, { toValue: scaleIn, duration: inDuration, useNativeDriver: true }),
      Animated.timing(tint, { toValue: 1, duration: inDuration + 20, useNativeDriver: true }),
    ]).start();
  }, [disabled, inDuration, scale, scaleIn, tint]);

  const onPressOut = React.useCallback(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, ...spring }),
      Animated.timing(tint, { toValue: 0, duration: outDuration, useNativeDriver: true }),
    ]).start();
  }, [outDuration, scale, spring, tint]);

  const containerStyle = React.useMemo(
    () => [
      { transform: [{ scale }] },
      disabled && { opacity: interactive.disabledOpacity ?? 0.5 },
    ],
    [disabled, interactive.disabledOpacity, scale],
  );

  const overlayStyle = React.useMemo(
    () => [
      StyleSheet.absoluteFillObject,
      {
        borderRadius: 999,
        backgroundColor: theme.colors.primary,
        opacity: tint.interpolate({ inputRange: [0, 1], outputRange: [0, tintTo] }),
      },
    ],
    [theme.colors.primary, tint, tintTo],
  );

  const contentStyle = React.useMemo(() => ({}), []);

  return { onPressIn, onPressOut, containerStyle, overlayStyle, contentStyle };
}
