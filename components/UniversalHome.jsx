// components/universalhome.jsx
import FeatherIcon from '@expo/vector-icons/Feather';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuthContext } from '../providers/SimpleAuthProvider';
import { withAlpha } from '../theme/colors';
import { usePermissions } from '../lib/permissions';
import { supabase } from '../lib/supabase';
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
  try {
    const { data: byUserId } = await supabase
      .from('profiles')
      .select('full_name, first_name, last_name, avatar_url, role, company_id, department_id')
      .eq('user_id', uid)
      .maybeSingle();
    if (byUserId) return byUserId;
  } catch {}

  const { data: byId } = await supabase
    .from('profiles')
    .select('full_name, first_name, last_name, avatar_url, role, company_id, department_id')
    .eq('id', uid)
    .maybeSingle();
  return byId || null;
}

async function fetchCountsMy(uid) {
  if (!uid) return { feed: 0, new: 0, progress: 0, all: 0 };
  const fetchCount = async (filterCb) => {
    let q = supabase.from('orders_secure_v2').select('id', { count: 'exact' });
    q = filterCb(q);
    const { count } = await q.range(0, 0);
    return count || 0;
  };
  const [feedMy, allMy, newMy, progressMy] = await Promise.all([
    fetchCount((q) => q.is('assigned_to', null)),
    fetchCount((q) => q.eq('assigned_to', uid)),
    fetchCount((q) => q.eq('assigned_to', uid).or('status.is.null,status.eq.– —ú– —ï– –Ü–°‚Äπ– ‚Ññ')),
    fetchCount((q) => q.eq('assigned_to', uid).eq('status', '– ‚Äô –°–Ç– ¬∞– ¬±– —ï–°‚Äö– ¬µ')),
  ]);
  return { feed: feedMy, new: newMy, progress: progressMy, all: allMy };
}

async function fetchCountsAll() {
  const fetchCount = async (filterCb) => {
    let q = supabase.from('orders_secure_v2').select('id', { count: 'exact' });
    q = filterCb(q);
    const { count } = await q.range(0, 0);
    return count || 0;
  };
  const [feedAll, allAll, newAll, progressAll] = await Promise.all([
    fetchCount((q) => q.is('assigned_to', null)),
    fetchCount((q) => q),
    fetchCount((q) => q.or('status.is.null,status.eq.– —ú– —ï– –Ü–°‚Äπ– ‚Ññ')),
    fetchCount((q) => q.eq('status', '– ‚Äô –°–Ç– ¬∞– ¬±– —ï–°‚Äö– ¬µ')),
  ]);
  return { feed: feedAll, new: newAll, progress: progressAll, all: allAll };
}

