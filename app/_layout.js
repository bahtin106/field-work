// app/_layout.js
import 'react-native-gesture-handler';
import { Stack, useRouter, useSegments, useRootNavigationState } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState, useCallback, useRef } from 'react';
import { ActivityIndicator, View, AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { initI18n, setLocale } from '../src/i18n';
import { loadUserLocale } from '../lib/userLocale';
import { supabase } from '../lib/supabase';
import SettingsProvider from '../providers/SettingsProvider';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';
import ToastProvider from '../components/ui/ToastProvider';
import { PermissionsProvider } from '../lib/permissions';
import BottomNav from '../components/navigation/BottomNav';
import { getUserRole } from '../lib/getUserRole';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { useAppLastSeen } from '../useAppLastSeen';

/** Mounts last-seen tracker only when rendered (iOS: avoids noise before auth) */
import { Platform } from 'react-native';
function LastSeenTracker() {
  // Монтируем "последний визит" только после логина, iOS не трогаем до авторизации
  try { if (Platform.OS === 'ios' || Platform.OS === 'android') { useAppLastSeen(60_000); } } catch {}
  return null;
}


if (!globalThis.__splashPrevented) {
  globalThis.__splashPrevented = true;
  SplashScreen.preventAutoHideAsync().catch(() => {});
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      keepPreviousData: true,
      placeholderData: (prev) => prev,
      staleTime: 5 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: 1,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
});

try {
  queryClient.setQueryDefaults(['session'], { retry: 0, gcTime: 0, cacheTime: 0 });
  queryClient.setQueryDefaults(['userRole'], { retry: 1, gcTime: 5 * 60 * 1000 });
  queryClient.setQueryDefaults(['perm-canViewAll'], { retry: 1, gcTime: 5 * 60 * 1000 });
  queryClient.setQueryDefaults(['profile'], { retry: 1, gcTime: 5 * 60 * 1000 });
} catch {}

const persister = createAsyncStoragePersister({ storage: AsyncStorage });

onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => setOnline(!!state.isConnected))
);

focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener('change', (s) => handleFocus(s === 'active'));
  return () => sub.remove();
});

