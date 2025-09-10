// app/_layout.js
import 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View, AppState, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { LinearTransition, FadeIn, FadeOut } from 'react-native-reanimated';

import { supabase } from '../lib/supabase';
import SettingsProvider from '../providers/SettingsProvider';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';
import ToastProvider from '../components/ui/ToastProvider';
import { PermissionsProvider } from '../lib/permissions';
import BottomNav from '../components/navigation/BottomNav';
import { getUserRole } from '../lib/getUserRole';
import { registerForPushTokensAsync, attachNotificationLogs } from '../lib/push';

SplashScreen.preventAutoHideAsync().catch(() => {});

function RootLayoutInner() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [role, setRole] = useState(null);
  const [booted, setBooted] = useState(false);
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const safeEdges = Platform.OS === 'ios' || insets.top >= 28 ? ['top','left','right'] : ['left','right'];

  async function waitForSession({ tries = 20, delay = 100 } = {}) {
    for (let i = 0; i < tries; i++) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) return session;
      } catch {}
      await new Promise(r => setTimeout(r, delay));
    }
    return null;
  }

  useEffect(() => {
    let mounted = true;
    const boot = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data?.session;
        const logged = !!session?.user;
        if (mounted) setIsLoggedIn(logged);

        if (logged) {
          try {
            await waitForSession();
            const r = await getUserRole();
            if (mounted) setRole(r);
          } catch { if (mounted) setRole(null); }
        } else {
          if (mounted) setRole(null);
        }
      } finally {
        if (mounted) setBooted(true);
      }
    };
    boot();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (_, session) => {
      const logged = !!session?.user;
      setIsLoggedIn(logged);
      if (logged && session?.user?.id) {
        try { await waitForSession(); const r = await getUserRole(); setRole(r); }
        catch { setRole(null); }
      } else { setRole(null); }
      setBooted(true);
    });

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && booted && (isLoggedIn ? role : true)) {
        SplashScreen.hideAsync().catch(() => {});
      }
    });

    return () => {
      mounted = false;
      authListener?.subscription?.unsubscribe();
      sub?.remove?.();
    };
  }, [booted]);

  useEffect(() => {
    const ready = booted && (isLoggedIn ? !!role : true);
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [booted, isLoggedIn, role]);


useEffect(() => {
  let detach;
  (async () => {
    try {
      const token = await registerForPushTokensAsync();
      console.log('✅ Expo push token:', token);
      detach = attachNotificationLogs();
    } catch (e) {
      console.warn('Push init error:', e?.message || e);
    }
  })();
  return () => detach?.();
}, []);


  const ready = booted && (isLoggedIn ? !!role : true);

  if (!ready) {
    return (
      <SafeAreaView edges={safeEdges} style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <PermissionsProvider>
        <SettingsProvider>
          <SafeAreaView edges={safeEdges} style={{ flex: 1, backgroundColor: theme.colors.background }}>
            <Animated.View
  layout={LinearTransition.duration(220)}
  style={{ flex: 1 }}
>
              <Stack
                initialRouteName={isLoggedIn ? 'orders/index' : '(auth)'}
                screenOptions={{
                  headerShown: false,
                  animation: 'simple_push',
                  gestureEnabled: true,
                  fullScreenGestureEnabled: true,
                  animationTypeForReplace: 'push',
                  gestureDirection: 'horizontal',
                  contentStyle: { backgroundColor: theme.colors.background },
                }}
              >
                <Stack.Screen name="(auth)" options={{ headerShown: false }} />
                <Stack.Screen name="orders/index" />
              </Stack>
              {isLoggedIn && <BottomNav />}
            </Animated.View>
          </SafeAreaView>
        </SettingsProvider>
      </PermissionsProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <RootLayoutInner />
      </ToastProvider>
    </ThemeProvider>
  );
}
