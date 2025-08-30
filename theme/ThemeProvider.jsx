import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'THEME_MODE_V2'; // bump key to avoid stale values

const lightTokens = {
  mode: 'light',
  colors: {
    bg: '#F7F8FA',
    card: '#FFFFFF',
    border: '#E5E7EB',
    text: '#0A0A0A',
    accent: '#007AFF',
    accentTextOn: '#FFFFFF',
    accentMuted: '#DCEBFF',
    tint: '#F2F3F7',
    surface: ['#FFFFFF', '#FAFAFA'],
    navbar: '#FFFFFF',},
  text: { muted: { color: '#6B7280' } },
  chip: { bg: '#E7F0FF' },
};

const darkTokens = {
  mode: 'dark',
  colors: {
    bg: '#0B0F16',
    card: '#121725',
    border: '#1E2535',
    text: '#F7FAFF',
    accent: '#0A84FF',
    accentTextOn: '#FFFFFF',
    accentMuted: '#0a84ff22',
    tint: '#192032',
    surface: ['#141A29', '#0D1320'],
  },
  text: { muted: { color: '#93A0B4' } },
  chip: { bg: '#1C2230' },
};

const ThemeContext = createContext({
  theme: lightTokens,
  mode: 'light',
  setMode: (_m) => {},
  toggle: () => {},
});

export const ThemeProvider = ({ children }) => {
  // Default to 'light' to avoid "always dark on cold start"
  const [mode, setMode] = useState('light');
  const [hydrated, setHydrated] = useState(false);

  // Hydrate saved mode once
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

  // Persist every change
  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, mode).catch(() => {});
  }, [mode]);

  // When following system
  useEffect(() => {
    if (mode !== 'system') return;
    const sub = Appearance.addChangeListener(() => {
      // force rerender
      setMode((m) => m);
    });
    return () => {
      if (sub?.remove) sub.remove();
    };
  }, [mode]);

  const theme = useMemo(() => {
    const effective = mode === 'system' ? (Appearance.getColorScheme?.() || 'light') : mode;
    return effective === 'dark' ? darkTokens : lightTokens;
  }, [mode]);

  const toggle = useCallback(() => {
    setMode((m) => (m === 'light' ? 'dark' : 'light'));
  }, []);

  // Render with best-effort theme even before hydration finished (default 'light')
  return (
    <ThemeContext.Provider value={{ theme, mode, setMode, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
