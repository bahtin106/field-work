// app/stats.jsx
import { AntDesign, Ionicons } from '@expo/vector-icons';
import { useFocusEffect, router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  ActivityIndicator,
  Pressable,
  Modal,
  TextInput as RNTextInput,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
} from 'react-native';

import { TouchableOpacity as GHTouchableOpacity } from 'react-native-gesture-handler';
import { Calendar } from 'react-native-calendars';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '../lib/supabase';
import { useTheme } from '../theme/ThemeProvider';

// ------- Periods -------
const PERIODS = [
  { key: '30d', label: '30 дней' },
  { key: 'ytd', label: 'Год' },
  { key: 'all', label: 'Все' },
  { key: 'custom', label: 'Диапазон' },
];

// ------- Date helpers -------
const startOfYear = (d = new Date()) => new Date(d.getFullYear(), 0, 1);
const addDays = (base, days) => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
};
const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const endOfDay = (d) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};
const iso = (d) => d.toISOString();
const fmt = (d) =>
  d ? d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';
const toISODate = (d) => {
  const y = d.getFullYear();
  const m = `0${d.getMonth() + 1}`.slice(-2);
  const day = `0${d.getDate()}`.slice(-2);
  return `${y}-${m}-${day}`;
};
const fromISODate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const HIT = { top: 12, bottom: 12, left: 12, right: 12 };

const fRUB = (n) =>
  new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(
    Math.round(Number(n || 0)),
  );

