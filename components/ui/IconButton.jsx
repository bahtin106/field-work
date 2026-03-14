// components/ui/IconButton.jsx
import React, { useEffect, useRef } from 'react';
import { Pressable, Animated, StyleSheet, Platform, Easing, Keyboard } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../theme';
import { withAlpha } from '../../theme/colors';

const resolveTokenColor = (theme, token) => {
  if (!token) return null;
  if (typeof token === 'string') {
    if (theme.colors[token]) return theme.colors[token];
    return token;
  }
  const base =
    resolveTokenColor(theme, token.ref || token.base || token.color) || theme.colors.primary;
  const alpha =
    typeof token.alpha === 'number' ? token.alpha : typeof token.a === 'number' ? token.a : 1;
  return withAlpha(base, alpha);
};

export default function IconButton({
  onPress,
  style,
  size = 'md',
  radius = 'md',
  variant = 'secondary',
  disabled,
  children,
  hitSlop = { top: 8, bottom: 8, left: 8, right: 8 },
  accessibilityLabel,
}) {
  const { theme } = useTheme();

  const iconTokens = theme?.components?.iconButton || {};
  const sizesMap = iconTokens.sizes || { sm: 28, md: 32, lg: 40 };
  const radiusMap = iconTokens.radius || { sm: 'sm', md: 'md', lg: 'lg' };
  const paletteTokens = iconTokens.palette;

  const touchSize = typeof size === 'number' ? size : (sizesMap[size] ?? sizesMap.md);
  const resolvedRadius =
    theme.radii[radius] ??
    theme.radii[typeof size === 'string' ? radiusMap[size] : 'md'] ??
    theme.radii.md;

  const fallbackPalette = {
    primary: {
      bg: withAlpha(theme.colors.primary, 10 / 255),
      border: withAlpha(theme.colors.primary, 77 / 255),
      ripple: withAlpha(theme.colors.primary, 31 / 255),
      icon: theme.colors.primary,
    },
    secondary: {
      bg: 'transparent',
      border: 'transparent',
      ripple: withAlpha(theme.colors.primary, 31 / 255),
      icon: theme.mode === 'dark' ? theme.colors.text : undefined,
    },
    ghost: {
      bg: 'transparent',
      border: 'transparent',
      ripple: withAlpha(theme.colors.primary, 31 / 255),
      icon: theme.mode === 'dark' ? theme.colors.text : undefined,
    },
  };

  const resolvePalette = (v) => {
    if (!paletteTokens || !paletteTokens[v]) return fallbackPalette[v] || fallbackPalette.secondary;
    const pt = paletteTokens[v];
    return {
      bg: resolveTokenColor(theme, pt.bg) ?? fallbackPalette[v]?.bg,
      border: resolveTokenColor(theme, pt.border) ?? fallbackPalette[v]?.border,
      ripple: resolveTokenColor(theme, pt.ripple) ?? fallbackPalette[v]?.ripple,
      icon: resolveTokenColor(theme, pt.icon) ?? fallbackPalette[v]?.icon,
    };
  };

  const palette = resolvePalette(variant);

  const scale = useRef(new Animated.Value(1)).current;
  const baseOpacity = useRef(new Animated.Value(1)).current;
  const baseScale = useRef(new Animated.Value(1)).current;
  const checkOpacity = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0.7)).current;
  const successTimerRef = useRef(null);

  const onPressIn = () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
    Animated.timing(scale, {
      toValue: 0.94,
      duration: 80,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };
  const onPressOut = () => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 8 }).start();
  };

  useEffect(() => {
    return () => {
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
        successTimerRef.current = null;
      }
    };
  }, []);

  const s = styles(theme, palette, touchSize, resolvedRadius, disabled);

  const handlePress = async () => {
    try {
      try {
        Keyboard.dismiss();
      } catch {}
      const res = onPress ? await onPress() : undefined;
      const ok = res === true || res === undefined;
      if (ok) {
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } catch {}

        Animated.parallel([
          Animated.timing(baseOpacity, {
            toValue: 0,
            duration: 120,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(baseScale, {
            toValue: 0.7,
            duration: 120,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ]).start(() => {
          Animated.parallel([
            Animated.timing(checkOpacity, {
              toValue: 1,
              duration: 180,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.spring(checkScale, {
              toValue: 1.05,
              speed: 14,
              bounciness: 12,
              useNativeDriver: true,
            }),
          ]).start();
        });

        if (successTimerRef.current) {
          clearTimeout(successTimerRef.current);
          successTimerRef.current = null;
        }

        successTimerRef.current = setTimeout(() => {
          Animated.parallel([
            Animated.timing(checkOpacity, {
              toValue: 0,
              duration: 180,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(checkScale, {
              toValue: 0.8,
              duration: 180,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
          ]).start(() => {
            Animated.parallel([
              Animated.timing(baseOpacity, {
                toValue: 1,
                duration: 180,
                easing: Easing.out(Easing.quad),
                useNativeDriver: true,
              }),
              Animated.spring(baseScale, {
                toValue: 1,
                useNativeDriver: true,
              }),
            ]).start(() => {
              successTimerRef.current = null;
            });
          });
        }, 1800);
      }
    } catch {}
  };

  const renderedChildren =
    React.isValidElement(children) && children.props?.color == null
      ? React.cloneElement(children, { color: palette.icon })
      : children;

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={hitSlop}
      delayPressIn={0}
      disabled={disabled}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityLabel={
        accessibilityLabel || (typeof children === 'string' ? children : undefined)
      }
      android_ripple={{
        color: palette.ripple,
        borderless: true,
        radius: Math.ceil(touchSize * 0.75),
      }}
    >
      <Animated.View style={[{ transform: [{ scale }] }, s.btn, style]}>
        <Animated.View
          pointerEvents="none"
          style={[s.iconLayer, { opacity: baseOpacity, transform: [{ scale: baseScale }] }]}
        >
          {renderedChildren}
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[s.iconLayer, { opacity: checkOpacity, transform: [{ scale: checkScale }] }]}
        >
          <Feather name="check" size={18} color={theme.colors.primary} />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = (t, p, size, radiusPx, disabled) =>
  StyleSheet.create({
    btn: {
      position: 'relative',
      overflow: 'hidden',
      minWidth: size,
      height: size,
      paddingHorizontal: 6,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: disabled
        ? p.bg === 'transparent'
          ? t.colors.surface
          : withAlpha(p.bg, 204 / 255)
        : p.bg,
      borderRadius: radiusPx,
      borderWidth: p.border === 'transparent' ? 0 : 1,
      borderColor: p.border,
      ...(p.bg === t.colors.surface || p.bg === (t.colors.button?.secondaryBg ?? '')
        ? Platform.OS === 'ios'
          ? t.shadows.card.ios
          : t.shadows.card.android
        : null),
    },
    iconLayer: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
