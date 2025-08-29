// app/stats.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  ActivityIndicator,
  Pressable,
  Modal,
  TextInput,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Platform,
  useColorScheme,
} from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AntDesign, Ionicons } from '@expo/vector-icons';
import { Calendar } from 'react-native-calendars';
import { supabase } from '../lib/supabase';

// ------- Design tokens (auto dark/light) -------
const useTokens = () => {
  const scheme = useColorScheme?.() || 'light';
  const isDark = scheme === 'dark';
  return {
    isDark,
    PRIMARY: '#007AFF',
    BG: isDark ? '#000000' : '#FFFFFF',
    SURFACE: isDark ? '#1C1C1E' : '#F2F2F7',
    CARD_BORDER: isDark ? '#2C2C2E' : '#EEEEEE',
    TEXT: isDark ? '#FFFFFF' : '#111111',
    SUBTEXT: isDark ? '#9A9AA1' : '#666666',
    OUTLINE: isDark ? '#2C2C2E' : '#E5E5EA',
    SHADOW: '#000',
    CAL_BG: isDark ? '#000000' : '#FFFFFF',
    CAL_TEXT: isDark ? '#FFFFFF' : '#111111',
  };
};

// ------- Periods -------
const PERIODS = [
  { key: '30d', label: '30 дней' },
  { key: 'ytd', label: 'Год' },
  { key: 'all', label: 'Все' },
  { key: 'custom', label: 'Диапазон' },
];

// ------- Date helpers -------
const startOfYear = (d = new Date()) => new Date(d.getFullYear(), 0, 1);
const addDays = (base, days) => { const d = new Date(base); d.setDate(d.getDate() + days); return d; };
const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const endOfDay = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
const iso = (d) => d.toISOString();
const fmt = (d) => d ? d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';
const toISODate = (d) => {
  const y = d.getFullYear();
  const m = (`0${d.getMonth()+1}`).slice(-2);
  const day = (`0${d.getDate()}`).slice(-2);
  return `${y}-${m}-${day}`;
};
const fromISODate = (s) => {
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y, m-1, d);
};
const HIT = { top: 12, bottom: 12, left: 12, right: 12 };

