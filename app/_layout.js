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
  const _router = useRouter();
  const _segments = useSegments();
  const _rootNavigationState = useRootNavigationState();
  const appState = useRef(AppState.currentState);

  // Guard to avoid initial redirect flicker on first paint
  const _didInitRef = useRef(false);
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
        // 1) session with timeout — получаем persisted session, но дополнительно проверяем её валидность
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

        // Если есть session — дополнительно проверим пользователя через getUser (авторитетный источник)
        let validatedUser = null;
        if (session?.access_token) {
          try {
            // Первая попытка
            const userResult = await Promise.race([
              supabase.auth.getUser().catch((e) => {
                logger.warn('getUser failed during init:', e?.message || e);
                return { data: { user: null } };
              }),
              new Promise((resolve) => setTimeout(() => resolve({ data: { user: null } }), 2000)),
            ]);
            validatedUser = userResult?.data?.user ?? null;
            // Если не удалось получить пользователя, но сессия есть — пробуем ещё раз через 500мс
            if (!validatedUser) {
              logger.warn('Session present but getUser returned no user — retrying after delay');
              await new Promise((res) => setTimeout(res, 500));
              const retryUserResult = await Promise.race([
                supabase.auth.getUser().catch((e) => {
                  logger.warn('getUser failed during retry:', e?.message || e);
                  return { data: { user: null } };
                }),
                new Promise((resolve) => setTimeout(() => resolve({ data: { user: null } }), 1500)),
              ]);
              validatedUser = retryUserResult?.data?.user ?? null;
              if (!validatedUser) {
                logger.warn(
                  'Session present but getUser returned no user after retry — treating as signed out',
                );
              }
            }
          } catch (e) {
            logger.warn('getUser (init) error:', e?.message || e);
          }
        }
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

        // Логика: если есть session, но пользователь не получен — НЕ сбрасываем isLoggedIn в false сразу, а считаем, что пользователь залогинен, если есть access_token
        const logged = !!validatedUser || !!session?.access_token;

        if (mounted) {
          setSessionReady(true);
          setIsLoggedIn(logged);
          logger?.warn?.('initializeApp: sessionReady set, isLoggedIn=', logged);
          if (!appReady) setAppReady(true);

          if (logged) {
            try {
              const userRolePromise = getUserRole();
              const timeoutPromise = new Promise((resolve) =>
                setTimeout(() => resolve('worker'), ROLE_TIMEOUT),
              );
              const userRole = await Promise.race([userRolePromise, timeoutPromise]);
              if (mounted) setRole(userRole);
              try {
                logger?.warn?.('initializeApp: role loaded=', userRole);
              } catch (e) {
                void e;
              }
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
      const onAuth = supabase.auth.onAuthStateChange(async (event, session) => {
        logger?.warn?.('🔄 Auth state changed:', event, session?.user?.id ?? 'no-id');
        if (!mounted) return;

        if (event === 'SIGNED_OUT') {
          logger.warn('📤 SIGNED_OUT — clearing state');
          try {
            await queryClient.clear();
            await persister.removeClient?.();
          } catch (e) {
            logger.warn('Error clearing cache:', e?.message || e);
          }
          if (mounted) {
            setIsLoggedIn(false);
            setRole(null);
            setSessionReady(true);
            if (!appReady) setAppReady(true);
          }
          return;
        }

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          logger.warn('📥 SIGNED_IN/TOKEN_REFRESHED — loading user data');
          try {
            // Load role and locale
            const [userRole] = await Promise.all([
              getUserRole(),
              loadUserLocale().then((code) => code && setLocale(code)),
            ]);

            // Invalidate queries
            queryClient.invalidateQueries({ queryKey: ['profile'] });
            queryClient.invalidateQueries({ queryKey: ['userRole'] });

            if (mounted) {
              logger.warn('✅ Setting isLoggedIn=true, role=', userRole);
              setRole(userRole);
              setIsLoggedIn(true);
              setSessionReady(true);
              if (!appReady) setAppReady(true);
            }
          } catch (e) {
            logger.warn('Error processing auth event:', e?.message || e);
          }
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

  // Навигация на основе статуса авторизации
  useEffect(() => {
    if (!_rootNavigationState?.key || !ready) {
      logger.warn('⏳ Navigation not ready yet');
      return;
    }

    const seg0 = Array.isArray(_segments) ? _segments[0] : undefined;
    const inAuth = seg0 === '(auth)';

    logger.warn(
      `🧭 Navigation effect: isLoggedIn=${isLoggedIn}, inAuth=${inAuth}, segment=${seg0}`,
    );

    if (!isLoggedIn) {
      if (!inAuth) {
        logger.warn('🔒 Not logged in, redirecting to login...');
        _router.replace('/(auth)/login');
      }
    } else {
      // Пользователь залогинен
      if (inAuth) {
        logger.warn('✅ Logged in but on auth screen, IMMEDIATE redirect to /orders...');
        try {
          _router.replace('/orders');
          logger.warn('✅ Navigation executed');
        } catch (e) {
          logger.warn('Navigation error:', e?.message || e);
        }
      }
    }
  }, [isLoggedIn, ready, _rootNavigationState?.key, _segments, _router]);

  // Инициализация push-уведомлений для залогиненных пользователей
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
        logger.warn('Push init error:', e);
      }
    })();
    return () => detach?.();
  }, [isLoggedIn]);

  // Инициализация обработки клавиатуры
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
        logger.warn('AvoidSoftInput init error:', e);
      }
    })();
    return () => {
      if (enabled && AvoidSoftInput) {
        AvoidSoftInput.setEnabled(false);
      }
    };
  }, []);

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
