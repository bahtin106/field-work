// theme/ThemeProvider.jsx
// Banking-grade design tokens + light/dark theme with premium dark surfaces
// API is backward-compatible with your current theme (colors.*, text.*, button.*, etc.)
import React, { createContext, useContext, useMemo, useState, useEffect, useCallback } from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'app_theme_preference'; // 'light' | 'dark' | 'system'

// ---- helpers ----
function withAlpha(hex, a = 1) {
  // supports '#RRGGBB' and '#RGB'
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.slice(0,2), 16);
  const g = parseInt(h.slice(2,4), 16);
  const b = parseInt(h.slice(4,6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// Base tokens (stable)
export const tokens = {
  radius: { xs: 6, sm: 10, md: 14, lg: 18, xl: 24, '2xl': 28 },
  spacing: { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 },
  elevation: { 0: 0, 1: 2, 2: 4, 3: 8, 4: 12 },
  font: {
    family: {
      regular: 'System',
      medium: 'System',
      semibold: 'System',
      bold: 'System',
    },
    size: { xs: 12, sm: 14, md: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 28 },
    line: { tight: 1.12, normal: 1.25, relaxed: 1.35 },
  },
  accent: '#007AFF', // iOS blue
  motion: {
    fast: 140,
    normal: 220,
    slow: 320,
  }
};

// ---- palettes ----
const paletteLight = {
  bg: '#F5F7FA',           // app background
  card: '#FFFFFF',
  cardElevated: '#FFFFFF',
  text: '#0B0C0F',
  subtext: '#667085',
  border: withAlpha('#111', 0.08),
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  accent: tokens.accent,
  accentTextOn: '#FFFFFF',
  tint: withAlpha('#000', 0.06), // subtle fills
};

// Dark tuned for "expensive" look: deep background + layered surfaces with subtle overlays
const paletteDark = {
  bg: '#0B0D12',            // deep
  card: '#11141A',          // base surface
  cardElevated: '#151924',  // elevated surface
  text: '#F2F4F7',
  subtext: '#98A2B3',
  border: withAlpha('#FFF', 0.08),
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#F87171',
  accent: tokens.accent,
  accentTextOn: '#FFFFFF',
  tint: withAlpha('#FFF', 0.06),
};

function buildTheme(mode) {
  const p = mode === 'dark' ? paletteDark : paletteLight;

  // derived ramps
  const accentSoft = mode === 'dark' ? withAlpha(p.accent, 0.18) : withAlpha(p.accent, 0.12);
  const accentMuted = mode === 'dark' ? withAlpha(p.accent, 0.28) : withAlpha(p.accent, 0.20);

  const surface = {
    0: p.card,
    1: p.cardElevated,
    2: mode === 'dark' ? '#1A1F2B' : '#FFFFFF',
  };

  return {
    mode,
    colors: {
      ...p,
      background: p.bg,
      accentSoft,
      accentMuted,
      surface,
    },
    // Common components style helpers (kept for backward compatibility)
    cardStyle: {
      backgroundColor: p.card,
      borderRadius: tokens.radius.xl,
    },
    button: {
      primary: {
        bg: p.accent,
        color: p.accentTextOn,
        radius: tokens.radius.xl,
        paddingV: tokens.spacing[4],
        paddingH: tokens.spacing[5],
        pressed: { bg: withAlpha(p.accent, 0.9) },
      },
      secondary: {
        bg: mode === 'dark' ? withAlpha('#FFFFFF', 0.06) : withAlpha('#1F3AFF', 0.08),
        color: p.accent,
        radius: tokens.radius.xl,
        paddingV: tokens.spacing[4],
        paddingH: tokens.spacing[5],
        borderColor: withAlpha(p.accent, 0.18),
        borderWidth: 1,
        pressed: { bg: mode === 'dark' ? withAlpha('#FFFFFF', 0.09) : withAlpha('#1F3AFF', 0.12) },
      },
      danger: {
        bg: p.danger,
        color: '#FFFFFF',
        radius: tokens.radius.xl,
        paddingV: tokens.spacing[4],
        paddingH: tokens.spacing[5],
        pressed: { bg: withAlpha('#EF4444', 0.9) },
      },
    },
    text: {
      title: { fontSize: tokens.font.size['2xl'], fontFamily: tokens.font.family.semibold, color: p.text },
      body: { fontSize: tokens.font.size.md, fontFamily: tokens.font.family.regular, color: p.text },
      muted: { fontSize: tokens.font.size.sm, color: p.subtext },
      label: { fontSize: tokens.font.size.sm, color: p.subtext, letterSpacing: 0.2 },
    },
    shadow: mode === 'dark'
      ? { shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 12, elevation: tokens.elevation[2] }
      : { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, elevation: tokens.elevation[2] },
    divider: { borderBottomWidth: 1, borderBottomColor: p.border },
    field: {
      bg: mode === 'dark' ? '#0F131A' : '#F8FAFC',
      border: p.border,
      radius: tokens.radius.lg,
      paddingV: tokens.spacing[4],
      paddingH: tokens.spacing[4],
      color: p.text,
      placeholder: p.subtext,
      focusedBorder: withAlpha(p.accent, 0.4),
    },
    chip: {
      bg: mode === 'dark' ? withAlpha('#FFF', 0.06) : withAlpha('#0A0A0A', 0.04),
      color: p.text,
      radius: tokens.radius.lg,
      paddingV: tokens.spacing[2],
      paddingH: tokens.spacing[3],
      activeBg: p.accent,
      activeColor: p.accentTextOn,
    },
    systemNav: {
      behavior: 'inset-swipe',
      buttonStyle: mode === 'dark' ? 'light' : 'dark',
    },
    // Additional premium tokens (optional use)
    opacity: { disabled: 0.5, hovered: 0.9, pressed: 0.8 },
    outline: { color: withAlpha(p.accent, 0.55), width: 2, radius: tokens.radius.lg },
    list: {
      row: { backgroundColor: p.card, borderBottomColor: p.border, borderBottomWidth: 1 },
      header: { backgroundColor: surface[1] },
    },
  };
}

// ---- context ----
const ThemeCtx = createContext({
  theme: buildTheme('light'),
  setMode: (_m) => {},
  mode: 'system',
});

export function ThemeProvider({ children }) {
  const [pref, setPref] = useState('system'); // 'light' | 'dark' | 'system'
  const [system, setSystem] = useState(Appearance.getColorScheme() || 'light');

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystem(colorScheme || 'light');
    });
    return () => sub && sub.remove && sub.remove();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved === 'light' || saved === 'dark' || saved === 'system') setPref(saved);
      } catch {}
    })();
  }, []);

  const setMode = useCallback(async (mode) => {
    const safe = (mode === 'light' || mode === 'dark') ? mode : 'system';
    setPref(safe);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, safe);
    } catch {}
  }, []);

  const resolved = pref === 'system' ? system : pref;
  const theme = useMemo(() => buildTheme(resolved), [resolved]);

  const value = useMemo(() => ({ theme, setMode, mode: pref }), [theme, setMode, pref]);

  return (
    <ThemeCtx.Provider value={value}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeCtx);
}
