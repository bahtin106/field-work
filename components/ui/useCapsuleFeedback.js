// components/ui/useCapsuleFeedback.js
import React from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * Premium press feedback for capsule buttons (e.g., Save in header)
 * - Safe: overlay uses pointerEvents="none" so it never блокирует нажатие
 * - Looks "дорого": мягкий spring scale + лёгкая цветная заливка из theme.colors.primary
 */
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
  }, [scale, tint, scaleIn, inDuration, disabled]);

  const onPressOut = React.useCallback(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, ...spring }),
      Animated.timing(tint, { toValue: 0, duration: outDuration, useNativeDriver: true }),
    ]).start();
  }, [scale, tint, spring, outDuration]);

  const containerStyle = React.useMemo(
    () => [ { transform: [{ scale }] }, disabled && { opacity: 0.5 } ],
    [scale, disabled]
  );

  const overlayStyle = React.useMemo(
    () => [
      StyleSheet.absoluteFillObject,
      { borderRadius: 999, backgroundColor: theme.colors.primary,
        opacity: tint.interpolate({ inputRange: [0, 1], outputRange: [0, tintTo] }),
      },
    ],
    [tint, theme.colors.primary, tintTo]
  );

  const contentStyle = React.useMemo(() => ({}), []);

  return { onPressIn, onPressOut, containerStyle, overlayStyle, contentStyle };
}