export default function StatsScreen() {
  // ---- Theme from context ----
  const { theme, mode } = useTheme();

  const insets = useSafeAreaInsets();
  const TOK = React.useMemo(
    () => ({
      isDark: mode === 'dark' || theme.mode === 'dark',
      PRIMARY: theme.colors.accent,
      BG: theme.colors.bg,
      SURFACE: theme.colors.card,
      CARD_BORDER: theme.colors.border,
      TEXT: theme.colors.text,
      SUBTEXT: theme.text?.muted?.color || '#6B7280',
      OUTLINE: theme.colors.border,
      SHADOW: '#000',
      CAL_BG: theme.colors.bg,
      CAL_TEXT: theme.colors.text,
      INPUT_BG: theme.colors.card,
      INPUT_BORDER: theme.colors.border,
      INPUT_TEXT: theme.colors.text,
      PLACEHOLDER: theme.text?.muted?.color || '#8E8E93',
    }),
    [theme, mode],
  );

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
  const [rangeEnd, setRangeEnd] = useState(null); // 'YYYY-MM-DD'

  const isAdmin = role === 'admin';
  const isDispatcher = role === 'dispatcher';
  const isManager = isAdmin || isDispatcher;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: TOK.BG, paddingTop: insets.top },
        appBar: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingTop: 6,
          paddingBottom: 8,
          backgroundColor: TOK.BG,
        },
        appBarBack: {
          width: 40,
          height: 40,
          borderRadius: 12,
          backgroundColor: TOK.SURFACE,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 10,
          borderWidth: 1,
          borderColor: TOK.OUTLINE,
        },
        appBarTitle: { fontSize: 22, fontWeight: '700', color: TOK.TEXT },

        chipRow: {
          flexDirection: 'row',
          gap: 8,
          paddingHorizontal: 16,
          paddingTop: 10,
          flexWrap: 'wrap',
        },
        chip: {
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 18,
          backgroundColor: TOK.SURFACE,
          borderWidth: 1,
          borderColor: TOK.OUTLINE,
        },
        chipActive: { backgroundColor: TOK.PRIMARY, borderColor: TOK.PRIMARY },
        chipText: { fontSize: 14, color: TOK.isDark ? '#E5E5EA' : '#333333' },
        chipTextActive: { color: 'white', fontWeight: '600' },

        section: { paddingHorizontal: 16, paddingTop: 12 },
        card: {
          backgroundColor: TOK.BG,
          borderRadius: 16,
          padding: 16,
          shadowColor: TOK.SHADOW,
          shadowOpacity: TOK.isDark ? 0.4 : 0.08,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 2,
          borderWidth: 1,
          borderColor: TOK.CARD_BORDER,
        },
        cardTitle: { fontSize: 15, color: TOK.SUBTEXT, marginBottom: 8 },

        metricRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingVertical: 6,
        },
        metricLabel: { fontSize: 15, color: TOK.isDark ? '#D1D1D6' : '#444444' },
        metricValue: { fontSize: 22, fontWeight: '700', color: TOK.TEXT },

        picker: {
          marginTop: 8,
          backgroundColor: TOK.SURFACE,
          borderRadius: 14,
          padding: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          borderWidth: 1,
          borderColor: TOK.OUTLINE,
        },
        pickerText: { color: TOK.TEXT, fontSize: 16, fontWeight: '600' },
        pickerHint: { fontSize: 12, color: TOK.SUBTEXT, marginTop: 2 },

        modal: { flex: 1, backgroundColor: TOK.BG, paddingTop: insets.top },
        modalHeaderRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          paddingTop: 10,
          paddingBottom: 10,
          borderBottomColor: TOK.OUTLINE,
          borderBottomWidth: 1,
        },
        modalClose: {
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 10,
          backgroundColor: TOK.SURFACE,
          borderWidth: 1,
          borderColor: TOK.OUTLINE,
        },
        modalCloseText: { color: TOK.TEXT, fontSize: 14, fontWeight: '600' },

        footerSpace: { height: 28 },

        // Custom period modal
        cHeader: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
        cTitle: { fontSize: 20, fontWeight: '700', color: TOK.TEXT },
        cSubtitle: { fontSize: 13, color: TOK.SUBTEXT, marginTop: 4 },
        cBlock: {
          marginTop: 12,
          backgroundColor: TOK.SURFACE,
          borderRadius: 16,
          marginHorizontal: 16,
          padding: 12,
          borderWidth: 1,
          borderColor: TOK.OUTLINE,
        },
        cRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 4,
          paddingVertical: 6,
        },
        cLabel: { fontSize: 16, color: TOK.TEXT, fontWeight: '600' },
        cDate: { fontSize: 15, color: TOK.isDark ? '#E5E5EA' : '#333333' },
        cFooter: { padding: 16, gap: 10 },
        btnPrimary: {
          backgroundColor: TOK.PRIMARY,
          padding: 14,
          borderRadius: 14,
          alignItems: 'center',
        },
        btnGhost: {
          backgroundColor: TOK.SURFACE,
          padding: 14,
          borderRadius: 14,
          alignItems: 'center',
          borderWidth: 1,
          borderColor: TOK.OUTLINE,
        },
        btnTextPrimary: { color: 'white', fontSize: 16, fontWeight: '700' },
        btnTextGhost: { color: TOK.TEXT, fontSize: 16, fontWeight: '700' },
        disabled: { opacity: 0.5 },

        // User picker modal
        upHeaderRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          paddingTop: 10,
          paddingBottom: 10,
          borderBottomColor: TOK.OUTLINE,
          borderBottomWidth: 1,
        },
        searchBox: {
          margin: 16,
          borderRadius: 12,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderWidth: 1,
          backgroundColor: TOK.INPUT_BG,
          borderColor: TOK.INPUT_BORDER,
          color: TOK.INPUT_TEXT,
          fontSize: 16,
        },
        userItem: {
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: TOK.OUTLINE,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
        userName: { color: TOK.TEXT, fontSize: 16 },
        userRole: { color: TOK.SUBTEXT, fontSize: 13 },
        checkBadge: {
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 12,
          backgroundColor: TOK.SURFACE,
          borderWidth: 1,
          borderColor: TOK.OUTLINE,
        },
        checkText: { color: TOK.TEXT, fontWeight: '600' },
      }),
    [TOK, insets.top],
  );


  // ---- Unified components (local) ----
  const Button = ({ title, onPress, style, textStyle, disabled, hitSlop }) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={hitSlop}
      style={({ pressed }) => [style, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
    >
      <Text style={textStyle}>{title}</Text>
    </Pressable>
  );

  const TextField = ({
    label,
    placeholder,
    value,
    onChangeText,
    multiline = false,
    keyboardType,
    secureTextEntry,
    returnKeyType,
    style,
  }) => (
    <View>
      {!!label && (
        <Text style={{ fontWeight: '500', marginBottom: 4, color: TOK.TEXT }}>{label}</Text>
      )}
      <RNTextInput
        style={[
          {
            borderRadius: 12,
            borderWidth: 1,
            borderColor: TOK.INPUT_BORDER,
            backgroundColor: TOK.INPUT_BG,
            color: TOK.INPUT_TEXT,
            paddingHorizontal: 12,
            paddingVertical: 10,
            fontSize: 16,
          },
          multiline && { height: 100 },
          style,
        ]}
        placeholder={placeholder || label}
        placeholderTextColor={TOK.PLACEHOLDER}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        returnKeyType={returnKeyType}
      />
    </View>
  );

  // ---------- Load profile ----------
  const loadMe = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user?.id) {
      setMe(null);
      setRole(null);
      return;
    }
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
    if (!isManager || !me?.company_id) {
      setUsers([]);
      return;
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('company_id', me.company_id)
      .order('full_name', { ascending: true });
    if (error) throw error;
    const rows = data || [];
    setUsers([{ id: 'ALL', full_name: 'Все сотрудники', role: 'all' }, ...rows]);
  }, [isManager, me?.company_id]);

  // ---------- Period range ----------
  const periodRange = useMemo(() => {
    const now = new Date();
    if (period === '30d') return { from: addDays(now, -30), to: endOfDay(now) };
    if (period === 'ytd') return { from: startOfYear(now), to: endOfDay(now) };
    if (period === 'custom') {
      return {
        from: customFrom ? startOfDay(customFrom) : null,
        to: customTo ? endOfDay(customTo) : null,
      };
    }
    return { from: null, to: endOfDay(now) };
  }, [period, customFrom, customTo]);

  const companyUserIds = useMemo(
    () => users.filter((u) => u.id !== 'ALL').map((u) => u.id),
    [users],
  );
  const isAllSelected = selectedUserId === 'ALL';

  // ---------- Load orders / payouts ----------
  const [orders, setOrders] = useState([]);

  
  // Finance totals from RPC
  const [finance, setFinance] = useState({ total_price: 0, total_fuel_cost: 0, net_income: 0 });
  const [financeByStatus, setFinanceByStatus] = useState([]);
  const loadOrders = useCallback(async () => {
    if (!selectedUserId && !isAllSelected) {
      setOrders([]);
      return;
    }

const buildQuery = (table) => {
      let q = supabase
        .from(table)
        .select(
          table === 'order_payouts'
            ? 'order_id, assigned_to, status, datetime, payout, fuel_cost, fuel_reimbursable'
            : 'id, assigned_to, status, datetime',
        )
        .order('datetime', { ascending: false });

      if (isAllSelected) {
        if (companyUserIds.length === 0) return { skip: true, q: null };
        q = q.in('assigned_to', companyUserIds);
      } else {
        q = q.eq('assigned_to', selectedUserId);
      }

      if (periodRange.from) q = q.gte('datetime', iso(periodRange.from));
      if (periodRange.to) q = q.lte('datetime', iso(periodRange.to));
      return { skip: false, q };
    };

    // 1) Пытаемся сразу через view с выплатами (лучше для метрик денег)
    const v = buildQuery('order_payouts');
    if (!v?.skip && v?.q) {
      const { data: vData, error: vErr } = await v.q;
      if (!vErr && Array.isArray(vData)) {
        setOrders(vData);
        return;
      }
    }

    // 2) Фолбэк на прямой доступ к orders (если RLS режет view или она отсутствует)
    const t = buildQuery('orders');
    if (!t?.skip && t?.q) {
      const { data: oData } = await t.q;
      const mapped = (oData || []).map((o) => ({
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

    setOrders([]);
  
  }, [selectedUserId, isAllSelected, companyUserIds, periodRange.from, periodRange.to]);

  
  // ---------- Load finance stats via RPC ----------
  const loadFinance = useCallback(async () => {
    const fromIso = periodRange.from ? iso(periodRange.from) : null;
    const toIso = periodRange.to ? iso(periodRange.to) : null;
    const p_executor = (isManager && !isAllSelected && selectedUserId) ? selectedUserId : null;
    const { data, error } = await supabase.rpc('get_finance_stats', {
      p_from: fromIso,
      p_to: toIso,
      p_executor
    });
    if (!error && Array.isArray(data)) {
      const allRow = data.find(r => r.bucket === 'ALL') || { total_price: 0, total_fuel_cost: 0, net_income: 0 };
      setFinance({
        total_price: Number(allRow.total_price) || 0,
        total_fuel_cost: Number(allRow.total_fuel_cost) || 0,
        net_income: Number(allRow.net_income) || 0,
      });
      const rows = data.filter(r => r.bucket && r.bucket !== 'ALL').map(r => ({
        bucket: r.bucket,
        total_price: Number(r.total_price) || 0,
        total_fuel_cost: Number(r.total_fuel_cost) || 0,
        net_income: Number(r.net_income) || 0,
      }));
      setFinanceByStatus(rows);
    } else {
      setFinance({ total_price: 0, total_fuel_cost: 0, net_income: 0 });
      setFinanceByStatus([]);
    }
  }, [periodRange.from, periodRange.to, isManager, isAllSelected, selectedUserId]);

// ---------- Initial load ----------
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      await loadMe();
    } finally {
      setLoading(false);
    }
  }, [loadMe]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        if (!me) return;
        if (isManager) await loadUsers();
        await loadOrders();
      })();
    }, [me, isManager, selectedUserId, period, customFrom, customTo, loadUsers, loadOrders]),
  );

  
  // also load finance after focus
  useFocusEffect(
    useCallback(() => {
      (async () => {
        await loadFinance();
      })();
    }, [loadFinance]),
  );
