// components/UniversalHome.jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';

// ✅ Общие импорты
import { useTheme } from '../theme/ThemeProvider';
import { supabase } from '../lib/supabase';
import { usePermissions } from '../lib/permissions';

import Card from './ui/Card';
import Button from './ui/Button';
import FeatherIcon from '@expo/vector-icons/Feather';

export default function UniversalHome({ role }) {
  const { theme } = useTheme();
  const router = useRouter();
  const { has } = usePermissions();

  const [userId, setUserId] = useState(null);
  const [fullName, setFullName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(null);

  // Счётчики: отдельно для "моих" и для "всех"
  const [myCounts, setMyCounts] = useState({ feed: 0, new: 0, progress: 0, all: 0 });
  const [allCounts, setAllCounts] = useState({ feed: 0, new: 0, progress: 0, all: 0 });

  // Переключатель области просмотра (показываем только если есть доступ)
  const canViewAll = has?.('canViewAllOrders');
  const [scope, setScope] = useState('my'); // 'my' | 'all'

  // Если права убрали на лету — возвращаемся в "Мои"
  useEffect(() => {
    if (!canViewAll && scope !== 'my') setScope('my');
  }, [canViewAll, scope]);

  // ====== Профиль ======
  useEffect(() => {
    const loadProfile = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const uid = sessionData?.session?.user?.id;
        if (!uid) return;
        setUserId(uid);

        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, first_name, last_name, avatar_url, role')
          .eq('id', uid)
          .maybeSingle();

        const nameCandidate =
          profile?.full_name ||
          `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim();

        setFullName(nameCandidate || '');
        setFirstName(profile?.first_name || '');
        setLastName(profile?.last_name || '');
        setAvatarUrl(profile?.avatar_url || null);
      } catch (_e) {
        // не падаем
      }
    };
    loadProfile();
  }, []);

  // ====== Счётчики (точно как в экранах списков) ======
  useEffect(() => {
    const loadCounts = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const uid = sessionData?.session?.user?.id;
        if (!uid) return;

        // Надёжнее, чем head:true: считаем через range(0,0)
        const fetchCount = async (filterCb) => {
          let q = supabase.from('orders_secure').select('id', { count: 'exact' });
          q = filterCb(q);
          // минимальный диапазон, чтобы не тянуть данные
          const { count } = await q.range(0, 0);
          return count || 0;
        };

        // --- Мои заявки --- (поведение как в my-orders.js)
        const feedMy = await fetchCount((q) => q.is('assigned_to', null));
        const allMy = await fetchCount((q) => q.eq('assigned_to', uid));
        const newMy = await fetchCount((q) =>
          q.eq('assigned_to', uid).or('status.is.null,status.eq.Новый')
        );
        const progressMy = await fetchCount((q) =>
          q.eq('assigned_to', uid).eq('status', 'В работе')
        );
        setMyCounts({ feed: feedMy, new: newMy, progress: progressMy, all: allMy });

        // --- Все заявки компании --- (поведение как в all-orders.jsx)
        const feedAll = await fetchCount((q) => q.is('assigned_to', null));
        const allAll = await fetchCount((q) => q);
        const newAll = await fetchCount((q) => q.or('status.is.null,status.eq.Новый'));
        const progressAll = await fetchCount((q) => q.eq('status', 'В работе'));
        setAllCounts({ feed: feedAll, new: newAll, progress: progressAll, all: allAll });
      } catch (_e) {
        // игнорируем
      }
    };
    loadCounts();
  }, []);

  // ====== Навигация ======
  const openSelfProfileEdit = () => {
    if (!userId) return;
    router.push(`/users/${userId}`);
  };
  const openAppSettings = () => router.push('/app_settings/AppSettings'); // Настройка приложения (для всех)
  const openCompanySettings = () => router.push('/settings');; // только для админа
  const openStats = () => router.push('/stats');
  const openCreateOrder = () => router.push('/orders/create-order');

  const handleLogout = async () => {
  try {
    await supabase.auth.signOut();
    // редирект выполнит RootLayout через onAuthStateChange
  } catch (_e) {
    // можно показать тост об ошибке, если нужно
  }
};

  // Маппа статусов в роуты
  const openOrdersWithFilter = (key) => {
    if (scope === 'all' && canViewAll) {
      const map = { feed: 'feed', new: 'new', progress: 'in_progress', all: 'all' };
      router.push({ pathname: '/orders/all-orders', params: { filter: map[key] || 'all' } });
    } else {
      router.push({ pathname: '/orders/my-orders', params: { seedFilter: key } });
    }
  };

  // Меню: добавили «Настройка приложения» (для всех) + «Настройки компании» (только админ)
  const menuItems = useMemo(() => {
    const items = [
      {
        key: 'app',
        title: 'Настройка приложения',
        icon: 'sliders',
        onPress: openAppSettings,
        visible: true,
      },
      {
        key: 'stats',
        title: 'Статистика',
        icon: 'bar-chart-2',
        onPress: openStats,
        visible: true,
      },
      {
        key: 'company',
        title: 'Настройки компании',
        icon: 'settings',
        onPress: openCompanySettings,
        visible: role === 'admin',
      },
    ].filter(i => i.visible);
    return items;
  }, [role]);

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
      {/* Карточка профиля (кнопка) — скругление фиксировано под систему */}
      <Card style={styles.cardRounded} padded={false}>
        <Pressable
          onPress={openSelfProfileEdit}
          android_ripple={{ color: theme.colors.ripple || '#00000014', borderless: false }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.profileRow, pressed && styles.rowPressed]}
        >
          {/* Аватар */}
          {avatarUrl ? (
            <View style={styles.avatarWrap}>
              <Image source={{ uri: avatarUrl }} style={styles.avatarImg} resizeMode="cover" />
            </View>
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          )}

          {/* Имя + роль */}
          <View style={styles.profileInfo}>
            <Text style={styles.profileName} numberOfLines={1}>
              {fullName || '—'}
            </Text>
            <Text style={styles.profileRole} numberOfLines={1}>
              {role === 'admin' ? 'Администратор' : role === 'dispatcher' ? 'Диспетчер' : 'Работник'}
            </Text>
          </View>

          {/* Disclosure */}
          <FeatherIcon
            name="chevron-right"
            size={20}
            color={theme.colors.textSecondary || theme.colors.text}
          />
        </Pressable>
      </Card>

      {/* Меню разделов — скруглённый контейнер + одинаковые плашки */}
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
              <FeatherIcon
                name="chevron-right"
                size={20}
                color={theme.colors.textSecondary || theme.colors.text}
              />
            </Pressable>
          );
        })}
      </Card>

      {/* Переключатель «Мои / Все» (только при доступе ко всем заявкам) */}
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

      {/* Сводка по заказам */}
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

      {/* Создать заявку */}
      {has('canCreateOrders') && (
        <View style={styles.actionWrapper}>
          <Button title="Создать заявку" onPress={openCreateOrder} />
        </View>
      )}

      {/* Выход */}
      <View style={styles.actionWrapper}>
        <Button title="Выйти из профиля" variant="destructive" onPress={handleLogout} />
      </View>
    </ScrollView>
  );
}

const createStyles = (theme) =>
  StyleSheet.create({
    container: {
      padding: theme.spacing.lg,
    },

    rowPressed: {
      opacity: 0.6,
    },

    // Общий стиль скругленных карточек (фикс «квадратности»)
    cardRounded: {
      marginBottom: theme.spacing.lg,
      borderRadius: theme.radii.xl || theme.radii.lg || 16,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },

    // ===== Profile row =====
    profileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
      justifyContent: 'space-between',
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
    },
    avatarText: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.colors.primary,
    },
    profileInfo: { flex: 1, paddingRight: 8 },
    profileName: {
      fontSize: theme.typography.sizes.lg,
      fontWeight: theme.typography.weight.semibold,
      color: theme.colors.text,
    },
    profileRole: {
      marginTop: 2,
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.textSecondary || theme.colors.text,
    },

    // ===== Menu =====
    menuCard: {},
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

    // ===== Scope switch =====
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
    scopePillActive: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    scopeText: { fontSize: 13, color: theme.colors.textSecondary || theme.colors.text },
    scopeTextActive: { color: theme.colors.onPrimary || '#fff', fontWeight: '600' },

    // ===== Summary =====
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
    summaryNumber: {
      fontSize: 22,
      fontWeight: '700',
      marginBottom: 4,
    },
    summaryLabel: {
      fontSize: 13,
      color: theme.colors.textSecondary || theme.colors.text,
    },

    // ===== Common actions =====
    actionWrapper: { marginBottom: theme.spacing.md },
  });
