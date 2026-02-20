import { router as globalRouter, Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef } from 'react';
import { ActivityIndicator, AppState, LogBox, Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

LogBox.ignoreLogs([/No route named/]);

import BottomNav from '../components/navigation/BottomNav';
import ToastProvider from '../components/ui/ToastProvider';
import { applyAndroidSystemBars } from '../lib/systemBars';
import patchRouter from '../lib/navigation/patchRouter';
import { PermissionsProvider } from '../lib/permissions';
import { supabase } from '../lib/supabase';
import { loadUserLocale } from '../lib/userLocale';
import SettingsProvider from '../providers/SettingsProvider';
import { SimpleAuthProvider, useAuthContext } from '../providers/SimpleAuthProvider';
import { initI18n, setLocale } from '../src/i18n';
import { FeedbackProvider } from '../src/shared/feedback';
import QueryProvider from '../src/shared/query/QueryProvider';
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
  const { isInitializing, isAuthenticated, user } = useAuthContext();
  const { theme } = useTheme();
  const router = useRouter();
  const segments = useSegments();
  const splashHiddenRef = useRef(false);
  const segmentsRef = useRef(segments);
  const accessCheckInFlightRef = useRef(false);
  const inAuthGroup = segments[0] === '(auth)';
  const authScreen = segments[1] || '';
  const isBlockedScreen = inAuthGroup && authScreen === 'blocked';

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    try {
      patchRouter(router);
    } catch {}

    try {
      patchRouter(globalRouter);
    } catch {}
  }, [router]);

  const hideSplash = useCallback(async () => {
    if (splashHiddenRef.current) return;
    try {
      await SplashScreen.hideAsync();
    } catch {
      // noop
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
        // noop
      }
    })();
  }, [isAuthenticated]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    applyAndroidSystemBars(theme).catch(() => {});
  }, [theme]);

  useEffect(() => {
    if (isInitializing) return;
    hideSplash();
  }, [isInitializing, hideSplash]);

  useEffect(() => {
    if (isInitializing) return;
    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
      return;
    }

    if (isAuthenticated && inAuthGroup && !isBlockedScreen) {
      router.replace('/orders');
    }
  }, [isInitializing, isAuthenticated, segments, router]);

  useEffect(() => {
    if (isInitializing || !isAuthenticated) return;
    const timer = setTimeout(() => {
      try {
        router?.prefetch?.('/app_settings/AppSettings');
        router?.prefetch?.('/company_settings');
      } catch {}
    }, 120);
    return () => clearTimeout(timer);
  }, [isInitializing, isAuthenticated, router]);

  const enforceAccess = useCallback(async () => {
    if (isInitializing || !isAuthenticated || !user?.id) return;
    if (accessCheckInFlightRef.current) return;

    accessCheckInFlightRef.current = true;
    try {
      const seg = Array.isArray(segmentsRef.current) ? segmentsRef.current : [];
      const inAuthGroup = seg[0] === '(auth)';
      const isBlockedScreen = inAuthGroup && seg[1] === 'blocked';

      const { data: accessData, error: accessError } = await supabase.rpc('get_my_access_state');

      if (!accessError) {
        const accessRow = Array.isArray(accessData) ? accessData[0] : accessData;
        if (accessRow?.can_login === false) {
          const code = String(accessRow.block_code || 'access_blocked');
          const message = String(accessRow.block_message || '');
          if (!isBlockedScreen) {
            router.replace({ pathname: '/(auth)/blocked', params: { code, message } });
          }
          return;
        }

        if (isBlockedScreen) {
          router.replace('/orders');
        }
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('is_suspended, suspended_at, is_admin_blocked, license_state, blocked_reason')
        .eq('id', user.id)
        .maybeSingle();

      const blockedByAdmin =
        !!profile?.is_suspended ||
        !!profile?.suspended_at ||
        !!profile?.is_admin_blocked ||
        ['manual', 'admin_block', 'admin_blocked'].includes(
          String(profile?.blocked_reason || '').toLowerCase(),
        );
      const blockedByLicense = String(profile?.license_state || '') === 'blocked_by_license';
      const blocked = blockedByAdmin || blockedByLicense;

      if (blocked && !isBlockedScreen) {
        const code = blockedByAdmin ? 'admin_blocked' : 'blocked_by_license';
        router.replace({ pathname: '/(auth)/blocked', params: { code, message: '' } });
      } else if (!blocked && isBlockedScreen) {
        router.replace('/orders');
      }
    } catch {
      // noop
    } finally {
      accessCheckInFlightRef.current = false;
    }
  }, [isAuthenticated, isInitializing, router, user?.id]);

  useEffect(() => {
    if (isInitializing || !isAuthenticated || !user?.id) return;

    enforceAccess();
    const intervalId = setInterval(() => {
      enforceAccess();
    }, 30000);

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') enforceAccess();
    });

    return () => {
      clearInterval(intervalId);
      appStateSub?.remove?.();
    };
  }, [enforceAccess, isAuthenticated, isInitializing, user?.id]);

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
              <Stack.Screen
                name="app_settings/AppSettings"
                options={{ title: 'Настройки приложения', animation: 'none' }}
              />
              <Stack.Screen
                name="company_settings/index"
                options={{ title: 'Настройки компании', animation: 'none' }}
              />
              <Stack.Screen name="users/index" options={{ title: 'Users' }} />
              <Stack.Screen name="users/new" options={{ title: 'New User' }} />
              <Stack.Screen name="users/[id]/index" options={{ title: 'User' }} />
              <Stack.Screen name="users/[id]/edit" options={{ title: 'Edit User' }} />
              <Stack.Screen name="billing/index" options={{ title: 'Subscription & Licenses' }} />
              <Stack.Screen name="admin/index" />
              <Stack.Screen name="admin/users/index" />
              <Stack.Screen name="admin/users/[id]/index" />
              <Stack.Screen name="admin/users/[id]/edit" />
              <Stack.Screen name="admin/companies/index" />
              <Stack.Screen name="admin/companies/details" />
              <Stack.Screen name="admin/companies/edit" />
              <Stack.Screen name="admin/storage/index" />
              <Stack.Screen name="admin/server/index" />
              <Stack.Screen name="stats" options={{ title: 'Stats' }} />
            </Stack>
            {isAuthenticated && !isBlockedScreen && <BottomNav />}
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
