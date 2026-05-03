// components/universalhome.jsx
import FeatherIcon from '@expo/vector-icons/Feather';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image as ExpoImage } from 'expo-image';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuthContext } from '../providers/SimpleAuthProvider';
import { withAlpha } from '../theme/colors';
import { usePermissions } from '../lib/permissions';
import { supabase } from '../lib/supabase';
import { yandexDiskIntegration } from '../lib/yandexDiskIntegration';
import { inspectProfileMedia } from '../src/features/profileMedia/api';
import { useTranslation } from '../src/i18n/useTranslation';
import { useTheme } from '../theme/ThemeProvider';
import { useSuperAdminAccess } from '../hooks/useSuperAdminAccess';
import { useSubscriptionGuard } from '../hooks/useSubscriptionGuard';
import { useCompanySettings } from '../hooks/useCompanySettings';
import SupportRequestModal from '../app/company_settings/sections/SupportRequestModal';
import {
  countUnreadSupportRequests,
  SUPPORT_UNREAD_REFETCH_MS,
  SUPPORT_UNREAD_QUERY_KEY,
} from '../src/features/supportRequests/api';
import Button from './ui/Button';
import Card from './ui/Card';
import { useToast } from './ui/ToastProvider';

const VERBOSE_HOME_LOGS = __DEV__ && globalThis?.__VERBOSE_HOME_LOGS__ === true;
const HOME_ROUTES = {
  appSettings: '/app_settings/AppSettings',
  appEvents: '/app_settings/sections/events',
  companySettings: '/company_settings',
  cloudStorageSettings: '/company_settings/sections/yandex-disk',
  admin: '/admin',
  billing: '/billing',
  createOrder: '/orders/create-order',
};

let homeCriticalWarmupStarted = false;
let homeAdminWarmupStarted = false;
function warmHomeCriticalRoutes() {
  if (homeCriticalWarmupStarted) return;
  homeCriticalWarmupStarted = true;
  import('../app/app_settings/AppSettings').catch(() => {});
  import('../app/company_settings/CompanySettingsScreen').catch(() => {});
}

function warmHomeAdminRoute() {
  if (homeAdminWarmupStarted) return;
  homeAdminWarmupStarted = true;
  import('../app/admin/index').catch(() => {});
}

function isUuid(s) {
  return (
    typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
  );
}

// --- data fetchers ---
async function fetchSession() {
  const { data } = await supabase.auth.getSession();
  return data?.session || null;
}

async function fetchProfile(uid) {
  if (!uid) return null;

  const resolveProfileAvatar = async (profile) => {
    if (!profile) return null;
    const { cleanedUrls, resolvedUrls } = await inspectProfileMedia(
      [String(profile?.avatar_url || '').trim()].filter(Boolean),
    );
    return cleanedUrls.includes(String(profile?.avatar_url || '').trim())
      ? { ...profile, avatar_url: null, avatar_display_url: null }
      : {
          ...profile,
          avatar_display_url:
            resolvedUrls[String(profile?.avatar_url || '').trim()] || profile?.avatar_url || null,
        };
  };

  try {
    const { data: byUserId } = await supabase
      .from('profiles')
      .select('full_name, first_name, middle_name, last_name, avatar_url, role, company_id, department_id')
      .eq('user_id', uid)
      .maybeSingle();
    if (byUserId) return await resolveProfileAvatar(byUserId);
  } catch {}

  const { data: byId } = await supabase
    .from('profiles')
    .select('full_name, first_name, middle_name, last_name, avatar_url, role, company_id, department_id')
    .eq('id', uid)
    .maybeSingle();
  return await resolveProfileAvatar(byId || null);
}

