// components/ui/Button.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { withAlpha } from '../../theme/colors';
import { useFormAutoScrollContext } from '../../src/shared/forms/FormAutoScrollContext';
import {
  dismissKeyboardBeforeAction,
  prepareFormSubmit,
} from '../../src/shared/forms/prepareFormSubmit';

export default function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  style,
  containerStyle,
  textStyle,
  accessibilityLabel,
  formSubmit = false,
  dismissKeyboardOnPress = false,
  onPressIn: onPressInProp,
}) {
  const { theme } = useTheme();
  const formContext = useFormAutoScrollContext();
  const [autoLoading, setAutoLoading] = useState(false);
  const mountedRef = useRef(true);
  const pressLockedRef = useRef(false);

  const buttonTokens = useMemo(() => theme?.components?.button || {}, [theme]);

  // Shared press feedback is driven by the same tokens for every button variant.
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const busy = !!loading || autoLoading;
  const isDisabled = !!disabled || busy;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pressLockedRef.current = false;
    };
  }, []);

  const onPressIn = () => {
    try {
      onPressInProp?.();
    } catch {}
    Animated.parallel([
      Animated.timing(scale, {
        toValue: buttonTokens.pressedScale ?? 0.97,
        duration: buttonTokens.pressInDuration ?? 90,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: buttonTokens.pressedOpacity ?? 0.9,
        duration: buttonTokens.pressInDuration ?? 90,
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
        duration: buttonTokens.pressOutDuration ?? 140,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  };

  useEffect(() => {
    scale.setValue(1);
    opacity.setValue(1);

    return () => {
      try {
        scale.stopAnimation();
        opacity.stopAnimation();
        scale.setValue(1);
        opacity.setValue(1);
      } catch {}
    };
  }, [opacity, scale, isDisabled]);

  const palettes = buttonTokens.palette || {
    primary: {
      bg: theme.colors.primary,
      fg: theme.colors.primaryTextOn,
      border: theme.colors.primary,
    },
    secondary: {
      bg: theme.colors.button?.secondaryBg ?? theme.colors.surface,
      fg: theme.colors.text,
      border: theme.colors.border,
    },
    outline: {
      bg: theme.colors.surface,
      fg: theme.colors.button?.primaryBg ?? theme.colors.primary,
      border: theme.colors.button?.primaryBg ?? theme.colors.primary,
    },
    ghost: { bg: theme.colors.surface, fg: theme.colors.text, border: theme.colors.border },
    destructive: {
      bg: theme.colors.danger,
      fg: theme.colors.primaryTextOn,
      border: theme.colors.danger,
    },
  };

  const sizesMap = buttonTokens.sizes || {
    sm: {
      h: 40,
      f: theme.typography.sizes.sm,
      pad: theme.spacing.md,
    },
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

  const normalizedVariant = variant === 'danger' ? 'destructive' : variant;
  const palette = palettes[normalizedVariant] || palettes.primary;
  const sizes = sizesMap[size] || sizesMap.md;
  const spinnerColor = palette.fg;

  const s = useMemo(
    () => styles(theme, buttonTokens, palette, sizes, isDisabled),
    [buttonTokens, isDisabled, palette, sizes, theme],
  );
  const handlePress = () => {
    if (isDisabled || pressLockedRef.current) return;
    if (formSubmit) prepareFormSubmit(formContext);
    else if (dismissKeyboardOnPress) dismissKeyboardBeforeAction();
    const result = onPress?.();
    if (result && typeof result.then === 'function') {
      pressLockedRef.current = true;
      setAutoLoading(true);
      Promise.resolve(result).then(
        () => {
          pressLockedRef.current = false;
          if (mountedRef.current) setAutoLoading(false);
        },
        () => {
          pressLockedRef.current = false;
          if (mountedRef.current) setAutoLoading(false);
        },
      );
    }
  };

  return (
    <TouchableOpacity
      style={containerStyle}
      onPress={handlePress}
      activeOpacity={1} // сами управляем opacity анимацией
      delayPressIn={0}
      hitSlop={buttonTokens.hitSlop ?? 8}
      pressRetentionOffset={buttonTokens.pressRetentionOffset ?? 20}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: isDisabled, busy }}
      disabled={isDisabled}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
    >
      <Animated.View style={[{ transform: [{ scale }], opacity }, s.btn, style]}>
        {busy ? (
          <>
            <Text numberOfLines={1} style={[s.title, textStyle, s.hiddenTitle]}>
              {title}
            </Text>
            <ActivityIndicator
              size="small"
              color={spinnerColor}
              style={s.spinner}
            />
          </>
        ) : (
          <Text numberOfLines={1} style={[s.title, textStyle]}>
            {title}
          </Text>
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = (t, tokens, p, sz, disabled) =>
  StyleSheet.create({
    btn: {
      height: sz.h,
      paddingHorizontal: sz.pad,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: disabled
        ? p.bg === 'transparent'
          ? (t.colors.surfaceAlt ?? t.colors.surface)
          : withAlpha(p.bg, tokens.disabledOpacity ?? 0.5)
        : p.bg,
      borderRadius: tokens.radius ?? t.radii.lg,
      borderWidth: p.border === 'transparent' ? 0 : (tokens.borderWidth ?? 1),
      borderColor: disabled
        ? withAlpha(p.border === 'transparent' ? t.colors.border : p.border, tokens.disabledOpacity ?? 0.5)
        : p.border,
      opacity: disabled ? tokens.disabledOpacity ?? 0.5 : 1,
      ...(p.bg === t.colors.surface
        ? Platform.OS === 'ios'
          ? t.shadows.card.ios
          : t.shadows.card.android
        : null),
    },
    title: {
      color: disabled ? withAlpha(p.fg, 0.8) : p.fg,
      fontSize: sz.f,
      fontWeight: t.typography.weight.semibold,
    },
    hiddenTitle: {
      opacity: 0,
    },
    spinner: {
      position: 'absolute',
      alignSelf: 'center',
    },
  });
