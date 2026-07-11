// components/universalhome.jsx
import FeatherIcon from '@expo/vector-icons/Feather';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image as ExpoImage } from 'expo-image';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuthContext } from '../providers/SimpleAuthProvider';
import { formatPersonInitials, formatPersonName, formatPersonNameParts } from '../lib/personName';
import { fetchCompanyOrderStatuses, getOrderStatusesQueryKey } from '../lib/orderStatuses';
import { withAlpha } from '../theme/colors';
import { usePermissions } from '../lib/permissions';
import { supabase } from '../lib/supabase';
import { COMPANY_SETTINGS_QUERY_KEY } from '../lib/companySettingsQuery';
import {
  getCachedProfileMediaResolution,
  inspectProfileMedia,
  isRenderableProfileMediaUrl,
  primeProfileMediaResolution,
} from '../src/features/profileMedia/api';
import { listRequests } from '../src/features/requests/api';
import { useTranslation } from '../src/i18n/useTranslation';
import { getOfflineSnapshot } from '../src/shared/offline/offlineStatus';
import { markFirstContent, markScreenMount, measureNetwork } from '../src/shared/perf/devMetrics';
import { scheduleUiIdleTask } from '../src/shared/perf/uiIdleTask';
import { queryKeys } from '../src/shared/query/queryKeys';
import { queryClient as appQueryClient } from '../src/shared/query/queryClient';
import { scheduleSmartPrefetch } from '../src/shared/query/smartPrefetch';
import { useTheme } from '../theme/ThemeProvider';
import { useSuperAdminAccess } from '../hooks/useSuperAdminAccess';
import { useSubscriptionGuard } from '../hooks/useSubscriptionGuard';
import { useCompanySettings } from '../hooks/useCompanySettings';
import {
  countUnreadSupportRequests,
  SUPPORT_UNREAD_REFETCH_MS,
  SUPPORT_UNREAD_QUERY_KEY,
} from '../src/features/supportRequests/api';
import Button from './ui/Button';
import Card from './ui/Card';
import { preloadLazyRouteScreen } from './layout/LazyRouteScreen';
import { useToast } from './ui/ToastProvider';

const SupportRequestModal = lazy(() => import('../app/company_settings/sections/SupportRequestModal'));

const VERBOSE_HOME_LOGS = __DEV__ && globalThis?.__VERBOSE_HOME_LOGS__ === true;
const HOME_PROFILE_STALE_MS = 2 * 60 * 1000;
const HOME_COMPANY_STALE_MS = 10 * 60 * 1000;
const HOME_DEPARTMENT_STALE_MS = 10 * 60 * 1000;
const HOME_SESSION_STALE_MS = 5 * 60 * 1000;
const HOME_DURABLE_GC_MS = 14 * 24 * 60 * 60 * 1000;
const HOME_MY_ORDERS_PREFETCH_PAGE_SIZE = 30;

const HOME_ROUTES = {
  appSettings: '/app_settings/AppSettings',
  appEvents: '/app_settings/sections/events',
  companySettings: '/company_settings',
  cloudStorageSettings: '/company_settings/sections/yandex-disk',
  admin: '/admin',
  billing: '/billing',
  createOrder: '/orders/create-order',
  calendar: '/orders/calendar',
};

let homeAdminWarmupStarted = false;
let homeCalendarWarmupStarted = false;
let homePrimaryWarmupStarted = false;
let homeCreateOrderWarmupStarted = false;
let homeAppSettingsWarmupStarted = false;
let homeCompanySettingsWarmupStarted = false;
let homeBillingWarmupStarted = false;
const homeMyOrdersPrefetchStartedByScope = new Set();

function warmLazyRoute(cacheKey, load) {
  preloadLazyRouteScreen(cacheKey, load).catch(() => {});
}

function warmHomePrimaryRoutes() {
  if (homePrimaryWarmupStarted) return;
  homePrimaryWarmupStarted = true;
  warmLazyRoute('routes.orders/my-orders', () => import('../screens/orders/MyOrdersScreen'));
}

function warmHomeCreateOrderRoute() {
  if (homeCreateOrderWarmupStarted) return;
  homeCreateOrderWarmupStarted = true;
  warmLazyRoute('routes.orders/create-order', () => import('../screens/orders/CreateOrderScreen'));
}

function warmHomeAppSettingsRoute() {
  if (homeAppSettingsWarmupStarted) return;
  homeAppSettingsWarmupStarted = true;
  warmLazyRoute('routes.app_settings/AppSettings', () => import('../screens/app_settings/AppSettingsScreen'));
}

function warmHomeCompanySettingsRoute() {
  if (homeCompanySettingsWarmupStarted) return;
  homeCompanySettingsWarmupStarted = true;
  warmLazyRoute('company_settings_title', () => import('../screens/company_settings/CompanySettingsScreen'));
}

function warmHomeBillingRoute() {
  if (homeBillingWarmupStarted) return;
  homeBillingWarmupStarted = true;
  warmLazyRoute('routes.billing/index', () => import('../screens/billing/BillingScreen'));
}

function warmHomeCalendarRoute() {
  if (homeCalendarWarmupStarted) return;
  homeCalendarWarmupStarted = true;
  warmLazyRoute('routes.orders/calendar', () => import('../screens/orders/CalendarScreen'));
}

function warmHomeAdminRoute() {
  if (homeAdminWarmupStarted) return;
  homeAdminWarmupStarted = true;
  import('../app/admin/index').catch(() => {});
}

function warmHomeRoute(route) {
  if (route === HOME_ROUTES.appSettings) warmHomeAppSettingsRoute();
  else if (route === HOME_ROUTES.companySettings) warmHomeCompanySettingsRoute();
  else if (route === HOME_ROUTES.billing) warmHomeBillingRoute();
  else if (route === HOME_ROUTES.createOrder) warmHomeCreateOrderRoute();
  else if (route === HOME_ROUTES.calendar) warmHomeCalendarRoute();
  else if (route === HOME_ROUTES.admin) warmHomeAdminRoute();
}

function isUuid(s) {
  return (
    typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
  );
}

function buildHomeMyOrdersRecentQueryKey(scopeKey) {
  return ['orders', 'my', 'recent', String(scopeKey || 'anonymous')];
}

function isRenderableAvatarUrl(url) {
  return isRenderableProfileMediaUrl(String(url || ''));
}

function buildAvatarCacheKey(uid, sourceUrl) {
  const source = String(sourceUrl || '').trim();
  if (!source) return undefined;
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }
  return `profile-avatar-${String(uid || 'anon')}-${hash.toString(36)}`;
}

