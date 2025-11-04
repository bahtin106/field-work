// components/UniversalHome.jsx
import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../theme/ThemeProvider';
import { supabase } from '../lib/supabase';
import { usePermissions } from '../lib/permissions';
import Card from './ui/Card';
import Button from './ui/Button';
import FeatherIcon from '@expo/vector-icons/Feather';
import { useQuery, useQueryClient } from '@tanstack/react-query';

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
      .select('full_name, first_name, last_name, avatar_url, role')
      .eq('user_id', uid)
      .maybeSingle();
    if (byUserId) return byUserId;
  } catch {}

  const { data: byId } = await supabase
    .from('profiles')
    .select('full_name, first_name, last_name, avatar_url, role')
    .eq('id', uid)
    .maybeSingle();
  return byId || null;
}

async function fetchCountsMy(uid) {
  if (!uid) return { feed: 0, new: 0, progress: 0, all: 0 };
  const fetchCount = async (filterCb) => {
    let q = supabase.from('orders_secure').select('id', { count: 'exact' });
    q = filterCb(q);
    const { count } = await q.range(0, 0);
    return count || 0;
  };
  const [feedMy, allMy, newMy, progressMy] = await Promise.all([
    fetchCount((q) => q.is('assigned_to', null)),
    fetchCount((q) => q.eq('assigned_to', uid)),
    fetchCount((q) => q.eq('assigned_to', uid).or('status.is.null,status.eq.Новый')),
    fetchCount((q) => q.eq('assigned_to', uid).eq('status', 'В работе')),
  ]);
  return { feed: feedMy, new: newMy, progress: progressMy, all: allMy };
}

async function fetchCountsAll() {
  const fetchCount = async (filterCb) => {
    let q = supabase.from('orders_secure').select('id', { count: 'exact' });
    q = filterCb(q);
    const { count } = await q.range(0, 0);
    return count || 0;
  };
  const [feedAll, allAll, newAll, progressAll] = await Promise.all([
    fetchCount((q) => q.is('assigned_to', null)),
    fetchCount((q) => q),
    fetchCount((q) => q.or('status.is.null,status.eq.Новый')),
    fetchCount((q) => q.eq('status', 'В работе')),
  ]);
  return { feed: feedAll, new: newAll, progress: progressAll, all: allAll };
}

