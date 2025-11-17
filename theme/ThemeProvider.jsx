// theme/ThemeProvider.jsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance } from 'react-native';
import { tokens } from './tokens';

const STORAGE_KEY = 'THEME_MODE_V2';

// Mix two HEX colors (like CSS overlay but returns opaque color). ratio is 0..1 of top color.
function mixHexColors(baseHex, topHex, ratio = 0.08) {
  try {
    const toRGB = (h) => {
      const m = String(h || '')
        .trim()
        .match(/^#?([0-9a-fA-F]{6})$/);
      if (!m) return null;
      const n = parseInt(m[1], 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    };
    const b = toRGB(baseHex);
    const t = toRGB(topHex);
    if (!b || !t) return baseHex || topHex;
    const k = Math.max(0, Math.min(1, Number(ratio)));
    const r = Math.round(b.r * (1 - k) + t.r * k);
    const g = Math.round(b.g * (1 - k) + t.g * k);
    const bch = Math.round(b.b * (1 - k) + t.b * k);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + bch).toString(16).slice(1).toUpperCase();
  } catch {
    return baseHex;
  }
}

function buildTheme(mode) {
  const effective = mode === 'system' ? Appearance.getColorScheme?.() || 'light' : mode;
  const base = effective === 'dark' ? tokens.dark : tokens.light;

  const colors = {
    background: base.colors.background ?? base.colors.bg ?? '#FFFFFF',
    surface: base.colors.surface ?? base.colors.card ?? '#FFFFFF',
    // Opaque blend for suspended cards: mix surface with danger at ~8%
    surfaceMutedDanger: mixHexColors(
      base.colors.surface ?? base.colors.card ?? '#FFFFFF',
      base.colors.danger ?? '#FF3B30',
      0.08,
    ),
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
    overlayNavBar: base.colors.overlayNavBar ?? base.colors.overlay ?? 'rgba(0,0,0,0.35)',
    success: base.colors.success,
    warning: base.colors.warning,
    danger: base.colors.danger,
    worker: base.colors.worker ?? '#5856D6',
    bg: base.colors.background ?? base.colors.bg,
    card: base.colors.card ?? base.colors.surface ?? '#FFFFFF',
    accent: base.colors.primary ?? base.colors.accent,
    accentTextOn: base.colors.onPrimary ?? base.colors.primaryTextOn,
    navigationBarBg: base.colors.navigationBarBg ?? base.colors.navbar ?? base.colors.surface,
    navbar: base.colors.navbar ?? base.colors.navigationBarBg ?? base.colors.surface,
    ripple:
      base.colors.ripple ?? (effective === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'),
    button: {
      primaryBg: base.colors.button?.primaryBg ?? base.colors.primary ?? '#007AFF',
      primaryText: base.colors.button?.primaryText ?? base.colors.onPrimary ?? '#FFFFFF',
      secondaryBg:
        base.colors.button?.secondaryBg ?? (effective === 'dark' ? '#3A4254' : '#EEF1F6'),
      secondaryText: base.colors.button?.secondaryText ?? base.colors.text ?? '#0A0A0A',
      dangerBg: base.colors.button?.dangerBg ?? (effective === 'dark' ? '#FF453A' : '#FF3B30'),
      dangerText: base.colors.button?.dangerText ?? '#FFFFFF',
    },
  };

  const normalizedShadows = {
    card: base.shadows?.card ?? {
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      },
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
    sm: base.spacing?.sm ?? 10,
    md: base.spacing?.md ?? 14,
    lg: base.spacing?.lg ?? 18,
    xl: base.spacing?.xl ?? 24,
    xxl: base.spacing?.xxl ?? 32,
  };

  const components = {
    card: {
      borderWidth: base.components?.card?.borderWidth ?? 1,
      padX: base.components?.card?.padX ?? 'sm',
      padY: base.components?.card?.padY ?? 'sm',
    },
    listItem: {
      height: base.components?.listItem?.height ?? 48,
      dividerWidth: base.components?.listItem?.dividerWidth ?? 1,
      disabledOpacity: base.components?.listItem?.disabledOpacity ?? 0.5,
      chevronSize: base.components?.listItem?.chevronSize ?? 20,
    },
    // NEW: sensible defaults; additive, won't break existing usage
    sectionTitle: {
      mb: base.components?.sectionTitle?.mb ?? 'sm', // spacing key
      ml: base.components?.sectionTitle?.ml ?? 'sm', // spacing key
    },
    row: {
      minHeight: base.components?.row?.minHeight ?? base.components?.listItem?.height ?? 48,
      py: base.components?.row?.py ?? null, // optional vertical padding (we set fixed height in screen)
      gapX: base.components?.row?.gapX ?? 'sm', // spacing key
    },
    avatar: {
      xl: base.components?.avatar?.xl ?? 120,
      lg: base.components?.avatar?.lg ?? 96,
      md: base.components?.avatar?.md ?? 48,
      border: base.components?.avatar?.border ?? 1,
    },

    iconButton: { size: base.components?.iconButton?.size ?? 32 },
    input: {
      height: base.components?.input?.height ?? base.components?.listItem?.height ?? 48,
      trailingSlotWidth: base.components?.input?.trailingSlotWidth ?? undefined,
      trailingGap: base.components?.input?.trailingGap ?? 8,
      separator: {
        insetX: base.components?.input?.separator?.insetX ?? 'lg',
        height:
          base.components?.input?.separator?.height ?? base.components?.listItem?.dividerWidth ?? 1,
        alpha: base.components?.input?.separator?.alpha ?? 0.18,
        errorAlpha: base.components?.input?.separator?.errorAlpha ?? 0.28,
      },
    },
    toast: { anchorOffset: base.components?.toast?.anchorOffset ?? 120 },
    scrollView: {
      paddingBottom: base.components?.scrollView?.paddingBottom ?? base.spacing?.xl ?? 24,
    },
    activityIndicator: { size: base.components?.activityIndicator?.size ?? 'large' },
  };

  // Pass-through shared media config (used by ImagePicker, etc.)
  const media = {
    aspect: base.components?.media?.aspect ?? [1, 1],
    quality: base.components?.media?.quality ?? 0.85,
  };

  const timings = {
    requestTimeoutMs: base.timings?.requestTimeoutMs ?? 12000,
    backDelayMs: base.timings?.backDelayMs ?? 300,
    presenceOnlineWindowMs: base.timings?.presenceOnlineWindowMs ?? 120000,
    presenceFutureSkewMs: base.timings?.presenceFutureSkewMs ?? 300000,
  };
  return {
    mode: effective,
    colors,
    shadows: normalizedShadows,
    typography,
    radii,
    spacing,
    components,
    media,
    timings,
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

  return (
    <ThemeContext.Provider value={{ theme, mode, setMode, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
