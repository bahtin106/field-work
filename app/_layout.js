import 'react-native-gesture-handler';
import * as NavigationBar from 'expo-navigation-bar';
import { Slot } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState, useCallback } from 'react';
import { ActivityIndicator, View, AppState, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { supabase } from '../lib/supabase';
import SettingsProvider from '../providers/SettingsProvider';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';

// Сплэш скрываем вручную
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const { theme } = useTheme();

  // Глобально: держим навбар видимым и в цвете темы
  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS === 'android') {
          const bg = theme?.colors?.navbar || (theme?.mode === 'dark' ? '#121725' : '#FFFFFF');
          const btn = theme?.mode === 'dark' ? 'light' : 'dark';
          await NavigationBar.setVisibilityAsync('visible');
          await NavigationBar.setBehaviorAsync('inset-swipe');
          await NavigationBar.setBackgroundColorAsync(bg);
          await NavigationBar.setButtonStyleAsync(btn);
        }
      } catch {}
    })();
  }, [theme?.mode, theme?.colors?.navbar]);

  const [isLoggedIn, setIsLoggedIn] = useState(null);

  useEffect(() => {
    let mounted = true;

    const checkAuth = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (mounted) setIsLoggedIn(!!user);
    };
    checkAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange((_, session) => {
      setIsLoggedIn(!!session);
    });

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') SplashScreen.hideAsync().catch(() => {});
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
      sub.remove();
    };
  }, []);

  const onLayoutRootView = useCallback(() => {
    if (isLoggedIn !== null) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [isLoggedIn]);

  return (
    <GestureHandlerRootView
      style={{ flex: 1, backgroundColor: 'transparent' }}
      onLayout={onLayoutRootView}
    >
      <ThemeProvider>
        <SettingsProvider>
          {isLoggedIn === null ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator size="large" />
            </View>
          ) : !isLoggedIn ? (
            <Slot name="auth" />
          ) : (
            <Slot name="tabs" />
          )}
        </SettingsProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