export default function UniversalHome({ role }) {
  const { theme } = useTheme();
  const router = useRouter();
  const { has, loading: permsLoading, role: roleFromPerms } = usePermissions();
  const qc = useQueryClient();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      qc.setQueryData(['session'], s ?? null);
      qc.invalidateQueries({ queryKey: ['profile'] });
    });
    return () => sub?.subscription?.unsubscribe?.();
  }, [qc]);

  const [scope, setScope] = useState('my');

  // ====== Сессия / профиль ======
  const { data: session } = useQuery({
    queryKey: ['session'],
    queryFn: fetchSession,
    staleTime: 0,
    refetchOnMount: true,
  });
  const uid = session?.user?.id || null;

  const { data: profile } = useQuery({
    queryKey: ['profile', uid],
    queryFn: () => fetchProfile(uid),
    enabled: !!uid,
    cacheTime: 0,
    staleTime: 0,
  });

  const currentProfile = uid ? profile : null;
  const profileLoading = uid && typeof profile === 'undefined';

  const fullName =
    currentProfile?.full_name ||
    `${currentProfile?.first_name || ''} ${currentProfile?.last_name || ''}`.trim();
  const firstName = currentProfile?.first_name || '';
  const lastName = currentProfile?.last_name || '';
  const avatarUrl = currentProfile?.avatar_url || null;

  // Роль для отображения
  const roleToShow = roleFromPerms || currentProfile?.role || role;

  // Админ без ожидания пермишенов
  const isAdmin = roleToShow === 'admin';

  // Область просмотра
  const canViewAll = isAdmin || (!permsLoading && has?.('canViewAllOrders') === true);

  // ★ Новое: право на создание заявок учитывает isAdmin и загрузку пермишенов
  const canCreateOrders = isAdmin || (!permsLoading && has?.('canCreateOrders') === true); // ★

  useEffect(() => {
    if (!canViewAll && scope !== 'my') setScope('my');
  }, [canViewAll, scope]);

  // ====== Счётчики ======
  const { data: myCounts = { feed: 0, new: 0, progress: 0, all: 0 } } = useQuery({
    queryKey: ['counts','my', uid],
    queryFn: () => fetchCountsMy(uid),
    enabled: !!uid,
    staleTime: 30 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnMount: false,
  });

  const { data: allCounts = { feed: 0, new: 0, progress: 0, all: 0 } } = useQuery({
    queryKey: ['counts','all'],
    queryFn: fetchCountsAll,
    enabled: !!canViewAll,
    staleTime: 30 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnMount: false,
  });

  // ====== Навигация ======
  const openSelfProfileEdit = () => { if (uid) router.push(`/users/${uid}`); };
  const openAppSettings = () => router.push('/app_settings/AppSettings');
  const openCompanySettings = () => router.push('/company_settings');
  const openStats = () => router.push('/stats');
  const openCreateOrder = () => router.push('/orders/create-order');
  const handleLogout = async () => {
  try {
    await supabase.auth.signOut();
    await qc.clear();
    // Не вызываем router.replace — переход произойдёт автоматически через onAuthStateChange
  } catch (e) {
    console.warn('Logout error:', e);
  }
};

  const openOrdersWithFilter = (key) => {
    if (scope === 'all' && canViewAll) {
      const map = { feed: 'feed', new: 'new', progress: 'in_progress', all: 'all' };
      router.push({ pathname: '/orders/all-orders', params: { filter: map[key] || 'all' } });
    } else {
      router.push({ pathname: '/orders/my-orders', params: { seedFilter: key } });
    }
  };

  const menuItems = useMemo(() => [
    { key: 'app', title: 'Настройка приложения', icon: 'sliders', onPress: openAppSettings, visible: true },
    { key: 'stats', title: 'Статистика', icon: 'bar-chart-2', onPress: openStats, visible: true },
    { key: 'company', title: 'Настройки компании', icon: 'settings', onPress: openCompanySettings, visible: isAdmin },
  ].filter(i => i.visible), [isAdmin]);

  const styles = useMemo(() => createStyles(theme), [theme]);

  const initials = useMemo(() => {
    const a = (firstName || '').trim().slice(0, 1);
    const b = (lastName || '').trim().slice(0, 1);
    const fromFull = (fullName || '').trim().split(/\s+/).map(s => s.slice(0,1)).slice(0,2).join('');
    return (a + b || fromFull || '•').toUpperCase();
  }, [firstName, lastName, fullName]);

  const counts = scope === 'all' && canViewAll ? allCounts : myCounts;

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <Card style={styles.cardRounded} padded={false}>
        <Pressable
          onPress={openSelfProfileEdit}
          android_ripple={{ color: theme.colors.ripple || '#00000014', borderless: false }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.profileRow, pressed && styles.rowPressed]}
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
              {profileLoading ? '—' : (fullName || '—')}
            </Text>
            <Text style={styles.profileRole} numberOfLines={1}>
              {roleToShow === 'admin' ? 'Администратор' : roleToShow === 'dispatcher' ? 'Диспетчер' : 'Работник'}
            </Text>
          </View>

          <FeatherIcon name="chevron-right" size={20} color={theme.colors.textSecondary || theme.colors.text} />
        </Pressable>
      </Card>

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
                <FeatherIcon name={item.icon} size={20} color={theme.colors.text} style={styles.menuIcon} />
                <Text style={styles.menuLabel}>{item.title}</Text>
              </View>
              <FeatherIcon name="chevron-right" size={20} color={theme.colors.textSecondary || theme.colors.text} />
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
                  color={active ? (theme.colors.onPrimary || '#fff') : theme.colors.textSecondary || theme.colors.text}
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.scopeText, active && styles.scopeTextActive]}>
                  {s === 'my' ? 'Мои' : 'Все'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.summaryContainer}>
        {['feed', 'new', 'progress', 'all'].map((key) => {
          const labelMap = { feed: 'В ленте', new: 'Новые', progress: 'В работе', all: 'Все' };
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
              <Text style={[styles.summaryNumber, { color: numberColor }]}>
                {counts[key] ?? 0}
              </Text>
              <Text style={styles.summaryLabel}>{labelMap[key]}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* ★ Тут заменили условие на canCreateOrders */}
      {canCreateOrders && (
        <View style={styles.actionWrapper}>
          <Button title="Создать заявку" onPress={openCreateOrder} />
        </View>
      )}

      <View style={styles.actionWrapper}>
        <Button title="Выйти из профиля" variant="destructive" onPress={handleLogout} />
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
      justifyContent: 'space-between',
    },
    avatarWrap: { width: 56, height: 56, borderRadius: 28, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, marginRight: theme.spacing.md },
    avatarImg: { width: '100%', height: '100%' },
    avatarFallback: {
      width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.colors.inputBg || theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, marginRight: theme.spacing.md,
    },
    avatarText: { fontSize: 18, fontWeight: '700', color: theme.colors.primary },
    profileInfo: { flex: 1, paddingRight: 8 },
    profileName: { fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weight.semibold, color: theme.colors.text },
    profileRole: { marginTop: 2, fontSize: theme.typography.sizes.sm, color: theme.colors.textSecondary || theme.colors.text },
    menuCard: {},
    menuRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, backgroundColor: theme.colors.surface,
    },
    menuRowBorder: { borderBottomWidth: 1, borderColor: theme.colors.border },
    menuContent: { flexDirection: 'row', alignItems: 'center' },
    menuIcon: { marginRight: theme.spacing.md },
    menuLabel: { fontSize: theme.typography.sizes.md, color: theme.colors.text },
    scopeSwitch: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: theme.spacing.md },
    scopePill: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.onPrimary },
    scopePillActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
    scopeText: { fontSize: 13, color: theme.colors.textSecondary || theme.colors.text },
    scopeTextActive: { color: theme.colors.onPrimary || '#fff', fontWeight: '600' },
    summaryContainer: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: theme.spacing.lg },
    summaryItem: { flexBasis: '48%', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.lg, paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.lg, marginBottom: theme.spacing.md },
    summaryNumber: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
    summaryLabel: { fontSize: 13, color: theme.colors.textSecondary || theme.colors.text },
    actionWrapper: { marginBottom: theme.spacing.md },
  });
