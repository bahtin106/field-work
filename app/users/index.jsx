// app/users/index.jsx

import { useRouter, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableWithoutFeedback,
  Keyboard,
  StyleSheet,
  Platform,
  Pressable,
} from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Feather } from '@expo/vector-icons';

import AppHeader from '../../components/navigation/AppHeader';

import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeProvider';
import Button from '../../components/ui/Button';
import UITextField from '../../components/ui/TextField';
// Unified filter system: import our reusable components
import { useFilters } from '../../components/hooks/useFilters';
import FiltersPanel from '../../components/filters/FiltersPanel';
import { ROLE, ROLE_LABELS } from '../../constants/roles';
import { getMyCompanyId } from '../../lib/workTypes';
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
    const rgb = color.match(/^rgb\\s*\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\)$/i);
    if (rgb) {
      return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${a})`;
    }
  }
  // Fallback won't be used because we always pass theme string colors
  return `rgba(0,0,0,${a})`;
}

export default function UsersIndex() {
  const { theme } = useTheme();
  useTranslation(); // subscribe to i18n changes without re-plumbing
  const { top: headerHeight } = useSafeAreaInsets();
  const router = useRouter();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [useDepartments, setUseDepartments] = useState(false);
  const [flagReady, setFlagReady] = useState(false);

  const [filtersVisible, setFiltersVisible] = useState(false);

  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  // Initialize filters with a short TTL (~10 seconds). 1 hour is too long for this use case.
  // When filters are applied they will persist for roughly 10 seconds and then expire.
  // Note: ttlHours accepts hours, so 0.003 ≈ 10.8 seconds.
  const filters = useFilters(
    'users',
    { departments: [], roles: [], suspended: null },
    { ttlHours: 0.003 },
  );
  // Safe bridge for FiltersPanel -> useFilters API differences
  const setFilterValue = useCallback(
    (key, value) => {
      if (filters && typeof filters.set === 'function') return filters.set(key, value);
      if (filters && typeof filters.setValue === 'function') return filters.setValue(key, value);
      if (filters && typeof filters.update === 'function') return filters.update(key, value);
    },
    [filters],
  );

  // keep Android navigation bar buttons readable while modals are open
  const applyNavBar = React.useCallback(async () => {
    try {
      await NavigationBar.setButtonStyleAsync(theme.mode === 'dark' ? 'light' : 'dark');
    } catch {}
  }, [theme.mode]);

  React.useEffect(() => {
    applyNavBar();
  }, [applyNavBar]);

  const openFiltersPanel = React.useCallback(() => {
    setFiltersVisible(true);
  }, []);
  const c = theme.colors;
  const sz = theme.spacing;
  const ty = theme.typography;
  const rad = theme.radii;
  const controlH = theme.components?.input?.height ?? theme.components?.listItem?.height ?? 48;
  const btnH =
    theme.components?.button?.sizes?.md?.h ??
    theme.components?.row?.minHeight ??
    theme.components?.listItem?.height ??
    48;

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
        header: { paddingHorizontal: sz.lg, paddingTop: Math.max(4, sz.xs), paddingBottom: sz.sm },
        title: {
          fontSize: ty.sizes.xl,
          fontWeight: ty.weight.bold,
          color: c.text,
          marginBottom: sz.sm,
        },
        searchRow: { flexDirection: 'row', alignItems: 'center', columnGap: sz.sm },
        searchBox: {
          flex: 1,
          position: 'relative',
          backgroundColor: c.inputBg,
          borderRadius: rad.lg,
          borderWidth: 1,
          borderColor: c.inputBorder,
          height: btnH,
          justifyContent: 'center',
          paddingLeft: sz.sm,
          paddingRight: sz.md,
        },
        clearBtn: {
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: withAlpha(c.border, 0.5),
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: -4,
        },
        clearBtnText: {
          fontSize: 20,
          lineHeight: 20,
          color: c.textSecondary,
          fontWeight: ty.weight.semibold,
          marginTop: -2,
        },
        searchMask: {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: StyleSheet.hairlineWidth,
          backgroundColor: c.inputBg,
          borderBottomLeftRadius: rad.lg,
          borderBottomRightRadius: rad.lg,
        },
        metaRow: { marginTop: sz.xs },
        metaText: { fontSize: ty.sizes.sm, color: c.textSecondary },
        errorCard: {
          marginTop: sz.xs,
          backgroundColor: withAlpha(c.danger, 0.13),
          borderColor: withAlpha(c.danger, 0.2),
          borderWidth: 1,
          paddingHorizontal: sz.sm,
          paddingVertical: sz.xs,
          borderRadius: rad.md,
        },
        errorText: { color: c.danger, fontSize: ty.sizes.sm },
        listContent: {
          paddingHorizontal: sz.lg,
          paddingBottom: theme.components?.scrollView?.paddingBottom ?? sz.xl,
        },
        card: {
          position: 'relative',
          backgroundColor: c.surface,
          padding: sz.sm,
          borderRadius: rad.xl,
          marginBottom: sz.sm,
          ...((theme.shadows &&
            theme.shadows.card &&
            (Platform.OS === 'ios' ? theme.shadows.card.ios : theme.shadows.card.android)) ||
            {}),
        },
        cardSuspended: {
          backgroundColor: theme.colors.surfaceMutedDanger,
          borderWidth: 0,
          borderColor: 'transparent',
        },
        cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
        cardTextWrap: { flexShrink: 1, paddingRight: sz.sm },
        cardTitle: { fontSize: ty.sizes.md, fontWeight: ty.weight.semibold, color: c.text },
        rolePill: {
          paddingHorizontal: sz.sm,
          paddingVertical: 6,
          borderRadius: rad.md,
          borderWidth: 1,
        },
        rolePillText: { fontSize: ty.sizes.xs, fontWeight: ty.weight.semibold },
        rolePillTopRight: { position: 'absolute', top: sz.xs, right: sz.xs, zIndex: 2 },
        suspendedPill: {
          position: 'absolute',
          right: sz.xs,
          bottom: sz.xs,
          zIndex: 2,
          paddingHorizontal: sz.sm,
          paddingVertical: 6,
          borderRadius: rad.md,
          borderWidth: 1,
          backgroundColor: withAlpha(c.danger, 0.13),
          borderColor: withAlpha(c.danger, 0.2),
        },
        suspendedPillText: {
          fontSize: ty.sizes.xs,
          fontWeight: ty.weight.semibold,
          color: c.danger,
        },
        emptyWrap: { padding: sz.lg, alignItems: 'center' },
        emptyText: { color: c.textSecondary },
        // --- Departments UI
        toolbarRow: {
          marginTop: sz.xs,
          flexDirection: 'row',
          alignItems: 'center',
          columnGap: sz.sm,
        },
        filterBtn: {
          height: controlH,
          width: controlH,
          borderRadius: controlH / 2,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface,
          marginRight: sz.sm,
        }, // keep default TTL (1h) for filter persistence
      }),
    [theme],
  );

  // Avoid fullscreen loader flicker after first content paint
  const hasShownContent = React.useRef(false);

  // --- Debounce for search (theme.timings)
  useEffect(() => {
    const ms = Number(theme.timings?.backDelayMs) || 300;
    const tmr = setTimeout(
      () => setDebouncedQ(q.trim().toLowerCase()),
      Math.max(120, Math.min(600, ms)),
    );
    return () => clearTimeout(tmr);
  }, [q, theme.timings?.backDelayMs]);

  const loadCompanyFlag = useCallback(async () => {
    // Ensure we always resolve flagReady to avoid splash flicker / stuck loader
    try {
      let enabled = false;
      const cid = await getMyCompanyId();
      if (cid) {
        try {
          // Try direct flag
          const { data, error } = await supabase
            .from('companies')
            .select('use_departments')
            .eq('id', cid)
            .single();
          if (!error) {
            enabled = !!data?.use_departments;
          }
        } catch {}
        if (!enabled) {
          // Fallback: enable if company has any departments
          try {
            const { count, error: deptErr } = await supabase
              .from('departments')
              .select('id', { count: 'exact', head: true })
              .eq('company_id', cid);
            if (!deptErr && typeof count === 'number' && count > 0) {
              enabled = true;
            }
          } catch {}
        }
      }
      setUseDepartments(enabled);
    } catch {
      setUseDepartments(false);
    } finally {
      // Mark flag as resolved to render full UI without flicker
      setFlagReady(true);
    }
  }, []);

  const fetchDepartments = useCallback(async () => {
    if (!useDepartments) {
      setDepartments([]);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('departments')
        .select('id, name, is_enabled')
        .order('name');
      if (error) throw error;
      const enabledOnly = (Array.isArray(data) ? data : []).filter((d) => d.is_enabled !== false);
      setDepartments(enabledOnly);
    } catch {
      // silent
      setDepartments([]);
    }
  }, [useDepartments]);

  const fetchUsers = useCallback(async () => {
    setErrorMsg('');
    setLoading(true);
    try {
      let query = supabase
        .from('profiles')
        .select(
          'id, first_name, last_name, full_name, role, department_id, last_seen_at, is_suspended, suspended_at',
        )
        .order('full_name', { ascending: true, nullsFirst: false });

      // Apply selected filters
      // Departments: use .in() for multi-select
      if (
        useDepartments &&
        Array.isArray(filters.values.departments) &&
        filters.values.departments.length > 0
      ) {
        const deptIds = filters.values.departments.map((d) =>
          typeof d === 'number' ? d : String(d),
        );
        query = query.in('department_id', deptIds);
      }
      // Roles: multi-select by role codes
      if (Array.isArray(filters.values.roles) && filters.values.roles.length > 0) {
        query = query.in('role', filters.values.roles);
      }
      // Suspended: tri-state filter
      if (filters.values.suspended === true) {
        // Show only suspended users (either is_suspended true or suspended_at not null)
        query = query.or('is_suspended.eq.true,suspended_at.not.is.null');
      } else if (filters.values.suspended === false) {
        // Show only active users (not suspended and no suspended_at)
        query = query.eq('is_suspended', false).is('suspended_at', null);
      }

      const { data, error } = await query;

      if (error) {
        setList([]);
        setErrorMsg(t('errors_loadUsers'));
      } else {
        setList(Array.isArray(data) ? data : []);
      }
    } catch {
      setList([]);
      setErrorMsg(t('errors_network'));
    } finally {
      setLoading(false);
    }
  }, [filters.values, useDepartments]);

  // Initial load
  useEffect(() => {
    (async () => {
      await loadCompanyFlag();
    })();
  }, [loadCompanyFlag]);

  useEffect(() => {
    if (!flagReady) return;
    (async () => {
      await Promise.all([fetchUsers(), fetchDepartments()]);
    })();
  }, [fetchUsers, fetchDepartments, flagReady]);

  // Realtime auto-refresh
  useEffect(() => {
    const channel = supabase
      .channel('rt-users')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        fetchUsers();
      });

    if (useDepartments) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'departments' }, () => {
        fetchDepartments();
      });
    }

    const sub = channel.subscribe();
    return () => {
      try {
        sub.unsubscribe();
      } catch {}
    };
  }, [fetchUsers, fetchDepartments, useDepartments]);

  // Refresh when screen regains focus
  useFocusEffect(
    useCallback(() => {
      if (!flagReady) return () => {};
      (async () => {
        await Promise.all([fetchUsers(), fetchDepartments()]);
      })();
      return () => {};
    }, [fetchUsers, fetchDepartments, flagReady]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchUsers(), fetchDepartments(), loadCompanyFlag()]);
    setRefreshing(false);
  }, [fetchUsers, fetchDepartments, loadCompanyFlag]);

  const filtered = useMemo(() => {
    if (!debouncedQ) return list;
    return list.filter((u) => {
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
  }, [debouncedQ, list]);

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
          backgroundColor: withAlpha(color, 0.13),
          borderColor: withAlpha(color, 0.2),
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

    // (Filter schema and summary definitions removed from inside parsePgTs; they will be defined outside this function.)

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
  // Build schema for filter modal: dynamic according to available options.
  // We define this outside of parsePgTs so it has access to current state hooks.
  const filterSchema = useMemo(() => {
    const schema = [];
    // Show department filter only if the company uses departments
    if (useDepartments) {
      schema.push({
        name: 'departments',
        label: 'users_department',
        type: 'multiselect',
        props: {
          options: departments.map((d) => ({
            id: String(d.id),
            value: String(d.id),
            label: d.name,
          })),
          searchable: false,
        },
      });
    }
    // Roles filter: multi-select among available roles
    schema.push({
      name: 'roles',
      label: 'users_role',
      type: 'multiselect',
      props: {
        options: Object.keys(ROLE_LABELS).map((r) => ({
          id: r,
          value: r,
          label: ROLE_LABELS[r] || r,
        })),
        searchable: false,
      },
    });
    // Suspended filter: tri-state (all, only suspended, without suspended)
    schema.push({
      name: 'suspended',
      label: 'users_suspended',
      type: 'select',
      props: {
        options: [
          { id: 'all', value: null, label: t('users_showAll', 'Все') },
          { id: 'onlySuspended', value: true, label: t('users_onlySuspended', 'Отстраненные') },
          {
            id: 'withoutSuspended',
            value: false,
            label: t('users_withoutSuspended', 'Без отстраненных'),
          },
        ],
        searchable: false,
      },
    });
    return schema;
  }, [useDepartments, departments, t]);

  // Compose summary string for active filters to display in UI
  const filterSummary = useMemo(() => {
    const parts = [];
    // Department summary
    if (
      useDepartments &&
      Array.isArray(filters.values.departments) &&
      filters.values.departments.length
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
        parts.push(`${t('users_role', 'Роль')}: ${roleNames.join(', ')}`);
      }
    }
    // Suspended summary
    if (filters.values.suspended === true) {
      parts.push(t('users_onlySuspended', 'Отстраненные'));
    } else if (filters.values.suspended === false) {
      parts.push(t('users_withoutSuspended', 'Без отстраненных'));
    }
    return parts.join(' • ');
  }, [filters.values, departments, useDepartments]);

  // --- Presence helpers (i18n-driven, no hardcoded strings)
  const isOnlineNow = React.useCallback((ts) => {
    // online if last_seen within past 2 minutes (allow small future skew up to 5 min)
    const d = parsePgTs(ts);
    if (!d) return false;
    const diff = Date.now() - d.getTime(); // positive if past
    return diff <= 2 * 60 * 1000 && diff >= -5 * 60 * 1000;
  }, []);

  const formatPresence = React.useCallback(
    (ts) => {
      // Returns either "В сети" or "Был в сети: 03.10.2025 в 23:59" or "Был в сети: никогда"
      if (isOnlineNow(ts)) return t('users_online');

      if (!ts) return `${t('users_lastSeen_prefix')} ${t('users_lastLogin_never')}`;
      const d = parsePgTs(ts);
      if (!d) return `${t('users_lastSeen_prefix')} ${t('users_lastLogin_never')}`;

      const datePart = new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(d);
      const timePart = new Intl.DateTimeFormat('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(d);
      return `${t('users_lastSeen_prefix')} ${datePart} ${t('common_at')} ${timePart}`;
    },
    [isOnlineNow, t],
  );

  // Exact "last seen" formatter: always shows full date & time (local), robust to small clock skews

  const renderItem = useCallback(
    ({ item }) => {
      const stylesPill = rolePillStyle(item.role);
      const fullName = (
        `${item.first_name || ''} ${item.last_name || ''}`.trim() ||
        item.full_name ||
        ''
      ).trim();
      return (
        <Pressable
          android_ripple={{ borderless: false, color: withAlpha(theme.colors.border, 0.13) }}
          onPress={() => goToUser(item.id)}
          style={[
            styles.card,
            item?.is_suspended === true || !!item?.suspended_at ? styles.cardSuspended : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${t('users_openUser')} ${fullName || t('common_noName')}`}
        >
          <View style={styles.cardRow}>
            <View style={styles.cardTextWrap}>
              <Text numberOfLines={1} style={styles.cardTitle}>
                {fullName || t('common_noName')}
              </Text>
              {item?.department_id ? (
                <Text numberOfLines={1} style={styles.metaText}>
                  {(() => {
                    const d = departments.find((d) => String(d.id) === String(item.department_id));
                    return d ? `${t('users_department')}: ${d.name}` : null;
                  })()}
                </Text>
              ) : null}
              <Text
                numberOfLines={1}
                style={[
                  styles.metaText,
                  isOnlineNow(item?.last_seen_at)
                    ? { color: theme.colors.success, fontWeight: theme.typography.weight.semibold }
                    : null,
                ]}
              >
                {formatPresence(item?.last_seen_at)}
              </Text>
            </View>
          </View>

          <View style={[stylesPill.container, styles.rolePillTopRight]}>
            <Text style={stylesPill.text}>{ROLE_LABELS[item.role] || '—'}</Text>
          </View>

          {item?.is_suspended === true || !!item?.suspended_at ? (
            <View style={styles.suspendedPill}>
              <Text style={styles.suspendedPillText}>Отстранен</Text>
            </View>
          ) : null}
        </Pressable>
      );
    },
    [goToUser, theme.colors.border],
  );

  const keyExtractor = useCallback((item) => String(item.id), []);

  // Derived: department name is now handled via filter summary

  if ((!hasShownContent.current && loading) || !flagReady) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaView>
    );
  }

  const EmptyState = () => (
    <View style={styles.emptyWrap}>
      <Text style={styles.emptyText}>
        {list.length === 0 ? t('empty_noData') : t('empty_noResults')}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={styles.container}>
          <AppHeader back options={{ headerTitleAlign: 'left', title: t('routes_users_index') }} />

          <View style={styles.header}>
            {/* Search + Create */}
            <View style={styles.searchRow}>
              <View style={styles.searchBox}>
                <UITextField
                  value={q}
                  onChangeText={setQ}
                  placeholder={t('users_search_placeholder')}
                  returnKeyType="search"
                  onSubmitEditing={Keyboard.dismiss}
                  rightSlot={
                    !!q ? (
                      <Pressable
                        android_ripple={{
                          borderless: false,
                          color: withAlpha(theme.colors.border, 0.13),
                        }}
                        onPress={() => setQ('')}
                        style={styles.clearBtn}
                        accessibilityRole="button"
                        accessibilityLabel={t('common_clear')}
                      >
                        <Text style={styles.clearBtnText}>×</Text>
                      </Pressable>
                    ) : null
                  }
                />
              </View>

              <Button
                title={t('btn_create')}
                onPress={() => router.push('/users/new')}
                variant="primary"
                size="md"
              />
            </View>

            {/* Filter row: icon to open modal and summary + reset when active */}
            <View style={styles.toolbarRow}>
              <Pressable
                onPress={openFiltersPanel}
                android_ripple={{ borderless: false, color: withAlpha(theme.colors.border, 0.13) }}
                style={styles.filterBtn}
                accessibilityRole="button"
                accessibilityLabel={t('users_filterButton', 'Фильтры')}
              >
                <Feather name="sliders" size={18} color={theme.colors.text} />
              </Pressable>
              {filterSummary ? (
                <>
                  <Text style={[styles.metaText, { flexShrink: 1 }]} numberOfLines={2}>
                    {filterSummary}
                  </Text>
                  <Pressable
                    onPress={() => {
                      // Manually clear all filters and persist the empty state.
                      // Calling reset() alone only updates local state; we explicitly set
                      // each filter to its default value and then apply to persist.
                      if (setFilterValue) {
                        setFilterValue('departments', []);
                        setFilterValue('roles', []);
                        setFilterValue('suspended', null);
                      }
                      filters.apply().then(() => {
                        fetchUsers();
                      });
                    }}
                  >
                    <Text
                      style={[
                        styles.metaText,
                        { color: theme.colors.primary, marginLeft: theme.spacing.sm },
                      ]}
                    >
                      {' '}
                      {t('settings_sections_quiet_items_quiet_reset', 'Сбросить')}
                    </Text>
                  </Pressable>
                </>
              ) : null}
            </View>

            <View style={styles.metaRow}>
              <Text style={styles.metaText}>
                {debouncedQ
                  ? `${t('users_found')}: ${filtered.length}`
                  : `${t('users_total')}: ${list.length}`}
              </Text>
            </View>

            {!!errorMsg && (
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            )}
          </View>

          <FlatList
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.listContent}
            data={filtered}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
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
        values={filters.values}
        setValue={setFilterValue}
        defaults={{ departments: [], roles: [], suspended: null }}
        onReset={() => filters.reset()}
        onApply={async () => {
          await filters.apply();
          setFiltersVisible(false);
          fetchUsers();
        }}
      />
    </SafeAreaView>
  );
}