export default function StatsScreen() {
  const insets = useSafeAreaInsets();
  const TOK = useTokens();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [me, setMe] = useState(null);
  const [role, setRole] = useState(null);

  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const [usersSearch, setUsersSearch] = useState('');

  const [selectedUserId, setSelectedUserId] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);

  const [period, setPeriod] = useState('30d');

  // Custom period state (persisted)
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(null);
  const [customTo, setCustomTo] = useState(null);

  // Temp range inside modal
  const [rangeStart, setRangeStart] = useState(null); // 'YYYY-MM-DD'
  const [rangeEnd, setRangeEnd] = useState(null);     // 'YYYY-MM-DD'

  const isAdmin = role === 'admin';
  const isDispatcher = role === 'dispatcher';
  const isManager = isAdmin || isDispatcher;

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: TOK.BG, paddingTop: insets.top },
    appBar: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8, backgroundColor: TOK.BG,
    },
    appBarBack: {
      width: 40, height: 40, borderRadius: 12, backgroundColor: TOK.SURFACE,
      alignItems: 'center', justifyContent: 'center', marginRight: 10, borderWidth: 1, borderColor: TOK.OUTLINE,
    },
    appBarTitle: { fontSize: 22, fontWeight: '700', color: TOK.TEXT },

    chipRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 10, flexWrap: 'wrap' },
    chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, backgroundColor: TOK.SURFACE, borderWidth: 1, borderColor: TOK.OUTLINE },
    chipActive: { backgroundColor: TOK.PRIMARY, borderColor: TOK.PRIMARY },
    chipText: { fontSize: 14, color: TOK.isDark ? '#E5E5EA' : '#333333' },
    chipTextActive: { color: 'white', fontWeight: '600' },

    section: { paddingHorizontal: 16, paddingTop: 12 },
    card: {
      backgroundColor: TOK.BG,
      borderRadius: 16,
      padding: 16,
      shadowColor: TOK.SHADOW, shadowOpacity: TOK.isDark ? 0.4 : 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
      elevation: 2, borderWidth: 1, borderColor: TOK.CARD_BORDER,
    },
    cardTitle: { fontSize: 15, color: TOK.SUBTEXT, marginBottom: 8 },

    metricRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
    metricLabel: { fontSize: 15, color: TOK.isDark ? '#D1D1D6' : '#444444' },
    metricValue: { fontSize: 22, fontWeight: '700', color: TOK.TEXT },

    picker: { marginTop: 8, backgroundColor: TOK.SURFACE, borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: TOK.OUTLINE },
    pickerText: { color: TOK.TEXT, fontSize: 16, fontWeight: '600' },
    pickerHint: { fontSize: 12, color: TOK.SUBTEXT, marginTop: 2 },

    modal: { flex: 1, backgroundColor: TOK.BG, paddingTop: insets.top },
    modalHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, borderBottomColor: TOK.OUTLINE, borderBottomWidth: 1 },
    modalClose: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: TOK.SURFACE, borderWidth: 1, borderColor: TOK.OUTLINE },
    modalCloseText: { color: TOK.TEXT, fontSize: 14, fontWeight: '600' },

    footerSpace: { height: 28 },

    // Custom period modal
    cHeader: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
    cTitle: { fontSize: 20, fontWeight: '700', color: TOK.TEXT },
    cSubtitle: { fontSize: 13, color: TOK.SUBTEXT, marginTop: 4 },
    cBlock: { marginTop: 12, backgroundColor: TOK.SURFACE, borderRadius: 16, marginHorizontal: 16, padding: 12, borderWidth: 1, borderColor: TOK.OUTLINE },
    cRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingVertical: 6 },
    cLabel: { fontSize: 16, color: TOK.TEXT, fontWeight: '600' },
    cDate: { fontSize: 15, color: TOK.isDark ? '#E5E5EA' : '#333333' },
    cFooter: { padding: 16, gap: 10 },
    btnPrimary: { backgroundColor: TOK.PRIMARY, padding: 14, borderRadius: 14, alignItems: 'center' },
    btnGhost: { backgroundColor: TOK.SURFACE, padding: 14, borderRadius: 14, alignItems: 'center', borderWidth: 1, borderColor: TOK.OUTLINE },
    btnTextPrimary: { color: 'white', fontSize: 16, fontWeight: '700' },
    btnTextGhost: { color: TOK.TEXT, fontSize: 16, fontWeight: '700' },
    disabled: { opacity: 0.5 },
  }), [TOK, insets.top]);

  // ---------- Load profile ----------
  const loadMe = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user?.id) { setMe(null); setRole(null); return; }
    const uid = auth.user.id;
    const { data: prof, error } = await supabase
      .from('profiles')
      .select('id, role, full_name, company_id')
      .eq('id', uid)
      .single();
    if (error) throw error;
    setMe(prof);
    setRole(prof.role);
    setSelectedUserId(prof.id);
    setSelectedUser(prof);
  }, []);

  // ---------- Load users (for managers) ----------
  const loadUsers = useCallback(async () => {
    if (!isManager || !me?.company_id) { setUsers([]); return; }
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('company_id', me.company_id)
      .order('full_name', { ascending: true });
    if (error) throw error;
    const rows = (data || []);
    setUsers([{ id: 'ALL', full_name: 'Все сотрудники', role: 'all' }, ...rows]);
  }, [isManager, me?.company_id]);

  // ---------- Period range ----------
  const periodRange = useMemo(() => {
    const now = new Date();
    if (period === '30d') return { from: addDays(now, -30), to: endOfDay(now) };
    if (period === 'ytd')  return { from: startOfYear(now), to: endOfDay(now) };
    if (period === 'custom') {
      return {
        from: customFrom ? startOfDay(customFrom) : null,
        to: customTo ? endOfDay(customTo) : null,
      };
    }
    return { from: null, to: endOfDay(now) };
  }, [period, customFrom, customTo]);

  const companyUserIds = useMemo(() => users.filter(u => u.id !== 'ALL').map(u => u.id), [users]);
  const isAllSelected = selectedUserId === 'ALL';

  // ---------- Load orders ----------
  const [orders, setOrders] = useState([]);
  const loadOrders = useCallback(async () => {
    if (!selectedUserId && !isAllSelected) { setOrders([]); return; }

    const buildQuery = (table) => {
      let q = supabase
        .from(table)
        .select(table === 'orders'
          ? 'id, assigned_to, status, datetime'
          : 'order_id, assigned_to, status, datetime, payout, fuel_cost, fuel_reimbursable')
        .order('datetime', { ascending: false });

      if (isAllSelected) {
        if (companyUserIds.length === 0) return { skip: true, q: null };
        q = q.in('assigned_to', companyUserIds);
      } else {
        q = q.eq('assigned_to', selectedUserId);
      }

      if (periodRange.from) q = q.gte('datetime', iso(periodRange.from));
      if (periodRange.to)   q = q.lte('datetime', iso(periodRange.to));
      return { skip: false, q };
    };

    // Try main table first
    const a = buildQuery('orders');
    if (a?.skip || !a?.q) { setOrders([]); return; }
    const { data, error } = await a.q;
    if (!error && Array.isArray(data)) {
      const mapped = data.map(o => ({
        order_id: o.id,
        assigned_to: o.assigned_to,
        status: o.status,
        datetime: o.datetime,
        payout: null,
        fuel_cost: null,
        fuel_reimbursable: null,
      }));
      setOrders(mapped);
      return;
    }

    // Fallback to payouts view if direct table blocked by RLS
    const b = buildQuery('order_payouts');
    if (b?.skip || !b?.q) { setOrders([]); return; }
    const { data: d2, error: er2 } = await b.q;
    if (!er2 && Array.isArray(d2)) { setOrders(d2); } else { setOrders([]); }
  }, [selectedUserId, isAllSelected, companyUserIds, periodRange.from, periodRange.to]);

  // ---------- Initial load ----------
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      await loadMe();
    } finally {
      setLoading(false);
    }
  }, [loadMe]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        if (!me) return;
        if (isManager) await loadUsers();
        await loadOrders();
      })();
    }, [me, isManager, selectedUserId, period, customFrom, customTo, loadUsers, loadOrders])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadOrders();
      if (isManager) await loadUsers();
    } finally { setRefreshing(false); }
  }, [loadOrders, isManager, loadUsers]);

  // ---------- Derived ----------
  const computed = useMemo(() => {
    const list = orders || [];
    const totals = {
      all: list.length,
      new: list.filter(r => r.status === 'Новый').length,
      inProgress: list.filter(r => r.status === 'В работе').length,
      done: list.filter(r => r.status === 'Завершённая').length,
    };
    const now = new Date();
    const in7 = addDays(now, 7);
    const upcoming = list
      .filter(r => r.datetime && new Date(r.datetime) >= now && new Date(r.datetime) <= in7 && r.status !== 'Завершённая')
      .sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
      .slice(0, 6);
    return { totals, upcoming };
  }, [orders]);

  const selectedPeriodLabel = useMemo(() => {
    if (period === 'custom') return `${fmt(customFrom)} → ${fmt(customTo)}`;
    return (PERIODS.find(p => p.key === period)?.label || '—');
  }, [period, customFrom, customTo]);

  const filteredUsers = useMemo(() => {
    const list = users;
    const q = (usersSearch || '').trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      u =>
        (u.full_name || '').toLowerCase().includes(q) ||
        (u.role || '').toLowerCase().includes(q)
    );
  }, [users, usersSearch]);

  // ---------- User picker ----------
  const openPicker = () => setUserPickerOpen(true);
  const closePicker = () => setUserPickerOpen(false);
  const selectUser = (u) => {
    setSelectedUserId(u.id);
    setSelectedUser(u.id === 'ALL' ? { full_name: 'Все сотрудники', role: 'all' } : u);
    closePicker();
  };

  // ---------- Custom period with react-native-calendars ----------
  const openCustom = () => {
    const today = new Date();
    const todayIso = toISODate(today);
    const startIso = customFrom ? toISODate(customFrom) : todayIso;
    const endIso = customTo ? toISODate(customTo) : startIso;
    const clamp = (isoStr) => {
      const d = fromISODate(isoStr);
      return d > today ? todayIso : isoStr;
    };
    setRangeStart(clamp(startIso));
    setRangeEnd(clamp(endIso));
    setCustomModalOpen(true);
  };
  const closeCustom = () => setCustomModalOpen(false);
  const resetCustom = () => {
    const todayIso = toISODate(new Date());
    setRangeStart(todayIso);
    setRangeEnd(todayIso);
  };
  const applyCustom = () => {
    const from = fromISODate(rangeStart);
    const to = fromISODate(rangeEnd);
    setCustomFrom(startOfDay(from));
    setCustomTo(endOfDay(to));
    setPeriod('custom');
    closeCustom();
  };

  // Calendar markings
  const markedDates = useMemo(() => {
    if (!rangeStart) return {};
    const start = fromISODate(rangeStart);
    const end = rangeEnd ? fromISODate(rangeEnd) : start;
    const marks = {};
    const dayMS = 24 * 60 * 60 * 1000;
    for (let t = start.getTime(); t <= end.getTime(); t += dayMS) {
      const d = new Date(t);
      const key = toISODate(d);
      const isStart = key === rangeStart;
      const isEnd = key === rangeEnd;
      marks[key] = {
        startingDay: isStart,
        endingDay: isEnd,
        color: TOK.PRIMARY,
        textColor: 'white',
      };
    }
    return marks;
  }, [rangeStart, rangeEnd, TOK.PRIMARY]);

  const onDayPress = (day) => {
    const todayIso = toISODate(new Date());
    const picked = day.dateString > todayIso ? todayIso : day.dateString; // no future
    if (!rangeStart || (rangeStart && rangeEnd && rangeStart !== rangeEnd)) {
      setRangeStart(picked);
      setRangeEnd(picked);
      return;
    }
    // range start exists, range end equals start (single day)
    if (picked < rangeStart) {
      setRangeEnd(rangeStart);
      setRangeStart(picked);
    } else {
      setRangeEnd(picked);
    }
  };

  const todayIso = toISODate(new Date());

  // ---------- Render ----------
  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={TOK.PRIMARY} />
      </SafeAreaView>
    );
  }

  const headerName = isManager
    ? (selectedUser?.full_name || 'Выберите пользователя')
    : (me?.full_name || 'Я');

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.appBar}>
        <Pressable onPress={() => router.back()} hitSlop={HIT} style={styles.appBarBack}>
          <AntDesign name="arrowleft" size={22} color={TOK.TEXT} />
        </Pressable>
        <Text style={styles.appBarTitle}>Статистика</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentInsetAdjustmentBehavior="automatic"
      >
        {isManager && (
          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <Pressable onPress={openPicker} style={styles.picker} hitSlop={HIT}>
              <Ionicons name="person-circle-outline" size={22} color={TOK.SUBTEXT} />
              <View style={{ flex: 1 }}>
                <Text style={styles.pickerText}>{headerName}</Text>
                <Text style={styles.pickerHint}>Нажми, чтобы выбрать пользователя или “Все сотрудники”</Text>
              </View>
              <Ionicons name="chevron-down" size={18} color={TOK.SUBTEXT} />
            </Pressable>
          </View>
        )}

        {/* Period chips */}
        <View style={styles.chipRow}>
          {PERIODS.map(p => {
            const active = p.key === period;
            const isCustom = p.key === 'custom';
            return (
              <Pressable
                key={p.key}
                onPress={() => isCustom ? openCustom() : setPeriod(p.key)}
                style={[styles.chip, active && styles.chipActive]}
                hitSlop={HIT}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {isCustom && period === 'custom' ? `${fmt(customFrom)} → ${fmt(customTo)}` : p.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Summary */}
        <View style={styles.section}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Заявки · {period === 'custom' ? `${fmt(customFrom)} → ${fmt(customTo)}` : (PERIODS.find(p => p.key === period)?.label || '—')}</Text>
            <View style={styles.metricRow}><Text style={styles.metricLabel}>Всего</Text><Text style={styles.metricValue}>{computed.totals.all}</Text></View>
            <View style={styles.metricRow}><Text style={styles.metricLabel}>Новые</Text><Text style={styles.metricValue}>{computed.totals.new}</Text></View>
            <View style={styles.metricRow}><Text style={styles.metricLabel}>В работе</Text><Text style={styles.metricValue}>{computed.totals.inProgress}</Text></View>
            <View style={styles.metricRow}><Text style={styles.metricLabel}>Завершённые</Text><Text style={styles.metricValue}>{computed.totals.done}</Text></View>
          </View>
        </View>

        {/* Upcoming */}
        <View style={styles.section}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Ближайшие выезды · 7 дней</Text>
            {computed.upcoming.length > 0 ? computed.upcoming.map((o) => (
              <View key={o.order_id} style={{ paddingVertical: 10, borderBottomColor: TOK.OUTLINE, borderBottomWidth: 1 }}>
                <View style={styles.metricRow}>
                  <Text style={{ color: TOK.isDark ? '#E5E5EA' : '#333' }}>{o.status}</Text>
                  <Text style={{ color: TOK.isDark ? '#FFFFFF' : '#333', fontWeight: '600' }}>
                    {o.datetime ? new Date(o.datetime).toLocaleString('ru-RU', {
                      day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
                    }) : '—'}
                  </Text>
                </View>
              </View>
            )) : (
              <Text style={{ color: TOK.SUBTEXT, marginTop: 8 }}>Нет выездов в ближайшие 7 дней</Text>
            )}
          </View>
        </View>

        <View style={styles.footerSpace} />
      </ScrollView>

      {/* Custom Period Modal */}
      <Modal visible={customModalOpen} animationType="slide" onRequestClose={closeCustom} transparent={false}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeaderRow}>
            <Text style={styles.appBarTitle}>Выбор периода</Text>
            <Pressable onPress={closeCustom} style={styles.modalClose} hitSlop={HIT}><Text style={styles.modalCloseText}>Закрыть</Text></Pressable>
          </View>

          <View style={styles.cBlock}>
            <Text style={styles.cLabel}>Диапазон</Text>
            <Text style={[styles.cDate, { marginTop: 6 }]}>
              {rangeStart && rangeEnd ? `${fmt(fromISODate(rangeStart))} → ${fmt(fromISODate(rangeEnd))}` : '—'}
            </Text>

            <View style={{ marginTop: 12, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: TOK.OUTLINE }}>
              <Calendar
                onDayPress={onDayPress}
                markedDates={markedDates}
                markingType="period"
                maxDate={todayIso}
                theme={{
                  backgroundColor: TOK.CAL_BG,
                  calendarBackground: TOK.CAL_BG,
                  textSectionTitleColor: TOK.SUBTEXT,
                  dayTextColor: TOK.CAL_TEXT,
                  monthTextColor: TOK.CAL_TEXT,
                  arrowColor: TOK.PRIMARY,
                  selectedDayBackgroundColor: TOK.PRIMARY,
                  selectedDayTextColor: '#ffffff',
                  todayTextColor: TOK.PRIMARY,
                }}
                firstDay={1}
                enableSwipeMonths
              />
            </View>
          </View>

          <View style={styles.cFooter}>
            <Pressable onPress={applyCustom} style={[styles.btnPrimary, !(rangeStart && rangeEnd) && styles.disabled]} disabled={!(rangeStart && rangeEnd)}>
              <Text style={styles.btnTextPrimary}>Применить</Text>
            </Pressable>
            <Pressable onPress={resetCustom} style={styles.btnGhost}>
              <Text style={styles.btnTextGhost}>Сбросить</Text>
            </Pressable>
            <Pressable onPress={closeCustom} style={styles.btnGhost}>
              <Text style={styles.btnTextGhost}>Отмена</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
