// app/_layout.js
import 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState, useCallback } from 'react';
import { ActivityIndicator, View, AppState, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { LinearTransition } from 'react-native-reanimated';

import { supabase } from '../lib/supabase';
import SettingsProvider from '../providers/SettingsProvider';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';
import ToastProvider from '../components/ui/ToastProvider';
import { PermissionsProvider } from '../lib/permissions';
import BottomNav from '../components/navigation/BottomNav';
import { getUserRole } from '../lib/getUserRole';
// ---- React Query: cache + offline persist (Expo Managed, AsyncStorage) ----
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';

if (!globalThis.__SPLASH_LOCKED__) {
  SplashScreen.preventAutoHideAsync().catch(() => {});
  globalThis.__SPLASH_LOCKED__ = true;
}

// Единый QueryClient с SWR-поведением (мгновенный кэш + тихий рефетч)
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Критично для UX: оставляем предыдущие данные вместо спиннера
      keepPreviousData: true,
      placeholderData: (prev) => prev,
      // Дефолтные тайминги (перепишем на экранах при необходимости)
      staleTime: 5 * 60 * 1000,      // 5 минут
      gcTime: 24 * 60 * 60 * 1000,   // сутки
      retry: 1,
      refetchOnMount: false,
      refetchOnWindowFocus: false,   // в RN нет окна, управляем focusManager
      refetchOnReconnect: true,
    },
  },
});

// Persist кэша в AsyncStorage (Expo-friendly)
const persister = createAsyncStoragePersister({ storage: AsyncStorage });

// Сетевое состояние и фокус для RN
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => setOnline(!!state.isConnected))
);

focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener('change', (s) => handleFocus(s === 'active'));
  return () => sub.remove();
});

function RootLayoutInner() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [role, setRole] = useState(null);
  const [booted, setBooted] = useState(false);
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();


// Init notifications handler lazily and skip in Expo Go
useEffect(() => {
  let mounted = true
  ;(async () => {
    try {
      const { default: Constants } = await import('expo-constants');
      if (Constants?.appOwnership === 'expo') return;
      const Notifications = await import('expo-notifications');
      if (!mounted) return;
      Notifications.setNotificationHandler?.({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          priority: Notifications.AndroidNotificationPriority?.MAX,
        }),
      });
    } catch (e) {
      console.warn('Notif handler init error:', e?.message || e);
    }
  })();
  return () => { mounted = false }
}, []);
  const safeEdges = Platform.OS === 'ios' || insets.top >= 28 ? ['top','left','right'] : ['left','right'];
  const onLayoutRootView = useCallback(() => {
    if (booted) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [booted]);


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
        if (mounted) SplashScreen.hideAsync().catch(() => {});
      setBooted(true);
      }
    };
    boot();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (_, session) => {
      // Drop React Query cache on any auth change to avoid stale screens/data after relogin
      try { await queryClient.clear(); } catch {}
const logged = !!session?.user;
      setIsLoggedIn(logged);
      if (logged && session?.user?.id) {
        try { await waitForSession(); const r = await getUserRole(); setRole(r); }
        catch { setRole(null); }
      } else { setRole(null); }
      SplashScreen.hideAsync().catch(() => {});
      setBooted(true);
    });

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && booted) {
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
    const ready = booted;
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [booted, isLoggedIn, role]);
// Push init (только для залогиненного пользователя, пропускаем в Expo Go)
  useEffect(() => {
    if (!isLoggedIn) return;
    let detach;
    (async () => {
      try {
        const { default: Constants } = await import('expo-constants');
        if (Constants?.appOwnership === 'expo') return;
        const { registerAndSavePushToken, attachNotificationLogs } = await import('../lib/push');
        const token = await registerAndSavePushToken();
        console.log('✅ Expo push token (saved):', token);
        detach = attachNotificationLogs();
      } catch (e) {
        console.warn('Push init error:', e?.message || e);
      }
    })();
    return () => detach?.();
  }, [isLoggedIn]);

  const ready = booted;
  // После завершения инициализации навигация управляется
  // свойством initialRouteName на Stack и перенаправлением при выходе
  // в компонентах, поэтому отдельный редирект здесь не нужен.
if (!ready) {
    return (
      <SafeAreaView edges={safeEdges} style={{ flex: 1, backgroundColor: theme.colors.background }} onLayout={onLayoutRootView}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.background }} onLayout={onLayoutRootView}>
      <PermissionsProvider>
        <SettingsProvider>
          <SafeAreaView edges={safeEdges} style={{ flex: 1, backgroundColor: theme.colors.background }} onLayout={onLayoutRootView}>
            <Animated.View layout={LinearTransition.duration(220)} style={{ flex: 1 }}>
              <Stack
                initialRouteName={isLoggedIn ? 'orders/index' : '(auth)'}
                    key={isLoggedIn ? 'app' : 'auth'}
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
                <Stack.Screen name="orders/index" options={{ gestureEnabled: false }} />
              </Stack>
              {booted && isLoggedIn && !!role && <BottomNav />}
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
