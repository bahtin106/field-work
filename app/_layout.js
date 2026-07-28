import { router as globalRouter, Stack, usePathname, useRouter, useSegments } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Image, InteractionManager, LogBox, Platform, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { enableFreeze } from 'react-native-screens';
import { installDevWarnFilters } from '../src/utils/devWarnFilter';

installDevWarnFilters();

if (Platform.OS !== 'web' && !globalThis.__reactNativeScreensFreezeEnabled) {
  enableFreeze(true);
  globalThis.__reactNativeScreensFreezeEnabled = true;
}

LogBox.ignoreLogs([
  /No route named/,
  /`expo-notifications` functionality is not fully supported in Expo Go/i,
  /expo-notifications: Android Push notifications \(remote notifications\) functionality provided/i,
  /Expo Go can no longer provide full access to the media library/i,
]);

import BottomNav from '../components/navigation/BottomNav';
import { renderNavigationScreen } from '../components/navigation/NavigationCommitBoundary';
import ToastProvider from '../components/ui/ToastProvider';
import { applyAndroidStatusBar, applyAndroidSystemBars } from '../lib/systemBars';
import { installClientErrorLogging, uninstallClientErrorLogging } from '../lib/errorLogsClient';
import {
  getLastPublicAuthRoute,
  hydratePublicAuthRoute,
  rememberPublicAuthRoute,
  resetPublicAuthRoute,
} from '../lib/authFlowNavigationState';
import { bootstrapPushForUserWithOptions } from '../lib/pushAutoSetup';
import patchRouter from '../lib/navigation/patchRouter';
import dismissToRoute from '../lib/navigation/dismissToRoute';
import {
  getNotificationOrderId,
  getNotificationResponseKey,
  notificationBelongsToUser,
  resolveNotificationTarget,
} from '../lib/notificationRouting';
import { shouldSuppressForegroundOrderNotification } from '../lib/notificationForegroundState';
import { PermissionsProvider } from '../lib/permissions';
import { supabase } from '../lib/supabase';
import { loadUserLocale } from '../lib/userLocale';
import { SimpleAuthProvider, useAuthContext } from '../providers/SimpleAuthProvider';
import { initI18n, setLocale } from '../src/i18n';
import { useTranslation } from '../src/i18n/useTranslation';
import { FeedbackProvider } from '../src/shared/feedback';
import { FormAutoScrollProvider } from '../src/shared/forms/FormAutoScrollContext';
import OfflineStatusBanner from '../src/shared/offline/OfflineStatusBanner';
import {
  getOfflineSnapshot,
  isOfflineLikeError,
  subscribeOfflineState,
} from '../src/shared/offline/offlineStatus';
import {
  registerOfflineBackgroundSync,
  recoverInterruptedOrderPhotoQueue,
  runBackgroundSync,
} from '../src/shared/offline/backgroundSync';
import QueryProvider from '../src/shared/query/QueryProvider';
import RouteFreshnessBoundary from '../src/shared/query/RouteFreshnessBoundary';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';
import { useAppLastSeen } from '../useAppLastSeen';
import { KeyboardProvider } from '../lib/keyboardControllerCompat';
import { HelpCenterProvider } from '../src/features/helpCenter/HelpCenterProvider';

export const unstable_settings = {
  initialRouteName: 'index',
};

function ensureForegroundNotificationHandler() {
  if (Platform.OS === 'web') return;
  if (globalThis.__foregroundNotifHandlerConfigured) return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const belongsToCurrentUser = notificationBelongsToUser(
          notification,
          globalThis.__activeNotificationUserId,
        );
        const shouldShow =
          belongsToCurrentUser &&
          !shouldSuppressForegroundOrderNotification(notification);
        return {
          shouldShowBanner: shouldShow,
          shouldShowList: shouldShow,
          shouldPlaySound: shouldShow,
          shouldSetBadge: false,
        };
      },
    });
    globalThis.__foregroundNotifHandlerConfigured = true;
  } catch {
    globalThis.__foregroundNotifHandlerConfigured = false;
  }
}

ensureForegroundNotificationHandler();

function LastSeenTracker() {
  const { user } = useAuthContext();
  useAppLastSeen(60_000, user?.id || null);
  return null;
}

