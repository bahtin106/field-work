// app/_layout.js
import 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
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
import { registerAndSavePushToken, attachNotificationLogs } from '../lib/push';

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';

SplashScreen.preventAutoHideAsync().catch(() => {});

// --- React Query: cache + offline persist (RN) ---
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,      // 5 минут не считаем устаревшими
      gcTime: 24 * 60 * 60 * 1000,   // храним кэш сутки
      retry: 1,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
});

const persister = createAsyncStoragePersister({ storage: AsyncStorage });

// сетевое состояние и фокус для RN
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => setOnline(!!state.isConnected))
);

focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener('change', (s) => handleFocus(s === 'active'));
  return () => sub.remove();
});
// Expo Notifications handler: без deprecated shouldShowAlert
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,   // iOS: heads-up баннер
    shouldShowList: true,     // iOS: в Notification Center
    shouldPlaySound: true,    // iOS/Android: звук если разрешён
    priority: Notifications.AndroidNotificationPriority.MAX,
  }),
});

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
  if (!isLoggedIn) return;
  let detach;
  (async () => {
    try {
      const token = await registerAndSavePushToken();
      console.log('✅ Expo push token (saved):', token);
      detach = attachNotificationLogs();
    } catch (e) {
      console.warn('Push init error:', e?.message || e);
    }
  })();
  return () => detach?.();
}, [isLoggedIn]);

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
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 7 * 24 * 60 * 60 * 1000 }}>
      <ThemeProvider>
        <ToastProvider>
          <RootLayoutInner />
        </ToastProvider>
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}
