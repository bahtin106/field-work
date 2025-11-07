/* global setTimeout */

// app/_layout.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, View } from 'react-native';
import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import BottomNav from '../components/navigation/BottomNav';
import ToastProvider from '../components/ui/ToastProvider';
import { getUserRole } from '../lib/getUserRole';
import logger from '../lib/logger';
import { PermissionsProvider } from '../lib/permissions';
import { supabase } from '../lib/supabase';
import { loadUserLocale } from '../lib/userLocale';
import SettingsProvider from '../providers/SettingsProvider';
import { initI18n, setLocale } from '../src/i18n';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';
import { useAppLastSeen } from '../useAppLastSeen';

// timeouts / intervals (keep centrally to ease tuning)
const SESSION_TIMEOUT = 3500; // ms
const I18N_TIMEOUT = 1500; // ms
const LOCALE_TIMEOUT = 2000; // ms
const ROLE_TIMEOUT = 5000; // ms
const LAST_SEEN_INTERVAL = 60_000; // ms

// app/_layout.js

/** Mounts last-seen tracker only when rendered (iOS: avoids noise before auth) */
function LastSeenTracker() {
  // Монтируем "последний визит" только после логина, iOS не трогаем до авторизации
  try {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      useAppLastSeen(LAST_SEEN_INTERVAL);
    }
  } catch (e) {
    logger.warn('LastSeenTracker error:', e?.message || e);
  }
  return null;
}

if (!globalThis.__splashPrevented) {
  globalThis.__splashPrevented = true;
  SplashScreen.preventAutoHideAsync().catch((e) => {
    logger.warn('preventAutoHideAsync error:', e?.message || e);
  });
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
} catch (e) {
  logger.warn('setQueryDefaults error:', e?.message || e);
}

const persister = createAsyncStoragePersister({ storage: AsyncStorage });

onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => setOnline(!!state.isConnected)),
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

  // Guard to avoid initial redirect flicker on first paint
  const didInitRef = useRef(false);
  // Marker to skip auth-driven redirects during initial mount
  const _authMountedRef = useRef(false);

  const splashHiddenRef = useRef(false);
  const hideSplashNow = useCallback(async () => {
    if (splashHiddenRef.current) return;
    try {
      await SplashScreen.hideAsync();
    } catch (e) {
      logger.warn('hideSplash error:', e?.message || e);
    } finally {
      splashHiddenRef.current = true;
    }
  }, []);

  const ready = appReady && sessionReady;

  const onLayoutRootView = useCallback(async () => {
    await hideSplashNow();
  }, [ready, hideSplashNow]);

  useEffect(() => {
    let mounted = true;

    const initializeApp = async () => {
      try {
        // 1) session with timeout
        const sessResult = await Promise.race([
          supabase.auth.getSession().catch((e) => {
            if (e?.message?.includes?.('Auth session missing')) {
              logger.warn('No session, probably signed out');
              return { data: { session: null } };
            }
            logger.warn('getSession error:', e?.message || e);
            return { data: { session: null } };
          }),
          new Promise((resolve) =>
            setTimeout(() => resolve({ data: { session: null } }), SESSION_TIMEOUT),
          ),
        ]);
        const session = sessResult?.data?.session ?? null;

        // 2) i18n init (non-blocking with timeout)
        await Promise.race([
          initI18n().catch((e) => {
            logger.warn('i18n init error:', e?.message || e);
          }),
          new Promise((resolve) => setTimeout(resolve, I18N_TIMEOUT)),
        ]);

        // 3) locale sync
        if (session?.user) {
          try {
            const code = await Promise.race([
              loadUserLocale(),
              new Promise((resolve) => setTimeout(() => resolve(null), LOCALE_TIMEOUT)),
            ]);
            if (code) await setLocale(code);
          } catch (e) {
            logger.warn('loadUserLocale error:', e?.message || e);
          }
        }

        const logged = !!session?.user;

        if (mounted) {
          setSessionReady(true);
          setIsLoggedIn(logged);
          if (!appReady) setAppReady(true);

          if (logged) {
            try {
              const userRolePromise = getUserRole();
              const timeoutPromise = new Promise((resolve) =>
                setTimeout(() => resolve('worker'), ROLE_TIMEOUT),
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
      } catch (e) {
        logger.warn('initializeApp error:', e?.message || e);
        if (mounted && !appReady) setAppReady(true);
      }
    };

    initializeApp();

    let subscription = null;
    try {
      const onAuth = supabase.auth.onAuthStateChange(async (_event, session) => {
        if (!mounted) return;

        // Always try to get authoritative session state from supabase
        let currentSession = session;
        try {
          const res = await supabase.auth.getSession();
          currentSession = res?.data?.session ?? currentSession;
        } catch (e) {
          logger.warn('onAuthStateChange getSession error:', e?.message || e);
        }

        try {
          // Clear cache to avoid showing stale data after auth change
          await queryClient.clear();
        } catch (e) {
          logger.warn('queryClient.clear error:', e?.message || e);
        }

        const logged = !!currentSession?.user;
        setIsLoggedIn(logged);
        setSessionReady(true);
        if (!appReady) setAppReady(true);

        if (!logged) {
          try {
            await persister.removeClient?.();
          } catch (e) {
            logger.warn('persister.removeClient error:', e?.message || e);
          }
          // clear role when logged out
          if (mounted) setRole(null);
          // Ensure we navigate to login after sign-out (some signOut flows don't trigger immediate UI redirects)
          try {
            // small delay to avoid racing with navigation readiness
            setTimeout(() => {
              try {
                router.replace('/(auth)/login');
              } catch (err) {
                logger.warn('router.replace (on logout) error:', err?.message || err);
              }
            }, 60);
          } catch (e) {
            logger.warn('router.replace (on logout) schedule error:', e?.message || e);
          }
          return;
        }

        // On login: ensure locale and role are loaded and queries refreshed
        try {
          const code = await Promise.race([
            loadUserLocale(),
            new Promise((resolve) => setTimeout(() => resolve(null), LOCALE_TIMEOUT)),
          ]);
          if (code) await setLocale(code);
        } catch (e) {
          logger.warn('loadUserLocale (onAuth) error:', e?.message || e);
        }

        try {
          const userRolePromise = getUserRole();
          const timeoutPromise = new Promise((resolve) =>
            setTimeout(() => resolve('worker'), ROLE_TIMEOUT),
          );
          const userRole = await Promise.race([userRolePromise, timeoutPromise]);
          if (mounted) setRole(userRole);
        } catch (e) {
          logger.warn('getUserRole (onAuth) error:', e?.message || e);
          if (mounted) setRole(null);
        }

        // Trigger fresh queries for critical data
        try {
          queryClient.invalidateQueries({ queryKey: ['profile'] });
          queryClient.invalidateQueries({ queryKey: ['userRole'] });
        } catch (e) {
          logger.warn('invalidateQueries error:', e?.message || e);
        }
      });
      subscription = onAuth?.data?.subscription ?? null;
    } catch (e) {
      logger.warn('onAuthStateChange subscribe error:', e?.message || e);
    }

    const appStateSubscription = AppState.addEventListener('change', async (nextAppState) => {
      if (appState.current?.match(/inactive|background/) && nextAppState === 'active' && ready) {
        await hideSplashNow();
      }
      appState.current = nextAppState;
    });

    return () => {
      mounted = false;
      try {
        subscription?.unsubscribe?.();
      } catch (e) {
        logger.warn('subscription unsubscribe error:', e?.message || e);
      }
      try {
        appStateSubscription?.remove?.();
      } catch (e) {
        logger.warn('appStateSubscription remove error:', e?.message || e);
      }
    };
  }, []);

  useEffect(() => {
    if (ready) hideSplashNow();
  }, [ready, hideSplashNow]);

  // Ensure immediate navigation on explicit auth changes (but skip initial mount)
  useEffect(() => {
    if (!_authMountedRef.current) {
      _authMountedRef.current = true;
      return;
    }
    if (!ready) return;
    if (!rootNavigationState?.key) return;

    try {
      const seg0 = Array.isArray(segments) ? segments[0] : undefined;
      const inAuth = seg0 === '(auth)';
      if (!isLoggedIn && !inAuth) {
        router.replace('/(auth)/login');
        return;
      }
      if (isLoggedIn && inAuth) {
        router.replace('/orders');
      }
    } catch (e) {
      logger.warn('auth-change navigation error:', e?.message || e);
    }
  }, [isLoggedIn, ready, segments, router, rootNavigationState]);

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
      } catch (e) {
        logger.warn('AvoidSoftInput init error:', e?.message || e);
      }
    })();
    return () => {
      (async () => {
        try {
          if (enabled && AvoidSoftInput) {
            AvoidSoftInput.setEnabled(false);
          }
        } catch (e) {
          logger.warn('AvoidSoftInput teardown error:', e?.message || e);
        }
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
        logger.warn('✅ Expo push token (saved):', token);
        detach = attachNotificationLogs();
      } catch (e) {
        logger.warn('Push init error:', e?.message || e);
      }
    })();
    return () => detach?.();
  }, [isLoggedIn]);

  useEffect(() => {
    if (!ready) return;
    if (!rootNavigationState?.key) return;
    const seg0 = Array.isArray(segments) ? segments[0] : undefined;
    const inAuth = seg0 === '(auth)';
    // Обновлённая логика: один redirect на старте, без двойного перехода
    if (!didInitRef.current) {
      didInitRef.current = true;
      return;
    }
    if (!isLoggedIn && !inAuth) {
      try {
        router.replace('/(auth)/login');
      } catch (e) {
        logger.warn('router.replace -> login error:', e?.message || e);
      }
      return;
    }
    if (isLoggedIn && inAuth) {
      try {
        router.replace('/orders');
      } catch (e) {
        logger.warn('router.replace -> orders error:', e?.message || e);
      }
    }
  }, [isLoggedIn, ready, segments, router, rootNavigationState]);

  if (!ready) {
    return (
      <SafeAreaView
        edges={['top', 'left', 'right']}
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
            edges={['top', 'left', 'right']}
            style={{ flex: 1, backgroundColor: theme.colors.background }}
          >
            <Animated.View layout={LinearTransition.duration(220)} style={{ flex: 1 }}>
              <Stack
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
      persistOptions={{
        persister,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        dehydrateOptions: {
          shouldDehydrateQuery: (q) => {
            const key0 = Array.isArray(q.queryKey) ? q.queryKey[0] : null;
            if (
              key0 === 'session' ||
              key0 === 'userRole' ||
              key0 === 'profile' ||
              key0 === 'perm-canViewAll'
            )
              return false;
            return q.state.status === 'success';
          },
        },
      }}
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
