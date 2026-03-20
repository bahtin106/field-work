// components/universalhome.jsx
import FeatherIcon from '@expo/vector-icons/Feather';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image as ExpoImage } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuthContext } from '../providers/SimpleAuthProvider';
import { withAlpha } from '../theme/colors';
import { usePermissions } from '../lib/permissions';
import { getStatusDbAliases, mapStatusToDb } from '../lib/orderFilters';
import { supabase } from '../lib/supabase';
import { yandexDiskIntegration } from '../lib/yandexDiskIntegration';
import { inspectProfileMedia } from '../src/features/profileMedia/api';
import { useTranslation } from '../src/i18n/useTranslation';
import { useTheme } from '../theme/ThemeProvider';
import { useSuperAdminAccess } from '../hooks/useSuperAdminAccess';
import { useSubscriptionGuard } from '../hooks/useSubscriptionGuard';
import { useCompanySettings } from '../hooks/useCompanySettings';
import Button from './ui/Button';
import Card from './ui/Card';
import { useToast } from './ui/ToastProvider';

const VERBOSE_HOME_LOGS = __DEV__ && globalThis?.__VERBOSE_HOME_LOGS__ === true;

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
      .select('full_name, first_name, last_name, avatar_url, role, company_id, department_id')
      .eq('user_id', uid)
      .maybeSingle();
    if (byUserId) return await resolveProfileAvatar(byUserId);
  } catch {}

  const { data: byId } = await supabase
    .from('profiles')
    .select('full_name, first_name, last_name, avatar_url, role, company_id, department_id')
    .eq('id', uid)
    .maybeSingle();
  return await resolveProfileAvatar(byId || null);
}

async function fetchCountsMy(uid) {
  if (!uid) return { feed: 0, new: 0, progress: 0, all: 0 };
  const newStatuses = getStatusDbAliases('new');
  const inProgressStatus = mapStatusToDb('in_progress');
  const fetchCount = async (filterCb) => {
    let q = supabase.from('orders_secure_v2').select('id', { count: 'exact' });
    q = filterCb(q);
    const { count } = await q.range(0, 0);
    return count || 0;
  };
  const [feedMy, allMy, newMy, progressMy] = await Promise.all([
    fetchCount((q) => q.is('assigned_to', null)),
    fetchCount((q) => q.eq('assigned_to', uid)),
    fetchCount((q) => q.eq('assigned_to', uid).in('status', newStatuses)),
    fetchCount((q) => q.eq('assigned_to', uid).eq('status', inProgressStatus)),
  ]);
  return { feed: feedMy, new: newMy, progress: progressMy, all: allMy };
}

