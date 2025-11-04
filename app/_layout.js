// app/_layout.js
import 'react-native-gesture-handler';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState, useCallback, useRef } from 'react';
import { ActivityIndicator, View, AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { AvoidSoftInput } from 'react-native-avoid-softinput';
import { useAppLastSeen } from '../useAppLastSeen'; // ✅ mount last-seen hook

// Guard against multiple calls in dev (Fast Refresh) / multiple mounts
if (!globalThis.__splashPrevented) {
  globalThis.__splashPrevented = true;
  // Don't await to avoid blocking module eval; ignore harmless race errors
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

// Do not persist/keep transient auth-related queries
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
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [role, setRole] = useState(null);
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const segments = useSegments();
  const appState = useRef(AppState.currentState);

  // ✅ mount hook globally (logs + DB update inside the hook)
  useAppLastSeen(60_000);

  // ensure Splash.hide called only once
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

  const safeEdges = ['top', 'left', 'right'];

  const onLayoutRootView = useCallback(async () => {
    if (appReady) {
      await hideSplashNow();
    }
  }, [appReady, hideSplashNow]);

  useEffect(() => {
    let mounted = true;

    const initializeApp = async () => {
      try {
        // 1) Try to get session, but never block UI longer than 3.5s
        const sessResult = await Promise.race([
          supabase.auth.getSession().catch(() => ({ data: { session: null } })),
          new Promise((resolve) => setTimeout(() => resolve({ data: { session: null } }), 3500)),
        ]);
        const session = sessResult?.data?.session ?? null;

        // 2) Init i18n from local cache, but don't block startup longer than ~1.5s
        await Promise.race([
          initI18n(),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);

        // 3) If user is logged in — sync locale from profile (best effort)
        if (session?.user) {
          try {
            const code = await Promise.race([
              loadUserLocale(),
              new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
            ]);
            if (code) await setLocale(code);
          } catch (e) {
            console.warn('loadUserLocale failed:', e?.message || e);
          }
        }

        const logged = !!session?.user;

        if (mounted) {
          setIsLoggedIn(logged);
          // Allow navigation immediately; role loads in background
          if (!appReady) setAppReady(true);

          if (logged) {
            try {
              const userRolePromise = getUserRole();
              const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve('worker'), 5000));
              const userRole = await Promise.race([userRolePromise, timeoutPromise]);
              if (mounted) setRole(userRole);
            } catch (error) {
              console.warn('Failed to get user role:', error);
              if (mounted) setRole(null);
            }
          } else {
            if (mounted) setRole(null);
          }
        }
      } catch (error) {
        console.error('App initialization error:', error);
        if (mounted && !appReady) setAppReady(true);
      } finally {
        // Ensure we never stay on loader in any case
        if (mounted && !appReady) {
          setAppReady(true);
        }
      }
    };

    initializeApp();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;

        try {
          // Clear React Query cache on auth changes
          await queryClient.clear();
        } catch (error) {
          console.warn('Error clearing cache:', error);
        }

        const logged = !!session?.user;
        setIsLoggedIn(logged);
        // Allow transition immediately; role loads in background
        if (!appReady) setAppReady(true);

        if (logged) {
          // Sync locale on sign-in
          try {
            const code = await Promise.race([
              loadUserLocale(),
              new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
            ]);
            if (code) await setLocale(code);
          } catch (e) {
            console.warn('loadUserLocale on auth change failed:', e?.message || e);
          }

          try {
            const userRolePromise = getUserRole();
            const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve('worker'), 5000));
            const userRole = await Promise.race([userRolePromise, timeoutPromise]);
            if (mounted) setRole(userRole);
          } catch (error) {
            console.warn('Failed to get user role on auth change:', error);
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
        appReady
      ) {
        // When returning to foreground, ensure splash is hidden (safety)
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

  // Secondary safety: once appReady flips, hide splash if it somehow wasn't hidden by onLayout
  useEffect(() => {
    if (appReady) {
      hideSplashNow();
    }
  }, [appReady, hideSplashNow]);
  // Global IME handling: enable AvoidSoftInput once at root (except Expo Go)
  useEffect(() => {
    let enabled = false;
    (async () => {
      try {
        const { default: Constants } = await import('expo-constants');
        if (Constants?.appOwnership === 'expo') return; // Expo Go unsupported
        AvoidSoftInput.setEnabled(true);
        enabled = true;
      } catch {}
    })();
    return () => {
      try { if (enabled) AvoidSoftInput.setEnabled(false); } catch {}
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
  if (!appReady) return;
  const seg0 = Array.isArray(segments) ? segments[0] : undefined;
  const inAuth = seg0 === '(auth)';
  // After logout: always land on login within (auth) stack
  if (!isLoggedIn && !inAuth) {
    try { router.replace('/(auth)/login'); } catch {}
    return;
  }
  // After login from Auth stack: go to main
  if (isLoggedIn && inAuth) {
    try { router.replace('/orders/index'); } catch {}
  }
}, [isLoggedIn, appReady, segments, router]);

  if (!appReady) {
    return (
      <SafeAreaView
        edges={safeEdges}
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
          <SafeAreaView
            edges={safeEdges}
            style={{ flex: 1, backgroundColor: theme.colors.background }}
          >
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
              // Skip persisting auth/role/profile/permission queries and anything not successful
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