function HomeWarningCard({
  styles,
  theme,
  icon,
  title,
  body,
  cta,
  onPress,
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
  const { isSuperAdmin, isLoading: superAdminLoading } = useSuperAdminAccess();
  const { has, loading: permsLoading, role: roleFromPerms } = usePermissions();
  const toast = useToast();
  const qc = useQueryClient();
  warmHomeCriticalRoutes();
  const navigateTo = useCallback(
    (href) => {
      if (!href) return;
      router.push(href);
    },
    [router],
  );

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
  const { data: unreadSupportCount = 0, isFetched: unreadSupportFetched } = useQuery({
    queryKey: SUPPORT_UNREAD_QUERY_KEY,
    queryFn: countUnreadSupportRequests,
    enabled: isSuperAdmin,
    staleTime: 10 * 1000,
    refetchInterval: SUPPORT_UNREAD_REFETCH_MS,
  });

  useEffect(() => {
    if (!isSuperAdmin) return undefined;
    const channel = supabase
      .channel('home-feedbacks-unread-counter')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feedbacks' }, () => {
        qc.invalidateQueries({ queryKey: SUPPORT_UNREAD_QUERY_KEY });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isSuperAdmin, qc]);

  // ====== Session / profile ======
  const { data: session } = useQuery({
    queryKey: ['session'],
    queryFn: fetchSession,
    staleTime: 0,
    refetchOnMount: 'stale',
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
    enabled: !!uid && !providedProfile,
    initialData: providedProfile || undefined,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: providedProfile ? false : 'always',
    refetchOnReconnect: !providedProfile,
    placeholderData: (prev) => prev,
  });

  const currentProfile = profileData || providedProfile || null;

  const fullName =
    `${currentProfile?.first_name || ''} ${currentProfile?.middle_name || ''} ${currentProfile?.last_name || ''}`.trim() ||
    currentProfile?.full_name;
  const firstName = currentProfile?.first_name || '';
  const lastName = currentProfile?.last_name || '';
  const avatarUrl = currentProfile?.avatar_display_url || currentProfile?.avatar_url || null;
  const companyId = currentProfile?.company_id || null;
  const {
    settings: companySettings,
    useDepartments,
    isLoading: companySettingsLoading,
  } = useCompanySettings(companyId || null);
  const subscriptionGuard = useSubscriptionGuard(companyId);
  const isReadOnlyBySubscription =
    !subscriptionGuard.isLoading &&
    String(subscriptionGuard.reason || '').startsWith('subscription_');
  const deptIdFromProfile = currentProfile?.department_id || null;

  // Prefer explicit role from props, then profile, then permissions fallback.
  // This keeps UI responsive while permissions are still loading.
  const resolvedRole = role || currentProfile?.role || roleFromPerms || 'worker';

  const isAdmin = resolvedRole === 'admin';
  const accountType = String(
    user?.user_metadata?.account_type || session?.user?.user_metadata?.account_type || '',
  ).toLowerCase();
  const isSoloAdmin = isAdmin && accountType === 'solo';


  const canCreateOrders = !permsLoading && has?.('canCreateOrders') === true;


  const openSelfProfileEdit = useCallback(() => {
    const selfProfileId = String(currentProfile?.id || uid || '').trim();
    if (!isUuid(selfProfileId)) return;
    router.push({ pathname: '/users/[id]', params: { id: selfProfileId } });
  }, [currentProfile?.id, router, uid]);
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
    queryFn: () => yandexDiskIntegration('status'),
    enabled: shouldCheckCloudHealth,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: true,
    placeholderData: (prev) => prev,
  });
  const cloudHealthCode = String(
    cloudStatusError
      ? 'error'
      : cloudIntegrationStatus?.health ||
          (cloudIntegrationStatus?.connected ? 'unknown' : 'not_connected'),
  );
  const hasCloudIssue =
    shouldCheckCloudHealth &&
    cloudStatusFetched &&
    !cloudStatusFetching &&
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
    warmHomeCriticalRoutes();
    if (isSuperAdmin) warmHomeAdminRoute();
    if (typeof router?.prefetch !== 'function') return;
    const routesToPrefetch = [HOME_ROUTES.appSettings, HOME_ROUTES.companySettings];
    if (isSuperAdmin) routesToPrefetch.push(HOME_ROUTES.admin);
    routesToPrefetch.forEach((route) => {
      try {
        router.prefetch(route);
      } catch {}
    });
  }, [isSuperAdmin, router]);

  const styles = useMemo(() => createStyles(theme), [theme]);

  useEffect(() => {
    if (!uid) return undefined;
    const channel = supabase
      .channel(`home-profile-${uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` },
        () => {
          qc.invalidateQueries({ queryKey: ['profile', uid] });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles', filter: `user_id=eq.${uid}` },
        () => {
          qc.invalidateQueries({ queryKey: ['profile', uid] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc, uid]);

  useFocusEffect(
    useCallback(() => {
      if (!uid) return undefined;
      qc.invalidateQueries({ queryKey: ['profile', uid] });
      return undefined;
    }, [qc, uid]),
  );

  // Fetch company name if companyId is available
  const { data: companyRow, isFetched: companyFetched } = useQuery({
    queryKey: ['company', companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const { data } = await supabase.from('companies').select('id, name').eq('id', companyId).maybeSingle();
      return data || null;
    },
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
  });

  const companyName = companyRow?.name || null;

  // Fetch department name if department id available
  const departmentIdToUse = deptIdFromProfile;
  const { data: departmentRow, isFetched: departmentFetched } = useQuery({
    queryKey: ['department', departmentIdToUse],
    queryFn: async () => {
      if (!departmentIdToUse) return null;
      const { data } = await supabase.from('departments').select('id, name').eq('id', departmentIdToUse).maybeSingle();
      return data || null;
    },
    enabled: useDepartments && !!departmentIdToUse,
    staleTime: 60 * 1000,
    refetchOnMount: 'always',
  });

  const departmentName = departmentRow?.name || null;

  const initials = useMemo(() => {
    const a = (firstName || '').trim().slice(0, 1);
    const b = (lastName || '').trim().slice(0, 1);
    const fromFull = (fullName || '')
      .trim()
      .split(/\s+/)
      .map((s) => s.slice(0, 1))
      .slice(0, 2)
      .join('');
    return (a + b || fromFull || '??').toUpperCase();
  }, [firstName, lastName, fullName]);

  const roleLabel =
    resolvedRole === 'admin'
      ? t('role_admin')
      : resolvedRole === 'dispatcher'
        ? t('role_dispatcher')
        : t('role_worker');
  const badgeOverflowThreshold = theme.components?.badge?.maxCount ?? 99;
  const badgeOverflowLabel = `${badgeOverflowThreshold}+`;

  const hasProfileSeed = !!currentProfile?.id;
  const companyReady = !companyId || companyFetched;
  const departmentReady = !useDepartments || !departmentIdToUse || departmentFetched;
  const homeCriticalReady =
    !!uid &&
    hasProfileSeed &&
    (profileFetched || !profileLoading) &&
    !permsLoading &&
    companyReady &&
    departmentReady;

  const unreadSupportReady = !isSuperAdmin || unreadSupportFetched;
  const companySettingsReady = !companyId || !isAdmin || !companySettingsLoading;
  const subscriptionReady = !companyId || !subscriptionGuard.isLoading;
  const cloudStatusReady = !shouldCheckCloudHealth || cloudStatusFetched || cloudStatusError;
  const superAdminReady = !superAdminLoading;
  const homeShellReady =
    homeCriticalReady &&
    unreadSupportReady &&
    companySettingsReady &&
    subscriptionReady &&
    cloudStatusReady &&
    superAdminReady;

  useEffect(() => {
    if (!homeShellReady) return;
    onInitialReady?.();
  }, [homeShellReady, onInitialReady]);

  if (!homeShellReady) {
    return (
      <View style={styles.loadingRoot}>
        <Card style={styles.loadingCard}>
          <View style={styles.loadingRow}>
            <ActivityIndicator
              size={theme.components?.activityIndicator?.size ?? 'small'}
              color={theme.colors.primary}
            />
            <Text style={styles.loadingText}>
              {t('toast_loading_info', 'Загружаю информацию…')}
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
          {avatarUrl ? (
            <View style={styles.avatarWrap}>
              <ExpoImage source={{ uri: avatarUrl }} style={styles.avatarImg} contentFit="cover" cachePolicy="none" />
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
                {useDepartments && departmentName ? (
                  <View style={styles.departmentRow}>
                    <Text style={styles.departmentText} numberOfLines={1}>
                      {`${t('users_department')}: ${departmentName}`}
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

      <Card style={[styles.cardRounded, styles.menuCard]} padded={false}>
        {menuItems.map((item, index) => {
          const isLast = index === menuItems.length - 1;
          const isDisabled = item.disabled === true;
          return (
            <Pressable
              key={item.key}
              onPress={item.onPress}
              unstable_pressDelay={0}
              onPressIn={() => {
                const route = item.route;
                if (!route || typeof router?.prefetch !== 'function') return;
                try {
                  router.prefetch(route);
                } catch {}
              }}
              android_ripple={{ color: theme.colors.ripple, borderless: false }}
              style={({ pressed }) => [
                styles.menuRow,
                isDisabled && styles.menuRowDisabled,
                pressed && styles.rowPressed,
                !isLast && styles.menuRowBorder,
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
        <Card style={[styles.cardRounded, styles.quickAccessCard]} padded={false}>
          {quickAccessItems.map((item, index) => {
            const isLast = index === quickAccessItems.length - 1;
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
                  !isLast && styles.menuRowBorder,
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
          <Button title={t('home_btn_create_order')} onPress={openCreateOrder} />
        </View>
      )}

      <View style={styles.actionWrapper}>
        <Button title={t('home_btn_logout')} variant='destructive' onPress={handleLogout} />
      </View>
      </ScrollView>

      <SupportRequestModal
        key={`support-request-${supportRequestNonce}`}
        visible={supportRequestOpen}
        onClose={() => setSupportRequestOpen(false)}
        profile={currentProfile}
      />
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
      borderRadius: radii.xl,
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
    },
    avatarImg: { width: '100%', height: '100%' },
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
      borderRadius: radii.xl,
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
    menuRowBorder: {
      borderBottomWidth: theme.components?.listItem?.dividerWidth ?? 1,
      borderColor: colors.border,
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
      borderRadius: radii.xl,
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