const ACCESS_REVALIDATE_INTERVAL_MS = 5 * 60 * 1000;
const ACCESS_CHECK_MIN_GAP_MS = 1200;
const ACCESS_BOOTSTRAP_DELAY_MS = 1800;
const PUSH_BOOTSTRAP_DELAY_MS = 4500;

if (!globalThis.__splashPrevented) {
  globalThis.__splashPrevented = true;
  SplashScreen.preventAutoHideAsync().catch(() => {});
}

function _BrandedLoadingScreen({ theme, label }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 }}>
      <Image
        source={require('../assets/icon.png')}
        style={{ width: 112, height: 112 }}
        resizeMode="contain"
      />
      <Text
        style={{
          marginTop: 20,
          color: theme.colors.text,
          fontSize: 16,
          fontWeight: '600',
          letterSpacing: 0.2,
        }}
      >
        {label}
      </Text>
      <ActivityIndicator size="small" color={theme.colors.primary} style={{ marginTop: 12 }} />
    </View>
  );
}

function RootLayoutInner() {
  const { isInitializing, isSigningOut, isAuthenticated, user } = useAuthContext();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const splashHiddenRef = useRef(false);
  const segmentsRef = useRef(segments);
  const accessCheckInFlightRef = useRef(false);
  const lastAccessCheckAtRef = useRef(0);
  const pushSyncInFlightRef = useRef(null);
  const pushSyncDoneForUserRef = useRef(null);
  const lastHandledNotificationKeyRef = useRef('');
  const notificationIdsByOrderRef = useRef(new Map());
  const previousAuthStateRef = useRef(isAuthenticated);
  const returnToHomeAfterLogoutRef = useRef(false);
  const authSnapshotRef = useRef({ isAuthenticated, userId: String(user?.id || '') });
  authSnapshotRef.current = { isAuthenticated, userId: String(user?.id || '') };
  globalThis.__activeNotificationUserId = isAuthenticated ? String(user?.id || '') : '';
  const [publicAuthRouteHydrated, setPublicAuthRouteHydrated] = useState(false);
  const inAuthGroup = segments[0] === '(auth)';
  const authScreen = segments[1] || '';
  const normalizedPathname = String(pathname || '').trim().replace(/\/+$/, '') || '/';
  const isAuthPathname =
    normalizedPathname.startsWith('/(auth)') ||
    /^\/(?:login|blocked|register|register-code|verify-email|set-password)(?:\/|$)/.test(normalizedPathname);
  const inAuthFlow = inAuthGroup || isAuthPathname;
  const isBlockedScreen =
    (inAuthGroup && authScreen === 'blocked') ||
    normalizedPathname === '/blocked' ||
    normalizedPathname === '/(auth)/blocked';
  const rootSafeEdges = ['top', 'left', 'right'];

  const isSamePath = useCallback((targetPath) => {
    const current = String(pathname || '').trim().replace(/\/+$/, '') || '/';
    const target = String(targetPath || '').trim().replace(/\/+$/, '') || '/';
    return current === target;
  }, [pathname]);

  useEffect(() => {
    lastHandledNotificationKeyRef.current = '';
    notificationIdsByOrderRef.current.clear();
  }, [user?.id]);

  useEffect(() => {
    let mounted = true;
    hydratePublicAuthRoute().finally(() => {
      if (mounted) setPublicAuthRouteHydrated(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const isAuthenticatedUserCurrent = useCallback((expectedUserId) => {
    const snapshot = authSnapshotRef.current;
    return (
      snapshot.isAuthenticated === true &&
      String(snapshot.userId || '') === String(expectedUserId || '')
    );
  }, []);

  useEffect(() => {
    if (previousAuthStateRef.current && !isAuthenticated) {
      // A nested orders navigator can retain its last child (for example, Calendar).
      // A fresh session after an explicit logout must always start at the home route.
      returnToHomeAfterLogoutRef.current = true;
      resetPublicAuthRoute();
    }
    previousAuthStateRef.current = isAuthenticated;
  }, [isAuthenticated]);

  const hasAccessRelevantProfileChange = useCallback((payload) => {
    if (!payload || typeof payload !== 'object') return true;
    const next = payload.new && typeof payload.new === 'object' ? payload.new : null;
    const prev = payload.old && typeof payload.old === 'object' ? payload.old : null;
    if (!next || !prev) return true;

    const watchedColumns = ['is_admin_blocked', 'license_state', 'blocked_reason', 'company_id'];
    return watchedColumns.some((column) => String(next?.[column] ?? '') !== String(prev?.[column] ?? ''));
  }, []);

  useEffect(() => {
    installClientErrorLogging();
    return () => {
      uninstallClientErrorLogging();
    };
  }, []);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    try {
      patchRouter(router, { pendingMs: 0 });
    } catch {}

    try {
      patchRouter(globalRouter, { pendingMs: 0 });
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
    if (inAuthFlow) {
      applyAndroidStatusBar(theme);
      return;
    }
    applyAndroidSystemBars(theme).catch(() => {});
  }, [inAuthFlow, theme]);

  useEffect(() => {
    if (!publicAuthRouteHydrated) return;
    if (isAuthenticated) {
      resetPublicAuthRoute();
      return;
    }
    if (inAuthFlow && !isBlockedScreen) {
      rememberPublicAuthRoute({ pathname, segments });
    }
  }, [inAuthFlow, isAuthenticated, isBlockedScreen, pathname, publicAuthRouteHydrated, segments]);

  const shouldHoldNativeSplash =
    isInitializing ||
    !publicAuthRouteHydrated;

  useEffect(() => {
    if (shouldHoldNativeSplash) return;
    hideSplash();
  }, [hideSplash, shouldHoldNativeSplash]);

  useEffect(() => {
    if (isInitializing || !publicAuthRouteHydrated) return;
    if (isAuthenticated && returnToHomeAfterLogoutRef.current && !isBlockedScreen) {
      if (isSamePath('/orders')) {
        returnToHomeAfterLogoutRef.current = false;
      } else {
        router.replace('/orders');
      }
    } else if (!isAuthenticated) {
      const target = getLastPublicAuthRoute('/(auth)/login');
      const isLoginScreen =
        normalizedPathname === '/login' || normalizedPathname === '/(auth)/login';
      if ((!inAuthFlow || (isLoginScreen && target !== '/(auth)/login')) && !isSamePath(target)) {
        router.replace(target);
      }
    } else if (normalizedPathname === '/') {
      router.replace('/orders');
    } else if (isAuthenticated && inAuthFlow && !isBlockedScreen && !isSamePath('/orders')) {
      router.replace('/orders');
    }
  }, [inAuthFlow, isAuthenticated, isBlockedScreen, isInitializing, isSamePath, normalizedPathname, publicAuthRouteHydrated, router]);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;

    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isInitializing || !isAuthenticated || isBlockedScreen) return false;

      const current = String(pathname || '').trim();
      if (!current || current === '/orders' || current === '/orders/' || inAuthFlow) {
        return false;
      }

      const canGoBack = typeof router?.canGoBack === 'function' && router.canGoBack();
      if (canGoBack) return false;

      dismissToRoute(router, '/orders');
      return true;
    });

    return () => sub.remove();
  }, [inAuthFlow, isAuthenticated, isBlockedScreen, isInitializing, pathname, router]);

  const loadOwnAccessProfile = useCallback(async (uid) => {
    if (!uid) return null;
    const columns = 'is_admin_blocked, license_state, blocked_reason';

    const { data: byId } = await supabase
      .from('profiles')
      .select(columns)
      .eq('id', uid)
      .maybeSingle();
    return byId || null;
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) return undefined;
    let active = true;
    let running = false;
    let initialized = false;

    const run = async () => {
      if (!active || !initialized || running) return;
      const network = getOfflineSnapshot();
      if (network.isNetworkKnown && !network.isOnline) return;
      running = true;
      try {
        await runBackgroundSync();
      } finally {
        running = false;
      }
    };

    registerOfflineBackgroundSync().catch(() => {});
    recoverInterruptedOrderPhotoQueue()
      .catch(() => {})
      .finally(() => {
        initialized = true;
        run().catch(() => {});
      });
    const unsubscribeNetwork = subscribeOfflineState(() => {
      run().catch(() => {});
    });
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') run().catch(() => {});
    });
    const retryTimer = setInterval(() => {
      run().catch(() => {});
    }, 60_000);

    return () => {
      active = false;
      unsubscribeNetwork();
      appStateSubscription.remove();
      clearInterval(retryTimer);
    };
  }, [isAuthenticated, user?.id]);

  const enforceAccess = useCallback(async () => {
    if (isInitializing || !isAuthenticated || !user?.id) return;
    const expectedUserId = String(user.id);
    if (accessCheckInFlightRef.current) return;
    const now = Date.now();
    if (now - lastAccessCheckAtRef.current < ACCESS_CHECK_MIN_GAP_MS) return;
    lastAccessCheckAtRef.current = now;

    accessCheckInFlightRef.current = true;
    try {
      const seg = Array.isArray(segmentsRef.current) ? segmentsRef.current : [];
      const inAuthGroup = seg[0] === '(auth)';
      const isBlockedScreen = inAuthGroup && seg[1] === 'blocked';

      const { data: accessData, error: accessError } = await supabase.rpc('get_my_access_state');
      if (!isAuthenticatedUserCurrent(expectedUserId)) return;

      if (!accessError) {
        const accessRow = Array.isArray(accessData) ? accessData[0] : accessData;
        if (accessRow?.can_login === false) {
          const code = String(accessRow.block_code || 'access_blocked');
          const message = String(accessRow.block_message || '');
          const fallbackMessage =
            code === 'blocked_by_license'
              ? t('auth_blocked_by_license')
              : code === 'company_inactive'
                ? t('auth_company_inactive')
                : `${t('auth_access_blocked')}. ${t('auth_blocked_subtitle')}`;
          if (!isBlockedScreen) {
            router.replace({
              pathname: '/(auth)/blocked',
              params: {
                code,
                message: message || fallbackMessage,
                ts: String(Date.now()),
              },
            });
          }
          return;
        }

        if (isBlockedScreen) {
          if (!isSamePath('/orders')) {
            router.replace('/orders');
          }
        }
        return;
      }

      if (!getOfflineSnapshot().isOnline || isOfflineLikeError(accessError)) {
        // Never treat connectivity problems as account blocking.
        return;
      }

      const profile = await loadOwnAccessProfile(expectedUserId);
      if (!isAuthenticatedUserCurrent(expectedUserId)) return;
      if (!profile) {
        // Fail-open: transient profile lookup issues should not kick active users into a block loop.
        return;
      }

      const blockedByAdmin =
        !!profile?.is_admin_blocked;
      const blockedByLicense = String(profile?.license_state || '') === 'blocked_by_license';
      const blocked = blockedByAdmin || blockedByLicense;

      if (blocked && !isBlockedScreen) {
        const code = blockedByAdmin ? 'admin_blocked' : 'blocked_by_license';
        const fallbackMessage = blockedByAdmin
          ? `${t('auth_access_blocked')}. ${t('auth_blocked_subtitle')}`
          : t('auth_blocked_by_license');
        router.replace({
          pathname: '/(auth)/blocked',
          params: {
            code,
            message: fallbackMessage,
            ts: String(Date.now()),
          },
        });
      } else if (!blocked && isBlockedScreen) {
        if (!isSamePath('/orders')) {
          router.replace('/orders');
        }
      }
    } catch {
      // noop
    } finally {
      accessCheckInFlightRef.current = false;
    }
  }, [isAuthenticated, isAuthenticatedUserCurrent, isInitializing, isSamePath, loadOwnAccessProfile, router, t, user?.id]);

  useEffect(() => {
    if (isInitializing || !isAuthenticated || !user?.id) return;

    let bootstrapTask = null;
    const bootstrapTimer = setTimeout(() => {
      bootstrapTask = InteractionManager.runAfterInteractions(() => {
        enforceAccess();
      });
    }, ACCESS_BOOTSTRAP_DELAY_MS);

    const intervalId = setInterval(() => {
      enforceAccess();
    }, ACCESS_REVALIDATE_INTERVAL_MS);

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') enforceAccess();
    });

    return () => {
      clearTimeout(bootstrapTimer);
      try {
        bootstrapTask?.cancel?.();
      } catch {}
      clearInterval(intervalId);
      appStateSub?.remove?.();
    };
  }, [enforceAccess, isAuthenticated, isInitializing, user?.id]);

  useEffect(() => {
    if (isInitializing || !isAuthenticated) return;
    if (inAuthGroup && !isBlockedScreen) {
      enforceAccess();
    }
  }, [enforceAccess, inAuthGroup, isAuthenticated, isBlockedScreen, isInitializing]);

  useEffect(() => {
    if (isInitializing || !isAuthenticated || !user?.id) return undefined;

    const channelById = supabase
      .channel(`self-access-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`,
        },
        (payload) => {
          if (!hasAccessRelevantProfileChange(payload)) return;
          enforceAccess();
        },
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channelById);
      } catch {}
    };
  }, [enforceAccess, hasAccessRelevantProfileChange, isAuthenticated, isInitializing, user?.id]);

  useEffect(() => {
    if (isInitializing || !isAuthenticated || !user?.id) return undefined;
    if (pushSyncDoneForUserRef.current === user.id) return undefined;

    let active = true;
    const runBootstrap = async (requestPermission) => {
      if (pushSyncInFlightRef.current === user.id) return;
      pushSyncInFlightRef.current = user.id;
      try {
        const result = await bootstrapPushForUserWithOptions(user.id, { requestPermission });
        if (active && requestPermission && result?.ok) {
          pushSyncDoneForUserRef.current = user.id;
        }
      } catch {} finally {
        if (pushSyncInFlightRef.current === user.id) {
          pushSyncInFlightRef.current = null;
        }
      }
    };

    // Existing permission/token state is read silently and rebound to the new
    // account immediately. The delayed pass below is only for permission UX.
    const silentBootstrap = runBootstrap(false).catch(() => {});

    let bootstrapTask = null;
    const bootstrapTimer = setTimeout(() => {
      silentBootstrap.finally(() => {
        if (!active) return;
        bootstrapTask = InteractionManager.runAfterInteractions(() => {
          runBootstrap(true).catch(() => {});
        });
      });
    }, PUSH_BOOTSTRAP_DELAY_MS);

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        runBootstrap(false).catch(() => {});
      }
    });

    return () => {
      active = false;
      clearTimeout(bootstrapTimer);
      try {
        bootstrapTask?.cancel?.();
      } catch {}
      appStateSub?.remove?.();
    };
  }, [isAuthenticated, isInitializing, user?.id]);

  const dismissPresentedNotificationsForOrder = useCallback(
    async (orderId) => {
      const normalized = String(orderId || '').trim();
      if (!normalized) return;

      const moduleRef = Notifications;
      const rememberedIds = notificationIdsByOrderRef.current.get(normalized) || new Set();
      const toDismiss = new Set(rememberedIds);
      const list = await moduleRef.getPresentedNotificationsAsync?.();
      if (Array.isArray(list) && list.length) {
        for (const item of list) {
          const itemOrderId = getNotificationOrderId(item);
          if (itemOrderId && itemOrderId === normalized) {
            const identifier = String(item?.request?.identifier || '').trim();
            if (identifier) toDismiss.add(identifier);
          }
        }
      }

      for (const id of toDismiss) {
        try {
          await moduleRef.dismissNotificationAsync?.(id);
        } catch {}
      }

      notificationIdsByOrderRef.current.delete(normalized);
    },
    [],
  );

  const getActiveOrderIdFromPathname = useCallback((currentPathname) => {
    const normalized = String(currentPathname || '').trim();
    const match = normalized.match(/^\/orders\/([^/?#]+)$/i);
    if (!match?.[1]) return null;
    return String(match[1]).trim();
  }, []);

  const openSupportFeedbackFromNotification = useCallback(
    (feedbackId) => {
      const normalizedFeedbackId = String(feedbackId || '').trim();
      if (!normalizedFeedbackId) return;
      router.push({
        pathname: '/admin/feedbacks/[id]',
        params: { id: normalizedFeedbackId, fromNotification: '1' },
      });
    },
    [router],
  );

  const openOrderFromNotification = useCallback(
    (orderId) => {
      const normalizedOrderId = String(orderId || '').trim();
      if (!normalizedOrderId) return;
      if (getActiveOrderIdFromPathname(pathnameRef.current) !== normalizedOrderId) {
        router.push({
          pathname: '/orders/[id]',
          params: {
            id: normalizedOrderId,
            fromNotification: '1',
            returnTo: '/orders',
          },
        });
      }
      dismissPresentedNotificationsForOrder(normalizedOrderId).catch(() => {});
    },
    [
      dismissPresentedNotificationsForOrder,
      getActiveOrderIdFromPathname,
      router,
    ],
  );

  useEffect(() => {
    if (Platform.OS === 'web' || isInitializing || !isAuthenticated || isBlockedScreen) {
      return undefined;
    }

    let active = true;

    const rememberNotificationIdentifier = (notification) => {
      const orderId = String(getNotificationOrderId(notification) || '').trim();
      if (!orderId) return;
      const identifier = String(notification?.request?.identifier || '').trim();
      if (!identifier) return;
      const next = notificationIdsByOrderRef.current.get(orderId) || new Set();
      next.add(identifier);
      notificationIdsByOrderRef.current.set(orderId, next);
    };

    const clearLastResponse = () => {
      try {
        Notifications.clearLastNotificationResponse?.();
      } catch {}
    };

    const dismissTappedNotification = (response) => {
      const identifier = String(response?.notification?.request?.identifier || '').trim();
      if (identifier) {
        Notifications.dismissNotificationAsync?.(identifier).catch(() => {});
      }
    };

    const handleResponse = (response) => {
      if (!active || !response) return;
      const expectedUserId = authSnapshotRef.current.userId;
      if (!isAuthenticatedUserCurrent(expectedUserId)) return;
      if (!notificationBelongsToUser(response, expectedUserId)) {
        dismissTappedNotification(response);
        clearLastResponse();
        return;
      }
      const dedupeKey = getNotificationResponseKey(response);
      if (dedupeKey && lastHandledNotificationKeyRef.current === dedupeKey) {
        clearLastResponse();
        return;
      }
      if (dedupeKey) lastHandledNotificationKeyRef.current = dedupeKey;

      const target = resolveNotificationTarget(response);
      clearLastResponse();
      dismissTappedNotification(response);
      if (!target) return;
      if (target.kind === 'support-feedback') {
        openSupportFeedbackFromNotification(target.entityId);
      } else if (target.kind === 'order') {
        openOrderFromNotification(target.entityId);
      }
    };

    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      const currentUserId = authSnapshotRef.current.userId;
      if (!notificationBelongsToUser(notification, currentUserId)) {
        const identifier = String(notification?.request?.identifier || '').trim();
        if (identifier) Notifications.dismissNotificationAsync?.(identifier).catch(() => {});
        return;
      }
      rememberNotificationIdentifier(notification);
    });
    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      rememberNotificationIdentifier(response?.notification);
      handleResponse(response);
    });

    try {
      const initialResponse = Notifications.getLastNotificationResponse?.();
      if (initialResponse) handleResponse(initialResponse);
    } catch {}

    Notifications.getPresentedNotificationsAsync?.()
      .then((presented) => {
        if (!active || !Array.isArray(presented)) return;
        for (const item of presented) rememberNotificationIdentifier(item);
      })
      .catch(() => {});

    return () => {
      active = false;
      responseSub?.remove?.();
      receivedSub?.remove?.();
    };
  }, [
    isAuthenticated,
    isAuthenticatedUserCurrent,
    isBlockedScreen,
    isInitializing,
    openSupportFeedbackFromNotification,
    openOrderFromNotification,
  ]);

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

  if ((isInitializing || !publicAuthRouteHydrated) && !isSigningOut) {
    return (
      <SafeAreaView
        edges={rootSafeEdges}
        style={{ flex: 1, backgroundColor: theme.colors.background }}
      >
        <_BrandedLoadingScreen
          theme={theme}
          label={t('toast_loading_info')}
        />
      </SafeAreaView>
    );
  }

  return (
    <GestureHandlerRootView
      style={[
        { flex: 1, backgroundColor: theme.colors.background },
        Platform.OS === 'web' ? { width: '100%', maxWidth: 600, alignSelf: 'center', marginHorizontal: 'auto' } : undefined
      ]}
      onLayout={hideSplash}
    >
      <PermissionsProvider>
        <FormAutoScrollProvider scopeKey={pathname} enabled>
          <SafeAreaView
            edges={rootSafeEdges}
            style={{ flex: 1, backgroundColor: theme.colors.background }}
          >
            {isAuthenticated && !isBlockedScreen ? <OfflineStatusBanner /> : null}
            <View style={{ flex: 1, minHeight: 0 }}>
              <Stack
                initialRouteName="index"
                screenLayout={renderNavigationScreen}
                screenOptions={{
                  headerShown: false,
                  animation: 'none',
                  animationTypeForReplace: 'push',
                  gestureEnabled: true,
                  fullScreenGestureEnabled: true,
                  freezeOnBlur: true,
                  contentStyle: { backgroundColor: theme.colors.background },
                }}
              >
                <Stack.Screen name="index" />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="orders" />
                  <Stack.Screen
                    name="app_settings/AppSettings"
                    options={{ title: t('routes.app_settings/AppSettings') }}
                  />
                  <Stack.Screen
                    name="company_settings/index"
                    options={{ title: t('routes.company_settings/index') }}
                  />
                  <Stack.Screen
                    name="company_settings/sections/telegram-bot"
                    options={{ title: t('routes.company_settings/sections/telegram-bot') }}
                  />
                  <Stack.Screen
                    name="company_settings/sections/max-bot"
                    options={{ title: t('routes.company_settings/sections/max-bot') }}
                  />
                  <Stack.Screen
                    name="company_settings/sections/order-feed-fields"
                    options={{ title: t('settings_management_feed_fields') }}
                  />
                  <Stack.Screen
                    name="company_settings/sections/order-statuses"
                    options={{ title: t('order_statuses_title') }}
                  />
                  <Stack.Screen name="users/index" options={{ title: t('routes.users/index') }} />
                  <Stack.Screen name="users/new" options={{ title: t('routes.users/new') }} />
                  <Stack.Screen name="users/[id]/index" options={{ title: t('routes.users/[id]/index') }} />
                  <Stack.Screen name="users/[id]/edit" options={{ title: t('routes.users/[id]/edit') }} />
                  <Stack.Screen name="clients/index" options={{ title: t('routes.clients/index') }} />
                  <Stack.Screen name="clients/new" options={{ title: t('routes.clients/new') }} />
                  <Stack.Screen name="clients/[id]/index" options={{ title: t('routes.clients/[id]/index') }} />
                  <Stack.Screen name="clients/[id]/edit" options={{ title: t('routes.clients/[id]/edit') }} />
                  <Stack.Screen name="billing/index" options={{ title: t('routes.billing/index') }} />
                  <Stack.Screen name="support/index" options={{ title: t('support_requests_title') }} />
                  <Stack.Screen name="admin/index" />
                  <Stack.Screen name="admin/users/index" />
                  <Stack.Screen name="admin/users/[id]/index" />
                  <Stack.Screen name="admin/users/[id]/edit" />
                  <Stack.Screen name="admin/companies/index" />
                  <Stack.Screen name="admin/companies/details" />
                  <Stack.Screen name="admin/companies/edit" />
                  <Stack.Screen name="admin/feedbacks/index" />
                  <Stack.Screen name="admin/feedbacks/[id]/index" />
                  <Stack.Screen name="admin/promocodes/index" />
                  <Stack.Screen name="admin/storage/index" />
                  <Stack.Screen name="admin/server/index" />
                <Stack.Screen name="stats" options={{ title: t('routes.stats') }} />
              </Stack>
            </View>
            {isSigningOut || (!isAuthenticated && !inAuthFlow) ? (
              <View
                pointerEvents="auto"
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  bottom: 0,
                  left: 0,
                  zIndex: 100,
                  elevation: 100,
                  backgroundColor: theme.colors.background,
                }}
              >
                <_BrandedLoadingScreen theme={theme} label={t('toast_loading_info')} />
              </View>
            ) : null}
            {isAuthenticated ? <RouteFreshnessBoundary /> : null}
            {isAuthenticated && !isBlockedScreen && <BottomNav />}
            {isAuthenticated && <LastSeenTracker />}
          </SafeAreaView>
        </FormAutoScrollProvider>
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
                  <HelpCenterProvider>
                    <RootLayoutInner />
                  </HelpCenterProvider>
                </SimpleAuthProvider>
              </FeedbackProvider>
            </ToastProvider>
          </ThemeProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </QueryProvider>
  );
}