const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadOrders();
      if (isManager) await loadUsers();
    
      await loadFinance();
    } finally {
      setRefreshing(false);
    }
  }, [loadOrders, isManager, loadUsers]);

  // ---------- Derived ----------
  const computed = useMemo(() => {
    const list = orders || [];
    const totals = {
      all: list.length,
      new: list.filter((r) => r.status === 'Новый').length,
      inProgress: list.filter((r) => r.status === 'В работе').length,
      done: list.filter((r) => r.status === 'Завершённая').length,
    };
    const now = new Date();
    const in7 = addDays(now, 7);
    const upcoming = list
      .filter(
        (r) =>
          r.datetime &&
          new Date(r.datetime) >= now &&
          new Date(r.datetime) <= in7 &&
          r.status !== 'Завершённая',
      )
      .sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
      .slice(0, 6);

    // Денежные метрики (работают, если пришли поля из view)
    const money = list.reduce(
      (acc, r) => {
        const payout = Number(r.payout) || 0;
        const fuelCost = Number(r.fuel_cost) || 0;
        const reimb =
          r?.fuel_reimbursable === true ||
          r?.fuel_reimbursable === 't' ||
          r?.fuel_reimbursable === 1;
        acc.payout += payout;
        if (reimb) acc.fuel += fuelCost;
        acc.net = acc.payout - acc.fuel;
        return acc;
      },
      { payout: 0, fuel: 0, net: 0 },
    );

    return { totals, upcoming, money };
  }, [orders]);

  const performance = useMemo(() => {
    const list = orders || [];
    const done = list.filter(r => r.status === 'Завершённая');
    const inProgress = list.filter(r => r.status === 'В работе');
    const fresh = list.filter(r => r.status === 'Новый');

    let days = 1;
    if (period === 'custom' && customFrom && customTo) {
      const ms = Math.abs(endOfDay(customTo).getTime() - startOfDay(customFrom).getTime());
      days = Math.max(1, Math.ceil(ms / (24*60*60*1000)));
    } else if (period === '30d') {
      days = 30;
    } else if (period === 'ytd') {
      const now = new Date();
      const start = startOfYear(now);
      const ms = endOfDay(now).getTime() - start.getTime();
      days = Math.max(1, Math.ceil(ms / (24*60*60*1000)));
    }

    const avgPerDay = list.length / days;
    const totalDone = done.length || 0;
    const totalAll = list.length || 0;
    const completion = totalAll ? (totalDone / totalAll) : 0;
    const inWorkRate = totalAll ? (inProgress.length / totalAll) : 0;
    const newRate = totalAll ? (fresh.length / totalAll) : 0;

    const totalNet = list.reduce((acc, r) => {
      const payout = Number(r.payout) || 0;
      const fuel = (r?.fuel_reimbursable === true || r?.fuel_reimbursable === 't' || r?.fuel_reimbursable === 1) ? (Number(r.fuel_cost) || 0) : 0;
      return acc + (payout - fuel);
    }, 0);
    const avgPayoutPerDone = totalDone ? (totalNet / totalDone) : 0;

    return { days, avgPerDay, completion, inWorkRate, newRate, avgPayoutPerDone };
  }, [orders, period, customFrom, customTo]);

  const topPerformers = useMemo(() => {
    if (!Array.isArray(orders) || orders.length === 0) return [];
    const map = new Map();
    orders.forEach(o => {
      const uid = o.assigned_to || 'unknown';
      map.set(uid, (map.get(uid) || 0) + 1);
    });
    const nameById = new Map();
    (users || []).forEach(u => { if (u.id && u.id !== 'ALL') nameById.set(u.id, u.full_name || u.id); });
    return Array.from(map.entries())
      .map(([uid, count]) => ({ id: String(uid), name: nameById.get(uid) || uid, count }))
      .sort((a,b) => b.count - a.count)
      .slice(0, 3);
  }, [orders, users]);



  const selectedPeriodLabel = useMemo(() => {
    if (period === 'custom') return `${fmt(customFrom)} → ${fmt(customTo)}`;
    return PERIODS.find((p) => p.key === period)?.label || '—';
  }, [period, customFrom, customTo]);

  const filteredUsers = useMemo(() => {
    const list = users;
    const q = (usersSearch || '').trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (u) =>
        (u.full_name || '').toLowerCase().includes(q) || (u.role || '').toLowerCase().includes(q),
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
    // Открываем модалку без автоподстановки сегодняшнего дня.
    // Если ранее выбран кастомный диапазон — предзаполняем его, иначе оставляем пусто.
    setRangeStart(customFrom ? toISODate(customFrom) : null);
    setRangeEnd(customTo ? toISODate(customTo) : null);
    setCustomModalOpen(true);
  };
  const closeCustom = () => setCustomModalOpen(false);
  const resetCustom = () => {
    setRangeStart(null);
    setRangeEnd(null);
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
    const picked = day.dateString > todayIso ? todayIso : day.dateString; // запрет будущих дат

    // 1) Если начало диапазона не выбрано — устанавливаем только "С"
    if (!rangeStart) {
      setRangeStart(picked);
      setRangeEnd(null);
      return;
    }

    // 2) Если выбрано только "С" — второй тап задаёт "По"
    if (rangeStart && !rangeEnd) {
      if (picked < rangeStart) {
        // если ткнули раньше — меняем местами
        setRangeEnd(rangeStart);
        setRangeStart(picked);
      } else {
        setRangeEnd(picked);
      }
      return;
    }

    // 3) Если диапазон уже заполнен (есть "С" и "По") — начинаем заново с нового "С"
    setRangeStart(picked);
    setRangeEnd(null);
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
    ? selectedUser?.full_name || 'Выберите пользователя'
    : me?.full_name || 'Я';

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
                <Text style={styles.pickerHint}>
                  Нажми, чтобы выбрать пользователя или “Все сотрудники”
                </Text>
              </View>
              <Ionicons name="chevron-down" size={18} color={TOK.SUBTEXT} />
            </Pressable>
          </View>
        )}

        {/* Period chips */}
        <View style={styles.chipRow}>
          {PERIODS.map((p) => {
            const active = p.key === period;
            const isCustom = p.key === 'custom';
            return (
              <Button
                key={p.key}
                onPress={() => (isCustom ? openCustom() : setPeriod(p.key))}
                style={[styles.chip, active && styles.chipActive]}
                hitSlop={HIT}
                textStyle={[styles.chipText, active && styles.chipTextActive]}
                title={isCustom && period === 'custom' ? `${fmt(customFrom)} → ${fmt(customTo)}` : p.label}
              />
            );
          })}
        </View>

        {/* Summary: заявки */}
        <View style={styles.section}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Заявки ·{' '}
              {period === 'custom'
                ? `${fmt(customFrom)} → ${fmt(customTo)}`
                : PERIODS.find((p) => p.key === period)?.label || '—'}
            </Text>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>Всего</Text>
              <Text style={styles.metricValue}>{computed.totals.all}</Text>
            </View>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>Новые</Text>
              <Text style={styles.metricValue}>{computed.totals.new}</Text>
            </View>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>В работе</Text>
              <Text style={styles.metricValue}>{computed.totals.inProgress}</Text>
            </View>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>Завершённые</Text>
              <Text style={styles.metricValue}>{computed.totals.done}</Text>
            </View>
          </View>
        </View>

        {/* Summary: финансы */}
        <View style={styles.section}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Финансы · {isManager ? headerName : 'Вы'} ·{' '}
              {period === 'custom'
                ? `${fmt(customFrom)} → ${fmt(customTo)}`
                : PERIODS.find((p) => p.key === period)?.label || '—'}
            </Text>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>Начислено</Text>
              <Text style={styles.metricValue}>{fRUB(finance.total_price || computed.money.payout)}</Text>
            </View>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>Возмещение топлива</Text>
              <Text style={styles.metricValue}>{fRUB(finance.total_fuel_cost || computed.money.fuel)}</Text>
            </View>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>К выплате</Text>
              <Text style={styles.metricValue}>{fRUB(finance.net_income || (computed.money.payout - computed.money.fuel))}</Text>
            </View>
            {(finance.total_price === 0 && computed.money.payout === 0) && (
              <Text style={{ color: TOK.SUBTEXT, marginTop: 8 }}>
                Нет данных по выплатам за выбранный период или нет доступа к представлению
                <Text style={{ fontWeight: '700' }}> order_payouts</Text>.
              </Text>
            )}
          </View>
        </View>

      {/* Разрез по статусам */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Разрез по статусам</Text>
        {
          (financeByStatus && financeByStatus.length > 0) ? (
            <View style={{ gap: 10 }}>
              {financeByStatus.map((row, idx) => (
                <View key={idx} style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.metricLabel}>{row.bucket}</Text>
                  </View>
                  <View style={{ flex: 2, alignItems: 'flex-end' }}>
                    <Text style={styles.metricTiny}>Стоимость: {fRUB(row.total_price)}</Text>
                    <Text style={styles.metricTiny}>ГСМ: {fRUB(row.total_fuel_cost)}</Text>
                    <Text style={styles.metricTiny}>Итого: {fRUB(row.net_income)}</Text>
                  </View>
                </View>
              ))}
              <View style={styles.separator} />
              <View style={styles.rowBetween}>
                <Text style={styles.metricLabel}>Итого</Text>
                <Text style={styles.metricValue}>{fRUB(finance.net_income || 0)}</Text>
              </View>
            </View>
          ) : (
            <Text style={styles.muted}>Нет данных за выбранный период</Text>
          )
        }

      </View>

      {/* Показатели */}
      <View style={styles.section}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Показатели</Text>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Среднее заявок в день</Text>
            <Text style={styles.metricValue}>{performance.avgPerDay.toFixed(2)}</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Завершено, %</Text>
            <Text style={styles.metricValue}>{Math.round(performance.completion * 100)}%</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>В работе, %</Text>
            <Text style={styles.metricValue}>{Math.round(performance.inWorkRate * 100)}%</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Новые, %</Text>
            <Text style={styles.metricValue}>{Math.round(performance.newRate * 100)}%</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Средняя выплата / завершённую</Text>
            <Text style={styles.metricValue}>{fRUB(performance.avgPayoutPerDone)}</Text>
          </View>
        </View>
      </View>

      {/* Топ исполнителей (для менеджеров и при выборе «Все сотрудники») */}
      {isManager && isAllSelected && topPerformers.length > 0 && (
        <View style={styles.section}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Топ исполнителей</Text>
            {topPerformers.map((row) => (
              <View key={row.id} style={styles.rowBetween}>
                <Text style={styles.metricLabel}>{row.name}</Text>
                <Text style={styles.metricValue}>{row.count}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

        {/* Upcoming */}
        <View style={styles.section}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Ближайшие выезды · 7 дней</Text>
            {computed.upcoming.length > 0 ? (
              computed.upcoming.map((o) => (
                <View
                  key={o.order_id}
                  style={{
                    paddingVertical: 10,
                    borderBottomColor: TOK.OUTLINE,
                    borderBottomWidth: 1,
                  }}
                >
                  <View style={styles.metricRow}>
                    <Text style={{ color: TOK.isDark ? '#E5E5EA' : '#333' }}>{o.status}</Text>
                    <Text style={{ color: TOK.isDark ? '#FFFFFF' : '#333', fontWeight: '600' }}>
                      {o.datetime
                        ? new Date(o.datetime).toLocaleString('ru-RU', {
                            day: '2-digit',
                            month: '2-digit',
                            year: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </Text>
                  </View>
                </View>
              ))
            ) : (
              <Text style={{ color: TOK.SUBTEXT, marginTop: 8 }}>
                Нет выездов в ближайшие 7 дней
              </Text>
            )}
          </View>
        </View>

        <View style={styles.footerSpace} />
      </ScrollView>

      {/* Custom Period Modal */}
      <Modal
        visible={customModalOpen}
        animationType="slide"
        onRequestClose={closeCustom}
        transparent={false}
      >
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeaderRow}>
            <Text style={styles.appBarTitle}>Выбор периода</Text>
            <Button onPress={closeCustom} style={styles.modalClose} hitSlop={HIT} textStyle={styles.modalCloseText} title="Закрыть" />
          </View>

          <View style={styles.cBlock}>
            <Text style={styles.cLabel}>Диапазон</Text>
            <Text style={[styles.cDate, { marginTop: 6 }]}>
              {rangeStart && rangeEnd
                ? `${fmt(fromISODate(rangeStart))} → ${fmt(fromISODate(rangeEnd))}`
                : '—'}
            </Text>

            <View
              style={{
                marginTop: 12,
                borderRadius: 16,
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: TOK.OUTLINE,
              }}
            >
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
            <Button
              onPress={applyCustom}
              style={[styles.btnPrimary, !(rangeStart && rangeEnd) && styles.disabled]}
              disabled={!(rangeStart && rangeEnd)}
              textStyle={styles.btnTextPrimary}
              title="Применить"
            />
            <Button onPress={resetCustom} style={styles.btnGhost} textStyle={styles.btnTextGhost} title="Сбросить" />
            <Button onPress={closeCustom} style={styles.btnGhost} textStyle={styles.btnTextGhost} title="Отмена" />
          </View>
        </SafeAreaView>
      </Modal>

      {/* User Picker Modal */}
      {isManager && (
        <Modal
          visible={userPickerOpen}
          animationType="slide"
          onRequestClose={() => setUserPickerOpen(false)}
          transparent={false}
        >
          <SafeAreaView style={styles.modal}>
            <View style={styles.upHeaderRow}>
              <Text style={styles.appBarTitle}>Сотрудники</Text>
              <Button
                onPress={() => setUserPickerOpen(false)}
                style={styles.modalClose}
                hitSlop={HIT}
                textStyle={styles.modalCloseText}
                title="Закрыть"
              />
            </View>

            <TextField
              label={null}
              value={usersSearch}
              onChangeText={setUsersSearch}
              placeholder="Поиск по имени или роли"
              style={styles.searchBox}
              returnKeyType="search"
            />

            <FlatList
              data={filteredUsers}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => {
                const active = selectedUserId === item.id;
                return (
                  <Pressable onPress={() => selectUser(item)} style={styles.userItem}>
                    <View>
                      <Text style={styles.userName}>{item.full_name}</Text>
                      <Text style={styles.userRole}>{item.role}</Text>
                    </View>
                    {active ? (
                      <View style={styles.checkBadge}>
                        <Text style={styles.checkText}>Выбрано</Text>
                      </View>
                    ) : (
                      <Ionicons name="chevron-forward" size={18} color={TOK.SUBTEXT} />
                    )}
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <Text style={{ color: TOK.SUBTEXT, padding: 16 }}>Ничего не найдено</Text>
              }
            />
          </SafeAreaView>
        </Modal>
      )}
    </SafeAreaView>
  );
}
