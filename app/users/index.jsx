// app/users/index.jsx

import { useRouter, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput as TextField,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableWithoutFeedback,
  Keyboard,
  StyleSheet,
  Platform,
  Modal,
  ScrollView,
  Pressable,
} from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  // Fallback for non-string dynamic colors
  return `rgba(0,122,255,${a})`;
}

import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeProvider';
import Button from '../../components/ui/Button';
import { getMyCompanyId } from '../../lib/workTypes'; // используем, чтобы получить флаг компании

const ROLE_LABELS = {
  admin: 'Администратор',
  dispatcher: 'Диспетчер',
  worker: 'Рабочий',
};

const CONTROL_HEIGHT = 44; // Единая высота для поля поиска и кнопки "Создать"

export default function UsersIndex() {
  const { theme } = useTheme();
  const { top: headerHeight } = useSafeAreaInsets();
  const router = useRouter();

  // keep Android navigation bar buttons readable while modals are open
  const applyNavBar = React.useCallback(async () => {
    try {
      await NavigationBar.setButtonStyleAsync(theme.mode === 'dark' ? 'light' : 'dark');
    } catch {}
  }, [theme]);

  React.useEffect(() => { applyNavBar(); }, [applyNavBar]);

  const c = theme.colors;
  const styles = React.useMemo(() => StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.background },
    container: { flex: 1 },
    loaderWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.background },
    header: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10 },
    title: { fontSize: 22, fontWeight: '700', color: c.text, marginBottom: 12 },
    searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    searchBox: {
      flex: 1, position: 'relative', backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.border,
      height: 44, paddingLeft: 12, paddingRight: 40, justifyContent: 'center',
    },
    searchInput: { fontSize: 15, color: c.text, height: 44, paddingVertical: 0 },
    clearBtn: {
      position: 'absolute', right: 8, top: (44 - 28) / 2, width: 28, height: 28, borderRadius: 14,
      backgroundColor: c.border, alignItems: 'center', justifyContent: 'center',
    },
    clearBtnText: { fontSize: 20, lineHeight: 20, color: c.textSecondary, fontWeight: '600', marginTop: -2 },
    primaryBtn: {
      height: 44, backgroundColor: c.primary, paddingHorizontal: 16, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
      ...((theme.shadows && theme.shadows.level1 && theme.shadows.level1[Platform.OS]) || {}),
    },
    metaRow: { marginTop: 8 },
    metaText: { fontSize: 12, color: c.textSecondary },
    errorCard: {
      marginTop: 8, backgroundColor: withAlpha(c.danger, 0.13), borderColor: withAlpha(c.danger, 0.2),
      borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12,
    },
    errorText: { color: c.danger, fontSize: 13 },
    listContent: { paddingHorizontal: 16, paddingBottom: 24 },
    card: {
      backgroundColor: c.surface, padding: 14, borderRadius: 16, marginBottom: 10,
      ...((theme.shadows && theme.shadows.level1 && theme.shadows.level1[Platform.OS]) || {}),
    },
    cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    cardTextWrap: { flexShrink: 1, paddingRight: 12 },
    cardTitle: { fontSize: 16, fontWeight: '600', color: c.text },
    rolePill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1 },
    rolePillText: { fontSize: 12, fontWeight: '600' },
    emptyWrap: { padding: 24, alignItems: 'center' },
    emptyText: { color: c.textSecondary },
    // --- Departments UI
    toolbarRow: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
    chip: {
      height: CONTROL_HEIGHT, flex: 1, backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.border,
      paddingHorizontal: 12, alignItems: 'center', justifyContent: 'space-between', flexDirection: 'row',
    },
    chipText: { color: c.text, fontSize: 14 },
    chipHint: { color: c.textSecondary, fontSize: 13 },
    modalOverlay: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
    modalDim: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.colors.overlay },
    modalBackdrop: { flex: 1, justifyContent: 'flex-end' },
    modalCard: {
      backgroundColor: c.background, paddingTop: 12, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '80%',
      ...((theme.shadows && theme.shadows.level2 && theme.shadows.level2[Platform.OS]) || {}),
    },
    modalHeader: { paddingHorizontal: 16, paddingBottom: 12 },
    modalTitle: { color: c.text, fontWeight: '700', fontSize: 16 },
    divider: { height: 1, backgroundColor: c.border, marginVertical: 8, marginHorizontal: 16 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
    rowText: { color: c.text, fontSize: 15, flexShrink: 1 },
    muted: { color: c.textSecondary },
    applyBar: { padding: 16, borderTopWidth: 1, borderTopColor: c.border, flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
    ghostBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
    manageBtnText: { color: c.text, fontWeight: '600' },
  }), [theme]);

  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Company feature flag: use_departments
  const [companyId, setCompanyId] = useState(null);
  const [useDepartments, setUseDepartments] = useState(false);

  // Departments state (for filtering only)
  const [departments, setDepartments] = useState([]);
  const [deptFilter, setDeptFilter] = useState(null);
  const [deptPickerVisible, setDeptPickerVisible] = useState(false);

  // --- Debounce for search (200ms)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const loadCompanyFlag = useCallback(async () => {
    try {
      const cid = await getMyCompanyId();
      setCompanyId(cid);
      if (!cid) {
        setUseDepartments(false);
        setDeptFilter(null);
        return;
      }

      // Пытаемся прочитать флаг напрямую из companies
      const { data, error } = await supabase
        .from('companies')
        .select('use_departments')
        .eq('id', cid)
        .single();

      if (!error) {
        const enabled = !!data?.use_departments;
        setUseDepartments(enabled);
        if (!enabled) setDeptFilter(null);
        if (!enabled) return; // если выключено — не делаем fallback
      }

      // Fallback: если RLS/поле недоступны — считаем включенным,
      // если у компании есть хотя бы один отдел
      const { count, error: deptErr } = await supabase
        .from('departments')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', cid);

      if (!deptErr && typeof count === "number" && count > 0)
        setUseDepartments(true)
      else
        setUseDepartments(false)
        setDeptFilter(null)
    } catch (e) {
      setUseDepartments(false);
      setDeptFilter(null);
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
    } catch (e) {
      // тихо игнорируем, чтобы не ломать экран сотрудников
      setDepartments([]);
    }
  }, [useDepartments]);

  const fetchUsers = useCallback(async () => {
    setErrorMsg('');
    setLoading(true);
    try {
      let query = supabase
        .from('profiles')
        .select('id, first_name, last_name, full_name, role, department_id')
        .order('full_name', { ascending: true, nullsFirst: false });

      if (useDepartments && deptFilter != null) {
        query = query.eq('department_id', deptFilter);
      }

      const { data, error } = await query;

      if (error) {
        setList([]);
        setErrorMsg('Не удалось загрузить список сотрудников.');
      } else {
        setList(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      setList([]);
      setErrorMsg('Ошибка сети при загрузке сотрудников.');
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
    (async () => {
      await Promise.all([fetchUsers(), fetchDepartments()]);
    })();
  }, [fetchUsers, fetchDepartments]);

  // Realtime auto-refresh: profiles & departments (только если департаменты включены)
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
      (async () => {
        await Promise.all([fetchUsers(), fetchDepartments()]);
      })();
      return () => {};
    }, [fetchUsers, fetchDepartments]),
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
      const roleRu = (ROLE_LABELS[u.role] || '').toLowerCase();
      return (
        name.includes(debouncedQ) || roleCode.includes(debouncedQ) || roleRu.includes(debouncedQ)
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
      role === 'admin'
        ? (theme.colors?.primary)
        : role === 'dispatcher'
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

  const renderItem = useCallback(
    ({ item }) => {
      const stylesPill = rolePillStyle(item.role);
      return (
        <Pressable
          android_ripple={{ borderless: false, color: (theme.colors.border + '22') }} onPress={() => goToUser(item.id)}
          activeOpacity={0.7}
          style={styles.card}
          accessibilityRole="button"
          accessibilityLabel={`Открыть сотрудника ${((`${item.first_name || ''} ${item.last_name || ''}`.trim()) || item.full_name || '').trim() || 'Без имени'}`}
        >
          <View style={styles.cardRow}>
            <View style={styles.cardTextWrap}>
              <Text numberOfLines={1} style={styles.cardTitle}>
                {((`${item.first_name || ''} ${item.last_name || ''}`.trim()) || item.full_name || '').trim() || 'Без имени'}
              </Text>
            </View>
            <View style={stylesPill.container}>
              <Text style={stylesPill.text}>{ROLE_LABELS[item.role] || '—'}</Text>
            </View>
          </View>
        </Pressable>
      );
    },
    [goToUser],
  );

  const keyExtractor = useCallback((item) => String(item.id), []);

  // Derived: department name by id
  const activeDeptName = useMemo(() => {
    const d = departments.find((d) => String(d.id) === String(deptFilter));
    return d ? d.name : null;
  }, [departments, deptFilter]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaView>
    );
  }

  const EmptyState = () => (
    <View style={styles.emptyWrap}>
      <Text style={styles.emptyText}>
        {list.length === 0 ? 'Пока пусто' : 'Ничего не найдено по запросу'}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Сотрудники</Text>

            {/* Search + Create */}
            <View style={styles.searchRow}>
              <View style={styles.searchBox}>
                <TextField
                  placeholder="Поиск по имени/роли"
                  placeholderTextColor={theme.colors.textSecondary}
                  value={q}
                  onChangeText={setQ}
                  autoCorrect={false}
                  returnKeyType="search"
                  onSubmitEditing={Keyboard.dismiss}
                  style={styles.searchInput}
                />
                {!!q && (
                  <Pressable
                    android_ripple={{ borderless: false, color: (theme.colors.border + '22') }} onPress={() => setQ('')}
                    activeOpacity={0.8}
                    style={styles.clearBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Очистить поиск"
                  >
                    <Text style={styles.clearBtnText}>×</Text>
                  </Pressable>
                )}
              </View>

              <Button title="Создать" onPress={() => router.push("/users/new")} variant="primary" size="md" />
            </View>

            {/* Department filter (visible only if company enabled departments) */}
            {useDepartments && (
              <View style={styles.toolbarRow}>
                <Pressable
                  android_ripple={{ borderless: false, color: (theme.colors.border + '22') }}
                  onPress={() => setDeptPickerVisible(true)}
                  style={styles.chip}
                >
                  <Text style={styles.chipText}>
                    {activeDeptName ? `Отдел: ${activeDeptName}` : 'Все отделы'}
                  </Text>
                  <Text style={styles.chipHint}>Выбрать</Text>
                </Pressable>
              </View>
            )}

            <View className="metaRow" style={styles.metaRow}>
              <Text style={styles.metaText}>
                {debouncedQ ? `Найдено: ${filtered.length}` : `Всего: ${list.length}`}
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
            <Modal onDismiss={applyNavBar} presentationStyle="overFullScreen" statusBarTranslucent={true} navigationBarTranslucent={true} hardwareAccelerated={true} visible={deptPickerVisible} animationType="slide" transparent onRequestClose={() => setDeptPickerVisible(false)}>
              <View style={[styles.modalOverlay, { paddingTop: headerHeight }]}>
                <View style={styles.modalCard}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>Фильтр по отделу</Text>
                  </View>
                  <View style={styles.divider} />
                  <ScrollView keyboardShouldPersistTaps="handled">
                    <Pressable style={styles.row} android_ripple={{ borderless: false, color: (theme.colors.border + '22') }} onPress={() => { setDeptFilter(null); setDeptPickerVisible(false); }}>
                      <Text style={[styles.rowText, styles.muted]}>Все отделы</Text>
                      {deptFilter == null && <Text>✓</Text>}
                    </Pressable>
                    {departments.map((d) => (
                      <Pressable
                        key={String(d.id)}
                        style={styles.row}
                        android_ripple={{ borderless: false, color: (theme.colors.border + '22') }} onPress={() => { setDeptFilter(prev => String(prev)===String(d.id) ? null : String(d.id)); setDeptPickerVisible(false); }}
                      >
                        <Text style={styles.rowText}>{d.name}</Text>
                        {String(deptFilter) === String(d.id) && <Text>✓</Text>}
                      </Pressable>
                    ))}
                  </ScrollView>
                  <View style={styles.applyBar}>
                    <Pressable android_ripple={{ borderless: false, color: (theme.colors.border + '22') }} onPress={() => setDeptPickerVisible(false)} style={styles.ghostBtn}>
                      <Text style={styles.manageBtnText}>Закрыть</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            </Modal>
          )}
        </View>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}