async function fetchCountsAll() {
  const newStatuses = getStatusDbAliases('new');
  const inProgressStatus = mapStatusToDb('in_progress');
  const fetchCount = async (filterCb) => {
    let q = supabase.from('orders_secure_v2').select('id', { count: 'exact' });
    q = filterCb(q);
    const { count } = await q.range(0, 0);
    return count || 0;
  };
  const [feedAll, allAll, newAll, progressAll] = await Promise.all([
    fetchCount((q) => q.is('assigned_to', null)),
    fetchCount((q) => q),
    fetchCount((q) => q.in('status', newStatuses)),
    fetchCount((q) => q.eq('status', inProgressStatus)),
  ]);
  return { feed: feedAll, new: newAll, progress: progressAll, all: allAll };
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
  const lastNavigationAtRef = useRef(0);
  const NAV_GUARD_MS = 0;

  const runSingleNavigation = useCallback((navigate) => {
    const now = Date.now();
    if (now - lastNavigationAtRef.current < NAV_GUARD_MS) return;
    lastNavigationAtRef.current = now;
    navigate?.();
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

  const [scope, setScope] = useState('my');

  // ====== Session / profile ======
  const { data: session } = useQuery({
    queryKey: ['session'],
    queryFn: fetchSession,
    staleTime: 0,
    refetchOnMount: 'stale',
    enabled: !user,
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
    initialData: providedProfile || undefined,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });

  const currentProfile = profileData || providedProfile || null;

  const fullName =
    currentProfile?.full_name ||
    `${currentProfile?.first_name || ''} ${currentProfile?.last_name || ''}`.trim();
  const firstName = currentProfile?.first_name || '';
  const lastName = currentProfile?.last_name || '';
  const avatarUrl = currentProfile?.avatar_display_url || currentProfile?.avatar_url || null;
  const companyId = currentProfile?.company_id || null;
  const { settings: companySettings, useDepartments } = useCompanySettings(companyId || null);
  const subscriptionGuard = useSubscriptionGuard(companyId);
  const isReadOnlyBySubscription =
    !subscriptionGuard.isLoading &&
    String(subscriptionGuard.reason || '').startsWith('subscription_');
  const deptIdFromProfile = currentProfile?.department_id || null;

  // Prefer explicit role from props, then profile, then permissions fallback.
  // This keeps UI responsive while permissions are still loading.
  const resolvedRole = role || currentProfile?.role || roleFromPerms || 'worker';

  // Р В РЎвЂ™Р В РўвЂР В РЎВР В РЎвЂР В Р вЂ¦ Р В Р’В±Р В Р’ВµР В Р’В· Р В РЎвЂўР В Р’В¶Р В РЎвЂР В РўвЂР В Р’В°Р В Р вЂ¦Р В РЎвЂР РЋР РЏ Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В РЎВР В РЎвЂР РЋРІвЂљВ¬Р В Р’ВµР В Р вЂ¦Р В РЎвЂўР В Р вЂ 
  const isAdmin = resolvedRole === 'admin';

  // Р В РЎвЂєР В Р’В±Р В Р’В»Р В Р’В°Р РЋР С“Р РЋРІР‚С™Р РЋР Р‰ Р В РЎвЂ”Р РЋР вЂљР В РЎвЂўР РЋР С“Р В РЎВР В РЎвЂўР РЋРІР‚С™Р РЋР вЂљР В Р’В°
  const canViewAll = isAdmin || (!permsLoading && has?.('canViewAllOrders') === true);

  // Р Р†Р’ВРІР‚В¦ Р В РЎСљР В РЎвЂўР В Р вЂ Р В РЎвЂўР В Р’Вµ: Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ Р В РЎвЂў Р В Р вЂ¦Р В Р’В° Р РЋР С“Р В РЎвЂўР В Р’В·Р В РўвЂР В Р’В°Р В Р вЂ¦Р В РЎвЂР В Р’Вµ Р В Р’В·Р В Р’В°Р РЋР РЏР В Р вЂ Р В РЎвЂўР В РЎвЂќ Р РЋРЎвЂњР РЋРІР‚РЋР В РЎвЂР РЋРІР‚С™Р РЋРІР‚в„–Р В Р вЂ Р В Р’В°Р В Р’ВµР РЋРІР‚С™ isAdmin Р В РЎвЂ Р В Р’В·Р В Р’В°Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В·Р В РЎвЂќР РЋРЎвЂњ Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В РЎВР В РЎвЂР РЋРІвЂљВ¬Р В Р’ВµР В Р вЂ¦Р В РЎвЂўР В Р вЂ 
  const canCreateOrders = !permsLoading && has?.('canCreateOrders') === true;

  useEffect(() => {
    if (!canViewAll && scope !== 'my') setScope('my');
  }, [canViewAll, scope]);

  // ====== Counters ======
  // Р В РІР‚СљР В Р’В°Р РЋР вЂљР В Р’В°Р В Р вЂ¦Р РЋРІР‚С™Р В РЎвЂР РЋР вЂљР РЋРЎвЂњР В Р’ВµР В РЎВ, Р РЋРІР‚РЋР РЋРІР‚С™Р В РЎвЂў Р РЋР С“Р РЋРІР‚РЋР РЋРІР‚ВР РЋРІР‚С™Р РЋРІР‚РЋР В РЎвЂР В РЎвЂќР В РЎвЂ Р В Р’В·Р В Р’В°Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В¶Р В Р’В°Р РЋР вЂ№Р РЋРІР‚С™Р РЋР С“Р РЋР РЏ Р В РЎвЂќР В РЎвЂўР В РЎвЂ“Р В РўвЂР В Р’В° Р В Р’ВµР РЋР С“Р РЋРІР‚С™Р РЋР Р‰ uid Р В Р’В Р РЋР вЂљР В РЎвЂўР В Р’В»Р РЋР Р‰ Р В РЎвЂўР В РЎвЂ”Р РЋР вЂљР В Р’ВµР В РўвЂР В Р’ВµР В Р’В»Р В Р’ВµР В Р вЂ¦Р В Р’В°
  // profileLoading Р В РЎСљР В РІР‚Сћ Р В Р’В±Р В Р’В»Р В РЎвЂўР В РЎвЂќР В РЎвЂР РЋР вЂљР РЋРЎвЂњР В Р’ВµР РЋРІР‚С™ Р РЋР С“Р РЋРІР‚РЋР В Р’ВµР РЋРІР‚С™Р РЋРІР‚РЋР В РЎвЂР В РЎвЂќР В РЎвЂ - Р В РЎвЂўР В Р вЂ¦Р В РЎвЂ Р В РЎВР В РЎвЂўР В РЎвЂ“Р РЋРЎвЂњР РЋРІР‚С™ Р В Р’В·Р В Р’В°Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В¶Р В Р’В°Р РЋРІР‚С™Р РЋР Р‰Р РЋР С“Р РЋР РЏ Р В РЎвЂ”Р В Р’В°Р РЋР вЂљР В Р’В°Р В Р’В»Р В Р’В»Р В Р’ВµР В Р’В»Р РЋР Р‰Р В Р вЂ¦Р В РЎвЂў
  const readyForCounts = !!uid && !!resolvedRole;

  // Debug: readiness for counts queries.
  useEffect(() => {
    if (!VERBOSE_HOME_LOGS) return;
    console.info('[UniversalHome] Counts readiness:', {
      uid,
      resolvedRole,
      readyForCounts,
      canViewAll,
    });
  }, [uid, resolvedRole, readyForCounts, canViewAll]);

  const {
    data: myCounts = { feed: 0, new: 0, progress: 0, all: 0 },
    isFetched: myCountsFetched,
  } = useQuery({
    queryKey: ['counts', 'my', uid],
    queryFn: () => fetchCountsMy(uid),
    enabled: readyForCounts,
    staleTime: 2 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnMount: false,
    placeholderData: (prev) => prev,
  });

  const { data: allCounts = { feed: 0, new: 0, progress: 0, all: 0 } } = useQuery({
    queryKey: ['counts', 'all'],
    queryFn: fetchCountsAll,
    enabled: readyForCounts && canViewAll,
    staleTime: 2 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnMount: false,
    placeholderData: (prev) => prev,
  });

  // ====== Р В РЎСљР В Р’В°Р В Р вЂ Р В РЎвЂР В РЎвЂ“Р В Р’В°Р РЋРІР‚В Р В РЎвЂР РЋР РЏ ======
  const openSelfProfileEdit = useCallback(() => {
    const selfProfileId = String(currentProfile?.id || uid || '').trim();
    if (!isUuid(selfProfileId)) return;
    runSingleNavigation(() =>
      router.push({ pathname: '/users/[id]', params: { id: selfProfileId } }),
    );
  }, [currentProfile?.id, router, runSingleNavigation, uid]);
  const openAppSettings = useCallback(
    () => runSingleNavigation(() => router.push('/app_settings/AppSettings')),
    [router, runSingleNavigation],
  );
  const openCompanySettings = useCallback(
    () => runSingleNavigation(() => router.push('/company_settings')),
    [router, runSingleNavigation],
  );
  const openCloudStorageSettings = useCallback(
    () => runSingleNavigation(() => router.push('/company_settings/sections/yandex-disk')),
    [router, runSingleNavigation],
  );
  const openAdministration = useCallback(
    () => runSingleNavigation(() => router.push('/admin')),
    [router, runSingleNavigation],
  );
  const openStats = useCallback(
    () => runSingleNavigation(() => router.push('/stats')),
    [router, runSingleNavigation],
  );
  const openBilling = useCallback(
    () => runSingleNavigation(() => router.push('/billing')),
    [router, runSingleNavigation],
  );
  const openCreateOrder = useCallback(() => {
    if (isReadOnlyBySubscription) {
      toast.warning(t('subscription_create_unavailable_toast'));
      return;
    }
    runSingleNavigation(() => router.push('/orders/create-order'));
  }, [isReadOnlyBySubscription, router, runSingleNavigation, t, toast]);
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

  const openOrdersWithFilter = (key) => {
    if (scope === 'all' && canViewAll) {
      const map = { feed: 'feed', new: 'new', progress: 'in_progress', all: 'all' };
      runSingleNavigation(() =>
        router.push({ pathname: '/orders/all-orders', params: { filter: map[key] || 'all' } }),
      );
    } else {
      runSingleNavigation(() =>
        router.push({ pathname: '/orders/my-orders', params: { seedFilter: key } }),
      );
    }
  };

  const menuItems = useMemo(
    () =>
      [
        {
          key: 'app',
          title: t('home_menu_app_settings'),
          icon: 'sliders',
          onPress: openAppSettings,
          visible: true,
        },
        {
          key: 'stats',
          title: t('home_menu_stats'),
          icon: 'bar-chart-2',
          onPress: openStats,
          visible: true,
        },
        {
          key: 'company',
          title: t('home_menu_company_settings'),
          icon: 'settings',
          onPress: openCompanySettings,
          visible: isAdmin,
        },
        {
          key: 'administration',
          title: t('settings_company_administration'),
          icon: 'shield',
          onPress: openAdministration,
          visible: isSuperAdmin,
        },
      ].filter((i) => i.visible),
    [isAdmin, isSuperAdmin, openAppSettings, openStats, openCompanySettings, openAdministration, t],
  );

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

  const counts = scope === 'all' && canViewAll ? allCounts : myCounts;
  const roleLabel =
    resolvedRole === 'admin'
      ? t('role_admin')
      : resolvedRole === 'dispatcher'
        ? t('role_dispatcher')
        : t('role_worker');

  const hasProfileSeed = !!currentProfile?.id;
  const companyReady = !companyId || companyFetched;
  const departmentReady = !useDepartments || !departmentIdToUse || departmentFetched;
  const homeCriticalReady =
    !!uid &&
    hasProfileSeed &&
    (profileFetched || !profileLoading) &&
    !permsLoading &&
    myCountsFetched &&
    companyReady &&
    departmentReady;

  useEffect(() => {
    if (!homeCriticalReady) return;
    onInitialReady?.();
  }, [homeCriticalReady, onInitialReady]);

  // Render UI immediately even if profile is still loading.

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <Card style={styles.cardRounded} padded={false}>
          <Pressable
          onPress={openSelfProfileEdit}
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
            <Text style={styles.profileName} numberOfLines={1}>
              {fullName || ''}
            </Text>
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
          return (
            <Pressable
              key={item.key}
              onPress={item.onPress}
              android_ripple={{ color: theme.colors.ripple, borderless: false }}
              style={({ pressed }) => [
                styles.menuRow,
                pressed && styles.rowPressed,
                !isLast && styles.menuRowBorder,
              ]}
              accessibilityRole="button"
            >
              <View style={styles.menuContent}>
                <FeatherIcon
                  name={item.icon}
                  size={theme.icons?.md ?? theme.typography.sizes.md + theme.spacing.xs}
                  color={theme.colors.text}
                  style={styles.menuIcon}
                />
                <Text style={styles.menuLabel}>{item.title}</Text>
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

      {canViewAll && (
        <View style={styles.scopeSwitch}>
          {['my', 'all'].map((s) => {
            const active = scope === s;
            return (
              <Pressable
                key={s}
                onPress={() => setScope(s)}
                android_ripple={{ color: theme.colors.ripple, borderless: false }}
                style={({ pressed }) => [
                  styles.scopePill,
                  active && styles.scopePillActive,
                  pressed && { opacity: 0.9 },
                ]}
                accessibilityRole="button"
              >
                <FeatherIcon
                  name={s === 'my' ? 'user' : 'users'}
                  size={theme.icons?.sm ?? theme.typography.sizes.sm + theme.spacing.xs}
                  color={
                    active
                      ? theme.colors.onPrimary
                      : theme.colors.textSecondary || theme.colors.text
                  }
                  style={styles.scopeIcon}
                />
                <Text style={[styles.scopeText, active && styles.scopeTextActive]}>
                  {s === 'my' ? t('home_scope_my') : t('home_scope_all')}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.summaryContainer}>
        {['feed', 'new', 'progress', 'all'].map((key) => {
          const labelMap = {
            feed: t('home_summary_feed'),
            new: t('home_summary_new'),
            progress: t('home_summary_progress'),
            all: t('home_summary_all'),
          };
          let numberColor = theme.colors.text;
          if (key === 'new') numberColor = theme.colors.primary;
          if (key === 'progress') numberColor = theme.colors.success || theme.colors.primary;
          return (
            <Pressable
              key={key}
              onPress={() => openOrdersWithFilter(key)}
              android_ripple={{ color: theme.colors.ripple, borderless: false }}
              style={({ pressed }) => [styles.summaryItem, pressed && styles.rowPressed]}
              accessibilityRole="button"
            >
              <Text style={[styles.summaryNumber, { color: numberColor }]}>{counts[key] ?? 0}</Text>
              <Text style={styles.summaryLabel}>{labelMap[key]}</Text>
            </Pressable>
          );
        })}
      </View>
      {canCreateOrders && (
        <View style={styles.actionWrapper}>
          <Button title={t('home_btn_create_order')} onPress={openCreateOrder} />
        </View>
      )}

      <View style={styles.actionWrapper}>
        <Button title={t('home_btn_logout')} variant='destructive' onPress={handleLogout} />
      </View>
    </ScrollView>
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
  const summaryNumberSize = type.sizes.xl + spacing.xs;
  const compactTextSize = type.sizes.sm - 1;
  const pillVertical = spacing.xs;
  const pillHorizontal = spacing.md;

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
    menuRowBorder: {
      borderBottomWidth: theme.components?.listItem?.dividerWidth ?? 1,
      borderColor: colors.border,
    },
    menuContent: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    menuIcon: { marginRight: spacing.md },
    menuLabel: {
      fontSize: type.sizes.md,
      color: colors.text,
    },
    scopeSwitch: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    scopePill: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: pillVertical,
      paddingHorizontal: pillHorizontal,
      borderRadius: radii.pill,
      borderWidth: theme.components?.card?.borderWidth ?? 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    scopePillActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    scopeText: {
      fontSize: compactTextSize,
      color: colors.textSecondary || colors.text,
    },
    scopeTextActive: {
      color: colors.onPrimary,
      fontWeight: type.weight.semibold,
    },
    scopeIcon: {
      marginRight: spacing.xs,
    },
    summaryContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      marginBottom: spacing.lg,
    },
    summaryItem: {
      flexBasis: '48%',
      backgroundColor: colors.surface,
      borderWidth: theme.components?.card?.borderWidth ?? 1,
      borderColor: colors.border,
      borderRadius: radii.lg,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.md,
      minHeight: menuRowMinHeight + spacing.xl,
    },
    summaryNumber: {
      fontSize: summaryNumberSize,
      fontWeight: type.weight.bold,
      marginBottom: spacing.xs,
    },
    summaryLabel: {
      fontSize: compactTextSize,
      color: colors.textSecondary || colors.text,
    },
    actionWrapper: { marginBottom: spacing.md },
  });
};



