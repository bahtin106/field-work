// theme/ThemeProvider.jsx
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { Appearance, Animated } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { tokens } from './tokens';

const STORAGE_KEY = 'THEME_MODE_V2';

function buildTheme(mode) {
  const effective = mode === 'system' ? (Appearance.getColorScheme?.() || 'light') : mode;
  const base = effective === 'dark' ? tokens.dark : tokens.light;

  const colors = {
    background: base.colors.background ?? base.colors.bg ?? '#FFFFFF',
    surface: base.colors.surface ?? base.colors.card ?? '#FFFFFF',
    text: base.colors.text ?? '#0A0A0A',
    textSecondary: base.colors.textSecondary ?? '#6B7280',
    primary: base.colors.primary ?? base.colors.accent ?? '#007AFF',
    onPrimary: base.colors.onPrimary ?? base.colors.primaryTextOn ?? '#FFFFFF',
    primaryTextOn: base.colors.primaryTextOn ?? base.colors.onPrimary ?? '#FFFFFF',
    border: base.colors.border ?? '#E5E7EB',
    inputBg: base.colors.inputBg ?? base.colors.surface ?? '#FFFFFF',
    inputBorder: base.colors.inputBorder ?? base.colors.border ?? '#E5E7EB',
    placeholder: base.colors.inputPlaceholder ?? base.colors.textSecondary ?? '#9CA3AF',
    inputPlaceholder: base.colors.inputPlaceholder ?? base.colors.textSecondary ?? '#9CA3AF',
    overlay: base.colors.overlay ?? 'rgba(0,0,0,0.35)',
    success: base.colors.success,
    warning: base.colors.warning,
    danger: base.colors.danger,
    worker: base.colors.worker ?? '#5856D6',
    bg: base.colors.background ?? base.colors.bg,
    card: (base.colors.card ?? base.colors.surface) ?? '#FFFFFF',
    accent: base.colors.primary ?? base.colors.accent,
    accentTextOn: base.colors.onPrimary ?? base.colors.primaryTextOn,
    navbar: base.colors.navbar ?? base.colors.surface,
    ripple: base.colors.ripple ?? (effective === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'),
  };

  const normalizedShadows = {
    card:
      base.shadows?.card ??
      {
        ios: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
        android: { elevation: 2 },
      },
    level1: base.shadows?.card ?? {},
    level2: base.shadows?.raised ?? {},
    ...(base.shadows || {}),
  };

  const typography = {
    sizes: {
      xs: base.typography?.sizes?.xs ?? 11,
      sm: base.typography?.sizes?.sm ?? 13,
      md: base.typography?.sizes?.md ?? 15,
      lg: base.typography?.sizes?.lg ?? 17,
      xl: base.typography?.sizes?.xl ?? 20,
      xxl: base.typography?.sizes?.xxl ?? 24,
      display: base.typography?.sizes?.display ?? 34,
    },
    fontFamily: base.typography?.fontFamily,
    weight: {
      regular: base.typography?.weight?.regular ?? '400',
      medium: base.typography?.weight?.medium ?? '500',
      semibold: base.typography?.weight?.semibold ?? '600',
      bold: base.typography?.weight?.bold ?? '700',
    },
  };

  const radii = {
    xs: base.radii?.xs ?? 6,
    sm: base.radii?.sm ?? 8,
    md: base.radii?.md ?? 12,
    lg: base.radii?.lg ?? 16,
    xl: base.radii?.xl ?? 24,
    pill: base.radii?.pill ?? 999,
  };

  const spacing = {
    xs: base.spacing?.xs ?? 6,
    sm: base.spacing?.sm ?? 8,
    md: base.spacing?.md ?? 12,
    lg: base.spacing?.lg ?? 16,
    xl: base.spacing?.xl ?? 20,
    xxl: base.spacing?.xxl ?? 24,
  };

  return {
    mode: effective,
    colors,
    shadows: normalizedShadows,
    typography,
    radii,
    spacing,
    _raw: base,
  };
}

const ThemeContext = createContext({
  theme: buildTheme('light'),
  mode: 'light',
  setMode: (_m) => {},
  toggle: () => {},
});

export const ThemeProvider = ({ children }) => {
  const [mode, setMode] = useState('light');
  const [hydrated, setHydrated] = useState(false);
  const [, force] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (alive && (saved === 'light' || saved === 'dark' || saved === 'system')) {
          setMode(saved);
        }
      } finally {
        if (alive) setHydrated(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, mode).catch(() => {});
  }, [mode]);

  useEffect(() => {
    if (mode !== 'system') return;
    const sub = Appearance.addChangeListener(() => {
      force((n) => n + 1);
    });
    return () => sub?.remove?.();
  }, [mode]);

  const theme = useMemo(() => buildTheme(mode), [mode]);

  const toggle = useCallback(() => {
    setMode((m) => (m === 'light' ? 'dark' : 'light'));
  }, []);

  return <ThemeContext.Provider value={{ theme, mode, setMode, toggle }}>{children}</ThemeContext.Provider>;
};

export function useCapsuleFeedback(opts = {}) {
  const {
    scaleIn = 0.98,
    tintTo = 0.12,
    inDuration = 90,
    outDuration = 140,
    spring = { speed: 20, bounciness: 8 },
  } = opts;

  const { theme } = useTheme();
  const scale = React.useRef(new Animated.Value(1)).current;
  const tint = React.useRef(new Animated.Value(0)).current;

  const onPressIn = React.useCallback(() => {
    Animated.parallel([
      Animated.timing(scale, { toValue: scaleIn, duration: inDuration, useNativeDriver: true }),
      Animated.timing(tint, { toValue: 1, duration: inDuration + 30, useNativeDriver: true }),
    ]).start();
  }, [scale, tint, scaleIn, inDuration]);

  const onPressOut = React.useCallback(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, ...spring }),
      Animated.timing(tint, { toValue: 0, duration: outDuration, useNativeDriver: true }),
    ]).start();
  }, [scale, tint, spring, outDuration]);

  // Готовые стили для капсулы: бордер и оверлей — от темы
  const containerStyle = React.useMemo(() => ({
    transform: [{ scale }],
    borderColor: theme.colors.primary + '55',
  }), [scale, theme.colors.primary]);

  const overlayStyle = React.useMemo(() => ({
    backgroundColor: theme.colors.primary,
    opacity: tint.interpolate({ inputRange: [0, 1], outputRange: [0, tintTo] }),
  }), [tint, theme.colors.primary, tintTo]);

  return { onPressIn, onPressOut, containerStyle, overlayStyle };
}
export const useTheme = () => useContext(ThemeContext);
