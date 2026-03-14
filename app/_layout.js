import { router as globalRouter, Stack, usePathname, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, LogBox, Platform, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { installDevWarnFilters } from '../src/utils/devWarnFilter';

installDevWarnFilters();

LogBox.ignoreLogs([
  /No route named/,
  /`expo-notifications` functionality is not fully supported in Expo Go/i,
  /expo-notifications: Android Push notifications \(remote notifications\) functionality provided/i,
  /Expo Go can no longer provide full access to the media library/i,
]);

import BottomNav from '../components/navigation/BottomNav';
import ToastProvider, { useToast } from '../components/ui/ToastProvider';
import appReadyState from '../lib/appReadyState';
import { applyAndroidSystemBars } from '../lib/systemBars';
import { bootstrapPushForUserWithOptions } from '../lib/pushAutoSetup';
import patchRouter from '../lib/navigation/patchRouter';
import { PermissionsProvider } from '../lib/permissions';
import { supabase } from '../lib/supabase';
import { loadUserLocale } from '../lib/userLocale';
import SettingsProvider from '../providers/SettingsProvider';
import { SimpleAuthProvider, useAuthContext } from '../providers/SimpleAuthProvider';
import { getRequestById } from '../src/features/requests/api';
import { initI18n, setLocale } from '../src/i18n';
import { useTranslation } from '../src/i18n/useTranslation';
import { FeedbackProvider } from '../src/shared/feedback';
import QueryProvider from '../src/shared/query/QueryProvider';
import RouteFreshnessBoundary from '../src/shared/query/RouteFreshnessBoundary';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';
import { useAppLastSeen } from '../useAppLastSeen';
import { KeyboardProvider } from '../lib/keyboardControllerCompat';

function LastSeenTracker() {
  useAppLastSeen(30_000);
  return null;
}

const ACCESS_REVALIDATE_INTERVAL_MS = 2 * 60 * 1000;

if (!globalThis.__splashPrevented) {
  globalThis.__splashPrevented = true;
  SplashScreen.preventAutoHideAsync().catch(() => {});
}

function _BrandedLoadingScreen({ theme }) {
  const isDark = theme?.mode === 'dark';
  const cardBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.92)';
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16,24,40,0.08)';

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 }}>
      <View
        style={{
          width: 112,
          height: 112,
          borderRadius: 32,
          backgroundColor: cardBg,
          borderWidth: 1,
          borderColor: cardBorder,
          justifyContent: 'center',
          alignItems: 'center',
          shadowColor: '#000',
          shadowOpacity: isDark ? 0.24 : 0.14,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          elevation: 5,
        }}
      >
        <Image
          source={require('../assets/splash/splashscreen_logo.png')}
          style={{ width: 78, height: 78 }}
          resizeMode="contain"
        />
      </View>
      <Text
        style={{
          marginTop: 20,
          color: theme.colors.text,
          fontSize: 16,
          fontWeight: '600',
          letterSpacing: 0.2,
        }}
      >
        Загрузка
      </Text>
      <ActivityIndicator size="small" color={theme.colors.primary} style={{ marginTop: 12 }} />
    </View>
  );
}

