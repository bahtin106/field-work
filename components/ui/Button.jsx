// components/ui/Button.jsx
import { useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
} from 'react-native';
import { useTheme } from '../../theme';

export default function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  style,
}) {
  const { theme } = useTheme();

  // iOS-like press animation: quick compress + subtle dim, spring back
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const onPressIn = () => {
    Animated.parallel([
      Animated.timing(scale, {
        toValue: 0.97,
        duration: 90,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0.9,
        duration: 90,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  };

  const onPressOut = () => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        speed: 20,
        bounciness: 8,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 140,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  };

  // ---- tokens from theme.components.button ----
  const buttonTokens = theme?.components?.button || {};

  const palettes = buttonTokens.palette || {
    primary: {
      bg: theme.colors.primary,
      fg: theme.colors.primaryTextOn,
      border: theme.colors.primary,
    },
    secondary: {
      bg: theme.colors.surface,
      fg: theme.colors.text,
      border: theme.colors.border,
    },
    ghost: { bg: 'transparent', fg: theme.colors.text, border: 'transparent' },
    destructive: {
      bg: theme.colors.danger,
      fg: theme.colors.primaryTextOn,
      border: theme.colors.danger,
    },
  };

  const sizesMap = buttonTokens.sizes || {
    md: {
      h: 48,
      f: theme.typography.sizes.md,
      pad: theme.spacing.md,
    },
    lg: {
      h: 56,
      f: theme.typography.sizes.lg,
      pad: theme.spacing.lg,
    },
  };

  const palette = palettes[variant] || palettes.primary;
  const sizes = sizesMap[size] || sizesMap.md;

  const s = styles(theme, palette, sizes, disabled || loading);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={1} // сами управляем opacity анимацией
      delayPressIn={0}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      pressRetentionOffset={{ top: 20, bottom: 20, left: 20, right: 20 }}
      accessibilityRole="button"
      disabled={disabled || loading}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
    >
      <Animated.View style={[{ transform: [{ scale }], opacity }, s.btn, style]}>
        {loading ? (
          <ActivityIndicator />
        ) : (
          <Text numberOfLines={1} style={s.title}>
            {title}
          </Text>
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = (t, p, sz, disabled) =>
  StyleSheet.create({
    btn: {
      height: sz.h,
      paddingHorizontal: sz.pad,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: disabled
        ? p.bg === 'transparent'
          ? (t.colors.surfaceAlt ?? t.colors.surface)
          : p.bg + '66'
        : p.bg,
      borderRadius: t.radii.lg,
      borderWidth: p.border === 'transparent' ? 0 : 1,
      borderColor: disabled ? t.colors.border + '66' : p.border,
      opacity: disabled ? 0.6 : 1,
      ...(p.bg === t.colors.surface
        ? Platform.OS === 'ios'
          ? t.shadows.card.ios
          : t.shadows.card.android
        : null),
    },
    title: {
      color: disabled ? p.fg + 'CC' : p.fg,
      fontSize: sz.f,
      fontWeight: t.typography.weight.semibold,
    },
  });
