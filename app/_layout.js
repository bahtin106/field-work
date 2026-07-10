import { router as globalRouter, Stack, usePathname, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Image, InteractionManager, Keyboard, LogBox, Platform, Text, TextInput, View } from 'react-native';
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
import ToastProvider, { useToast } from '../components/ui/ToastProvider';
import { applyAndroidStatusBar, applyAndroidSystemBars } from '../lib/systemBars';
import { installClientErrorLogging, uninstallClientErrorLogging } from '../lib/errorLogsClient';
import {
  getLastPublicAuthRoute,
  rememberPublicAuthRoute,
  resetPublicAuthRoute,
} from '../lib/authFlowNavigationState';
import { bootstrapPushForUserWithOptions } from '../lib/pushAutoSetup';
import patchRouter from '../lib/navigation/patchRouter';
import dismissToRoute from '../lib/navigation/dismissToRoute';
import { PermissionsProvider } from '../lib/permissions';
import { supabase } from '../lib/supabase';
import { loadUserLocale } from '../lib/userLocale';
import { SimpleAuthProvider, useAuthContext } from '../providers/SimpleAuthProvider';
import { getSupportRequestById } from '../src/features/supportRequests/api';
import { initI18n, setLocale } from '../src/i18n';
import { useTranslation } from '../src/i18n/useTranslation';
import { FeedbackProvider } from '../src/shared/feedback';
import OfflineStatusBanner from '../src/shared/offline/OfflineStatusBanner';
import { getOfflineSnapshot, isOfflineLikeError } from '../src/shared/offline/offlineStatus';
import QueryProvider from '../src/shared/query/QueryProvider';
import RouteFreshnessBoundary from '../src/shared/query/RouteFreshnessBoundary';
import { withAlpha } from '../theme/colors';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';
import { useAppLastSeen } from '../useAppLastSeen';
import { KeyboardProvider } from '../lib/keyboardControllerCompat';

function ensureForegroundNotificationHandler() {
  if (Platform.OS === 'web') return;
  if (globalThis.__foregroundNotifHandlerConfigured) return;
  globalThis.__foregroundNotifHandlerConfigured = true;

  import('expo-notifications')
    .then((Notifications) => {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
    })
    .catch(() => {
      globalThis.__foregroundNotifHandlerConfigured = false;
    });
}

function LastSeenTracker() {
  useAppLastSeen(30_000);
  return null;
}

function BlurFocusedInputOnKeyboardHide() {
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    // Android can emit keyboardDidHide while switching between inputs with
    // different keyboard modes (for example email -> password). Blurring the
    // current input there closes the newly opened keyboard immediately.
    if (Platform.OS === 'android') return undefined;

    const blurFocusedInput = () => {
      try {
        const state = TextInput?.State;
        const focusedInput = state?.currentlyFocusedInput?.();
        if (focusedInput && typeof focusedInput.blur === 'function') {
          focusedInput.blur();
        }
      } catch {
        // Nothing to blur.
      }
    };

    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subscription = Keyboard.addListener(hideEvent, blurFocusedInput);

    return () => {
      subscription?.remove?.();
    };
  }, []);

  return null;
}

const ACCESS_REVALIDATE_INTERVAL_MS = 5 * 60 * 1000;
const ACCESS_CHECK_MIN_GAP_MS = 1200;
const ACCESS_BOOTSTRAP_DELAY_MS = 1800;
const PUSH_BOOTSTRAP_DELAY_MS = 4500;
const NOTIFICATION_LISTENERS_DELAY_MS = 2800;

function isHuaweiLikeAndroidDevice() {
  if (Platform.OS !== 'android') return false;
  const constants = Platform.constants || {};
  const identity = [
    constants.Brand,
    constants.Manufacturer,
    constants.Model,
    constants.Device,
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');

  return identity.includes('huawei') || identity.includes('honor');
}

if (!globalThis.__splashPrevented) {
  globalThis.__splashPrevented = true;
  SplashScreen.preventAutoHideAsync().catch(() => {});
}

function _BrandedLoadingScreen({ theme, label }) {
  const isDark = theme?.mode === 'dark';
  const cardBg = withAlpha(theme.colors.surface, isDark ? 0.52 : 0.92);
  const cardBorder = withAlpha(theme.colors.border, isDark ? 0.72 : 0.92);
  const cardShadow =
    theme.shadows?.level2?.ios?.shadowColor ||
    theme.shadows?.card?.ios?.shadowColor ||
    theme.colors.shadow ||
    theme.colors.cardShadow;

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
          shadowColor: cardShadow,
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
        {label}
      </Text>
      <ActivityIndicator size="small" color={theme.colors.primary} style={{ marginTop: 12 }} />
    </View>
  );
}

