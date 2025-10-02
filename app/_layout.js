// app/_layout.js
import 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState, useCallback, useRef } from 'react';
import { ActivityIndicator, View, AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
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

// Предотвращаем автоматическое скрытие сплэш-скрина
SplashScreen.preventAutoHideAsync();

// Единый QueryClient с SWR-поведением (мгновенный кэш + тихий рефетч)
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
  const [appReady, setAppReady] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [role, setRole] = useState(null);
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const appState = useRef(AppState.currentState);

  const safeEdges = ['top', 'left', 'right'];

  // Простая функция для скрытия сплэша
  const onLayoutRootView = useCallback(async () => {
    if (appReady) {
      await SplashScreen.hideAsync();
    }
  }, [appReady]);

  // Упрощенная инициализация приложения
  useEffect(() => {
    let mounted = true;

    const initializeApp = async () => {
      try {
        // 1. Проверяем сессию
        const { data: { session } } = await supabase.auth.getSession();
        const logged = !!session?.user;
        
        if (mounted) {
          setIsLoggedIn(logged);
          
          // 2. Если пользователь залогинен, получаем роль
          if (logged) {
            try {
              const userRole = await getUserRole();
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
      } finally {
        // 3. Помечаем приложение как готовое
        if (mounted) {
          setAppReady(true);
        }
      }
    };

    initializeApp();

    // Слушатель изменения состояния аутентификации
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;
        
        try {
          // Очищаем кэш при изменении аутентификации
          await queryClient.clear();
        } catch (error) {
          console.warn('Error clearing cache:', error);
        }

        const logged = !!session?.user;
        setIsLoggedIn(logged);

        if (logged) {
          try {
            const userRole = await getUserRole();
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

    // Слушатель состояния приложения для повторного скрытия сплэша если нужно
    const appStateSubscription = AppState.addEventListener('change', async (nextAppState) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active' &&
        appReady
      ) {
        // При возвращении в активное состояние, убедимся что сплэш скрыт
        await SplashScreen.hideAsync();
      }
      appState.current = nextAppState;
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
      appStateSubscription.remove();
    };
  }, []);

  // Скрываем сплэш когда приложение готово
  useEffect(() => {
    if (appReady) {
      const hideSplash = async () => {
        await SplashScreen.hideAsync();
      };
      hideSplash();
    }
  }, [appReady]);

  // Push notifications (только для продакшн и залогиненных)
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

  // Пока приложение не готово, показываем индикатор загрузки
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
      persistOptions={{ persister, maxAge: 7 * 24 * 60 * 60 * 1000 }}
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
