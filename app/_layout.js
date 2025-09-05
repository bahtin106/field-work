// app/_layout.js
import 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View, AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// NOTE: paths are relative to app/
import { supabase } from '../lib/supabase';
import SettingsProvider from '../providers/SettingsProvider';
import { ThemeProvider } from '../theme/ThemeProvider';
import { PermissionsProvider } from '../lib/permissions';
import BottomNav from '../components/navigation/BottomNav';

function RootLayoutInner() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [booted, setBooted] = useState(false);

  // Скрываем сплэш сразу после маунта и на всякий случай при смене стейта
  useEffect(() => {
    // скрыть сразу после первого кадра
    const t = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (booted) SplashScreen.hideAsync().catch(() => {});
  }, [booted]);

  useEffect(() => {
    let mounted = true;

    const boot = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data?.session;
        if (mounted) setIsLoggedIn(!!session?.user);
      } finally {
        if (mounted) setBooted(true);
      }
    };
    boot();

    const { data: authListener } = supabase.auth.onAuthStateChange((_, session) => {
      if (!mounted) return;
      setIsLoggedIn(!!session?.user);
      setBooted(true);
    });

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') SplashScreen.hideAsync().catch(() => {});
    });

    return () => {
      mounted = false;
      authListener?.subscription?.unsubscribe();
      sub?.remove?.();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: 'transparent' }}>
      <PermissionsProvider>
        <SettingsProvider>
          {!booted ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator size="large" />
            </View>
          ) : (
  <View style={{ flex: 1 }}>
    <Stack
      initialRouteName="(auth)"
      screenOptions={{
        headerShown: false,
        animation: 'simple_push',
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
        animationTypeForReplace: 'push',
        gestureDirection: 'horizontal',
      }}
    >
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
    </Stack>

    <BottomNav />
  </View>
)}
        </SettingsProvider>
      </PermissionsProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootLayoutInner />
    </ThemeProvider>
  );
}
