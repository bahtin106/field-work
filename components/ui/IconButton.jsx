// components/ui/IconButton.jsx
import React, { useRef, useState } from "react";
import { Pressable, Animated, StyleSheet, Platform, Easing } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "../../theme";

export default function IconButton({
  onPress,
  style,
  size = 32,           // touch target (min 32/40)
  radius = "md",
  variant = "secondary", // secondary by default to match surface cards
  disabled,
  children,
  hitSlop = { top: 8, bottom: 8, left: 8, right: 8 },
  accessibilityLabel,
}) {
  const { theme } = useTheme();
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

  const palette = {
    primary: {
      bg: theme.colors.primary + "0A", // ~4% alpha
      border: theme.colors.primary + "4D",
    },
    secondary: {
      bg: theme.colors.surface,
      border: theme.colors.border,
    },
    ghost: { bg: "transparent", border: "transparent" },
  }[variant];

  const s = styles(theme, palette, size, radius, disabled);

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
      accessibilityLabel={accessibilityLabel}
      android_ripple={{ color: (theme.colors.primary + "1F"), borderless: true, radius: Math.ceil(size * 0.75) }}
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
          {success ? <Feather name="check" size={18} color={theme.colors.primary} /> : children}
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = (t, p, size, radius, disabled) =>
  StyleSheet.create({
    btn: { position: 'relative', overflow: 'hidden',
      minWidth: size,
      height: size,
      paddingHorizontal: 6,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: disabled ? (p.bg === "transparent" ? t.colors.surface : p.bg + "CC") : p.bg,
      borderRadius: t.radii[radius] ?? t.radii.md,
      borderWidth: p.border === "transparent" ? 0 : 1,
      borderColor: p.border,
      ...(p.bg === t.colors.surface
        ? Platform.OS === "ios"
          ? t.shadows.card.ios
          : t.shadows.card.android
        : null),
    },
    flash: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: t.colors.primary + '22', borderRadius: t.radii[radius] ?? t.radii.md },
    pulse: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: (p.bg === 'transparent' ? (t.colors.primary + '1A') : (t.colors.primary + '14')),
      borderRadius: t.radii[radius] ?? t.radii.md,
    },
  });