export default function UniversalHome({ role, user, profile: providedProfile }) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { signOut } = useAuthContext();
  const { isSuperAdmin } = useSuperAdminAccess();
  const { has, loading: permsLoading, role: roleFromPerms } = usePermissions();
  const toast = useToast();
  const qc = useQueryClient();

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

  const { data: profileData, isLoading: profileLoading } = useQuery({
    queryKey: ['profile', uid],
    queryFn: () => fetchProfile(uid),
    enabled: !!uid,
    initialData: providedProfile || undefined,
    staleTime: 30 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });

  const currentProfile = profileData || providedProfile || null;

  const fullName =
    currentProfile?.full_name ||
    `${currentProfile?.first_name || ''} ${currentProfile?.last_name || ''}`.trim();
  const firstName = currentProfile?.first_name || '';
  const lastName = currentProfile?.last_name || '';
  const avatarUrl = currentProfile?.avatar_url || null;
  const companyId = currentProfile?.company_id || null;
  const { useDepartments } = useCompanySettings(companyId || null);
  const subscriptionGuard = useSubscriptionGuard(companyId);
  const isReadOnlyBySubscription =
    !subscriptionGuard.isLoading &&
    String(subscriptionGuard.reason || '').startsWith('subscription_');
  const deptIdFromProfile = currentProfile?.department_id || null;

  // Prefer explicit role from props, then profile, then permissions fallback.
  // This keeps UI responsive while permissions are still loading.
  const resolvedRole = role || currentProfile?.role || roleFromPerms || 'worker';

  // – ¬ –°‚Äô– ¬ –¢‚Äò– ¬ –°¬ò– ¬ –°‚Äò– ¬ – ‚Ä¶ – ¬ –í¬±– ¬ –í¬µ– ¬ –í¬∑ – ¬ –°‚Ä¢– ¬ –í¬∂– ¬ –°‚Äò– ¬ –¢‚Äò– ¬ –í¬∞– ¬ – ‚Ä¶– ¬ –°‚Äò– –é– –è – ¬ –°‚Äî– ¬ –í¬µ– –é– ‚Äö– ¬ –°¬ò– ¬ –°‚Äò– –é–≤‚Äö¬¨– ¬ –í¬µ– ¬ – ‚Ä¶– ¬ –°‚Ä¢– ¬ – ‚Ä 
  const isAdmin = resolvedRole === 'admin';

  // – ¬ –°‚Ä∫– ¬ –í¬±– ¬ –í¬ª– ¬ –í¬∞– –é– —ì– –é–≤–Ç—ô– –é– –â – ¬ –°‚Äî– –é– ‚Äö– ¬ –°‚Ä¢– –é– —ì– ¬ –°¬ò– ¬ –°‚Ä¢– –é–≤–Ç—ô– –é– ‚Äö– ¬ –í¬∞
  const canViewAll = isAdmin || (!permsLoading && has?.('canViewAllOrders') === true);

  // – –Ü–í¬ò–≤–Ç¬¶ – ¬ –°—ö– ¬ –°‚Ä¢– ¬ – ‚Ä – ¬ –°‚Ä¢– ¬ –í¬µ: – ¬ –°‚Äî– –é– ‚Äö– ¬ –í¬∞– ¬ – ‚Ä – ¬ –°‚Ä¢ – ¬ – ‚Ä¶– ¬ –í¬∞ – –é– —ì– ¬ –°‚Ä¢– ¬ –í¬∑– ¬ –¢‚Äò– ¬ –í¬∞– ¬ – ‚Ä¶– ¬ –°‚Äò– ¬ –í¬µ – ¬ –í¬∑– ¬ –í¬∞– –é– –è– ¬ – ‚Ä – ¬ –°‚Ä¢– ¬ –°‚Äù – –é–°‚Äú– –é–≤–Ç–é– ¬ –°‚Äò– –é–≤–Ç—ô– –é–≤–Ç‚Ññ– ¬ – ‚Ä – ¬ –í¬∞– ¬ –í¬µ– –é–≤–Ç—ô isAdmin – ¬ –°‚Äò – ¬ –í¬∑– ¬ –í¬∞– ¬ –°‚Äì– –é– ‚Äö– –é–°‚Äú– ¬ –í¬∑– ¬ –°‚Äù– –é–°‚Äú – ¬ –°‚Äî– ¬ –í¬µ– –é– ‚Äö– ¬ –°¬ò– ¬ –°‚Äò– –é–≤‚Äö¬¨– ¬ –í¬µ– ¬ – ‚Ä¶– ¬ –°‚Ä¢– ¬ – ‚Ä 
  const canCreateOrders = isAdmin || (!permsLoading && has?.('canCreateOrders') === true);

  useEffect(() => {
    if (!canViewAll && scope !== 'my') setScope('my');
  }, [canViewAll, scope]);

  // ====== Counters ======
  // – ¬ –≤–Ç—ö– ¬ –í¬∞– –é– ‚Äö– ¬ –í¬∞– ¬ – ‚Ä¶– –é–≤–Ç—ô– ¬ –°‚Äò– –é– ‚Äö– –é–°‚Äú– ¬ –í¬µ– ¬ –°¬ò, – –é–≤–Ç–é– –é–≤–Ç—ô– ¬ –°‚Ä¢ – –é– —ì– –é–≤–Ç–é– –é–≤–Ç¬ò– –é–≤–Ç—ô– –é–≤–Ç–é– ¬ –°‚Äò– ¬ –°‚Äù– ¬ –°‚Äò – ¬ –í¬∑– ¬ –í¬∞– ¬ –°‚Äì– –é– ‚Äö– –é–°‚Äú– ¬ –í¬∂– ¬ –í¬∞– –é– ‚Äπ– –é–≤–Ç—ô– –é– —ì– –é– –è – ¬ –°‚Äù– ¬ –°‚Ä¢– ¬ –°‚Äì– ¬ –¢‚Äò– ¬ –í¬∞ – ¬ –í¬µ– –é– —ì– –é–≤–Ç—ô– –é– –â uid – ¬ –í¬ò – –é– ‚Äö– ¬ –°‚Ä¢– ¬ –í¬ª– –é– –â – ¬ –°‚Ä¢– ¬ –°‚Äî– –é– ‚Äö– ¬ –í¬µ– ¬ –¢‚Äò– ¬ –í¬µ– ¬ –í¬ª– ¬ –í¬µ– ¬ – ‚Ä¶– ¬ –í¬∞
  // profileLoading – ¬ –°—ö– ¬ –≤–Ç—û – ¬ –í¬±– ¬ –í¬ª– ¬ –°‚Ä¢– ¬ –°‚Äù– ¬ –°‚Äò– –é– ‚Äö– –é–°‚Äú– ¬ –í¬µ– –é–≤–Ç—ô – –é– —ì– –é–≤–Ç–é– ¬ –í¬µ– –é–≤–Ç—ô– –é–≤–Ç–é– ¬ –°‚Äò– ¬ –°‚Äù– ¬ –°‚Äò - – ¬ –°‚Ä¢– ¬ – ‚Ä¶– ¬ –°‚Äò – ¬ –°¬ò– ¬ –°‚Ä¢– ¬ –°‚Äì– –é–°‚Äú– –é–≤–Ç—ô – ¬ –í¬∑– ¬ –í¬∞– ¬ –°‚Äì– –é– ‚Äö– –é–°‚Äú– ¬ –í¬∂– ¬ –í¬∞– –é–≤–Ç—ô– –é– –â– –é– —ì– –é– –è – ¬ –°‚Äî– ¬ –í¬∞– –é– ‚Äö– ¬ –í¬∞– ¬ –í¬ª– ¬ –í¬ª– ¬ –í¬µ– ¬ –í¬ª– –é– –â– ¬ – ‚Ä¶– ¬ –°‚Ä¢
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

  const { data: myCounts = { feed: 0, new: 0, progress: 0, all: 0 } } = useQuery({
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

  // ====== – ¬ –°—ö– ¬ –í¬∞– ¬ – ‚Ä – ¬ –°‚Äò– ¬ –°‚Äì– ¬ –í¬∞– –é–≤–Ç¬ – ¬ –°‚Äò– –é– –è ======
  const openSelfProfileEdit = () => {
    if (uid) router.push(`/users/${uid}`);
  };
  const openAppSettings = useCallback(() => router.push('/app_settings/AppSettings'), [router]);
  const openCompanySettings = useCallback(() => router.push('/company_settings'), [router]);
  const openAdministration = useCallback(() => router.push('/admin'), [router]);
  const openStats = useCallback(() => router.push('/stats'), [router]);
  const openBilling = useCallback(() => router.push('/billing'), [router]);
  const openCreateOrder = useCallback(() => {
    if (isReadOnlyBySubscription) {
      toast.warning(
        t('subscription_create_unavailable_toast', '–°–æ–∑–¥–∞–Ω–∏–µ –∑–∞—è–≤–∫–∏ –Ω–µ–¥–æ—Å—Ç—É–ø–Ω–æ'),
      );
      return;
    }
    router.push('/orders/create-order');
  }, [isReadOnlyBySubscription, router, t, toast]);
  const handleLogout = async () => {
    try {
      await signOut();
    } catch {}
  };

  const openOrdersWithFilter = (key) => {
    if (scope === 'all' && canViewAll) {
      const map = { feed: 'feed', new: 'new', progress: 'in_progress', all: 'all' };
      router.push({ pathname: '/orders/all-orders', params: { filter: map[key] || 'all' } });
    } else {
      router.push({ pathname: '/orders/my-orders', params: { seedFilter: key } });
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
  const { data: companyRow } = useQuery({
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
  const { data: departmentRow } = useQuery({
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
    return (a + b || fromFull || '–≤–Ç—û').toUpperCase();
  }, [firstName, lastName, fullName]);

  const counts = scope === 'all' && canViewAll ? allCounts : myCounts;
  const roleLabel =
    resolvedRole === 'admin'
      ? t('role_admin')
      : resolvedRole === 'dispatcher'
        ? t('role_dispatcher')
        : t('role_worker');

  // Render UI immediately even if profile is still loading.

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <Card style={styles.cardRounded} padded={false}>
          <Pressable
          onPress={openSelfProfileEdit}
          android_ripple={{ color: theme.colors.ripple || '#00000014', borderless: false }}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.profileRow,
            pressed && styles.rowPressed,
          ]}
        >
          {avatarUrl ? (
            <View style={styles.avatarWrap}>
              <Image source={{ uri: avatarUrl }} style={styles.avatarImg} resizeMode="cover" />
            </View>
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          )}

          <View style={styles.profileInfo}>
            <Text style={styles.profileName} numberOfLines={1}>
              {profileLoading ? t('common_dash') : fullName || t('common_dash')}
            </Text>
            <View style={styles.metaRows}>
              <Text style={styles.companyText} numberOfLines={1}>
                {companyName || t('common_dash')}
              </Text>
              <View style={styles.roleRow}>
                <Text style={styles.profileRoleText} numberOfLines={1}>
                  {roleLabel}
                </Text>
              </View>
              {useDepartments ? (
                <View style={styles.departmentRow}>
                  <Text style={styles.departmentText} numberOfLines={1}>
                    {`${t('users_department')}: ${departmentName || t('common_dash')}`}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          <View style={styles.profileMenuDotsWrap}>
            <FeatherIcon
              name="more-horizontal"
              size={18}
              color={theme.colors.textSecondary || theme.colors.text}
            />
          </View>
        </Pressable>
      </Card>

      {isReadOnlyBySubscription ? (
        <Card style={styles.subscriptionWarningCard}>
          <View style={styles.subscriptionWarningHeader}>
            <View style={styles.subscriptionWarningBadge}>
              <FeatherIcon
                name="alert-triangle"
                size={14}
                color={theme.colors.warning || theme.colors.primary}
              />
            </View>
            <View style={styles.subscriptionWarningBody}>
              <Text style={styles.subscriptionWarningTitle}>
                {t('home_subscription_expired_title', '– —ü– —ï– “ë– —ó– —ë–°–É– —î– ¬∞ – —ë–°–É–°‚Äö– ¬µ– —î– ¬ª– ¬∞')}
              </Text>
              <Text style={styles.subscriptionWarningText}>
                {t(
                  'home_subscription_expired_body',
                  '– ¬ – ¬µ– ¬∂– —ë– —ò –°‚Ä°–°‚Äö– ¬µ– –Ö– —ë–°–è: – —ë– ¬∑– —ò– ¬µ– –Ö– ¬µ– –Ö– —ë– ¬µ – –Ö– ¬µ– “ë– —ï–°–É–°‚Äö–°—ì– —ó– –Ö– —ï – “ë– —ï – —ó–°–Ç– —ï– “ë– ¬ª– ¬µ– –Ö– —ë–°–è – —ó– —ï– “ë– —ó– —ë–°–É– —î– —ë.',
                )}
              </Text>
            </View>
          </View>
          <Pressable
            onPress={openBilling}
            android_ripple={{ color: theme.colors.ripple || '#00000014', borderless: false }}
            style={({ pressed }) => [styles.subscriptionWarningLinkRow, pressed && styles.rowPressed]}
            accessibilityRole="button"
          >
            <Text style={styles.subscriptionWarningLinkText}>
              {t('home_subscription_expired_cta', '– —ü– —ï–°–É– —ò– —ï–°‚Äö–°–Ç– ¬µ–°‚Äö–°–ä – —ó– —ï– “ë– —ó– —ë–°–É– —î–°—ì')}
            </Text>
            <FeatherIcon
              name="chevron-right"
              size={16}
              color={theme.colors.textSecondary || theme.colors.text}
            />
          </Pressable>
        </Card>
      ) : null}

      <Card style={[styles.cardRounded, styles.menuCard]} padded={false}>
        {menuItems.map((item, index) => {
          const isLast = index === menuItems.length - 1;
          return (
            <Pressable
              key={item.key}
              onPress={item.onPress}
              android_ripple={{ color: theme.colors.ripple || '#00000014', borderless: false }}
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
                  size={20}
                  color={theme.colors.text}
                  style={styles.menuIcon}
                />
                <Text style={styles.menuLabel}>{item.title}</Text>
              </View>
              <FeatherIcon
                name="chevron-right"
                size={20}
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
                android_ripple={{ color: theme.colors.ripple || '#00000014', borderless: false }}
                style={({ pressed }) => [
                  styles.scopePill,
                  active && styles.scopePillActive,
                  pressed && { opacity: 0.9 },
                ]}
                accessibilityRole="button"
              >
                <FeatherIcon
                  name={s === 'my' ? 'user' : 'users'}
                  size={14}
                  color={
                    active
                      ? theme.colors.onPrimary || '#fff'
                      : theme.colors.textSecondary || theme.colors.text
                  }
                  style={{ marginRight: 6 }}
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
              android_ripple={{ color: theme.colors.ripple || '#00000014', borderless: false }}
              style={({ pressed }) => [styles.summaryItem, pressed && styles.rowPressed]}
              accessibilityRole="button"
            >
              <Text style={[styles.summaryNumber, { color: numberColor }]}>{counts[key] ?? 0}</Text>
              <Text style={styles.summaryLabel}>{labelMap[key]}</Text>
            </Pressable>
          );
        })}
      </View>      {canCreateOrders && (
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

const createStyles = (theme) =>
  StyleSheet.create({
    container: { padding: theme.spacing.lg },
    rowPressed: { opacity: 0.6 },
    cardRounded: {
      marginBottom: theme.spacing.lg,
      borderRadius: theme.radii.xl || theme.radii.lg || 16,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    profileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
      justifyContent: 'flex-start',
      backgroundColor: '#FFFFFF',
      borderWidth: 1,
      borderColor: withAlpha(theme.colors.border, 0.9),
      borderRadius: theme.radii.lg,
      minHeight: 112,
    },
    avatarWrap: {
      width: 56,
      height: 56,
      borderRadius: 28,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      marginRight: theme.spacing.md,
      marginTop: 0,
      alignSelf: 'center',
    },
    avatarImg: { width: '100%', height: '100%' },
    avatarFallback: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.inputBg || theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginRight: theme.spacing.md,
      marginTop: 0,
      alignSelf: 'center',
    },
    avatarText: { fontSize: 18, fontWeight: '700', color: theme.colors.primary },
    profileInfo: { flex: 1, paddingRight: theme.spacing.xl * 2 },
    profileName: {
      fontSize: theme.typography.sizes.lg,
      fontWeight: theme.typography.weight.semibold,
      color: theme.colors.text,
      paddingRight: theme.spacing.md,
    },
    profileRoleText: {
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.textSecondary || theme.colors.text,
    },
    metaRows: {
      marginTop: 6,
      marginLeft: 0,
    },
    companyText: {
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.text,
      fontWeight: theme.typography.weight.semibold,
      paddingLeft: 0,
    },
    roleRow: {
      marginTop: 4,
      marginLeft: 0,
      paddingLeft: 0,
    },
    departmentRow: {
      marginTop: 4,
      marginLeft: 0,
      paddingLeft: 0,
    },
    departmentText: {
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.textSecondary || theme.colors.text,
    },
    profileMenuDotsWrap: {
      position: 'absolute',
      top: theme.spacing.sm,
      right: theme.spacing.sm,
      width: 24,
      height: 24,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    menuCard: {},
    subscriptionWarningCard: {
      marginBottom: theme.spacing.lg,
      borderRadius: theme.radii.xl || theme.radii.lg || 16,
      borderWidth: 1,
      borderColor: withAlpha(theme.colors.warning || theme.colors.primary, 0.2),
      backgroundColor: theme.colors.surface,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
    },
    subscriptionWarningHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: theme.spacing.xs,
      gap: theme.spacing.xs,
    },
    subscriptionWarningBadge: {
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(theme.colors.warning || theme.colors.primary, 0.14),
      marginTop: 1,
    },
    subscriptionWarningBody: {
      flex: 1,
    },
    subscriptionWarningTitle: {
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
      color: theme.colors.text,
    },
    subscriptionWarningText: {
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.textSecondary || theme.colors.text,
      lineHeight: 19,
    },
    subscriptionWarningLinkRow: {
      marginTop: theme.spacing.sm,
      paddingTop: theme.spacing.sm,
      borderTopWidth: 1,
      borderTopColor: withAlpha(theme.colors.border, 0.65),
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    subscriptionWarningLinkText: {
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.text,
      fontWeight: theme.typography.weight.semibold,
    },
    menuRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
      backgroundColor: theme.colors.surface,
    },
    menuRowBorder: { borderBottomWidth: 1, borderColor: theme.colors.border },
    menuContent: { flexDirection: 'row', alignItems: 'center' },
    menuIcon: { marginRight: theme.spacing.md },
    menuLabel: { fontSize: theme.typography.sizes.md, color: theme.colors.text },
    scopeSwitch: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: theme.spacing.md,
    },
    scopePill: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.onPrimary,
    },
    scopePillActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
    scopeText: { fontSize: 13, color: theme.colors.textSecondary || theme.colors.text },
    scopeTextActive: { color: theme.colors.onPrimary || '#fff', fontWeight: '600' },
    summaryContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      marginBottom: theme.spacing.lg,
    },
    summaryItem: {
      flexBasis: '48%',
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.lg,
      paddingVertical: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      marginBottom: theme.spacing.md,
    },
    summaryNumber: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
    summaryLabel: { fontSize: 13, color: theme.colors.textSecondary || theme.colors.text },
    actionWrapper: { marginBottom: theme.spacing.md },
  });







