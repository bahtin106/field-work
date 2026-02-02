// app/users/index.jsx

import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AppHeader from '../../components/navigation/AppHeader';
import { useTheme } from '../../theme/ThemeProvider';
// Unified filter system: import our reusable components
import FiltersPanel from '../../components/filters/FiltersPanel';
import SearchFiltersBar from '../../components/filters/SearchFiltersBar';
import { useFilters } from '../../components/hooks/useFilters';
// Cache-enabled hooks
import { useDepartments as useDepartmentsHook } from '../../components/hooks/useDepartments';
import { useUsers } from '../../components/hooks/useUsers';
import { UserCard } from '../../components/users/UserCard';
import { ROLE, ROLE_LABELS } from '../../constants/roles';
import { useMyCompanyId } from '../../hooks/useMyCompanyId';
import { pluralizeRu } from '../../lib/pluralize';
import { t } from '../../src/i18n';
import { useTranslation } from '../../src/i18n/useTranslation';

// Safe alpha helper for both hex/rgb strings and dynamic PlatformColor objects
function withAlpha(color, a) {
  if (typeof color === 'string') {
    const hex = color.match(/^#([0-9a-fA-F]{6})$/);
    if (hex) {
      const alpha = Math.round(Math.max(0, Math.min(1, a)) * 255)
        .toString(16)
        .padStart(2, '0');
      return color + alpha;
    }
    const rgb = color.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
    if (rgb) {
      return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${a})`;
    }
  }
  return color;
}

export default function UsersIndex() {
  const { theme } = useTheme();
  useTranslation(); // subscribe to i18n changes without re-plumbing

  const router = useRouter();
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [useDepartments, setUseDepartments] = useState(false);

  // Initialize filters with a 5-second TTL as requested by user.
  // When user leaves and returns within 5 seconds, filters persist.
  // After 5 seconds, filters reset to defaults automatically.

  const filters = useFilters({
    screenKey: 'users',
    defaults: { departments: [], roles: [], suspended: null },
    ttl: 5000, // 5 seconds
  });

  const { companyId, loading: companyIdLoading } = useMyCompanyId();

  // ПАРАЛЛЕЛЬНАЯ ЗАГРУЗКА: оба хука вызываются одновременно на верхнем уровне компонента
  // Это обеспечивает параллельную загрузку данных
  const {
    users,
    isLoading: usersLoading,
    isRefreshing: usersRefreshing,
    refresh: refreshUsers,
  } = useUsers({
    filters: filters.values,
    enabled: !companyIdLoading, // КРИТИЧНО: включаем когда companyId завершил загрузку
  });

  const {
    departments,
    isLoading: departmentsLoading,
    isRefreshing: departmentsRefreshing,
    refresh: refreshDepartments,
  } = useDepartmentsHook({
    companyId,
    enabled: !!companyId,
    onlyEnabled: true,
  });

  // Включаем фильтрацию по отделам, когда они загружены
  useEffect(() => {
    const hasDepartments = Array.isArray(departments) && departments.length > 0;
    if (hasDepartments && !useDepartments) setUseDepartments(true);
  }, [departments, useDepartments]);

  // Combined loading state - wait for initial data from both sources
  // Once cached data is available, show it immediately (stale-while-revalidate pattern)
  // КРИТИЧНО: Показываем loader только если ОБА источника грузятся И нет данных
  const hasAnyData = users.length > 0 || departments.length > 0;
  const isLoading = (usersLoading || departmentsLoading) && !hasAnyData;
  const isRefreshing = usersRefreshing || departmentsRefreshing;

  // Pull-to-refresh обновляет оба источника одновременно
  const refreshAll = useCallback(async () => {
    await Promise.all([refreshUsers(), refreshDepartments()]);
  }, [refreshUsers, refreshDepartments]);

  // Обновляем данные при возврате на экран (Apple-style: свежие данные, но без спама)
  const lastRefreshRef = React.useRef(0);
  
  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      const timeSinceLastRefresh = now - lastRefreshRef.current;
      
      // Обновляем только если прошло больше 1 секунды с последнего обновления
      if (timeSinceLastRefresh > 1000 && !usersRefreshing && !departmentsRefreshing) {
        lastRefreshRef.current = now;
        refreshAll();
      }
    }, [refreshAll, usersRefreshing, departmentsRefreshing]),
  );

  // Проксирующая функция для совместимости с фильтрами
  const setFilterValue = filters.setValue;
  // Открыть панель фильтров
  const openFiltersPanel = () => setFiltersVisible(true);

  const c = theme.colors;
  const sz = theme.spacing;
  const ty = theme.typography;
  const rad = theme.radii;
  const scrollPaddingBottom = theme?.components?.scrollView?.paddingBottom ?? 80;
  const activityIndicatorSize = theme?.components?.activityIndicator?.size ?? 'large';
  const ALPHA_PILL_BG = theme?.components?.pill?.backgroundAlpha ?? 0.13;
  const ALPHA_PILL_BORDER = theme?.components?.pill?.borderAlpha ?? 0.2;
  const styles = React.useMemo(
    () =>
      StyleSheet.create({
        safe: { flex: 1, backgroundColor: c.background },
        container: { flex: 1 },
        loaderWrap: {
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: c.background,
        },
        header: { paddingHorizontal: sz.lg, paddingTop: sz.xs, paddingBottom: sz.sm },
        title: {
          fontSize: ty.sizes.xl,
          fontWeight: ty.weight.bold,
          color: c.text,
          marginBottom: sz.sm,
        },
        metaRow: { marginTop: sz.xs },
        metaText: { fontSize: ty.sizes.sm, color: c.textSecondary },
        errorCard: {
          marginTop: sz.xs,
          backgroundColor: theme.colors.surfaceMutedDanger,
          borderColor: theme.colors.danger,
          borderWidth: 1,
          paddingHorizontal: sz.sm,
          paddingVertical: sz.xs,
          borderRadius: rad.md,
        },
        errorText: { color: c.danger, fontSize: ty.sizes.sm },
        listContent: {
          paddingHorizontal: sz.lg,
          paddingBottom: scrollPaddingBottom,
        },
        rolePill: {
          paddingHorizontal: sz.sm,
          paddingVertical: sz.xs || 6,
          borderRadius: rad.md,
          borderWidth: 1,
        },
        rolePillText: { fontSize: ty.sizes.xs, fontWeight: ty.weight.semibold },
        emptyWrap: { padding: sz.lg, alignItems: 'center' },
        emptyText: { color: c.textSecondary },
      }),
    [theme],
  );

  // --- Debounce for search (theme.timings)
  useEffect(() => {
    const ms = Number(theme?.timings?.backDelayMs ?? 300);
    const tmr = setTimeout(() => setDebouncedQ(q.trim().toLowerCase()), ms);
    return () => clearTimeout(tmr);
  }, [q, theme?.timings?.backDelayMs]);

  // Pull-to-refresh handler
  const onRefresh = useCallback(async () => {
    await refreshAll();
  }, [refreshAll]);

  const filtered = useMemo(() => {
    if (!debouncedQ) return users;
    return users.filter((u) => {
      const name = (
        `${u.first_name || ''} ${u.last_name || ''}`.trim() ||
        u.full_name ||
        ''
      ).toLowerCase();
      const roleCode = (u.role || '').toLowerCase();
      const roleTitle = ROLE_LABELS[u.role]?.toLowerCase?.() || '';
      return (
        name.includes(debouncedQ) || roleCode.includes(debouncedQ) || roleTitle.includes(debouncedQ)
      );
    });
  }, [debouncedQ, users]);

  const goToUser = useCallback(
    (id) => {
      router.push(`/users/${id}`);
    },
    [router],
  );

  const rolePillStyle = (role) => {
    const color =
      role === ROLE.ADMIN
        ? theme.colors?.primary
        : role === ROLE.DISPATCHER
          ? theme.colors?.success
          : theme.colors?.worker || theme.colors?.primary;
    return {
      container: [
        styles.rolePill,
        {
          backgroundColor: withAlpha(color, ALPHA_PILL_BG),
          borderColor: withAlpha(color, ALPHA_PILL_BORDER),
        },
      ],
      text: [styles.rolePillText, { color }],
    };
  };

  // Robust Postgres timestamptz → Date parser (handles most common variants, treats no-TZ as UTC)
  function parsePgTs(ts) {
    if (!ts) return null;
    if (ts instanceof Date) return isNaN(ts) ? null : ts;

    const toDateFromParts = (y, m, d, hh, mm, ss, ms, tzSign, tzH, tzM) => {
      const utcMs = Date.UTC(y, m - 1, d, hh, mm, ss, ms);
      if (tzSign) {
        const offMin = (tzH || 0) * 60 + (tzM || 0);
        const offMs = offMin * 60 * 1000;
        return new Date(utcMs - (tzSign === '-' ? -offMs : offMs));
      }
      return new Date(utcMs); // treat no-TZ as UTC
    };

    try {
      if (typeof ts === 'string') {
        let s = ts.trim();
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s) && s.indexOf('T') === -1) {
          s = s.replace(' ', 'T');
        }

        const m = s.match(
          /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):?(\d{2})|([+-])(\d{2}))?$/,
        );
        if (m) {
          const year = +m[1],
            month = +m[2],
            day = +m[3];
          const hh = +m[4],
            mi = +m[5],
            ss = +m[6];
          const frac = m[7] ? m[7] : null;
          let ms = 0;
          if (frac) {
            const msStr = (frac + '000').slice(0, 3);
            ms = +msStr;
          }

          if (m[8] === 'Z') {
            return new Date(Date.UTC(year, month - 1, day, hh, mi, ss, ms));
          }
          if (m[9] && m[10]) {
            const sign = m[9];
            const tzH = +m[10];
            const tzM = +(m[11] || 0);
            return toDateFromParts(year, month, day, hh, mi, ss, ms, sign, tzH, tzM);
          }
          if (m[12] && m[13]) {
            const sign = m[12];
            const tzH = +m[13];
            return toDateFromParts(year, month, day, hh, mi, ss, ms, sign, tzH, 0);
          }
          return toDateFromParts(year, month, day, hh, mi, ss, ms, null, 0, 0);
        }

        const d = new Date(s);
        return isNaN(d) ? null : d;
      }

      const d = new Date(ts);
      return isNaN(d) ? null : d;
    } catch {
      return null;
    }
  }

  // --- Filter definitions ---
  // Compose summary string for active filters to display in UI
  const filterSummary = useMemo(() => {
    const parts = [];
    // Department summary
    if (
      useDepartments &&
      Array.isArray(filters.values.departments) &&
      filters.values.departments.length &&
      Array.isArray(departments)
    ) {
      const names = filters.values.departments
        .map((id) => {
          const d = departments.find((dept) => String(dept.id) === String(id));
          return d ? d.name : null;
        })
        .filter(Boolean);
      if (names.length) {
        parts.push(`${t('users_department')}: ${names.join(', ')}`);
      }
    }
    // Role summary
    if (Array.isArray(filters.values.roles) && filters.values.roles.length) {
      const roleNames = filters.values.roles.map((r) => ROLE_LABELS[r]).filter(Boolean);
      if (roleNames.length) {
        parts.push(`${t('users_role')}: ${roleNames.join(', ')}`);
      }
    }
    // Suspended summary
    if (filters.values.suspended === true) {
      parts.push(t('users_onlySuspended'));
    } else if (filters.values.suspended === false) {
      parts.push(t('users_withoutSuspended'));
    }
    return parts.join(t('common_bullet'));
  }, [filters.values, departments, useDepartments]);

  // --- Presence helpers (i18n-driven, no hardcoded strings)
  const isOnlineNow = React.useCallback(
    (ts) => {
      // online if last_seen within past 2 minutes (allow small future skew up to 5 min)
      const d = parsePgTs(ts);
      if (!d) return false;
      const diff = Date.now() - d.getTime(); // positive if past
      const onlineWindowMs = Number(theme?.timings?.presenceOnlineWindowMs ?? 120000); // 2 min default
      const futureSkewMs = Number(theme?.timings?.presenceFutureSkewMs ?? 300000); // 5 min default
      return diff <= onlineWindowMs && diff >= -futureSkewMs;
    },
    [theme?.timings?.presenceOnlineWindowMs, theme?.timings?.presenceFutureSkewMs],
  );

  /**
   * Helper: Format relative time for last seen
   * Returns: "2 минуты назад", "22 часа назад", "1 день назад", etc.
   * Up to 3 days uses relative format, 4+ days shows date only
   */
  const getRelativeTime = React.useCallback((now, past) => {
    const diffMs = now - past;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    // Сейчас (меньше минуты)
    if (diffMin < 1) {
      return t('users_relativeTime_now');
    }

    // Минуты (1-59 мин)
    if (diffMin < 60) {
      const n = diffMin;
      const word = pluralizeRu(
        n,
        t('users_relativeTime_min_1'), // минуту
        t('users_relativeTime_min_2_4'), // минуты
        t('users_relativeTime_min_5'), // минут
      );
      return `${n} ${word} ${t('users_relativeTime_ago')}`;
    }

    // Часы (1-23 часа)
    if (diffHour < 24) {
      const n = diffHour;
      const word = pluralizeRu(
        n,
        t('users_relativeTime_hour_1'), // час
        t('users_relativeTime_hour_2_4'), // часа
        t('users_relativeTime_hour_5'), // часов
      );
      return `${n} ${word} ${t('users_relativeTime_ago')}`;
    }

    // Дни (1-3 дня)
    if (diffDay <= 3) {
      const n = diffDay;
      const word = pluralizeRu(
        n,
        t('users_relativeTime_day_1'), // день
        t('users_relativeTime_day_2_4'), // дня
        t('users_relativeTime_day_5'), // дней
      );
      return `${n} ${word} ${t('users_relativeTime_ago')}`;
    }

    // 4+ days: return null to signal date-only format should be used
    return null;
  }, []);

  const formatPresence = React.useCallback(
    (ts) => {
      // Returns either "В сети" or "Был в сети: [relative_time]" or "Был в сети: [date]" or "Был в сети: никогда"
      if (isOnlineNow(ts)) return t('users_online');

      if (!ts) return `${t('users_lastSeen_prefix')} ${t('users_lastLogin_never')}`;
      const d = parsePgTs(ts);
      if (!d) return `${t('users_lastSeen_prefix')} ${t('users_lastLogin_never')}`;

      const relativeTime = getRelativeTime(Date.now(), d.getTime());

      // If within 3 days, use relative time format
      if (relativeTime) {
        return `${t('users_lastSeen_prefix')} ${relativeTime}`;
      }

      // For 4+ days, use date-only format (no time)
      const datePart = new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(d);
      return `${t('users_lastSeen_prefix')} ${datePart}`;
    },
    [isOnlineNow, getRelativeTime, t],
  );

  // Memoized department map for fast lookup
  const departmentMap = useMemo(() => {
    const map = new Map();
    if (Array.isArray(departments)) {
      departments.forEach((dept) => {
        map.set(String(dept.id), dept.name);
      });
    }
    return map;
  }, [departments]);

  const renderItem = useCallback(
    ({ item }) => {
      // Fast department lookup from memoized map
      const deptName = item?.department_id ? departmentMap.get(String(item.department_id)) : null;

      return (
        <UserCard
          item={item}
          departmentName={deptName}
          onPress={goToUser}
          rolePillStyle={rolePillStyle}
          formatPresence={formatPresence}
          isOnlineNow={isOnlineNow}
          translate={t}
        />
      );
    },
    [departmentMap, goToUser, rolePillStyle, formatPresence, isOnlineNow, t],
  );

  const keyExtractor = useCallback((item) => String(item.id), []);

  // Show loader only on initial load (when we don't have cached data yet)
  if (isLoading && users.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <View style={styles.loaderWrap}>
          <ActivityIndicator size={activityIndicatorSize} />
        </View>
      </SafeAreaView>
    );
  }

  const EmptyState = () => (
    <View style={styles.emptyWrap}>
      <Text style={styles.emptyText}>
        {users.length === 0 ? t('empty_noData') : t('empty_noResults')}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={styles.container}>
          <AppHeader
            back
            options={{
              headerTitleAlign: 'left',
              title: t('routes_users_index'),
              rightTextLabel: t('btn_create'),
              onRightPress: () => router.push('/users/new'),
            }}
          />

          <View style={styles.header}>
            <SearchFiltersBar
              value={q}
              onChangeText={setQ}
              onClear={() => setQ('')}
              placeholder={t('users_search_placeholder')}
              onOpenFilters={openFiltersPanel}
              filterSummary={filterSummary}
              onResetFilters={async () => {
                const resetValues = filters.reset();
                await filters.apply(resetValues);
              }}
              metaText={
                debouncedQ
                  ? `${t('users_found')}: ${filtered.length}`
                  : `${t('users_total')}: ${users.length}`
              }
            />

            {/* Removed error display - errors now handled by hooks */}
          </View>

          <FlatList
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.listContent}
            data={filtered}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={onRefresh}
                tintColor={theme.colors.primary}
                colors={Platform.OS === 'android' ? [theme.colors.primary] : undefined}
              />
            }
            ListEmptyComponent={<EmptyState />}
          />
        </View>
      </TouchableWithoutFeedback>

      {/* DNS-like full-screen Filters Panel */}
      <FiltersPanel
        visible={filtersVisible}
        onClose={() => setFiltersVisible(false)}
        departments={useDepartments ? departments : []}
        rolesOptions={Object.keys(ROLE_LABELS).map((r) => ({
          id: r,
          value: r,
          label: ROLE_LABELS[r] || r,
        }))}
        searchItems={users}
        showSearchCategory={false}
        values={filters.values}
        setValue={setFilterValue}
        defaults={{ departments: [], roles: [], suspended: null }}
        onReset={() => filters.reset()}
        onApply={async () => {
          await filters.apply();
          // Users will be refreshed automatically via useEffect
        }}
      />
    </SafeAreaView>
  );
}
