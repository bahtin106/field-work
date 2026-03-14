import React from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useTheme } from './ThemeProvider';

export function useCapsuleFeedback(opts = {}) {
  const {
    scaleIn = 0.98,
    tintTo = 0.12,
    inDuration = 80,
    outDuration = 140,
    spring = { speed: 20, bounciness: 8 },
    disabled = false,
  } = opts;

  const { theme } = useTheme();
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
    () => [{ transform: [{ scale }] }, disabled && { opacity: 0.5 }],
    [disabled, scale],
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