function RootLayoutInner() {
  const { isInitializing, isAuthenticated, user } = useAuthContext();
  const { t } = useTranslation();
  const toast = useToast();
  const { theme } = useTheme();
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();
  const splashHiddenRef = useRef(false);
  const [appBootReady, setAppBootReady] = useState(() => appReadyState.isReady());
  const segmentsRef = useRef(segments);
  const accessCheckInFlightRef = useRef(false);
  const pushSyncInFlightRef = useRef(false);
  const pushSyncDoneForUserRef = useRef(null);
  const notificationOpenInFlightRef = useRef(false);
  const lastHandledNotificationKeyRef = useRef('');
  const presentedCleanupInFlightRef = useRef(false);
  const inAuthGroup = segments[0] === '(auth)';
  const authScreen = segments[1] || '';
  const isBlockedScreen = inAuthGroup && authScreen === 'blocked';

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    const unsubscribe = appReadyState.subscribe((state) => {
      setAppBootReady(state === 'ready');
    });
    return unsubscribe;
  }, []);

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

  const shouldHoldNativeSplash =
    isInitializing || (isAuthenticated && !isBlockedScreen && !appBootReady);

  useEffect(() => {
    if (shouldHoldNativeSplash) return;
    hideSplash();
  }, [hideSplash, shouldHoldNativeSplash]);

  useEffect(() => {
    if (isInitializing) return;
    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
      return;
    }

    if (isAuthenticated && inAuthGroup && !isBlockedScreen) {
      router.replace('/orders');
    }
  }, [inAuthGroup, isAuthenticated, isBlockedScreen, isInitializing, router]);

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
    }, ACCESS_REVALIDATE_INTERVAL_MS);

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') enforceAccess();
    });

    return () => {
      clearInterval(intervalId);
      appStateSub?.remove?.();
    };
  }, [enforceAccess, isAuthenticated, isInitializing, user?.id]);

  useEffect(() => {
    if (isInitializing || !isAuthenticated || !user?.id) return undefined;
    if (pushSyncDoneForUserRef.current === user.id) return undefined;

    let active = true;
    const runBootstrap = async (requestPermission) => {
      if (pushSyncInFlightRef.current) return;
      pushSyncInFlightRef.current = true;
      try {
        await bootstrapPushForUserWithOptions(user.id, { requestPermission });
        if (active && requestPermission) {
          pushSyncDoneForUserRef.current = user.id;
        }
      } catch {} finally {
        pushSyncInFlightRef.current = false;
      }
    };

    runBootstrap(true).catch(() => {});

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        runBootstrap(false).catch(() => {});
      }
    });

    return () => {
      active = false;
      appStateSub?.remove?.();
    };
  }, [isAuthenticated, isInitializing, user?.id]);

  const extractOrderIdFromNotificationResponse = useCallback((response) => {
    const rawData = response?.notification?.request?.content?.data;
    let data = rawData;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        data = {};
      }
    }
    if (!data || typeof data !== 'object') data = {};

    const directId =
      data.order_id ??
      data.orderId ??
      (data.entity_type === 'order' ? data.entity_id : null) ??
      data.request_id ??
      null;
    if (directId != null && String(directId).trim() !== '') {
      return String(directId).trim();
    }

    const params = data.params;
    if (params && typeof params === 'object' && params.id != null && String(params.id).trim() !== '') {
      return String(params.id).trim();
    }

    const route = String(data.route || data.path || '').trim();
    if (route) {
      const match = route.match(/\/orders\/([^/?#]+)/i);
      if (match?.[1]) return String(match[1]).trim();
    }

    return null;
  }, []);

  const extractOrderIdFromNotificationContent = useCallback((notification) => {
    const rawData = notification?.request?.content?.data;
    let data = rawData;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        data = {};
      }
    }
    if (!data || typeof data !== 'object') return null;

    const directId =
      data.order_id ??
      data.orderId ??
      (data.entity_type === 'order' ? data.entity_id : null) ??
      data.request_id ??
      null;
    if (directId != null && String(directId).trim() !== '') {
      return String(directId).trim();
    }

    const params = data.params;
    if (params && typeof params === 'object' && params.id != null && String(params.id).trim() !== '') {
      return String(params.id).trim();
    }

    const route = String(data.route || data.path || '').trim();
    if (route) {
      const match = route.match(/\/orders\/([^/?#]+)/i);
      if (match?.[1]) return String(match[1]).trim();
    }

    return null;
  }, []);

  const extractEventTypeFromNotificationContent = useCallback((notification) => {
    const rawData = notification?.request?.content?.data;
    let data = rawData;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        data = {};
      }
    }
    if (!data || typeof data !== 'object') return '';
    return String(data.event_type || '').trim();
  }, []);

  const dismissPresentedNotificationsForOrder = useCallback(
    async (orderId, Notifications) => {
      const normalized = String(orderId || '').trim();
      if (!normalized) return;

      const moduleRef = Notifications || (await import('expo-notifications'));
      const list = await moduleRef.getPresentedNotificationsAsync?.();
      if (!Array.isArray(list) || !list.length) return;

      const toDismiss = [];
      for (const item of list) {
        const itemOrderId = extractOrderIdFromNotificationContent(item);
        if (itemOrderId && itemOrderId === normalized) {
          const identifier = String(item?.request?.identifier || '').trim();
          if (identifier) toDismiss.push(identifier);
        }
      }

      for (const id of toDismiss) {
        try {
          await moduleRef.dismissNotificationAsync?.(id);
        } catch {}
      }
    },
    [extractOrderIdFromNotificationContent],
  );

  const cleanupStalePresentedNotifications = useCallback(async () => {
    if (presentedCleanupInFlightRef.current) return;
    if (Platform.OS === 'web' || !user?.id) return;

    presentedCleanupInFlightRef.current = true;
    try {
      const Notifications = await import('expo-notifications');
      const presented = await Notifications.getPresentedNotificationsAsync?.();
      if (!Array.isArray(presented) || presented.length === 0) return;

      const entries = [];
      const orderIds = new Set();
      for (const item of presented) {
        const orderId = extractOrderIdFromNotificationContent(item);
        if (!orderId) continue;
        const eventType = extractEventTypeFromNotificationContent(item);
        const identifier = String(item?.request?.identifier || '').trim();
        if (!identifier) continue;
        entries.push({ identifier, orderId, eventType });
        orderIds.add(orderId);
      }
      if (!entries.length || !orderIds.size) return;

      const { data: rows, error } = await supabase
        .from('orders_secure_v2')
        .select('id, assigned_to')
        .in('id', Array.from(orderIds));
      if (error) return;

      const byId = new Map((rows || []).map((row) => [String(row.id), row]));
      const dismissIds = new Set();

      for (const item of entries) {
        const row = byId.get(item.orderId);
        if (!row) {
          dismissIds.add(item.identifier);
          continue;
        }

        if (item.eventType === 'feed_new_order' || item.eventType === 'feed_stale_reminder') {
          if (row.assigned_to != null) dismissIds.add(item.identifier);
          continue;
        }

        if (item.eventType === 'assigned_new_order') {
          if (!row.assigned_to || String(row.assigned_to) !== String(user.id)) {
            dismissIds.add(item.identifier);
          }
        }
      }

      for (const id of dismissIds) {
        try {
          await Notifications.dismissNotificationAsync?.(id);
        } catch {}
      }
    } catch {
      // noop
    } finally {
      presentedCleanupInFlightRef.current = false;
    }
  }, [extractEventTypeFromNotificationContent, extractOrderIdFromNotificationContent, user?.id]);

  const getActiveOrderIdFromPathname = useCallback((currentPathname) => {
    const normalized = String(currentPathname || '').trim();
    const match = normalized.match(/^\/orders\/([^/?#]+)$/i);
    if (!match?.[1]) return null;
    return String(match[1]).trim();
  }, []);

  const getNotificationResponseKey = useCallback(
    (response) => {
      const requestId = String(response?.notification?.request?.identifier || '').trim();
      const actionId = String(response?.actionIdentifier || '').trim();
      const orderId = String(extractOrderIdFromNotificationResponse(response) || '').trim();
      return `${requestId}|${actionId}|${orderId}`;
    },
    [extractOrderIdFromNotificationResponse],
  );

  const openOrderFromNotification = useCallback(
    async (orderId) => {
      if (!orderId || notificationOpenInFlightRef.current) return;
      notificationOpenInFlightRef.current = true;
      try {
        const order = await getRequestById(orderId);
        if (!order?.id) {
          toast.error(t('push_open_order_unavailable'));
          router.replace('/orders/my-orders');
          return;
        }

        router.push({
          pathname: `/orders/${order.id}`,
          params: {
            returnTo: '/orders/my-orders',
            returnParams: JSON.stringify({ fromNotification: true }),
          },
        });

        // Mark all currently shown notifications for this order as consumed.
        dismissPresentedNotificationsForOrder(order.id).catch(() => {});
      } catch {
        toast.error(t('push_open_generic_error'));
        router.replace('/orders');
      } finally {
        notificationOpenInFlightRef.current = false;
      }
    },
    [dismissPresentedNotificationsForOrder, router, t, toast],
  );

  useEffect(() => {
    if (Platform.OS === 'web' || isInitializing || !isAuthenticated || isBlockedScreen) {
      return undefined;
    }

    let active = true;
    let responseSub = null;

    const handleResponse = async (response, Notifications) => {
      if (!active || !response) return;
      const dedupeKey = getNotificationResponseKey(response);
      if (dedupeKey && lastHandledNotificationKeyRef.current === dedupeKey) return;
      if (dedupeKey) lastHandledNotificationKeyRef.current = dedupeKey;

      const orderId = extractOrderIdFromNotificationResponse(response);
      if (!orderId) return;

      await openOrderFromNotification(orderId);
      try {
        await Notifications?.clearLastNotificationResponseAsync?.();
      } catch {}
    };

    const init = async () => {
      try {
        const Notifications = await import('expo-notifications');
        responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
          handleResponse(response, Notifications).catch(() => {});
        });

        const lastResponse = await Notifications.getLastNotificationResponseAsync?.();
        if (lastResponse) {
          await handleResponse(lastResponse, Notifications);
        }
      } catch {
        // noop
      }
    };

    init().catch(() => {});

    return () => {
      active = false;
      responseSub?.remove?.();
    };
  }, [
    extractOrderIdFromNotificationResponse,
    getNotificationResponseKey,
    isAuthenticated,
    isBlockedScreen,
    isInitializing,
    openOrderFromNotification,
  ]);

  useEffect(() => {
    if (Platform.OS === 'web' || isInitializing || !isAuthenticated || isBlockedScreen || !user?.id) {
      return undefined;
    }

    cleanupStalePresentedNotifications().catch(() => {});
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        cleanupStalePresentedNotifications().catch(() => {});
      }
    });
    return () => appStateSub?.remove?.();
  }, [cleanupStalePresentedNotifications, isAuthenticated, isBlockedScreen, isInitializing, user?.id]);

  useEffect(() => {
    if (Platform.OS === 'web' || isInitializing || !isAuthenticated || isBlockedScreen) return;
    const orderId = getActiveOrderIdFromPathname(pathname);
    if (!orderId) return;
    dismissPresentedNotificationsForOrder(orderId).catch(() => {});
  }, [
    dismissPresentedNotificationsForOrder,
    getActiveOrderIdFromPathname,
    isAuthenticated,
    isBlockedScreen,
    isInitializing,
    pathname,
  ]);

  if (isInitializing) {
    return (
      <SafeAreaView
        edges={['top', 'left', 'right']}
        style={{ flex: 1, backgroundColor: theme.colors.background }}
      />
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
                animationTypeForReplace: 'push',
                gestureEnabled: true,
                fullScreenGestureEnabled: true,
                contentStyle: { backgroundColor: theme.colors.background },
              }}
            >
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="orders" />
              <Stack.Screen
                name="app_settings/AppSettings"
                options={{ title: 'Настройки приложения' }}
              />
              <Stack.Screen
                name="company_settings/index"
                options={{ title: 'Настройки компании' }}
              />
              <Stack.Screen
                name="company_settings/sections/telegram-bot"
                options={{ title: 'Telegram Bot' }}
              />
              <Stack.Screen name="users/index" options={{ title: 'Users' }} />
              <Stack.Screen name="users/new" options={{ title: 'New User' }} />
              <Stack.Screen name="users/[id]/index" options={{ title: 'User' }} />
              <Stack.Screen name="users/[id]/edit" options={{ title: 'Edit User' }} />
              <Stack.Screen name="clients/index" options={{ title: 'Clients' }} />
              <Stack.Screen name="clients/new" options={{ title: 'New Client' }} />
              <Stack.Screen name="clients/[id]/index" options={{ title: 'Client' }} />
              <Stack.Screen name="clients/[id]/edit" options={{ title: 'Edit Client' }} />
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
            {isAuthenticated ? <RouteFreshnessBoundary /> : null}
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