function RootLayoutInner() {
  const [appReady, setAppReady] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [role, setRole] = useState(null);
  const { theme } = useTheme();
  const router = useRouter();
  const segments = useSegments();
  const rootNavigationState = useRootNavigationState();
  const appState = useRef(AppState.currentState);

  const splashHiddenRef = useRef(false);
  const hideSplashNow = useCallback(async () => {
    if (splashHiddenRef.current) return;
    try {
      await SplashScreen.hideAsync();
    } catch (e) {
      console.warn('hideSplash error:', e?.message || e);
    } finally {
      splashHiddenRef.current = true;
    }
  }, []);

  const ready = appReady && sessionReady;

  const onLayoutRootView = useCallback(async () => {
    if (ready) await hideSplashNow();
  }, [ready, hideSplashNow]);

  useEffect(() => {
    let mounted = true;

    const initializeApp = async () => {
      try {
        // 1) session with timeout
        const sessResult = await Promise.race([
          supabase.auth.getSession().catch((e) => {
            if (e?.message?.includes?.('Auth session missing')) {
              console.log('No session, probably signed out');
              return { data: { session: null } };
            }
            console.warn('getSession error:', e?.message || e);
            return { data: { session: null } };
          }),
          new Promise((resolve) =>
            setTimeout(() => resolve({ data: { session: null } }), 3500)
          ),
        ]);
        const session = sessResult?.data?.session ?? null;

        // 2) i18n init (non-blocking with timeout)
        await Promise.race([
          initI18n().catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);

        // 3) locale sync
        if (session?.user) {
          try {
            const code = await Promise.race([
              loadUserLocale(),
              new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
            ]);
            if (code) await setLocale(code);
          } catch {}
        }

        const logged = !!session?.user;

        if (mounted) { setSessionReady(true);
          setIsLoggedIn(logged);
          if (!appReady) setAppReady(true);

          if (logged) {
            try {
              const userRolePromise = getUserRole();
              const timeoutPromise = new Promise((resolve) =>
                setTimeout(() => resolve('worker'), 5000)
              );
              const userRole = await Promise.race([userRolePromise, timeoutPromise]);
              if (mounted) setRole(userRole);
            } catch {
              if (mounted) setRole(null);
            }
          } else {
            if (mounted) setRole(null);
          }
        }
      } catch (error) {
        if (mounted && !appReady) setAppReady(true);
      }
    };

    initializeApp();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!mounted) return;

        try { await queryClient.clear(); } catch {}

        const logged = !!session?.user;
        setIsLoggedIn(logged);
        setSessionReady(true);
        if (!appReady) setAppReady(true);

        if (logged) {
          try {
            const code = await Promise.race([
              loadUserLocale(),
              new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
            ]);
            if (code) await setLocale(code);
          } catch {}

          try {
            const userRolePromise = getUserRole();
            const timeoutPromise = new Promise((resolve) =>
              setTimeout(() => resolve('worker'), 5000)
            );
            const userRole = await Promise.race([userRolePromise, timeoutPromise]);
            if (mounted) setRole(userRole);
          } catch {
            if (mounted) setRole(null);
          }
        } else {
          if (mounted) setRole(null);
        }
      }
    );

    const appStateSubscription = AppState.addEventListener('change', async (nextAppState) => {
      if (
        appState.current?.match(/inactive|background/) &&
        nextAppState === 'active' &&
        ready
      ) {
        await hideSplashNow();
      }
      appState.current = nextAppState;
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
      appStateSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (appReady) hideSplashNow();
  }, [ready, hideSplashNow]);

  useEffect(() => {
    let enabled = false;
    let AvoidSoftInput;
    (async () => {
      try {
        const { default: Constants } = await import('expo-constants');
        if (Constants?.appOwnership === 'expo') return;
        ({ AvoidSoftInput } = await import('react-native-avoid-softinput'));
        AvoidSoftInput.setEnabled(true);
        enabled = true;
      } catch {}
    })();
    return () => {
      (async () => {
        try {
          if (enabled && AvoidSoftInput) {
            AvoidSoftInput.setEnabled(false);
          }
        } catch {}
      })();
    };
  }, []);

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

  useEffect(() => {
    if (!ready) return;
    if (!rootNavigationState?.key) return;
    const seg0 = Array.isArray(segments) ? segments[0] : undefined;
    const inAuth = seg0 === '(auth)';
    if (!isLoggedIn && !inAuth) {
      try { router.replace('/(auth)/login'); } catch {}
      return;
    }
    if (isLoggedIn && inAuth) {
      try { router.replace('/orders/index'); } catch {}
    }
  }, [isLoggedIn, ready, segments, router, rootNavigationState]);

  if (!ready) {
    return (
      <SafeAreaView
        edges={['top','left','right']}
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        onLayout={onLayoutRootView}
      >
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <GestureHandlerRootView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      onLayout={onLayoutRootView}
    >
      <PermissionsProvider>
        <SettingsProvider>
          <SafeAreaView edges={['top','left','right']} style={{ flex: 1, backgroundColor: theme.colors.background }}>
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
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="orders/index" options={{ gestureEnabled: false }} />
              </Stack>
              {isLoggedIn && role && <BottomNav />}
                          {isLoggedIn ? <LastSeenTracker /> : null}
</Animated.View>
          </SafeAreaView>
        </SettingsProvider>
      </PermissionsProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: 7 * 24 * 60 * 60 * 1000, dehydrateOptions: { shouldDehydrateQuery: (q) => {
              const key0 = Array.isArray(q.queryKey) ? q.queryKey[0] : null;
              if (key0 === 'session' || key0 === 'userRole' || key0 === 'profile' || key0 === 'perm-canViewAll') return false;
              return q.state.status === 'success';
            } } }}
    >
      <SafeAreaProvider>
        <ThemeProvider>
          <ToastProvider>
            <RootLayoutInner />
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </PersistQueryClientProvider>
  );
}
