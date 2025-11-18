/* global setTimeout */

// app/_layout.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, View } from 'react-native';
import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import BottomNav from '../components/navigation/BottomNav';
import ToastProvider from '../components/ui/ToastProvider';
import { globalCache } from '../lib/cache/DataCache';
import { getUserRole } from '../lib/getUserRole';
import logger from '../lib/logger';
import { preloadDepartments } from '../lib/preloadDepartments';
import { getMyCompanyId } from '../lib/workTypes';

import { PermissionsProvider } from '../lib/permissions';
import { bumpSessionEpoch } from '../lib/sessionEpoch';
import { supabase } from '../lib/supabase';
import { loadUserLocale } from '../lib/userLocale';
import SettingsProvider from '../providers/SettingsProvider';
import { initI18n, setLocale } from '../src/i18n';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';
import { useAppLastSeen } from '../useAppLastSeen';

// timeouts / intervals (keep centrally to ease tuning)
const SESSION_TIMEOUT = 5000; // ms - увеличен для холодного старта
const I18N_TIMEOUT = 1500; // ms
const LOCALE_TIMEOUT = 2000; // ms
const ROLE_TIMEOUT = 5000; // ms
const LAST_SEEN_INTERVAL = 30_000; // ms - уменьшен с 60s до 30s для более частых обновлений онлайн-статуса

// app/_layout.js

/** Mounts last-seen tracker only when rendered (iOS: avoids noise before auth) */
function LastSeenTracker() {
  // Монтируем "последний визит" только после логина, iOS не трогаем до авторизации
  try {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      useAppLastSeen(LAST_SEEN_INTERVAL);
    }
  } catch (e) {
    // silent catch
  }
  return null;
}

