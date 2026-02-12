import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef } from 'react';
import { ActivityIndicator, DevSettings, LogBox, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

// Подавляем warning от Expo Router при проверке маршрутов
LogBox.ignoreLogs([/No route named/]);

import BottomNav from '../components/navigation/BottomNav';
import ToastProvider from '../components/ui/ToastProvider';
import patchRouter from '../lib/navigation/patchRouter';
import { PermissionsProvider } from '../lib/permissions';
import { loadUserLocale } from '../lib/userLocale';
import SettingsProvider from '../providers/SettingsProvider';
import { SimpleAuthProvider, useAuthContext } from '../providers/SimpleAuthProvider';
import { initI18n, setLocale } from '../src/i18n';
import { FeedbackProvider } from '../src/shared/feedback';
import QueryProvider from '../src/shared/query/QueryProvider';
import { queryClient } from '../src/shared/query/queryClient';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';
import { useAppLastSeen } from '../useAppLastSeen';

function LastSeenTracker() {
  useAppLastSeen(30_000);
  return null;
}

if (!globalThis.__splashPrevented) {
  globalThis.__splashPrevented = true;
  SplashScreen.preventAutoHideAsync().catch(() => {});
}

function RootLayoutInner() {
  const { isInitializing, isAuthenticated } = useAuthContext();
  const { theme } = useTheme();
  const router = useRouter();
  // Patch router once to prevent duplicate rapid navigations to the same route
  useEffect(() => {
    try {
      patchRouter(router, { debounceMs: 600 });
    } catch {
      // noop
    }
  }, [router]);
  const segments = useSegments();
  const splashHiddenRef = useRef(false);
  const wasAuthenticatedRef = useRef(false);
  const hardResettingRef = useRef(false);

  const hardResetAndReload = useCallback(async () => {
    if (hardResettingRef.current) return;
    hardResettingRef.current = true;
    try {
      // Полный сброс кэша/persisted state перед перезапуском JS-процесса
      await queryClient.cancelQueries();
      await queryClient.clear();
      await AsyncStorage.clear();
    } catch {
      // silent
    }

    // Принудительная перезагрузка JS (dev/prod). DevSettings.reload работает в RN.
    try {
      DevSettings.reload();
    } catch {
      // silent
    }
  }, []);

  const hideSplash = useCallback(async () => {
    if (splashHiddenRef.current) return;
    try {
      await SplashScreen.hideAsync();
    } catch {
      // silent
    } finally {
      splashHiddenRef.current = true;
    }
  }, []);

  useEffect(() => {
    initI18n().catch(() => {});
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    (async () => {
      try {
        const code = await loadUserLocale();
        if (code) await setLocale(code);
      } catch {
        // silent
      }
    })();
  }, [isAuthenticated]);

  useEffect(() => {
    if (isInitializing) return;
    hideSplash();
  }, [isInitializing, hideSplash]);

  // Если было auth=true и стало false (явный выход) — жёстко сбрасываем кэш и перезапускаем app
  useEffect(() => {
    if (isAuthenticated) {
      wasAuthenticatedRef.current = true;
      return;
    }
    if (wasAuthenticatedRef.current && !isAuthenticated && !isInitializing) {
      hardResetAndReload();
    }
  }, [isAuthenticated, isInitializing, hardResetAndReload]);

  useEffect(() => {
    if (isInitializing) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/orders');
    }
  }, [isInitializing, isAuthenticated, segments, router]);

  if (isInitializing) {
    return (
      <SafeAreaView
        edges={['top', 'left', 'right']}
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        onLayout={hideSplash}
      >
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <GestureHandlerRootView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      onLayout={hideSplash}
    >
      <PermissionsProvider>
        <SettingsProvider>
          <SafeAreaView
            edges={['top', 'left', 'right']}
            style={{ flex: 1, backgroundColor: theme.colors.background }}
          >
            <Stack
              initialRouteName={isAuthenticated ? 'orders' : '(auth)'}
              screenOptions={{
                headerShown: false,
                animation: 'simple_push',
                gestureEnabled: true,
                fullScreenGestureEnabled: true,
                contentStyle: { backgroundColor: theme.colors.background },
              }}
            >
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="orders" />
              <Stack.Screen name="app_settings/AppSettings" options={{ title: 'Настройки приложения' }} />
              <Stack.Screen name="company_settings/index" options={{ title: 'Настройки компании' }} />
              <Stack.Screen name="users/index" options={{ title: 'Пользователи' }} />
              <Stack.Screen name="users/new" options={{ title: 'Новый пользователь' }} />
              <Stack.Screen name="users/[id]/index" options={{ title: 'Пользователь' }} />
              <Stack.Screen name="users/[id]/edit" options={{ title: 'Редактировать' }} />
              <Stack.Screen name="billing/index" options={{ title: 'Биллинг' }} />
              <Stack.Screen name="stats" options={{ title: 'Статистика' }} />
            </Stack>
            {isAuthenticated && <BottomNav />}
            {isAuthenticated && <LastSeenTracker />}
          </SafeAreaView>
        </SettingsProvider>
      </PermissionsProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  return (
    <QueryProvider>
      <SafeAreaProvider>
        <KeyboardProvider>
          <ThemeProvider>
            <ToastProvider>
              <FeedbackProvider>
                <SimpleAuthProvider>
                  <RootLayoutInner />
                </SimpleAuthProvider>
              </FeedbackProvider>
            </ToastProvider>
          </ThemeProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </QueryProvider>
  );
}
