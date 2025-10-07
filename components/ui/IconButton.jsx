// components/ui/IconButton.jsx
import React, { useRef, useState } from "react";
import { Pressable, Animated, StyleSheet, Platform, Easing } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "../../theme";

// alpha utility (consistent with SelectModal): supports #RRGGBB and rgb(R,G,B)
function withAlpha(color, a) {
  if (typeof color === 'string') {
    const hex = color.match(/^#([0-9a-fA-F]{6})$/);
    if (hex) {
      const alpha = Math.round(Math.max(0, Math.min(1, a)) * 255)
        .toString(16)
        .padStart(2, '0');
      return color + alpha;
    }
    const rgb = color.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
    if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${a})`;
  }
  return `rgba(0,0,0,${a})`;
}

// Resolve palette entry from tokens. Token entries may be either a string color
// or an object { ref: 'primary' | '#RRGGBB', alpha?: 0..1 }.
const resolveTokenColor = (theme, token) => {
  if (!token) return null;
  if (typeof token === 'string') {
    if (theme.colors[token]) return theme.colors[token];
    return token; // assume literal
  }
  const base = resolveTokenColor(theme, token.ref || token.base || token.color) || theme.colors.primary;
  const alpha = typeof token.alpha === 'number' ? token.alpha : (typeof token.a === 'number' ? token.a : 1);
  return withAlpha(base, alpha);
};

export default function IconButton({
  onPress,
  style,
  size = "md",            // now accepts 'sm' | 'md' | 'lg' | number
  radius = "md",
  variant = "secondary",
  disabled,
  children,
  hitSlop = { top: 8, bottom: 8, left: 8, right: 8 },
  accessibilityLabel,
}) {
  const { theme } = useTheme();

  // --- Theming tokens (centralized) ---
  const iconTokens = theme?.components?.iconButton || {};
  const sizesMap = iconTokens.sizes || { sm: 28, md: 32, lg: 40 };
  const radiusMap = iconTokens.radius || { sm: "sm", md: "md", lg: "lg" };
  const paletteTokens = iconTokens.palette;

  // compute numeric touch size from tokens or explicit number
  const touchSize = typeof size === "number" ? size : (sizesMap[size] ?? sizesMap.md);
  const resolvedRadius = theme.radii[radius] ?? theme.radii[(typeof size === 'string' ? radiusMap[size] : 'md')] ?? theme.radii.md;

  // palette fallback if tokens are absent
  const fallbackPalette = {
    primary: {
      bg: withAlpha(theme.colors.primary, 10/255),
      border: withAlpha(theme.colors.primary, 77/255),
      ripple: withAlpha(theme.colors.primary, 31/255),
      flash: withAlpha(theme.colors.primary, 34/255),
      pulse: withAlpha(theme.colors.primary, 26/255),
      pulseFilled: withAlpha(theme.colors.primary, 20/255),
      icon: theme.colors.primary,
    },
    secondary: {
      bg: "transparent",
      border: "transparent",
      ripple: withAlpha(theme.colors.primary, 31/255),
      flash: withAlpha(theme.colors.primary, 34/255),
      pulse: withAlpha(theme.colors.primary, 26/255),
      pulseFilled: withAlpha(theme.colors.primary, 20/255),
      icon: (theme.mode === 'dark' ? theme.colors.text : undefined),
    },
    ghost: {
      bg: "transparent",
      border: "transparent",
      ripple: withAlpha(theme.colors.primary, 31/255),
      flash: withAlpha(theme.colors.primary, 34/255),
      pulse: withAlpha(theme.colors.primary, 26/255),
      pulseFilled: withAlpha(theme.colors.primary, 20/255),
      icon: (theme.mode === 'dark' ? theme.colors.text : undefined),
    },
  };

  const resolvePalette = (v) => {
    if (!paletteTokens || !paletteTokens[v]) return fallbackPalette[v] || fallbackPalette.secondary;
    const pt = paletteTokens[v];
    return {
      bg: resolveTokenColor(theme, pt.bg) ?? fallbackPalette[v]?.bg,
      border: resolveTokenColor(theme, pt.border) ?? fallbackPalette[v]?.border,
      ripple: resolveTokenColor(theme, pt.ripple) ?? fallbackPalette[v]?.ripple,
      flash: resolveTokenColor(theme, pt.flash) ?? fallbackPalette[v]?.flash,
      pulse: resolveTokenColor(theme, pt.pulse) ?? fallbackPalette[v]?.pulse,
      pulseFilled: resolveTokenColor(theme, pt.pulseFilled) ?? fallbackPalette[v]?.pulseFilled,
      icon: resolveTokenColor(theme, pt.icon) ?? fallbackPalette[v]?.icon,
    };
  };

  const palette = resolvePalette(variant);

  // --- Animations & haptics ---
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const rotate = useRef(new Animated.Value(0)).current; // 0..1
  const pulseScale = useRef(new Animated.Value(0)).current;
  const pulseOpacity = useRef(new Animated.Value(0)).current;
  const [success, setSuccess] = useState(false);
  const iconOpacity = useRef(new Animated.Value(1)).current;
  const iconScale = useRef(new Animated.Value(1)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;

  const onPressIn = () => {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch(e) {}
    // reset pulse
    pulseScale.setValue(0);
    pulseOpacity.setValue(0.2);
    Animated.parallel([
      Animated.timing(scale, { toValue: 0.94, duration: 80, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.85, duration: 80, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(rotate, { toValue: 1, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulseScale, { toValue: 1.6, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulseOpacity, { toValue: 0, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  };
  const onPressOut = () => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 8 }),
      Animated.timing(opacity, { toValue: 1, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(rotate, { toValue: 0, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  };

  const s = styles(theme, palette, touchSize, resolvedRadius, disabled);

  const handlePress = async () => {
    try {
      const res = onPress ? await onPress() : undefined;
      const ok = res === true || res === undefined; // treat undefined as success for backward compat
      if (ok) {
        try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch(e) {}
        setSuccess(true);
        // flash overlay
        flashOpacity.setValue(0.0);
        Animated.parallel([
          Animated.timing(flashOpacity, { toValue: 0.9, duration: 60, useNativeDriver: true }),
          Animated.sequence([
            Animated.parallel([
              Animated.timing(iconOpacity, { toValue: 0, duration: 80, useNativeDriver: true }),
              Animated.timing(iconScale, { toValue: 0.6, duration: 80, useNativeDriver: true }),
            ]),
            Animated.parallel([
              Animated.timing(iconOpacity, { toValue: 1, duration: 140, useNativeDriver: true }),
              Animated.spring(iconScale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 10 }),
            ]),
          ]),
        ]).start();
        // hide success after 900ms
        setTimeout(() => {
          Animated.parallel([
            Animated.timing(flashOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
            Animated.timing(iconOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
          ]).start(() => {
            setSuccess(false);
            Animated.timing(iconOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
          });
        }, 900);
      }
    } catch (e) {
      // ignore, parent likely shows toast
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={hitSlop}
      delayPressIn={0}
      disabled={disabled}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || (typeof children === 'string' ? children : undefined)}
      android_ripple={{ color: palette.ripple, borderless: true, radius: Math.ceil(touchSize * 0.75) }}
    >
      <Animated.View style={[
        { transform: [{ scale }, { rotate: rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-6deg'] }) }], opacity },
        s.btn,
        style,
      ]}>
        {/* pulse expansion overlay */}
        <Animated.View pointerEvents="none" style={[s.pulse, { transform: [{ scale: pulseScale }], opacity: pulseOpacity }]} />
        {/* success flash overlay */}
        <Animated.View pointerEvents="none" style={[s.flash, { opacity: flashOpacity }]} />
        {/* icon/content */}
        <Animated.View style={{ opacity: iconOpacity, transform: [{ scale: iconScale }] }}>
          {success
            ? <Feather name="check" size={18} color={theme.colors.primary} />
            : (React.isValidElement(children) && children.props?.color == null
                ? React.cloneElement(children, { color: palette.icon })
                : children)
          }
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = (t, p, size, radiusPx, disabled) =>
  StyleSheet.create({
    btn: { position: 'relative', overflow: 'hidden',
      minWidth: size,
      height: size,
      paddingHorizontal: 6,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: disabled ? (p.bg === "transparent" ? t.colors.surface : withAlpha(p.bg, 204/255)) : p.bg,
      borderRadius: radiusPx,
      borderWidth: p.border === "transparent" ? 0 : 1,
      borderColor: p.border,
      ...((p.bg === t.colors.surface || p.bg === (t.colors.button?.secondaryBg ?? ''))
        ? (Platform.OS === "ios" ? t.shadows.card.ios : t.shadows.card.android)
        : null),
    },
    flash: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: p.flash, borderRadius: radiusPx },
    pulse: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: (p.bg === 'transparent' ? p.pulse : p.pulseFilled),
      borderRadius: radiusPx,
    },
  });