function buildResolvedAvatarSnapshot(sourceUrl, inspection) {
  const source = String(sourceUrl || '').trim();
  if (!source) return null;
  const cleaned = Array.isArray(inspection?.cleanedUrls) && inspection.cleanedUrls.includes(source);
  if (cleaned) return { avatar_url: null, avatar_display_url: null };

  const resolved = String(inspection?.resolvedUrls?.[source] || '').trim();
  if (!isRenderableAvatarUrl(resolved)) return null;
  return { avatar_url: source, avatar_display_url: resolved };
}

function resolveProfileAvatarDisplay(profile) {
  if (!profile || typeof profile !== 'object') return profile || null;

  const avatarUrl = String(profile.avatar_url || '').trim();
  const avatarDisplayUrl = String(profile.avatar_display_url || profile.avatarDisplayUrl || '').trim();
  if (!avatarUrl) return { ...profile, avatar_url: null, avatar_display_url: null };
  const cachedAvatar = getCachedProfileMediaResolution(avatarUrl);
  if (cachedAvatar?.cleaned) return { ...profile, avatar_url: null, avatar_display_url: null };
  if (isRenderableAvatarUrl(cachedAvatar?.resolvedUrl)) {
    return { ...profile, avatar_display_url: cachedAvatar.resolvedUrl };
  }
  if (isRenderableAvatarUrl(avatarDisplayUrl)) return { ...profile, avatar_display_url: avatarDisplayUrl };
  if (isRenderableAvatarUrl(avatarUrl)) return { ...profile, avatar_display_url: avatarUrl };
  return profile;
}

// --- data fetchers ---
async function fetchSession() {
  const { data } = await supabase.auth.getSession();
  return data?.session || null;
}

async function fetchProfile(uid) {
  if (!uid) return null;

  const { data: byId } = await supabase
    .from('profiles')
    .select('id, full_name, first_name, middle_name, last_name, avatar_url, role, company_id, department_id')
    .eq('id', uid)
    .maybeSingle();
  if (!byId) return null;
  const profile = resolveProfileAvatarDisplay(byId);
  const cached =
    appQueryClient.getQueryData(['profile', uid]) ||
    appQueryClient.getQueryData(queryKeys.profile.me());
  return mergeProfileSnapshot(cached, profile);
}

function mergeProfileSnapshot(prev, snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return prev || null;
  const nextAvatarUrl = Object.prototype.hasOwnProperty.call(snapshot, 'avatar_url')
    ? snapshot.avatar_url ?? null
    : prev?.avatar_url ?? null;
  const hasAvatarDisplay =
    Object.prototype.hasOwnProperty.call(snapshot, 'avatar_display_url') ||
    Object.prototype.hasOwnProperty.call(snapshot, 'avatarDisplayUrl');
  const nextAvatarDisplayUrl = hasAvatarDisplay
    ? snapshot.avatar_display_url ?? snapshot.avatarDisplayUrl ?? null
    : null;
  const avatarChanged = String(prev?.avatar_url || '') !== String(nextAvatarUrl || '');
  return {
    ...(prev || {}),
    ...snapshot,
    avatar_url: nextAvatarUrl,
    avatar_display_url: hasAvatarDisplay
      ? nextAvatarDisplayUrl
      : avatarChanged
        ? nextAvatarUrl
        : prev?.avatar_display_url ?? nextAvatarUrl ?? null,
  };
}

function buildSelfEmployeeDetailSeed({
  previous,
  profile,
  uid,
  email,
  isAdmin,
  isSuperAdmin,
  companyName,
  departmentName,
}) {
  if (!profile || typeof profile !== 'object') return previous || null;

  const firstName = profile.first_name ?? profile.firstName ?? previous?.firstName ?? '';
  const middleName = profile.middle_name ?? profile.middleName ?? previous?.middleName ?? '';
  const lastName = profile.last_name ?? profile.lastName ?? previous?.lastName ?? '';
  const computedFullName = formatPersonNameParts({ firstName, middleName, lastName });
  const fullName = (computedFullName || profile.full_name || profile.fullName || previous?.fullName) || null;
  const avatarUrl = profile.avatar_url ?? profile.avatarUrl ?? previous?.avatarUrl ?? null;
  const avatarDisplayUrl = profile.avatar_display_url ?? profile.avatarDisplayUrl ?? previous?.avatarDisplayUrl ?? avatarUrl;
  const companyId = profile.company_id ?? profile.companyId ?? previous?.companyId ?? null;
  const departmentId = profile.department_id ?? profile.departmentId ?? previous?.departmentId ?? null;
  const displayName = fullName || profile.email || email || previous?.displayName || '';

  return {
    ...(previous || {}),
    ...profile,
    id: profile.id || previous?.id || uid,
    user_id: profile.user_id ?? previous?.user_id ?? uid,
    first_name: firstName,
    middle_name: middleName,
    last_name: lastName,
    full_name: fullName,
    avatar_url: avatarUrl,
    avatar_display_url: avatarDisplayUrl,
    company_id: companyId,
    department_id: departmentId,
    display_name: displayName,
    email: email || profile.email || previous?.email || '',
    firstName,
    middleName,
    lastName,
    fullName,
    avatarUrl,
    avatarDisplayUrl,
    displayName,
    companyId,
    departmentId,
    companyName: companyName ?? previous?.companyName ?? null,
    departmentName: departmentName ?? previous?.departmentName ?? null,
    role: profile.role || previous?.role || 'worker',
    myUid: uid || previous?.myUid || null,
    meIsAdmin: isAdmin === true ? true : previous?.meIsAdmin ?? false,
    meIsSuperAdmin: isSuperAdmin === true ? true : previous?.meIsSuperAdmin ?? false,
    __homeSeed: true,
  };
}

function HomeWarningCard({
  styles,
  theme,
  icon,
  title,
  body,
  cta,
  onPress,
  onPressIn,
}) {
  return (
    <Card style={styles.subscriptionWarningCard}>
      <View style={styles.subscriptionWarningHeader}>
        <View style={styles.subscriptionWarningBadge}>
          <FeatherIcon
            name={icon}
            size={theme.icons?.sm ?? theme.typography.sizes.sm + theme.spacing.xs}
            color={theme.colors.warning || theme.colors.primary}
          />
        </View>
        <View style={styles.subscriptionWarningBody}>
          <Text style={styles.subscriptionWarningTitle}>{title}</Text>
          <Text style={styles.subscriptionWarningText}>{body}</Text>
        </View>
      </View>
      <Pressable
        onPress={onPress}
        onPressIn={onPressIn}
        unstable_pressDelay={0}
        android_ripple={{ color: theme.colors.ripple, borderless: false }}
        style={({ pressed }) => [styles.subscriptionWarningLinkRow, pressed && styles.rowPressed]}
        accessibilityRole="button"
      >
        <Text style={styles.subscriptionWarningLinkText}>{cta}</Text>
        <FeatherIcon
          name="chevron-right"
          size={theme.components?.listItem?.chevronSize ?? theme.icons?.sm ?? theme.typography.sizes.md}
          color={theme.colors.textSecondary || theme.colors.text}
        />
      </Pressable>
    </Card>
  );
}