function RootLayoutInner() {
  const { isInitializing, isSigningOut, isAuthenticated, user } = useAuthContext();
  const { t } = useTranslation();
  const toast = useToast();
  const { theme } = useTheme();
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();
  const splashHiddenRef = useRef(false);
  const segmentsRef = useRef(segments);
  const accessCheckInFlightRef = useRef(false);
  const lastAccessCheckAtRef = useRef(0);
  const pushSyncInFlightRef = useRef(false);
  const pushSyncDoneForUserRef = useRef(null);
  const notificationOpenInFlightRef = useRef(false);
  const lastHandledNotificationKeyRef = useRef('');
  const notificationIdsByOrderRef = useRef(new Map());
  const pendingInitialNotificationResponseRef = useRef(null);
  const initialNotificationCheckedRef = useRef(Platform.OS === 'web');
  const previousAuthStateRef = useRef(isAuthenticated);
  const returnToHomeAfterLogoutRef = useRef(false);
  const authSnapshotRef = useRef({ isAuthenticated, userId: String(user?.id || '') });
  authSnapshotRef.current = { isAuthenticated, userId: String(user?.id || '') };
  const [initialNotificationCheckPending, setInitialNotificationCheckPending] = useState(Platform.OS !== 'web');
  const [pendingNotificationLaunch, setPendingNotificationLaunch] = useState(false);
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
  // Some EMUI/HarmonyOS builds add a duplicated top inset with a non-translucent status bar.
  const rootSafeEdges = isHuaweiLikeAndroidDevice() ? ['left', 'right'] : ['top', 'left', 'right'];

  const isSamePath = useCallback((targetPath) => {
    const current = String(pathname || '').trim().replace(/\/+$/, '') || '/';
    const target = String(targetPath || '').trim().replace(/\/+$/, '') || '/';
    return current === target;
  }, [pathname]);

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
    if (isAuthenticated) {
      resetPublicAuthRoute();
      return;
    }
    if (inAuthFlow && !isBlockedScreen) {
      rememberPublicAuthRoute({ pathname, segments });
    }
  }, [inAuthFlow, isAuthenticated, isBlockedScreen, pathname, segments]);

  useEffect(() => {
    if (Platform.OS === 'web' || isInitializing || !isAuthenticated || isBlockedScreen) return undefined;
    let task = null;
    const timer = setTimeout(() => {
      task = InteractionManager.runAfterInteractions(() => {
        ensureForegroundNotificationHandler();
      });
    }, NOTIFICATION_LISTENERS_DELAY_MS);
    return () => {
      clearTimeout(timer);
      try {
        task?.cancel?.();
      } catch {}
    };
  }, [isAuthenticated, isBlockedScreen, isInitializing]);

  const shouldHoldNativeSplash =
    isInitializing ||
    initialNotificationCheckPending ||
    (pendingNotificationLaunch && isAuthenticated && !isBlockedScreen);

  useEffect(() => {
    if (shouldHoldNativeSplash) return;
    hideSplash();
  }, [hideSplash, shouldHoldNativeSplash]);

  useEffect(() => {
    if (isInitializing || isAuthenticated || !pendingNotificationLaunch) return;
    pendingInitialNotificationResponseRef.current = null;
    setPendingNotificationLaunch(false);
    import('expo-notifications')
      .then((Notifications) => Notifications.clearLastNotificationResponseAsync?.())
      .catch(() => {});
  }, [isAuthenticated, isInitializing, pendingNotificationLaunch]);

  useEffect(() => {
    if (isInitializing) return;
    if (pendingNotificationLaunch && isAuthenticated && !isBlockedScreen) return;
    if (isAuthenticated && returnToHomeAfterLogoutRef.current && !isBlockedScreen) {
      if (isSamePath('/orders')) {
        returnToHomeAfterLogoutRef.current = false;
      } else {
        router.replace('/orders');
      }
    } else if (!isAuthenticated && !inAuthFlow) {
      const target = getLastPublicAuthRoute('/(auth)/login');
      if (!isSamePath(target)) router.replace(target);
    } else if (isAuthenticated && inAuthFlow && !isBlockedScreen && !isSamePath('/orders')) {
      router.replace('/orders');
    }
  }, [inAuthFlow, isAuthenticated, isBlockedScreen, isInitializing, isSamePath, pendingNotificationLaunch, router]);

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

    let bootstrapTask = null;
    const bootstrapTimer = setTimeout(() => {
      bootstrapTask = InteractionManager.runAfterInteractions(() => {
        runBootstrap(true).catch(() => {});
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

  const extractOrderIdFromNotificationResponse = useCallback((response) => {
    const normalizeNotificationData = (raw) => {
      let value = raw;
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value);
        } catch {
          return {};
        }
      }
      if (!value || typeof value !== 'object') return {};
      return value;
    };

    const extractOrderIdFromData = (data) => {
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

      const paramsRaw = data.params;
      const params = normalizeNotificationData(paramsRaw);
      if (params.id != null && String(params.id).trim() !== '') {
        return String(params.id).trim();
      }

      const route = String(data.route || data.path || '').trim();
      if (route) {
        const match = route.match(/\/orders\/([^/?#]+)/i);
        if (match?.[1]) return String(match[1]).trim();
      }

      return null;
    };

    const notification = response?.notification;
    const contentData = normalizeNotificationData(notification?.request?.content?.data);
    const remoteData = normalizeNotificationData(notification?.request?.trigger?.remoteMessage?.data);
    const bundledData = normalizeNotificationData(remoteData?.data);

    return (
      extractOrderIdFromData(contentData) ||
      extractOrderIdFromData(remoteData) ||
      extractOrderIdFromData(bundledData) ||
      null
    );
  }, []);

  const extractSupportFeedbackIdFromNotificationResponse = useCallback((response) => {
    const normalizeNotificationData = (raw) => {
      let value = raw;
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value);
        } catch {
          return {};
        }
      }
      if (!value || typeof value !== 'object') return {};
      return value;
    };

    const extractFeedbackIdFromData = (data) => {
      if (!data || typeof data !== 'object') return null;

      const directId =
        data.feedback_id ??
        data.feedbackId ??
        (data.entity_type === 'support_feedback' ? data.entity_id : null) ??
        null;
      if (directId != null && String(directId).trim() !== '') {
        return String(directId).trim();
      }

      const params = normalizeNotificationData(data.params);
      if (params.id != null && String(params.id).trim() !== '') {
        const route = String(data.route || data.path || '').trim();
        if (route.includes('/admin/feedbacks')) return String(params.id).trim();
      }

      const route = String(data.route || data.path || '').trim();
      if (route) {
        const match = route.match(/\/admin\/feedbacks\/([^/?#]+)/i);
        if (match?.[1]) return String(match[1]).trim();
      }

      return null;
    };

    const notification = response?.notification;
    const contentData = normalizeNotificationData(notification?.request?.content?.data);
    const remoteData = normalizeNotificationData(notification?.request?.trigger?.remoteMessage?.data);
    const bundledData = normalizeNotificationData(remoteData?.data);

    return (
      extractFeedbackIdFromData(contentData) ||
      extractFeedbackIdFromData(remoteData) ||
      extractFeedbackIdFromData(bundledData) ||
      null
    );
  }, []);

  const extractOrderIdFromNotificationContent = useCallback((notification) => {
    const normalizeNotificationData = (raw) => {
      let value = raw;
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value);
        } catch {
          return {};
        }
      }
      if (!value || typeof value !== 'object') return {};
      return value;
    };

    const extractOrderIdFromData = (data) => {
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

      const paramsRaw = data.params;
      const params = normalizeNotificationData(paramsRaw);
      if (params.id != null && String(params.id).trim() !== '') {
        return String(params.id).trim();
      }

      const route = String(data.route || data.path || '').trim();
      if (route) {
        const match = route.match(/\/orders\/([^/?#]+)/i);
        if (match?.[1]) return String(match[1]).trim();
      }

      return null;
    };

    const contentData = normalizeNotificationData(notification?.request?.content?.data);
    const remoteData = normalizeNotificationData(notification?.request?.trigger?.remoteMessage?.data);
    const bundledData = normalizeNotificationData(remoteData?.data);

    return (
      extractOrderIdFromData(contentData) ||
      extractOrderIdFromData(remoteData) ||
      extractOrderIdFromData(bundledData) ||
      null
    );
  }, []);

  const dismissPresentedNotificationsForOrder = useCallback(
    async (orderId, Notifications) => {
      const normalized = String(orderId || '').trim();
      if (!normalized) return;

      const moduleRef = Notifications || (await import('expo-notifications'));
      const rememberedIds = notificationIdsByOrderRef.current.get(normalized) || new Set();
      const toDismiss = new Set(rememberedIds);
      const list = await moduleRef.getPresentedNotificationsAsync?.();
      if (Array.isArray(list) && list.length) {
        for (const item of list) {
          const itemOrderId = extractOrderIdFromNotificationContent(item);
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
    [extractOrderIdFromNotificationContent],
  );

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
      const feedbackId = String(extractSupportFeedbackIdFromNotificationResponse(response) || '').trim();
      const orderId = String(extractOrderIdFromNotificationResponse(response) || '').trim();
      return `${requestId}|${actionId}|${feedbackId || orderId}`;
    },
    [extractOrderIdFromNotificationResponse, extractSupportFeedbackIdFromNotificationResponse],
  );

  const hasNotificationNavigationTarget = useCallback(
    (response) =>
      !!extractOrderIdFromNotificationResponse(response) ||
      !!extractSupportFeedbackIdFromNotificationResponse(response),
    [extractOrderIdFromNotificationResponse, extractSupportFeedbackIdFromNotificationResponse],
  );

  useEffect(() => {
    if (Platform.OS === 'web' || initialNotificationCheckedRef.current) return undefined;
    let active = true;
    const fallbackTimer = setTimeout(() => {
      if (!active || initialNotificationCheckedRef.current) return;
      initialNotificationCheckedRef.current = true;
      setInitialNotificationCheckPending(false);
    }, 1200);

    (async () => {
      try {
        const Notifications = await import('expo-notifications');
        const response = await Notifications.getLastNotificationResponseAsync?.();
        if (!active || !response) return;

        if (hasNotificationNavigationTarget(response)) {
          pendingInitialNotificationResponseRef.current = response;
          setPendingNotificationLaunch(true);
        }
      } catch {
        // The regular listener below still handles notification taps.
      } finally {
        if (active) {
          initialNotificationCheckedRef.current = true;
          setInitialNotificationCheckPending(false);
        }
        clearTimeout(fallbackTimer);
      }
    })();

    return () => {
      active = false;
      clearTimeout(fallbackTimer);
    };
  }, [hasNotificationNavigationTarget]);

  const openSupportFeedbackFromNotification = useCallback(
    async (feedbackId) => {
      if (!feedbackId || notificationOpenInFlightRef.current) return;
      const expectedUserId = authSnapshotRef.current.userId;
      if (!isAuthenticatedUserCurrent(expectedUserId)) return;
      notificationOpenInFlightRef.current = true;
      try {
        const feedback = await getSupportRequestById(feedbackId);
        if (!isAuthenticatedUserCurrent(expectedUserId)) return;
        if (!feedback?.id) {
          router.replace('/admin/feedbacks');
          return;
        }

        router.push({
          pathname: '/admin/feedbacks/[id]',
          params: { id: feedback.id },
        });
      } catch {
        if (isAuthenticatedUserCurrent(expectedUserId)) {
          router.replace('/admin/feedbacks');
        }
      } finally {
        notificationOpenInFlightRef.current = false;
      }
    },
    [isAuthenticatedUserCurrent, router],
  );

  const openOrderFromNotification = useCallback(
    async (orderId) => {
      const normalizedOrderId = String(orderId || '').trim();
      if (!normalizedOrderId || notificationOpenInFlightRef.current) return;
      const expectedUserId = authSnapshotRef.current.userId;
      if (!isAuthenticatedUserCurrent(expectedUserId)) return;
      notificationOpenInFlightRef.current = true;
      try {
        if (!isAuthenticatedUserCurrent(expectedUserId)) return;
        router.replace({
          pathname: `/orders/${normalizedOrderId}`,
          params: {
            returnTo: '/orders/my-orders',
            returnParams: JSON.stringify({ fromNotification: true }),
          },
        });

        dismissPresentedNotificationsForOrder(normalizedOrderId).catch(() => {});
      } catch {
        if (isAuthenticatedUserCurrent(expectedUserId)) {
          toast.error(t('push_open_generic_error'));
          router.replace('/orders');
        }
      } finally {
        notificationOpenInFlightRef.current = false;
      }
    },
    [dismissPresentedNotificationsForOrder, isAuthenticatedUserCurrent, router, t, toast],
  );

  useEffect(() => {
    if (Platform.OS === 'web' || isInitializing || !isAuthenticated || isBlockedScreen) {
      return undefined;
    }

    let active = true;
    let responseSub = null;
    let receivedSub = null;

    const releasePendingNotificationLaunch = () => {
      setTimeout(() => {
        if (active) setPendingNotificationLaunch(false);
      }, 120);
    };

    const rememberNotificationIdentifier = (notification) => {
      const orderId = String(extractOrderIdFromNotificationContent(notification) || '').trim();
      if (!orderId) return;
      const identifier = String(notification?.request?.identifier || '').trim();
      if (!identifier) return;
      const next = notificationIdsByOrderRef.current.get(orderId) || new Set();
      next.add(identifier);
      notificationIdsByOrderRef.current.set(orderId, next);
    };

    const handleResponse = async (response, Notifications) => {
      if (!active || !response) return;
      const expectedUserId = authSnapshotRef.current.userId;
      if (!isAuthenticatedUserCurrent(expectedUserId)) return;
      const dedupeKey = getNotificationResponseKey(response);
      if (dedupeKey && lastHandledNotificationKeyRef.current === dedupeKey) return;
      if (dedupeKey) lastHandledNotificationKeyRef.current = dedupeKey;

      const feedbackId = extractSupportFeedbackIdFromNotificationResponse(response);
      if (feedbackId) {
        await openSupportFeedbackFromNotification(feedbackId);
        try {
          await Notifications?.clearLastNotificationResponseAsync?.();
        } catch {}
        return;
      }

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
        const expectedUserId = authSnapshotRef.current.userId;
        if (!active || !isAuthenticatedUserCurrent(expectedUserId)) return;
        const presented = await Notifications.getPresentedNotificationsAsync?.();
        if (!active || !isAuthenticatedUserCurrent(expectedUserId)) return;
        if (Array.isArray(presented)) {
          for (const item of presented) rememberNotificationIdentifier(item);
        }

        receivedSub = Notifications.addNotificationReceivedListener((notification) => {
          rememberNotificationIdentifier(notification);
        });
        responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
          rememberNotificationIdentifier(response?.notification);
          if (hasNotificationNavigationTarget(response)) {
            setPendingNotificationLaunch(true);
          }
          handleResponse(response, Notifications)
            .catch(() => {})
            .finally(() => {
              releasePendingNotificationLaunch();
            });
        });

        const pendingInitialResponse = pendingInitialNotificationResponseRef.current;
        if (pendingInitialResponse) {
          pendingInitialNotificationResponseRef.current = null;
          await handleResponse(pendingInitialResponse, Notifications);
          releasePendingNotificationLaunch();
          return;
        }

        const lastResponse = await Notifications.getLastNotificationResponseAsync?.();
        if (lastResponse) {
          if (hasNotificationNavigationTarget(lastResponse)) {
            setPendingNotificationLaunch(true);
          }
          await handleResponse(lastResponse, Notifications);
        }
      } catch {
        // noop
      } finally {
        if (!pendingInitialNotificationResponseRef.current) {
          releasePendingNotificationLaunch();
        }
      }
    };

    init().catch(() => {
      setPendingNotificationLaunch(false);
    });

    return () => {
      active = false;
      responseSub?.remove?.();
      receivedSub?.remove?.();
    };
  }, [
    extractSupportFeedbackIdFromNotificationResponse,
    extractOrderIdFromNotificationContent,
    extractOrderIdFromNotificationResponse,
    getNotificationResponseKey,
    hasNotificationNavigationTarget,
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
    const t1 = setTimeout(() => {
      dismissPresentedNotificationsForOrder(orderId).catch(() => {});
    }, 450);
    const t2 = setTimeout(() => {
      dismissPresentedNotificationsForOrder(orderId).catch(() => {});
    }, 1200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [
    dismissPresentedNotificationsForOrder,
    getActiveOrderIdFromPathname,
    isAuthenticated,
    isBlockedScreen,
    isInitializing,
    pathname,
  ]);

  if (
    (isInitializing && !isSigningOut) ||
    initialNotificationCheckPending ||
    (pendingNotificationLaunch && isAuthenticated && !isBlockedScreen)
  ) {
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
          <SafeAreaView
            edges={rootSafeEdges}
            style={{ flex: 1, backgroundColor: theme.colors.background }}
          >
            {isAuthenticated && !isBlockedScreen ? <OfflineStatusBanner /> : null}
            <View style={{ flex: 1, minHeight: 0 }}>
              <Stack
                initialRouteName="(auth)"
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
            <BlurFocusedInputOnKeyboardHide />
          </SafeAreaView>
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