if (!globalThis.__splashPrevented) {
  globalThis.__splashPrevented = true;
  SplashScreen.preventAutoHideAsync().catch((e) => {
    // silent catch
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
  // silent catch
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
  const [authChecking, setAuthChecking] = useState(true);
  const [appKey, setAppKey] = useState(0);
  const { theme } = useTheme();
  const router = useRouter();
  const segments = useSegments();
  const appState = useRef(AppState.currentState);

  const splashHiddenRef = useRef(false);
  const hideSplashNow = useCallback(async () => {
    if (splashHiddenRef.current) return;
    try {
      await SplashScreen.hideAsync();
    } catch (e) {
      // silent catch
    } finally {
      splashHiddenRef.current = true;
    }
  }, []);

  const ready = appReady && sessionReady;

  // КРИТИЧНО: Дополнительная защита - force ready через 12 секунд после монтирования
  useEffect(() => {
    const forceReadyTimeout = setTimeout(() => {
      if (!appReady || !sessionReady) {
        logger?.warn?.('🚨 FORCE READY TIMEOUT - Unblocking UI after 12s');
        setAppReady(true);
        setSessionReady(true);
        setAuthChecking(false);
      }
    }, 12000);

    return () => clearTimeout(forceReadyTimeout);
  }, []);

  const onLayoutRootView = useCallback(async () => {
    await hideSplashNow();
  }, [ready, hideSplashNow]);

  useEffect(() => {
    let mounted = true;
    let maxTimeoutId = null;

    const initializeApp = async () => {
      setAuthChecking(true);

      // КРИТИЧНО: Гарантированный таймаут для разблокировки UI
      maxTimeoutId = setTimeout(() => {
        if (mounted) {
          logger?.warn?.('⏰ MAX TIMEOUT REACHED - Force unblock UI');
          setSessionReady(true);
          setAuthChecking(false);
          if (!appReady) setAppReady(true);
        }
      }, 10000); // 10 секунд - абсолютный максимум

      try {
        // 1) session with timeout — получаем persisted session, но дополнительно проверяем её валидность
        const sessResult = await Promise.race([
          supabase.auth.getSession().catch((e) => {
            if (e?.message?.includes?.('Auth session missing')) {
              return { data: { session: null } };
            }
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
            // Первая попытка с увеличенным таймаутом для холодного старта
            const userResult = await Promise.race([
              supabase.auth.getUser().catch((e) => {
                logger?.warn?.('getUser attempt 1 failed:', e?.message || e);
                return { data: { user: null }, error: e };
              }),
              new Promise((resolve) => setTimeout(() => resolve({ data: { user: null } }), 4000)),
            ]);
            validatedUser = userResult?.data?.user ?? null;

            // Если не удалось получить пользователя, но сессия есть — пробуем ещё раз
            if (!validatedUser && session?.access_token) {
              logger?.warn?.('Retrying getUser after 1s delay...');
              await new Promise((res) => setTimeout(res, 1000));
              const retryUserResult = await Promise.race([
                supabase.auth.getUser().catch((e) => {
                  logger?.warn?.('getUser attempt 2 failed:', e?.message || e);
                  return { data: { user: null }, error: e };
                }),
                new Promise((resolve) => setTimeout(() => resolve({ data: { user: null } }), 3000)),
              ]);
              validatedUser = retryUserResult?.data?.user ?? null;
            }

            // Финальная попытка: если сессия есть, но getUser не работает — используем данные из session
            if (!validatedUser && session?.user) {
              logger?.warn?.('Using user from session object as fallback');
              validatedUser = session.user;
            }
          } catch (e) {
            logger?.warn?.('getUser error:', e?.message || e);
            // Если есть session.user — используем его как fallback
            if (session?.user) {
              validatedUser = session.user;
            }
          }
        }
        // 2) i18n init (non-blocking with timeout)
        await Promise.race([
          initI18n().catch((e) => {
            // silent catch
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
            // silent catch
          }
        }

        // Логика: пользователь залогинен только если validatedUser получен успешно
        // НЕ доверяем только наличию access_token, т.к. токен может быть устаревшим
        const logged = !!validatedUser;

        if (mounted) {
          setSessionReady(true);
          setIsLoggedIn(logged);
          if (!appReady) setAppReady(true);
          setAuthChecking(false);

          if (logged && validatedUser?.id) {
            try {
              // Предварительно загружаем профиль для сессии
              const { data: prof } = await Promise.race([
                supabase
                  .from('profiles')
                  .select('full_name, first_name, last_name, avatar_url, role')
                  .eq('id', validatedUser.id)
                  .maybeSingle(),
                new Promise((resolve) => setTimeout(() => resolve({ data: null }), 2000)),
              ]);

              if (prof && mounted) {
                // Кэшируем профиль для немедленного использования в UniversalHome
                queryClient.setQueryData(['profile', validatedUser.id], prof);
              }

              const userRolePromise = getUserRole();
              const timeoutPromise = new Promise((resolve) =>
                setTimeout(() => resolve('worker'), ROLE_TIMEOUT),
              );
              const userRole = await Promise.race([userRolePromise, timeoutPromise]);
              if (mounted) {
                setRole(userRole);
                // Мгновенно кладём роль в кэш для быстрого доступа
                try {
                  queryClient.setQueryData(['userRole'], userRole);
                } catch (e) {
                  logger?.warn?.('Failed to cache userRole:', e?.message || e);
                }
              }

              // Предзагружаем отделы в глобальный кэш, чтобы они были мгновенно доступны
              try {
                const companyId = await Promise.race([
                  getMyCompanyId(),
                  new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
                ]);
                if (companyId) {
                  await preloadDepartments(companyId);
                }
              } catch (e) {
                logger?.warn?.('preloadDepartments during init error:', e?.message || e);
              }
            } catch {
              if (mounted) setRole(null);
            }
          } else {
            if (mounted) setRole(null);
          }
        }
      } catch (e) {
        // silent catch
        logger?.warn?.('⚠️ initializeApp error:', e?.message || e);
        if (mounted && !appReady) setAppReady(true);
        if (mounted) setSessionReady(true);
        setAuthChecking(false);
      } finally {
        // КРИТИЧНО: Гарантируем разблокировку UI даже при любых ошибках
        if (maxTimeoutId) clearTimeout(maxTimeoutId);
        if (mounted) {
          setSessionReady(true);
          setAuthChecking(false);
          if (!appReady) setAppReady(true);
        }
      }
    };

    initializeApp();

    return () => {
      mounted = false;
      if (maxTimeoutId) clearTimeout(maxTimeoutId);
    };
  }, []);

  // Подписка на события авторизации
  useEffect(() => {
    let mounted = true;
    let subscription = null;

    try {
      const onAuth = supabase.auth.onAuthStateChange(async (event, session) => {
        if (!mounted) return;

        if (event === 'SIGNED_OUT') {
          logger?.warn?.('🚪 SIGNED_OUT event received');

          // Очищаем все данные
          try {
            await queryClient.clear();
            await persister.removeClient?.();
            globalCache.clear(); // Очищаем кастомный кэш
          } catch (e) {
            // silent catch
          }

          // Обновляем состояние
          if (mounted) {
            setIsLoggedIn(false);
            setRole(null);
            setSessionReady(true);
            setAuthChecking(false);
            if (!appReady) setAppReady(true);
            // НЕ перемонтируем приложение - это ломает навигацию
            // setAppKey((prev) => prev + 1); - УБРАНО
          }

          // Инкрементируем session epoch — экраны сбросят свои bootstrap состояния
          try {
            bumpSessionEpoch();
          } catch (e) {}

          // Навигация после logout - через простой replace
          // НЕ делаем ничего здесь - пусть useEffect ниже обработает

          return;
        }

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          logger?.warn?.(`🔐 Auth event: ${event}`);

          // КРИТИЧНО: Сбрасываем authChecking СРАЗУ для разблокировки UI
          if (mounted) {
            setAuthChecking(false);
            setSessionReady(true);
            if (!appReady) setAppReady(true);
          }

          // Запускаем тяжёлую работу асинхронно с ГАРАНТИРОВАННЫМ таймаутом
          const asyncWorkPromise = (async () => {
            logger?.warn?.('🚀 Starting async IIFE in SIGNED_IN handler');
            try {
              // При SIGNED_IN сначала ЗАГРУЖАЕМ критические данные, ПОТОМ чистим кэш и перемонтируем
              let userRole = 'worker';
              let profileData = null;

              try {
                // Получаем пользователя для последующей загрузки профиля
                const { data: { user: currentUser } = {} } = await supabase.auth.getUser();
                logger?.warn?.(`👤 Current user: ${currentUser?.id || 'none'}`);

                // Гарантируем загрузку профиля и роли ДО очистки кэша
                if (currentUser?.id) {
                  try {
                    // Загружаем профиль явно
                    const { data: prof } = await supabase
                      .from('profiles')
                      .select('full_name, first_name, last_name, avatar_url, role')
                      .eq('id', currentUser.id)
                      .maybeSingle();

                    if (prof) {
                      profileData = { userId: currentUser.id, data: prof };
                      logger?.warn?.(`✅ Profile loaded: role=${prof.role}`);
                    } else {
                      logger?.warn?.('⚠️ Profile not found in database');
                    }
                  } catch (e) {
                    logger?.warn?.('Failed to preload profile:', e?.message || e);
                  }
                }

                // Load role and locale параллельно
                const [fetchedRole] = await Promise.all([
                  getUserRole().catch((e) => {
                    logger?.warn?.('getUserRole failed:', e?.message || e);
                    return 'worker'; // fallback роль
                  }),
                  loadUserLocale()
                    .then((code) => code && setLocale(code))
                    .catch((e) => {
                      // silent catch
                    }),
                ]);
                userRole = fetchedRole;
                logger?.warn?.(`🎭 User role resolved: ${userRole}`);
              } catch (e) {
                // silent catch - используем fallback роль
                logger?.warn?.('Error loading user data:', e?.message || e);
                userRole = 'worker';
              }

              // ТЕПЕРЬ чистим кэш, НО сразу же восстанавливаем критические данные
              if (event === 'SIGNED_IN') {
                try {
                  // Удаляем персистер, чтобы не загружались старые данные
                  await persister.removeClient?.();

                  // Очищаем кастомный кэш
                  globalCache.clear();

                  // Полностью удаляем ВСЕ запросы из кэша
                  queryClient.removeQueries();
                  queryClient.getQueryCache().clear();
                } catch (e) {
                  // silent catch
                }
              }

              // Мгновенно восстанавливаем роль и профиль в кэш ПЕРЕД перемонтированием
              try {
                queryClient.setQueryData(['userRole'], userRole);
                logger?.warn?.(`📦 Cached userRole: ${userRole}`);
                if (profileData) {
                  queryClient.setQueryData(['profile', profileData.userId], profileData.data);
                  logger?.warn?.(`📦 Cached profile for user: ${profileData.userId}`);
                }
              } catch (e) {
                logger?.warn?.('Failed to cache data:', e?.message || e);
              }

              // ТЕПЕРЬ обновляем состояние после загрузки данных
              if (mounted) {
                setRole(userRole);
                setIsLoggedIn(true);
                setSessionReady(true);
                if (!appReady) setAppReady(true);
                logger?.warn?.(`✅ State updated: isLoggedIn=true, role=${userRole}`);
              }

              // Небольшая пауза для стабилизации перед перемонтированием
              await new Promise((resolve) => setTimeout(resolve, 50));

              // ТЕПЕРЬ перемонтируем приложение — роль уже в кэше
              if (mounted) {
                setAppKey((prev) => prev + 1);
                logger?.warn?.('🔄 App remounted with new key');
              }

              // Инкрементируем session epoch — экраны сбросят bootstrap
              try {
                bumpSessionEpoch();
                logger?.warn?.('⏰ Session epoch bumped');
              } catch (e) {}

              // КРИТИЧНО: Сбрасываем appReadyState для нового цикла загрузки
              try {
                const { default: appReadyState } = await import('../lib/appReadyState');
                appReadyState.reset();
                logger?.warn?.('🔄 appReadyState reset for new login');
              } catch (e) {
                logger?.warn?.('Failed to reset appReadyState:', e?.message || e);
              }

              // Навигация после входа - через простой replace
              // НЕ делаем ничего здесь - пусть useEffect ниже обработает

              logger?.warn?.('✅ SIGNED_IN processing complete');
            } catch (error) {
              logger?.warn?.('❌ Error in SIGNED_IN handler:', error?.message || error);
              // Гарантируем разблокировку даже при ошибке
              if (mounted) {
                setAuthChecking(false);
                setSessionReady(true);
                if (!appReady) setAppReady(true);
                // При ошибке сохраняем состояние логина если session есть
                // setIsLoggedIn(false); - НЕ сбрасываем, т.к. уже установлено выше
              }
            }
          })();

          // КРИТИЧНО: Гарантированный таймаут 8 секунд для async работы
          const timeoutPromise = new Promise((resolve) => {
            setTimeout(() => {
              logger?.warn?.('⏰ SIGNED_IN async work timeout - force finish');
              resolve();
            }, 8000);
          });

          // Запускаем race между async работой и таймаутом
          Promise.race([asyncWorkPromise, timeoutPromise]).finally(() => {
            if (mounted) {
              // Гарантируем, что состояние разблокировано
              setAuthChecking(false);
              setSessionReady(true);
              if (!appReady) setAppReady(true);
              logger?.warn?.('✅ SIGNED_IN fully complete (with timeout safety)');
            }
          });

          return;
        }
      });
      subscription = onAuth?.data?.subscription ?? null;
    } catch (e) {
      // silent catch
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
        // silent catch
      }
      try {
        appStateSubscription?.remove?.();
      } catch (e) {
        // silent catch
      }
    };
  }, []);

  useEffect(() => {
    if (ready) hideSplashNow();
  }, [ready, hideSplashNow]);

  // Навигация при изменении состояния авторизации
  // КРИТИЧНО: Срабатывает ТОЛЬКО при изменении isLoggedIn, НЕ зависит от segments
  useEffect(() => {
    if (!ready) return;

    // Простая логика: изменился isLoggedIn -> навигируем
    if (!isLoggedIn) {
      logger?.warn?.('🔀 Auth state changed: navigating to login');
      router.replace('/(auth)/login');
    } else {
      logger?.warn?.('🔀 Auth state changed: navigating to home');
      router.replace('/orders');
    }
  }, [isLoggedIn, ready, router]);

  // Дополнительная защита на основе segments (fallback)
  useEffect(() => {
    if (!ready) return;

    const inAuthGroup = segments[0] === '(auth)';

    // Защита: если не залогинен и не на auth странице - редирект
    if (!isLoggedIn && !inAuthGroup) {
      logger?.debug?.('Guard: Not logged in and not on auth page');
      router.replace('/(auth)/login');
    }
    // Защита: если залогинен и на auth странице - редирект на главную
    else if (isLoggedIn && inAuthGroup) {
      logger?.debug?.('Guard: Logged in but on auth page');
      router.replace('/orders');
    }
  }, [isLoggedIn, ready, segments, router]);

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
        detach = attachNotificationLogs();
      } catch (e) {
        // silent catch
      }
    })();
    return () => detach?.();
  }, [isLoggedIn]);

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
            <Animated.View layout={LinearTransition.duration(220)} style={{ flex: 1 }} key={appKey}>
              <Stack
                key={`stack-${appKey}`}
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
        <KeyboardProvider>
          <ThemeProvider>
            <ToastProvider>
              <RootLayoutInner />
            </ToastProvider>
          </ThemeProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </PersistQueryClientProvider>
  );
}
