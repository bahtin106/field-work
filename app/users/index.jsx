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
import { SelectModal } from '../../components/ui/modals';
import { ROLE, ROLE_LABELS } from '../../constants/roles';
import { getMyCompanyId } from '../../lib/workTypes';
import { t } from '../../src/i18n';
import { useTranslation } from '../../src/i18n/useTranslation';

// Safe alpha helper for both hex/rgb strings and dynamic PlatformColor objects
function withAlpha(color, a) {
  if (typeof color === 'string') {
    const hex = color.match(/^#([0-9a-fA-F]{6})$/);
    if (hex) {
      const alpha = Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
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

  // keep Android navigation bar buttons readable while modals are open
  const applyNavBar = React.useCallback(async () => {
    try {
      await NavigationBar.setButtonStyleAsync(theme.mode === 'dark' ? 'light' : 'dark');
    } catch {}
  }, [theme.mode]);

  React.useEffect(() => { applyNavBar(); }, [applyNavBar]);

  const c = theme.colors;
  const sz = theme.spacing;
  const ty = theme.typography;
  const rad = theme.radii;
  const controlH = (theme.components?.input?.height ?? (theme.components?.listItem?.height ?? 48));

  const styles = React.useMemo(() => StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.background },
    container: { flex: 1 },
    loaderWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.background },
    header: { paddingHorizontal: sz.lg, paddingTop: Math.max(4, sz.xs), paddingBottom: sz.sm },
    title: { fontSize: ty.sizes.xl, fontWeight: ty.weight.bold, color: c.text, marginBottom: sz.sm },
    searchRow: { flexDirection: 'row', alignItems: 'center', columnGap: sz.sm },
    searchBox: {
      flex: 1, position: 'relative', backgroundColor: c.inputBg, borderRadius: rad.lg, borderWidth: 1, borderColor: c.inputBorder,
      height: controlH, justifyContent: 'center', paddingHorizontal: sz.sm,
    },
    clearBtn: {
      position: 'absolute', right: sz.xs, top: Math.max(0, (controlH - 28) / 2), width: 28, height: 28, borderRadius: 14,
      backgroundColor: withAlpha(c.border, 0.5), alignItems: 'center', justifyContent: 'center',
    },
    clearBtnText: { fontSize: 20, lineHeight: 20, color: c.textSecondary, fontWeight: ty.weight.semibold, marginTop: -2 },
    metaRow: { marginTop: sz.xs },
    metaText: { fontSize: ty.sizes.sm, color: c.textSecondary },
    errorCard: {
      marginTop: sz.xs, backgroundColor: withAlpha(c.danger, 0.13), borderColor: withAlpha(c.danger, 0.2),
      borderWidth: 1, paddingHorizontal: sz.sm, paddingVertical: sz.xs, borderRadius: rad.md,
    },
    errorText: { color: c.danger, fontSize: ty.sizes.sm },
    listContent: { paddingHorizontal: sz.lg, paddingBottom: theme.components?.scrollView?.paddingBottom ?? sz.xl },
    card: {
      position: 'relative',
      backgroundColor: c.surface, padding: sz.sm, borderRadius: rad.xl, marginBottom: sz.sm,
      ...((theme.shadows && theme.shadows.card && (Platform.OS === 'ios' ? theme.shadows.card.ios : theme.shadows.card.android)) || {}),
    },
    cardSuspended: {
  backgroundColor: theme.colors.surfaceMutedDanger,
  borderWidth: 0,
  borderColor: 'transparent',
},
    cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    cardTextWrap: { flexShrink: 1, paddingRight: sz.sm },
    cardTitle: { fontSize: ty.sizes.md, fontWeight: ty.weight.semibold, color: c.text },
    rolePill: { paddingHorizontal: sz.sm, paddingVertical: 6, borderRadius: rad.md, borderWidth: 1 },
    rolePillText: { fontSize: ty.sizes.xs, fontWeight: ty.weight.semibold },
    rolePillTopRight: { position: 'absolute', top: sz.xs, right: sz.xs, zIndex: 2 },
    suspendedPill: {
      position: 'absolute', right: sz.xs, bottom: sz.xs, zIndex: 2,
      paddingHorizontal: sz.sm, paddingVertical: 6, borderRadius: rad.md, borderWidth: 1,
      backgroundColor: withAlpha(c.danger, 0.13), borderColor: withAlpha(c.danger, 0.2),
    },
    suspendedPillText: { fontSize: ty.sizes.xs, fontWeight: ty.weight.semibold, color: c.danger },
    emptyWrap: { padding: sz.lg, alignItems: 'center' },
    emptyText: { color: c.textSecondary },
    // --- Departments UI
    toolbarRow: { marginTop: sz.xs, flexDirection: 'row', alignItems: 'center', columnGap: sz.sm },
    chip: {
      height: controlH, flex: 1, backgroundColor: c.surface, borderRadius: rad.lg, borderWidth: 1, borderColor: c.border,
      paddingHorizontal: sz.sm, alignItems: 'center', justifyContent: 'space-between', flexDirection: 'row',
    },
    chipText: { color: c.text, fontSize: ty.sizes.sm },
    chipHint: { color: c.textSecondary, fontSize: ty.sizes.xs },
    modalOverlay: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
    modalDim: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.colors.overlay },
    modalBackdrop: { flex: 1, justifyContent: 'flex-end' },
    modalCard: {
      backgroundColor: c.background, paddingTop: sz.sm, borderTopLeftRadius: rad.lg, borderTopRightRadius: rad.lg, maxHeight: '80%',
      ...((theme.shadows && theme.shadows.level2 && theme.shadows.level2[Platform.OS]) || {}),
    },
    modalHeader: { paddingHorizontal: sz.lg, paddingBottom: sz.sm },
    modalTitle: { color: c.text, fontWeight: ty.weight.bold, fontSize: ty.sizes.md },
    divider: { height: 1, backgroundColor: c.border, marginVertical: sz.xs, marginHorizontal: sz.lg },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: sz.lg, paddingVertical: sz.sm },
    rowText: { color: c.text, fontSize: ty.sizes.md, flexShrink: 1 },
    muted: { color: c.textSecondary },
    applyBar: { padding: sz.lg, borderTopWidth: 1, borderTopColor: c.border, flexDirection: 'row', justifyContent: 'flex-end', columnGap: sz.sm },
    ghostBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: rad.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
    manageBtnText: { color: c.text, fontWeight: ty.weight.semibold },
  }), [c, sz, ty, rad, controlH, theme.shadows]);

  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Company flag readiness gate to avoid UI flicker
  const [flagReady, setFlagReady] = useState(false);

  // Company feature flag: use_departments
  const [useDepartments, setUseDepartments] = useState(false);

  // Departments state (for filtering only)
  const [departments, setDepartments] = useState([]);
  const [deptFilter, setDeptFilter] = useState(null);
  const [deptPickerVisible, setDeptPickerVisible] = useState(false);

  // Avoid fullscreen loader flicker after first content paint
  const hasShownContent = React.useRef(false);

  // --- Debounce for search (theme.timings)
  useEffect(() => {
    const ms = Number(theme.timings?.backDelayMs) || 300;
    const tmr = setTimeout(() => setDebouncedQ(q.trim().toLowerCase()), Math.max(120, Math.min(600, ms)));
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
      if (!enabled) setDeptFilter(null);
    } catch {
      setUseDepartments(false);
      setDeptFilter(null);
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
      const { data, error } = await supabase.from('departments').select('id, name, is_enabled').order('name');
      if (error) throw error;
      const enabledOnly = (Array.isArray(data) ? data : []).filter(d => d.is_enabled !== false);
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
        .select('id, first_name, last_name, full_name, role, department_id, last_seen_at, is_suspended, suspended_at')
        .order('full_name', { ascending: true, nullsFirst: false });

      if (useDepartments && deptFilter != null) {
        query = query.eq('department_id', deptFilter);
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
  }, [deptFilter, useDepartments]);

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
      try { sub.unsubscribe(); } catch {}
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
      const name = ((`${u.first_name || ''} ${u.last_name || ''}`.trim()) || u.full_name || '').toLowerCase();
      const roleCode = (u.role || '').toLowerCase();
      const roleTitle = (ROLE_LABELS[u.role]?.toLowerCase?.() || '');
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
        ? (theme.colors?.primary)
        : role === ROLE.DISPATCHER
        ? (theme.colors?.success)
        : (theme.colors?.worker || theme.colors?.primary);
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

  try {
    if (typeof ts === 'string') {
      let s = ts.trim();
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s) && s.indexOf('T') === -1) {
        s = s.replace(' ', 'T');
      }

      const m = s.match(
        /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):?(\d{2})|([+-])(\d{2}))?$/
      );
      if (m) {
        const year = +m[1], month = +m[2], day = +m[3];
        const hh = +m[4], mi = +m[5], ss = +m[6];
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

// --- Presence helpers (i18n-driven, no hardcoded strings)
const isOnlineNow = React.useCallback((ts) => {
  // online if last_seen within past 2 minutes (allow small future skew up to 5 min)
  const d = parsePgTs(ts);
  if (!d) return false;
  const diff = Date.now() - d.getTime(); // positive if past
  return diff <= 2 * 60 * 1000 && diff >= -5 * 60 * 1000;
}, []);

const formatPresence = React.useCallback((ts) => {
  // Returns either "В сети" or "Был в сети: 03.10.2025 в 23:59" or "Был в сети: никогда"
  if (isOnlineNow(ts)) return t('users_online');

  if (!ts) return `${t('users_lastSeen_prefix')} ${t('users_lastLogin_never')}`;
  const d = parsePgTs(ts);
  if (!d) return `${t('users_lastSeen_prefix')} ${t('users_lastLogin_never')}`;

  const datePart = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  const timePart = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(d);
  return `${t('users_lastSeen_prefix')} ${datePart} ${t('common_at')} ${timePart}`;
}, [isOnlineNow, t]);
    
// Exact "last seen" formatter: always shows full date & time (local), robust to small clock skews

const renderItem = useCallback(
    ({ item }) => {
      const stylesPill = rolePillStyle(item.role);
      const fullName = ((`${item.first_name || ''} ${item.last_name || ''}`.trim()) || item.full_name || '').trim();
      return (
        <Pressable
          android_ripple={{ borderless: false, color: withAlpha(theme.colors.border, 0.13) }}
          onPress={() => goToUser(item.id)}
          style={[styles.card, (item?.is_suspended === true || !!item?.suspended_at) ? styles.cardSuspended : null]}
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
  <Text numberOfLines={1} style={[styles.metaText, isOnlineNow(item?.last_seen_at) ? { color: theme.colors.success, fontWeight: theme.typography.weight.semibold } : null]}>
    {formatPresence(item?.last_seen_at)}
  </Text>
</View>

          </View>

          <View style={[stylesPill.container, styles.rolePillTopRight]}>
            <Text style={stylesPill.text}>{ROLE_LABELS[item.role] || '—'}</Text>
          </View>

          { (item?.is_suspended === true || !!item?.suspended_at) ? (
            <View style={styles.suspendedPill}>
              <Text style={styles.suspendedPillText}>Отстранен</Text>
            </View>
          ) : null }
        </Pressable>
      );
    },
    [goToUser, theme.colors.border],
  );

  const keyExtractor = useCallback((item) => String(item.id), []);

  // Derived: department name by id
  const activeDeptName = useMemo(() => {
    const d = departments.find((d) => String(d.id) === String(deptFilter));
    return d ? d.name : null;
  }, [departments, deptFilter]);

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
                        android_ripple={{ borderless: false, color: withAlpha(theme.colors.border, 0.13) }}
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

              <Button title={t('btn_create')} onPress={() => router.push('/users/new')} variant="primary" size="md" />
            </View>

            {/* Department filter (visible only if company enabled departments) */}
            {useDepartments && (
              <View style={styles.toolbarRow}>
                <Pressable
                  android_ripple={{ borderless: false, color: withAlpha(theme.colors.border, 0.13) }}
                  onPress={() => setDeptPickerVisible(true)}
                  style={styles.chip}
                >
                  <Text style={styles.chipText}>
                    {activeDeptName ? `${t('users_department')}: ${activeDeptName}` : t('users_allDepartments')}
                  </Text>
                  <Text style={styles.chipHint}>{t('common_select')}</Text>
                </Pressable>
              </View>
            )}

            <View style={styles.metaRow}>
              <Text style={styles.metaText}>
                {debouncedQ ? `${t('users_found')}: ${filtered.length}` : `${t('users_total')}: ${list.length}`}
                {useDepartments && activeDeptName ? ` • ${activeDeptName}` : ''}
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

          {/* Department Picker Modal */}
          {useDepartments && (
            <SelectModal
              visible={deptPickerVisible}
              onClose={() => setDeptPickerVisible(false)}
              title={t('users_filterByDepartment')}
              searchable={false}
              items={[
                { id: '__all', label: t('users_allDepartments'), right: (deptFilter == null ? <Feather name="check" size={18} color={theme.colors.primary} /> : null) },
                ...departments.map((d) => ({
                  id: String(d.id),
                  label: d.name,
                  right: (String(deptFilter) === String(d.id) ? <Feather name="check" size={18} color={theme.colors.primary} /> : null),
                })),
              ]}
              onSelect={(item) => {
                if (!item) return;
                if (item.id === '__all') setDeptFilter(null);
                else setDeptFilter(String(item.id));
                setDeptPickerVisible(false);
              }}
              maxHeightRatio={0.65}
            />
          )}
        </View>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}