export default function UniversalHome({ role, user, profile: providedProfile, onInitialReady }) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { signOut } = useAuthContext();
  const { isSuperAdmin } = useSuperAdminAccess();
  const { has, loading: permsLoading, role: roleFromPerms } = usePermissions();
  const toast = useToast();
  const qc = useQueryClient();
  const initialFocusRefreshSkippedRef = useRef(false);
  const navigateTo = useCallback(
    (href) => {
      if (!href) return;
      router.push(href);
    },
    [router],
  );

  useEffect(() => {
    markScreenMount('Home');
  }, []);

  // Debug: inspect incoming auth/profile props.
  useEffect(() => {
    if (!VERBOSE_HOME_LOGS) return;
    console.info('[UniversalHome] Props:', {
      hasUser: !!user,
      userId: user?.id,
      hasProvidedProfile: !!providedProfile,
      profileSource: providedProfile?.__source,
      profileRole: providedProfile?.role,
      propRole: role,
    });
  }, [user, providedProfile, role]);

  useEffect(() => {
    if (user) return undefined;
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      qc.setQueryData(['session'], s ?? null);
      qc.invalidateQueries({ queryKey: ['profile'] });
    });
    return () => sub?.subscription?.unsubscribe?.();
  }, [qc, user]);

  const [supportRequestOpen, setSupportRequestOpen] = useState(false);
  const [supportRequestNonce, setSupportRequestNonce] = useState(0);
  const [secondaryNetworkEnabled, setSecondaryNetworkEnabled] = useState(false);
  const { data: unreadSupportCount = 0 } = useQuery({
    queryKey: SUPPORT_UNREAD_QUERY_KEY,
    queryFn: countUnreadSupportRequests,
    enabled: secondaryNetworkEnabled && isSuperAdmin,
    staleTime: 10 * 1000,
    refetchInterval: SUPPORT_UNREAD_REFETCH_MS,
  });

  useEffect(() => {
    if (!secondaryNetworkEnabled || !isSuperAdmin) return undefined;
    const channel = supabase
      .channel('home-feedbacks-unread-counter')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feedbacks' }, () => {
        qc.invalidateQueries({ queryKey: SUPPORT_UNREAD_QUERY_KEY });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isSuperAdmin, qc, secondaryNetworkEnabled]);

  // ====== Session / profile ======
  const { data: session } = useQuery({
    queryKey: ['session'],
    queryFn: fetchSession,
    staleTime: HOME_SESSION_STALE_MS,
    refetchOnMount: false,
    enabled: !user && !providedProfile,
  });
  const uid =
    user?.id && isUuid(user.id) ? user.id : isUuid(session?.user?.id) ? session.user.id : null;

  const {
    data: profileData,
    isLoading: profileLoading,
    isFetched: profileFetched,
  } = useQuery({
    queryKey: ['profile', uid],
    queryFn: () => fetchProfile(uid),
    enabled: !!uid,
    initialData: () =>
      (uid
        ? appQueryClient.getQueryData(['profile', uid]) ||
          appQueryClient.getQueryData(queryKeys.profile.me())
        : null) ||
      providedProfile ||
      undefined,
    initialDataUpdatedAt: () =>
      (uid
        ? appQueryClient.getQueryState(['profile', uid])?.dataUpdatedAt ||
          appQueryClient.getQueryState(queryKeys.profile.me())?.dataUpdatedAt
        : undefined) ||
      (providedProfile ? Date.now() : undefined),
    staleTime: HOME_PROFILE_STALE_MS,
    gcTime: HOME_DURABLE_GC_MS,
    refetchOnMount: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });

  const currentProfile = profileData || providedProfile || null;
  const { data: profileFallback } = useQuery({
    queryKey: ['homeProfileFallback', uid || 'anon'],
    queryFn: async () => {
      const { data: p, error: pErr } = await supabase
        .from('profiles')
        .select('id, company_id, role')
        .eq('id', uid)
        .maybeSingle();
      if (pErr) throw pErr;
      return p || null;
    },
    enabled: !!uid && !currentProfile?.company_id && profileFetched && !profileLoading,
    staleTime: HOME_PROFILE_STALE_MS,
    refetchOnMount: false,
    refetchOnReconnect: true,
  });

  const fullName =
    formatPersonName(currentProfile);
  const firstName = currentProfile?.first_name || '';
  const middleName = currentProfile?.middle_name || '';
  const lastName = currentProfile?.last_name || '';
  const rawAvatarUrl = String(currentProfile?.avatar_url || '').trim();
  const storedAvatarDisplayUrl = String(currentProfile?.avatar_display_url || '').trim();
  const cachedAvatarResolution = getCachedProfileMediaResolution(rawAvatarUrl);
  const avatarDisplayUrl = isRenderableAvatarUrl(storedAvatarDisplayUrl)
    ? storedAvatarDisplayUrl
    : isRenderableAvatarUrl(cachedAvatarResolution?.resolvedUrl)
      ? cachedAvatarResolution.resolvedUrl
      : '';
  const avatarUrl =
    !cachedAvatarResolution?.cleaned && isRenderableAvatarUrl(avatarDisplayUrl)
      ? avatarDisplayUrl
      : !cachedAvatarResolution?.cleaned && isRenderableAvatarUrl(rawAvatarUrl)
        ? rawAvatarUrl
        : null;
  const avatarCacheKey = buildAvatarCacheKey(uid, rawAvatarUrl || avatarUrl);
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  useEffect(() => {
    setAvatarLoaded(false);
    setAvatarLoadFailed(false);
  }, [avatarUrl]);
  const companyId = currentProfile?.company_id || profileFallback?.company_id || null;
  const {
    settings: companySettings,
    useDepartments,
  } = useCompanySettings(companyId || null, {
    enabled: secondaryNetworkEnabled,
    subscribe: secondaryNetworkEnabled,
  });
  const subscriptionGuard = useSubscriptionGuard(companyId, { enabled: secondaryNetworkEnabled });
  const isReadOnlyBySubscription =
    !subscriptionGuard.isLoading &&
    subscriptionGuard.entitlements != null &&
    subscriptionGuard.reason === 'subscription_expired';
  const deptIdFromProfile = currentProfile?.department_id || null;

  // The profile query is the live source for the home screen; the prop is only a boot-time seed.
  const resolvedRole = currentProfile?.role || role || roleFromPerms || 'worker';

  const isAdmin = resolvedRole === 'admin';
  const accountType = String(
    user?.user_metadata?.account_type || session?.user?.user_metadata?.account_type || '',
  ).toLowerCase();
  const isSoloAdmin = isAdmin && accountType === 'solo';


  const canCreateOrders = !permsLoading && has?.('canCreateOrders') === true;

  const applyAvatarSnapshot = useCallback(
    (snapshot) => {
      if (!uid || !snapshot) return;
      qc.setQueryData(['profile', uid], (prev) => mergeProfileSnapshot(prev || currentProfile, snapshot));
      qc.setQueryData(queryKeys.profile.me(), (prev) => mergeProfileSnapshot(prev || currentProfile, snapshot));
    },
    [currentProfile, qc, uid],
  );

  useEffect(() => {
    if (!uid || !rawAvatarUrl) return undefined;
    if (isRenderableAvatarUrl(avatarDisplayUrl)) {
      primeProfileMediaResolution(rawAvatarUrl, avatarDisplayUrl);
      ExpoImage.prefetch(avatarDisplayUrl, 'memory-disk').catch(() => {});
      if (storedAvatarDisplayUrl !== avatarDisplayUrl) {
        applyAvatarSnapshot({ avatar_url: rawAvatarUrl, avatar_display_url: avatarDisplayUrl });
      }
      return undefined;
    }
    if (isRenderableAvatarUrl(rawAvatarUrl)) {
      primeProfileMediaResolution(rawAvatarUrl, rawAvatarUrl);
      ExpoImage.prefetch(rawAvatarUrl, 'memory-disk').catch(() => {});
      if (storedAvatarDisplayUrl !== rawAvatarUrl) {
        applyAvatarSnapshot({ avatar_url: rawAvatarUrl, avatar_display_url: rawAvatarUrl });
      }
      return undefined;
    }

    let cancelled = false;
    inspectProfileMedia([rawAvatarUrl])
      .then((inspection) => {
        if (cancelled) return;
        const snapshot = buildResolvedAvatarSnapshot(rawAvatarUrl, inspection);
        if (!snapshot) return;
        applyAvatarSnapshot(snapshot);
        if (snapshot.avatar_display_url) {
          ExpoImage.prefetch(snapshot.avatar_display_url, 'memory-disk').catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [applyAvatarSnapshot, avatarDisplayUrl, rawAvatarUrl, storedAvatarDisplayUrl, uid]);

  const handleAvatarLoad = useCallback(() => {
    setAvatarLoaded(true);
    setAvatarLoadFailed(false);
  }, []);

  const handleAvatarLoadError = useCallback(() => {
    setAvatarLoaded(false);
    setAvatarLoadFailed(true);
    if (!uid || !rawAvatarUrl) return;
    inspectProfileMedia([rawAvatarUrl], { forceRefresh: true })
      .then((inspection) => {
        const snapshot = buildResolvedAvatarSnapshot(rawAvatarUrl, inspection);
        if (snapshot) applyAvatarSnapshot(snapshot);
      })
      .catch(() => {});
  }, [applyAvatarSnapshot, rawAvatarUrl, uid]);


  const openAppSettings = useCallback(
    () => navigateTo(HOME_ROUTES.appSettings),
    [navigateTo],
  );
  const openCompanySettings = useCallback(
    () => navigateTo(HOME_ROUTES.companySettings),
    [navigateTo],
  );
  const openCloudStorageSettings = useCallback(
    () => navigateTo(HOME_ROUTES.cloudStorageSettings),
    [navigateTo],
  );
  const openAdministration = useCallback(
    () => navigateTo(HOME_ROUTES.admin),
    [navigateTo],
  );
  const openSupportRequest = useCallback(() => {
    setSupportRequestNonce((value) => value + 1);
    setSupportRequestOpen(true);
  }, []);
  const showFutureFeatureToast = useCallback(() => {
    toast.info(t('feature_future'));
  }, [t, toast]);
  const openBilling = useCallback(
    () => navigateTo(HOME_ROUTES.billing),
    [navigateTo],
  );
  const openCreateOrder = useCallback(() => {
    if (isReadOnlyBySubscription) {
      toast.warning(t('subscription_create_unavailable_toast'));
      return;
    }
    navigateTo(HOME_ROUTES.createOrder);
  }, [isReadOnlyBySubscription, navigateTo, t, toast]);
  const shouldCheckCloudHealth =
    isAdmin && !!companyId && companySettings?.media_provider === 'yandex_disk';
  const {
    data: cloudIntegrationStatus,
    isFetched: cloudStatusFetched,
    isFetching: cloudStatusFetching,
    isError: cloudStatusError,
  } = useQuery({
    queryKey: ['cloud-storage-status', companyId],
    queryFn: async () => {
      const { yandexDiskIntegration } = await import('../lib/yandexDiskIntegration');
      return yandexDiskIntegration('status');
    },
    enabled: secondaryNetworkEnabled && shouldCheckCloudHealth,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: false,
    placeholderData: (prev) => prev,
  });
  const cloudHealthCode = String(
    cloudIntegrationStatus?.health ||
      (cloudIntegrationStatus?.connected ? 'unknown' : 'not_connected'),
  );
  const hasCloudIssue =
    shouldCheckCloudHealth &&
    cloudStatusFetched &&
    !cloudStatusFetching &&
    !cloudStatusError &&
    cloudHealthCode !== 'ok';

  const handleLogout = async () => {
    try {
      await signOut();
    } catch {}
  };

  const quickAccessItems = useMemo(
    () =>
      [
        {
          key: 'events',
          title: t('home_quick_events'),
          icon: 'bell',
          onPress: showFutureFeatureToast,
          disabled: true,
          visible: !isSoloAdmin,
        },
        {
          key: 'chats',
          title: t('home_quick_chats'),
          icon: 'message-circle',
          onPress: showFutureFeatureToast,
          disabled: true,
          visible: !isSoloAdmin,
        },
      ].filter((item) => item.visible),
    [isSoloAdmin, showFutureFeatureToast, t],
  );

  const menuItems = useMemo(
    () =>
      [
        {
          key: 'app',
          title: t('home_menu_app_settings'),
          icon: 'sliders',
          onPress: openAppSettings,
          route: HOME_ROUTES.appSettings,
          visible: !isSoloAdmin,
        },
        {
          key: 'stats',
          title: t('home_menu_stats'),
          icon: 'bar-chart-2',
          onPress: showFutureFeatureToast,
          disabled: true,
          visible: true,
        },
        {
          key: 'company',
          title: isSoloAdmin
            ? t('settings_title')
            : t('home_menu_company_settings'),
          icon: 'settings',
          onPress: openCompanySettings,
          route: HOME_ROUTES.companySettings,
          visible: isAdmin,
        },
        {
          key: 'support',
          title: t('company_settings_write_support'),
          icon: 'message-square',
          onPress: openSupportRequest,
          visible: true,
        },
        {
          key: 'administration',
          title: t('settings_company_administration'),
          icon: 'shield',
          onPress: openAdministration,
          route: HOME_ROUTES.admin,
          visible: isSuperAdmin,
          badgeCount: unreadSupportCount,
        },
      ].filter((i) => i.visible),
    [
      isAdmin,
      isSuperAdmin,
      openAppSettings,
      showFutureFeatureToast,
      openCompanySettings,
      openSupportRequest,
      openAdministration,
      unreadSupportCount,
      isSoloAdmin,
      t,
    ],
  );

  useEffect(() => {
    if (!uid || !currentProfile?.id) return undefined;
    const cancelTasks = [
      scheduleUiIdleTask(warmHomePrimaryRoutes, { delayMs: 400 }),
      scheduleUiIdleTask(warmHomeCalendarRoute, { delayMs: 3200 }),
      scheduleUiIdleTask(warmHomeCreateOrderRoute, { delayMs: 6000 }),
      scheduleUiIdleTask(warmHomeAppSettingsRoute, { delayMs: 9000 }),
      scheduleUiIdleTask(warmHomeCompanySettingsRoute, { delayMs: 12000 }),
      scheduleUiIdleTask(warmHomeBillingRoute, { delayMs: 15000 }),
    ];
    if (isSuperAdmin) {
      cancelTasks.push(scheduleUiIdleTask(warmHomeAdminRoute, { delayMs: 18000 }));
    }

    return () => {
      cancelTasks.forEach((cancel) => cancel());
    };
  }, [currentProfile?.id, isSuperAdmin, uid]);

  const styles = useMemo(() => createStyles(theme), [theme]);

  useEffect(() => {
    if (!secondaryNetworkEnabled || !uid) return undefined;
    const profileId = String(currentProfile?.id || uid || '').trim();
    if (!isUuid(profileId)) return undefined;
    const applyProfileChange = (payload) => {
      const snapshot = payload?.eventType === 'DELETE' ? null : payload?.new || null;
      if (snapshot?.id) {
        qc.setQueryData(['profile', uid], (prev) => mergeProfileSnapshot(prev, snapshot));
      }
      qc.invalidateQueries({ queryKey: ['profile', uid] });
    };
    const channel = supabase
      .channel(`home-profile-${profileId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${profileId}` },
        applyProfileChange,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentProfile?.id, qc, secondaryNetworkEnabled, uid]);

  const cachedSelfProfileDetail = useMemo(() => {
    const selfProfileId = String(currentProfile?.id || uid || '').trim();
    if (!isUuid(selfProfileId)) return null;
    return qc.getQueryData(queryKeys.employees.detail(selfProfileId)) || null;
  }, [currentProfile?.id, qc, uid]);

  // Fetch company name if companyId is available
  const { data: companyRow } = useQuery({
    queryKey: ['company', companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const { data } = await supabase.from('companies').select('id, name').eq('id', companyId).maybeSingle();
      return data || null;
    },
    enabled: !!companyId,
    initialData: () =>
      appQueryClient.getQueryData(['company', companyId]) ||
      (companyId && cachedSelfProfileDetail?.companyName
        ? { id: companyId, name: cachedSelfProfileDetail.companyName }
        : undefined),
    initialDataUpdatedAt: () => appQueryClient.getQueryState(['company', companyId])?.dataUpdatedAt,
    staleTime: HOME_COMPANY_STALE_MS,
    refetchOnMount: false,
    refetchOnReconnect: true,
  });

  const companyName = companyRow?.name || cachedSelfProfileDetail?.companyName || null;

  // Fetch department name if department id available
  const departmentIdToUse = deptIdFromProfile;
  const { data: departmentRow } = useQuery({
    queryKey: ['department', departmentIdToUse],
    queryFn: async () => {
      if (!departmentIdToUse) return null;
      const { data } = await supabase.from('departments').select('id, name').eq('id', departmentIdToUse).maybeSingle();
      return data || null;
    },
    enabled: useDepartments && !!departmentIdToUse,
    initialData: () =>
      appQueryClient.getQueryData(['department', departmentIdToUse]) ||
      (departmentIdToUse && cachedSelfProfileDetail?.departmentName
        ? { id: departmentIdToUse, name: cachedSelfProfileDetail.departmentName }
        : undefined),
    initialDataUpdatedAt: () => appQueryClient.getQueryState(['department', departmentIdToUse])?.dataUpdatedAt,
    staleTime: HOME_DEPARTMENT_STALE_MS,
    refetchOnMount: false,
    refetchOnReconnect: true,
  });

  const departmentName = departmentRow?.name || cachedSelfProfileDetail?.departmentName || null;

  const seedSelfProfileEmployeeDetail = useCallback(() => {
    const selfProfileId = String(currentProfile?.id || uid || '').trim();
    if (!isUuid(selfProfileId)) return null;
    if (!currentProfile || typeof currentProfile !== 'object') return selfProfileId;
    qc.setQueryData(queryKeys.employees.detail(selfProfileId), (previous) =>
      buildSelfEmployeeDetailSeed({
        previous,
        profile: currentProfile,
        uid,
        email: user?.email || session?.user?.email || '',
        isAdmin,
        isSuperAdmin,
        companyName,
        departmentName,
      }),
    );
    return selfProfileId;
  }, [
    companyName,
    currentProfile,
    departmentName,
    isAdmin,
    isSuperAdmin,
    qc,
    session?.user?.email,
    uid,
    user?.email,
  ]);

  useEffect(() => {
    seedSelfProfileEmployeeDetail();
  }, [seedSelfProfileEmployeeDetail]);

  const openSelfProfileEdit = useCallback(() => {
    const selfProfileId = seedSelfProfileEmployeeDetail();
    if (!selfProfileId) return;
    router.push({ pathname: '/users/[id]', params: { id: selfProfileId } });
  }, [router, seedSelfProfileEmployeeDetail]);

  useEffect(() => {
    if (!secondaryNetworkEnabled || !companyId) return undefined;
    const refreshCompanyData = (payload) => {
      if (payload?.new?.id) {
        qc.setQueryData(['company', companyId], (prev) => ({ ...(prev || {}), ...payload.new }));
      }
      qc.invalidateQueries({ queryKey: ['company', companyId] });
      qc.invalidateQueries({ queryKey: COMPANY_SETTINGS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ['companyEntitlements', companyId] });
      qc.invalidateQueries({ queryKey: ['cloud-storage-status', companyId] });
    };
    const channel = supabase
      .channel(`home-company-${companyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'companies', filter: `id=eq.${companyId}` },
        refreshCompanyData,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId, qc, secondaryNetworkEnabled]);

  useEffect(() => {
    if (!secondaryNetworkEnabled || !departmentIdToUse) return undefined;
    const channel = supabase
      .channel(`home-department-${departmentIdToUse}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'departments', filter: `id=eq.${departmentIdToUse}` },
        (payload) => {
          if (payload?.new?.id) {
            qc.setQueryData(['department', departmentIdToUse], (prev) => ({ ...(prev || {}), ...payload.new }));
          }
          qc.invalidateQueries({ queryKey: ['department', departmentIdToUse] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [departmentIdToUse, qc, secondaryNetworkEnabled]);

  useFocusEffect(
    useCallback(() => {
      if (!uid) return undefined;
      if (!initialFocusRefreshSkippedRef.current) {
        initialFocusRefreshSkippedRef.current = true;
        return undefined;
      }
      qc.invalidateQueries({ queryKey: ['profile', uid] });
      if (companyId) {
        qc.invalidateQueries({ queryKey: ['company', companyId] });
        qc.invalidateQueries({ queryKey: COMPANY_SETTINGS_QUERY_KEY });
        qc.invalidateQueries({ queryKey: ['companyEntitlements', companyId] });
        qc.invalidateQueries({ queryKey: ['cloud-storage-status', companyId] });
      }
      if (departmentIdToUse) {
        qc.invalidateQueries({ queryKey: ['department', departmentIdToUse] });
      }
      if (isSuperAdmin) {
        qc.invalidateQueries({ queryKey: SUPPORT_UNREAD_QUERY_KEY });
      }
      return undefined;
    }, [companyId, departmentIdToUse, isSuperAdmin, qc, uid]),
  );

  const initials = useMemo(() => {
    return formatPersonInitials({ firstName, middleName, lastName }, fullName) || '??';
  }, [firstName, middleName, lastName, fullName]);

  const roleLabel =
    resolvedRole === 'admin'
      ? t('role_admin')
      : resolvedRole === 'dispatcher'
        ? t('role_dispatcher')
        : t('role_worker');
  const badgeOverflowThreshold = theme.components?.badge?.maxCount ?? 99;
  const badgeOverflowLabel = `${badgeOverflowThreshold}+`;

  const hasProfileSeed = !!currentProfile?.id;
  const homeCriticalReady =
    !!uid &&
    hasProfileSeed &&
    (profileFetched || !profileLoading);

  const [homeCriticalReadyLatched, setHomeCriticalReadyLatched] = useState(false);
  useEffect(() => {
    if (homeCriticalReady) setHomeCriticalReadyLatched(true);
  }, [homeCriticalReady]);
  const shouldShowHomeLoader = !homeCriticalReadyLatched && !homeCriticalReady;

  useEffect(() => {
    if (!homeCriticalReady) return;
    markFirstContent('Home');
    onInitialReady?.();
  }, [homeCriticalReady, onInitialReady]);

  useEffect(() => {
    if (!homeCriticalReady) return undefined;
    const timer = setTimeout(() => {
      setSecondaryNetworkEnabled(true);
    }, 2800);
    return () => clearTimeout(timer);
  }, [homeCriticalReady]);

  useEffect(() => {
    if (!homeCriticalReady || !companyId || companySettings?.use_order_statuses !== true) return;
    qc.prefetchQuery({
      queryKey: getOrderStatusesQueryKey(companyId),
      queryFn: () => fetchCompanyOrderStatuses(companyId),
      staleTime: 5 * 60 * 1000,
    }).catch(() => {});
  }, [companyId, companySettings?.use_order_statuses, homeCriticalReady, qc]);

  useEffect(() => {
    if (!homeCriticalReady || !uid) return undefined;
    const scopeKey = `${uid}:${String(companyId || 'no-company')}`;
    if (homeMyOrdersPrefetchStartedByScope.has(scopeKey)) return undefined;
    homeMyOrdersPrefetchStartedByScope.add(scopeKey);

    const cancelPrefetch = scheduleUiIdleTask(() => {
      if (!getOfflineSnapshot().isOnline) {
        homeMyOrdersPrefetchStartedByScope.delete(scopeKey);
        return;
      }
      measureNetwork('home.myOrders.prefetch', () =>
        listRequests({
          scope: 'my',
          page: 1,
          pageSize: HOME_MY_ORDERS_PREFETCH_PAGE_SIZE,
          userId: uid,
        }),
      )
        .then((rows) => {
          const page = Array.isArray(rows) ? rows : [];
          qc.setQueryData(buildHomeMyOrdersRecentQueryKey(scopeKey), page);
          qc.setQueryData(queryKeys.requests.my({}), {
            pages: [page],
            pageParams: [1],
          });
        })
        .catch(() => {
          homeMyOrdersPrefetchStartedByScope.delete(scopeKey);
        });
    }, { delayMs: 900, idleTimeoutMs: 1800 });

    return () => {
      cancelPrefetch();
    };
  }, [companyId, homeCriticalReady, qc, uid]);

  useEffect(() => {
    if (!homeCriticalReady || !uid) return;
    let cancelPrefetch = null;
    const timer = setTimeout(() => {
      cancelPrefetch = scheduleSmartPrefetch(qc);
    }, 6500);
    return () => {
      clearTimeout(timer);
      try {
        cancelPrefetch?.();
      } catch {}
    };
  }, [homeCriticalReady, qc, uid]);

  if (shouldShowHomeLoader) {
    return (
      <View style={styles.loadingRoot}>
        <Card style={styles.loadingCard}>
          <View style={styles.loadingRow}>
            <ActivityIndicator
              size={theme.components?.activityIndicator?.size ?? 'small'}
              color={theme.colors.primary}
            />
            <Text style={styles.loadingText}>
              {t('toast_loading_info')}
            </Text>
          </View>
        </Card>
      </View>
    );
  }

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        delaysContentTouches={false}
      >
      <Card style={styles.cardRounded} padded={false}>
        <Pressable
          onPress={openSelfProfileEdit}
          unstable_pressDelay={0}
          android_ripple={{ color: theme.colors.ripple, borderless: false }}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.profileRow,
            pressed && styles.rowPressed,
          ]}
        >
          {avatarUrl && !avatarLoadFailed ? (
            <View style={styles.avatarWrap}>
              <View style={styles.avatarImageFallback}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
              <ExpoImage
                source={{ uri: avatarUrl, cacheKey: avatarCacheKey }}
                style={[styles.avatarImg, !avatarLoaded && styles.avatarImgHidden]}
                contentFit="cover"
                cachePolicy="memory-disk"
                priority="high"
                onLoad={handleAvatarLoad}
                onError={handleAvatarLoadError}
              />
            </View>
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          )}

          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>
              {fullName || ''}
            </Text>
            {!isSoloAdmin ? (
              <View style={styles.metaRows}>
                <Text style={styles.companyText} numberOfLines={1}>
                  {companyName || ''}
                </Text>
                <View style={styles.roleRow}>
                  <Text style={styles.profileRoleText} numberOfLines={1}>
                    {roleLabel}
                  </Text>
                </View>
                {useDepartments ? (
                  <View style={styles.departmentRow}>
                    <Text style={styles.departmentText} numberOfLines={1}>
                      {`${t('users_department')}: ${departmentName || t('placeholder_department')}`}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>

          <View style={styles.profileMenuDotsWrap}>
            <FeatherIcon
              name="more-horizontal"
              size={theme.icons?.sm ?? theme.typography.sizes.sm + theme.spacing.xs}
              color={theme.colors.textSecondary || theme.colors.text}
            />
          </View>
        </Pressable>
      </Card>

      {isReadOnlyBySubscription ? (
        <HomeWarningCard
          styles={styles}
          theme={theme}
          icon="alert-triangle"
          title={t('home_subscription_expired_title')}
          body={t('home_subscription_expired_body')}
          cta={t('home_subscription_expired_cta')}
          onPress={openBilling}
          onPressIn={() => warmHomeRoute(HOME_ROUTES.billing)}
        />
      ) : null}

      {hasCloudIssue ? (
        <HomeWarningCard
          styles={styles}
          theme={theme}
          icon="cloud-off"
          title={t('home_cloud_issue_title')}
          body={t('home_cloud_issue_body').replace('{status}', t(
            `company_integrations_yandex_health_${cloudHealthCode}`,
            t('company_integrations_yandex_health_error'),
          ))}
          cta={t('home_cloud_issue_cta')}
          onPress={openCloudStorageSettings}
        />
      ) : null}

      <Card style={[styles.cardRounded, styles.menuCard]} padded={false} separated>
        {menuItems.map((item) => {
          const isDisabled = item.disabled === true;
          return (
            <Pressable
              key={item.key}
              onPress={item.onPress}
              onPressIn={() => warmHomeRoute(item.route)}
              unstable_pressDelay={0}
              android_ripple={{ color: theme.colors.ripple, borderless: false }}
              style={({ pressed }) => [
                styles.menuRow,
                isDisabled && styles.menuRowDisabled,
                pressed && styles.rowPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: isDisabled }}
            >
              <View style={styles.menuContent}>
                <FeatherIcon
                  name={item.icon}
                  size={theme.icons?.md ?? theme.typography.sizes.md + theme.spacing.xs}
                  color={isDisabled ? (theme.colors.textSecondary || theme.colors.text) : theme.colors.text}
                  style={styles.menuIcon}
                />
                <Text style={[styles.menuLabel, isDisabled && styles.menuLabelDisabled]}>{item.title}</Text>
              </View>
              <View style={styles.menuRowRight}>
                {item.badgeCount > 0 ? (
                  <View style={styles.menuBadge}>
                    <Text style={styles.menuBadgeText}>
                      {item.badgeCount > badgeOverflowThreshold ? badgeOverflowLabel : String(item.badgeCount)}
                    </Text>
                  </View>
                ) : null}
                <FeatherIcon
                  name="chevron-right"
                  size={theme.components?.listItem?.chevronSize ?? theme.icons?.md ?? theme.typography.sizes.md}
                  color={theme.colors.textSecondary || theme.colors.text}
                />
              </View>
            </Pressable>
          );
        })}
      </Card>

      {quickAccessItems.length > 0 ? (
        <Card style={[styles.cardRounded, styles.quickAccessCard]} padded={false} separated>
          {quickAccessItems.map((item) => {
            const isDisabled = item.disabled === true;
            return (
              <Pressable
                key={item.key}
                onPress={item.onPress}
                unstable_pressDelay={0}
                android_ripple={{ color: theme.colors.ripple, borderless: false }}
                style={({ pressed }) => [
                  styles.menuRow,
                  isDisabled && styles.menuRowDisabled,
                  pressed && styles.rowPressed,
                ]}
                accessibilityRole="button"
                accessibilityState={{ disabled: isDisabled }}
              >
                <View style={styles.menuContent}>
                  <FeatherIcon
                    name={item.icon}
                    size={theme.icons?.md ?? theme.typography.sizes.md + theme.spacing.xs}
                    color={isDisabled ? (theme.colors.textSecondary || theme.colors.text) : theme.colors.text}
                    style={styles.menuIcon}
                  />
                  <Text style={[styles.menuLabel, isDisabled && styles.menuLabelDisabled]}>{item.title}</Text>
                </View>
                <FeatherIcon
                  name="chevron-right"
                  size={theme.components?.listItem?.chevronSize ?? theme.icons?.md ?? theme.typography.sizes.md}
                  color={theme.colors.textSecondary || theme.colors.text}
                />
              </Pressable>
            );
          })}
        </Card>
      ) : null}
      {canCreateOrders && (
        <View style={styles.actionWrapper}>
          <Button
            title={t('home_btn_create_order')}
            onPress={openCreateOrder}
            onPressIn={warmHomeCreateOrderRoute}
          />
        </View>
      )}

      <View style={styles.actionWrapper}>
        <Button title={t('home_btn_logout')} variant='destructive' onPress={handleLogout} />
      </View>
      </ScrollView>

      {supportRequestOpen ? (
        <Suspense fallback={null}>
          <SupportRequestModal
            key={`support-request-${supportRequestNonce}`}
            visible={supportRequestOpen}
            onClose={() => setSupportRequestOpen(false)}
            profile={currentProfile}
          />
        </Suspense>
      ) : null}
    </>
  );
}

const createStyles = (theme) => {
  const colors = theme.colors;
  const spacing = theme.spacing;
  const radii = theme.radii;
  const type = theme.typography;
  const avatarSize = theme.components?.avatar?.md
    ? theme.components.avatar.md + spacing.xs
    : spacing.xxl + spacing.xl;
  const avatarRadius = avatarSize / 2;
  const menuRowMinHeight =
    theme.components?.listItem?.height ?? theme.components?.row?.minHeight ?? spacing.xxl;
  const profileMinHeight = avatarSize + spacing.xl * 2;
  const iconButtonSize = theme.components?.iconButton?.size ?? spacing.xxl;
  const badgeSize = spacing.xl;
  const badgeVerticalPadding =
    theme.components?.badge?.paddingVertical ?? Math.max(1, Math.round(spacing.xs / 2));

  return StyleSheet.create({
    container: {
      padding: spacing.lg,
      paddingBottom:
        (theme.components?.scrollView?.paddingBottom ?? spacing.xl) + spacing.lg,
    },
    rowPressed: {
      opacity: theme.components?.listItem?.disabledOpacity ?? 0.6,
    },
    cardRounded: {
      marginBottom: spacing.lg,
      borderRadius: theme.components.card.radius,
      overflow: 'hidden',
      borderWidth: theme.components?.card?.borderWidth ?? 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    profileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-start',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      minHeight: profileMinHeight,
      backgroundColor: colors.surface,
      borderWidth: theme.components?.card?.borderWidth ?? 1,
      borderColor: withAlpha(colors.border, 0.9),
      borderRadius: radii.lg,
    },
    avatarWrap: {
      width: avatarSize,
      height: avatarSize,
      borderRadius: avatarRadius,
      overflow: 'hidden',
      borderWidth: theme.components?.avatar?.border ?? 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      marginRight: spacing.md,
      alignSelf: 'center',
      position: 'relative',
    },
    avatarImageFallback: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.inputBg || colors.surface,
    },
    avatarImg: {
      width: '100%',
      height: '100%',
      backgroundColor: 'transparent',
    },
    avatarImgHidden: {
      opacity: 0,
    },
    avatarFallback: {
      width: avatarSize,
      height: avatarSize,
      borderRadius: avatarRadius,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.inputBg || colors.surface,
      borderWidth: theme.components?.avatar?.border ?? 1,
      borderColor: colors.border,
      marginRight: spacing.md,
      alignSelf: 'center',
    },
    avatarText: {
      fontSize: type.sizes.lg,
      fontWeight: type.weight.bold,
      color: colors.primary,
    },
    profileInfo: {
      flex: 1,
      paddingRight: spacing.xl + spacing.md,
    },
    profileName: {
      fontSize: type.sizes.lg,
      fontWeight: type.weight.semibold,
      color: colors.text,
      lineHeight: Math.round(type.sizes.lg * 1.25),
      paddingRight: spacing.md,
    },
    profileRoleText: {
      fontSize: type.sizes.sm,
      color: colors.textSecondary || colors.text,
    },
    metaRows: {
      marginTop: spacing.xs,
      gap: spacing.xs,
    },
    companyText: {
      fontSize: type.sizes.sm,
      color: colors.text,
      fontWeight: type.weight.semibold,
    },
    roleRow: {},
    departmentRow: {},
    departmentText: {
      fontSize: type.sizes.sm,
      color: colors.textSecondary || colors.text,
    },
    profileMenuDotsWrap: {
      position: 'absolute',
      top: spacing.sm,
      right: spacing.sm,
      width: iconButtonSize,
      height: iconButtonSize,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.transparent || 'transparent',
    },
    menuCard: {},
    subscriptionWarningCard: {
      marginBottom: spacing.lg,
      borderRadius: theme.components.card.radius,
      borderWidth: theme.components?.card?.borderWidth ?? 1,
      borderColor: withAlpha(colors.warning || colors.primary, 0.2),
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    subscriptionWarningHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: spacing.xs,
      gap: spacing.xs,
    },
    subscriptionWarningBadge: {
      width: badgeSize,
      height: badgeSize,
      borderRadius: badgeSize / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.warning || colors.primary, 0.14),
    },
    subscriptionWarningBody: { flex: 1 },
    subscriptionWarningTitle: {
      fontSize: type.sizes.md,
      fontWeight: type.weight.semibold,
      color: colors.text,
    },
    subscriptionWarningText: {
      fontSize: type.sizes.sm,
      color: colors.textSecondary || colors.text,
      lineHeight: Math.round(type.sizes.sm * 1.35),
    },
    subscriptionWarningLinkRow: {
      marginTop: spacing.sm,
      paddingTop: spacing.sm,
      borderTopWidth: theme.components?.listItem?.dividerWidth ?? 1,
      borderTopColor: withAlpha(colors.border, 0.65),
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    subscriptionWarningLinkText: {
      fontSize: type.sizes.sm,
      color: colors.text,
      fontWeight: type.weight.semibold,
    },
    menuRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: menuRowMinHeight + spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      backgroundColor: colors.surface,
    },
    menuRowDisabled: {
      opacity: theme.components?.listItem?.disabledOpacity ?? 0.6,
    },
    menuContent: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    menuRowRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    menuBadge: {
      borderRadius: radii.pill,
      minWidth: spacing.lg + spacing.xs,
      paddingHorizontal: spacing.xs,
      paddingVertical: badgeVerticalPadding,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
    },
    menuBadgeText: {
      color: colors.onPrimary,
      fontSize: type.sizes.xs,
      fontWeight: type.weight.semibold,
    },
    menuIcon: { marginRight: spacing.md },
    menuLabel: {
      fontSize: type.sizes.md,
      color: colors.text,
    },
    menuLabelDisabled: {
      color: colors.textSecondary || colors.text,
    },
    quickAccessCard: {
      marginBottom: spacing.lg,
    },
    actionWrapper: { marginBottom: spacing.md },
    loadingRoot: {
      flex: 1,
      padding: spacing.lg,
      justifyContent: 'center',
    },
    loadingCard: {
      borderRadius: theme.components.card.radius,
      borderWidth: theme.components?.card?.borderWidth ?? 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    loadingText: {
      color: colors.text,
      fontSize: type.sizes.md,
      fontWeight: type.weight.medium,
    },
  });
};

