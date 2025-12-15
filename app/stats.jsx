// app/stats.jsx
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Modal,
  RefreshControl,
  TextInput as RNTextInput,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { Calendar } from 'react-native-calendars';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import AppHeader from '../components/navigation/AppHeader';
import { useCompanySettings } from '../hooks/useCompanySettings';
import { formatCurrencyWithOptions } from '../lib/currency';
import { supabase } from '../lib/supabase';
import { useTheme } from '../theme/ThemeProvider';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ------- Periods -------
const PERIODS = [
  { key: '7d', label: '7д', days: 7 },
  { key: '30d', label: '30д', days: 30 },
  { key: '90d', label: '90д', days: 90 },
  { key: 'ytd', label: 'Год', days: null },
  { key: 'all', label: 'Все', days: null },
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
  d ? d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
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

// currency-aware formatter will be created inside component (needs hooks)

const formatNumber = (n) => new Intl.NumberFormat('ru-RU').format(n);

export default function StatsScreen() {
  const { theme, mode } = useTheme();
  const insets = useSafeAreaInsets();

  // company settings hook must be used inside component body
  const { settings: companySettings } = useCompanySettings();

  // currency-aware formatter (uses company currency when available)
  const fRUB = (n) => {
    const cur = companySettings?.currency || 'RUB';
    return formatCurrencyWithOptions(Math.round(Number(n || 0)), cur, 'ru-RU', {
      maximumFractionDigits: 0,
    });
  };

  const TOK = React.useMemo(
    () => ({
      isDark: mode === 'dark' || theme.mode === 'dark',
      PRIMARY: theme.colors.accent,
      PRIMARY_LIGHT: theme.colors.accent + '20',
      BG: theme.colors.bg,
      SURFACE: theme.colors.card,
      CARD_BORDER: theme.colors.border,
      TEXT: theme.colors.text,
      SUBTEXT: theme.text?.muted?.color || '#6B7280',
      OUTLINE: theme.colors.border,
      SUCCESS: '#10B981',
      WARNING: '#F59E0B',
      ERROR: '#EF4444',
      INFO: '#3B82F6',
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
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [rangeStart, setRangeStart] = useState(null);
  const [rangeEnd, setRangeEnd] = useState(null);

  const isAdmin = role === 'admin';
  const isDispatcher = role === 'dispatcher';
  const isManager = isAdmin || isDispatcher;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: TOK.BG },
        scrollContent: { paddingBottom: 28 },

        // Header
        header: {
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: 16,
        },
        headerTitle: {
          fontSize: 28,
          fontWeight: '700',
          color: TOK.TEXT,
          marginBottom: 4,
        },
        headerSubtitle: {
          fontSize: 16,
          color: TOK.SUBTEXT,
        },

        // Quick Stats
        quickStats: {
          paddingHorizontal: 20,
          marginBottom: 16,
        },
        statsGrid: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 12,
        },
        statCard: {
          width: (SCREEN_WIDTH - 52) / 2,
          backgroundColor: TOK.SURFACE,
          borderRadius: 16,
          padding: 16,
          borderWidth: 1,
          borderColor: TOK.CARD_BORDER,
        },
        statValue: {
          fontSize: 24,
          fontWeight: '700',
          color: TOK.TEXT,
          marginBottom: 4,
        },
        statLabel: {
          fontSize: 14,
          color: TOK.SUBTEXT,
        },
        statTrend: {
          fontSize: 12,
          marginTop: 4,
        },

        // Filters
        filters: {
          paddingHorizontal: 20,
          marginBottom: 20,
        },
        filterRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        },
        periodSelector: {
          flexDirection: 'row',
          backgroundColor: TOK.SURFACE,
          borderRadius: 12,
          padding: 4,
          borderWidth: 1,
          borderColor: TOK.OUTLINE,
        },
        periodButton: {
          paddingHorizontal: 16,
          paddingVertical: 8,
          borderRadius: 8,
        },
        periodButtonActive: {
          backgroundColor: TOK.PRIMARY,
        },
        periodText: {
          fontSize: 14,
          fontWeight: '600',
          color: TOK.SUBTEXT,
        },
        periodTextActive: {
          color: '#FFFFFF',
        },
        userSelector: {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: TOK.SURFACE,
          padding: 12,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: TOK.OUTLINE,
        },
        userText: {
          flex: 1,
          fontSize: 16,
          color: TOK.TEXT,
          marginLeft: 8,
        },

        // Charts & Details
        section: {
          marginBottom: 20,
          paddingHorizontal: 20,
        },
        sectionTitle: {
          fontSize: 20,
          fontWeight: '700',
          color: TOK.TEXT,
          marginBottom: 16,
        },
        chartCard: {
          backgroundColor: TOK.SURFACE,
          borderRadius: 16,
          padding: 20,
          borderWidth: 1,
          borderColor: TOK.CARD_BORDER,
        },

        // Status Breakdown
        statusItem: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: TOK.OUTLINE + '30',
        },
        statusLeft: {
          flexDirection: 'row',
          alignItems: 'center',
          flex: 1,
        },
        statusDot: {
          width: 8,
          height: 8,
          borderRadius: 4,
          marginRight: 12,
        },
        statusName: {
          fontSize: 16,
          color: TOK.TEXT,
          flex: 1,
        },
        statusStats: {
          alignItems: 'flex-end',
        },
        statusCount: {
          fontSize: 16,
          fontWeight: '600',
          color: TOK.TEXT,
        },
        statusAmount: {
          fontSize: 14,
          color: TOK.SUBTEXT,
          marginTop: 2,
        },

        // Performance Metrics
        metricGrid: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 12,
        },
        metricCard: {
          width: (SCREEN_WIDTH - 52) / 2,
          backgroundColor: TOK.SURFACE,
          borderRadius: 12,
          padding: 16,
          borderWidth: 1,
          borderColor: TOK.CARD_BORDER,
        },
        metricValue: {
          fontSize: 18,
          fontWeight: '700',
          color: TOK.TEXT,
          marginBottom: 4,
        },
        metricLabel: {
          fontSize: 13,
          color: TOK.SUBTEXT,
        },

        // Modals
        modal: {
          flex: 1,
          backgroundColor: TOK.BG,
          paddingTop: insets.top,
        },
        modalHeader: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 20,
          paddingVertical: 16,
          borderBottomWidth: 1,
          borderBottomColor: TOK.OUTLINE,
        },
        modalTitle: {
          fontSize: 20,
          fontWeight: '700',
          color: TOK.TEXT,
        },
        closeButton: {
          padding: 8,
        },
        searchInput: {
          margin: 20,
          borderRadius: 12,
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderWidth: 1,
          backgroundColor: TOK.SURFACE,
          borderColor: TOK.OUTLINE,
          color: TOK.TEXT,
          fontSize: 16,
        },
        userItem: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 20,
          paddingVertical: 16,
          borderBottomWidth: 1,
          borderBottomColor: TOK.OUTLINE + '30',
        },
        userInfo: {
          flex: 1,
          marginLeft: 12,
        },
        userName: {
          fontSize: 16,
          color: TOK.TEXT,
          marginBottom: 2,
        },
        userRole: {
          fontSize: 14,
          color: TOK.SUBTEXT,
        },
        selectedIndicator: {
          width: 24,
          height: 24,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: TOK.PRIMARY,
          justifyContent: 'center',
          alignItems: 'center',
        },
        selectedDot: {
          width: 12,
          height: 12,
          borderRadius: 6,
          backgroundColor: TOK.PRIMARY,
        },

        // Calendar
        calendarContainer: {
          margin: 20,
          borderRadius: 16,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: TOK.OUTLINE,
        },
        rangeDisplay: {
          padding: 20,
          backgroundColor: TOK.SURFACE,
          borderBottomWidth: 1,
          borderBottomColor: TOK.OUTLINE,
        },
        rangeText: {
          fontSize: 16,
          color: TOK.TEXT,
          textAlign: 'center',
        },
        modalActions: {
          flexDirection: 'row',
          padding: 20,
          gap: 12,
        },
        actionButton: {
          flex: 1,
          paddingVertical: 16,
          borderRadius: 12,
          alignItems: 'center',
        },
        primaryAction: {
          backgroundColor: TOK.PRIMARY,
        },
        secondaryAction: {
          backgroundColor: TOK.SURFACE,
          borderWidth: 1,
          borderColor: TOK.OUTLINE,
        },
        actionText: {
          fontSize: 16,
          fontWeight: '600',
        },
        primaryActionText: {
          color: '#FFFFFF',
        },
        secondaryActionText: {
          color: TOK.TEXT,
        },
        disabledAction: {
          opacity: 0.5,
        },

        // Empty State
        emptyState: {
          alignItems: 'center',
          padding: 40,
        },
        emptyText: {
          fontSize: 16,
          color: TOK.SUBTEXT,
          textAlign: 'center',
          marginTop: 12,
        },
      }),
    [TOK, insets.top],
  );

  // Load profile
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

  // Load users (for managers)
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

  // Period range calculation
  const periodRange = useMemo(() => {
    const now = new Date();
    const periodConfig = PERIODS.find((p) => p.key === period);

    if (period === 'custom' && rangeStart && rangeEnd) {
      return {
        from: startOfDay(fromISODate(rangeStart)),
        to: endOfDay(fromISODate(rangeEnd)),
      };
    }

    if (periodConfig?.days) {
      return { from: addDays(now, -periodConfig.days), to: endOfDay(now) };
    }

    if (period === 'ytd') {
      return { from: startOfYear(now), to: endOfDay(now) };
    }

    return { from: null, to: endOfDay(now) };
  }, [period, rangeStart, rangeEnd]);

  // Load statistics data
  const [stats, setStats] = useState({
    totalOrders: 0,
    completedOrders: 0,
    inProgressOrders: 0,
    newOrders: 0,
    totalRevenue: 0,
    totalCosts: 0,
    netProfit: 0,
    statusBreakdown: [],
    performance: {
      avgOrdersPerDay: 0,
      completionRate: 0,
      efficiency: 0,
      avgRevenuePerOrder: 0,
    },
  });

  const loadStats = useCallback(async () => {
    if (!selectedUserId) return;

    try {
      // Load orders data
      let query = supabase
        .from('orders')
        .select('id, status, time_window_start, fuel_cost, assigned_to')
        .order('time_window_start', { ascending: false });

      if (selectedUserId !== 'ALL') {
        query = query.eq('assigned_to', selectedUserId);
      }

      if (periodRange.from) {
        query = query.gte('time_window_start', iso(periodRange.from));
      }
      if (periodRange.to) {
        query = query.lte('time_window_start', iso(periodRange.to));
      }

      const { data: orders, error } = await query;
      if (error) throw error;

      // Calculate statistics
      const totalOrders = orders?.length || 0;
      const completedOrders = orders?.filter((o) => o.status === 'Завершённая').length || 0;
      const inProgressOrders = orders?.filter((o) => o.status === 'В работе').length || 0;
      const newOrders = orders?.filter((o) => o.status === 'Новый').length || 0;

      const getRevenue = (o) =>
        Number(
          o.total_price ?? o.total ?? o.total_amount ?? o.amount_total ?? o.amount ?? o.price ?? 0,
        );
      const totalRevenue = orders?.reduce((sum, o) => sum + getRevenue(o), 0) || 0;
      const totalCosts = orders?.reduce((sum, o) => sum + (Number(o.fuel_cost) || 0), 0) || 0;
      const netProfit = totalRevenue - totalCosts;

      // Status breakdown
      const statusBreakdown = [
        { status: 'Завершённая', count: completedOrders, color: TOK.SUCCESS, amount: totalRevenue },
        { status: 'В работе', count: inProgressOrders, color: TOK.WARNING, amount: 0 },
        { status: 'Новый', count: newOrders, color: TOK.INFO, amount: 0 },
      ].filter((item) => item.count > 0);

      // Performance metrics
      const days =
        period === 'custom' && periodRange.from && periodRange.to
          ? Math.max(1, Math.ceil((periodRange.to - periodRange.from) / (24 * 60 * 60 * 1000)))
          : PERIODS.find((p) => p.key === period)?.days || 365;

      const avgOrdersPerDay = totalOrders / days;
      const completionRate = totalOrders > 0 ? completedOrders / totalOrders : 0;
      const avgRevenuePerOrder = completedOrders > 0 ? totalRevenue / completedOrders : 0;

      setStats({
        totalOrders,
        completedOrders,
        inProgressOrders,
        newOrders,
        totalRevenue,
        totalCosts,
        netProfit,
        statusBreakdown,
        performance: {
          avgOrdersPerDay,
          completionRate,
          efficiency: completionRate * 100,
          avgRevenuePerOrder,
        },
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  }, [selectedUserId, periodRange, period, TOK]);

  // Initial load
  useEffect(() => {
    const initialize = async () => {
      setLoading(true);
      try {
        await loadMe();
      } finally {
        setLoading(false);
      }
    };
    initialize();
  }, []);

  // Reload when dependencies change
  useFocusEffect(
    useCallback(() => {
      if (me) {
        if (isManager) loadUsers();
        loadStats();
      }
    }, [me, isManager, selectedUserId, periodRange]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadStats();
      if (isManager) await loadUsers();
    } finally {
      setRefreshing(false);
    }
  }, [loadStats, isManager, loadUsers]);

  // User selection
  const openUserPicker = () => setUserPickerOpen(true);
  const closeUserPicker = () => setUserPickerOpen(false);
  const selectUser = (user) => {
    setSelectedUserId(user.id);
    setSelectedUser(user.id === 'ALL' ? { full_name: 'Все сотрудники', role: 'all' } : user);
    closeUserPicker();
  };

  // Custom period handling
  const openCustomPeriod = () => {
    setCustomModalOpen(true);
  };

  const closeCustomPeriod = () => {
    setCustomModalOpen(false);
    setRangeStart(null);
    setRangeEnd(null);
  };

  const applyCustomPeriod = () => {
    if (rangeStart && rangeEnd) {
      setPeriod('custom');
      setCustomModalOpen(false);
    }
  };

  const onDayPress = (day) => {
    const todayIso = toISODate(new Date());
    const picked = day.dateString > todayIso ? todayIso : day.dateString;

    if (!rangeStart) {
      setRangeStart(picked);
      setRangeEnd(null);
    } else if (rangeStart && !rangeEnd) {
      if (picked < rangeStart) {
        setRangeEnd(rangeStart);
        setRangeStart(picked);
      } else {
        setRangeEnd(picked);
      }
    } else {
      setRangeStart(picked);
      setRangeEnd(null);
    }
  };

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
        textColor: '#FFFFFF',
      };
    }
    return marks;
  }, [rangeStart, rangeEnd, TOK.PRIMARY]);

  const filteredUsers = useMemo(() => {
    const q = (usersSearch || '').trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        (u.full_name || '').toLowerCase().includes(q) || (u.role || '').toLowerCase().includes(q),
    );
  }, [users, usersSearch]);

  const displayName = isManager
    ? selectedUser?.full_name || 'Выберите сотрудника'
    : me?.full_name || 'Моя статистика';

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={TOK.PRIMARY} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AppHeader options={{ title: 'Статистика' }} back />

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Статистика</Text>
          <Text style={styles.headerSubtitle}>{displayName}</Text>
        </View>

        {/* Quick Stats */}
        <View style={styles.quickStats}>
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{formatNumber(stats.totalOrders)}</Text>
              <Text style={styles.statLabel}>Всего заявок</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{formatNumber(stats.completedOrders)}</Text>
              <Text style={styles.statLabel}>Завершено</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: TOK.SUCCESS }]}>
                {fRUB(stats.netProfit)}
              </Text>
              <Text style={styles.statLabel}>Чистая прибыль</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{stats.performance.avgOrdersPerDay.toFixed(1)}</Text>
              <Text style={styles.statLabel}>В день</Text>
            </View>
          </View>
        </View>

        {/* Filters */}
        <View style={styles.filters}>
          <View style={styles.filterRow}>
            <View style={styles.periodSelector}>
              {PERIODS.map((p) => (
                <TouchableOpacity
                  key={p.key}
                  style={[styles.periodButton, period === p.key && styles.periodButtonActive]}
                  onPress={() => setPeriod(p.key)}
                >
                  <Text style={[styles.periodText, period === p.key && styles.periodTextActive]}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {period === 'custom' && (
              <TouchableOpacity onPress={openCustomPeriod}>
                <Ionicons name="calendar" size={24} color={TOK.PRIMARY} />
              </TouchableOpacity>
            )}
          </View>

          {isManager && (
            <TouchableOpacity style={styles.userSelector} onPress={openUserPicker}>
              <Ionicons name="people" size={20} color={TOK.SUBTEXT} />
              <Text style={styles.userText} numberOfLines={1}>
                {selectedUser?.full_name || 'Выберите сотрудника'}
              </Text>
              <Ionicons name="chevron-down" size={16} color={TOK.SUBTEXT} />
            </TouchableOpacity>
          )}
        </View>

        {/* Status Breakdown */}
        {stats.statusBreakdown.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>По статусам</Text>
            <View style={styles.chartCard}>
              {stats.statusBreakdown.map((item, index) => (
                <View key={item.status} style={styles.statusItem}>
                  <View style={styles.statusLeft}>
                    <View style={[styles.statusDot, { backgroundColor: item.color }]} />
                    <Text style={styles.statusName}>{item.status}</Text>
                  </View>
                  <View style={styles.statusStats}>
                    <Text style={styles.statusCount}>{formatNumber(item.count)}</Text>
                    {item.amount > 0 && (
                      <Text style={styles.statusAmount}>{fRUB(item.amount)}</Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Performance Metrics */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Эффективность</Text>
          <View style={styles.metricGrid}>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>
                {(stats.performance.completionRate * 100).toFixed(0)}%
              </Text>
              <Text style={styles.metricLabel}>Выполнено</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>{fRUB(stats.performance.avgRevenuePerOrder)}</Text>
              <Text style={styles.metricLabel}>Средний чек</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>{formatNumber(stats.inProgressOrders)}</Text>
              <Text style={styles.metricLabel}>В работе</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>{formatNumber(stats.newOrders)}</Text>
              <Text style={styles.metricLabel}>Новые</Text>
            </View>
          </View>
        </View>

        {/* Financial Summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Финансы</Text>
          <View style={styles.chartCard}>
            <View style={styles.statusItem}>
              <Text style={styles.statusName}>Общий доход</Text>
              <Text style={styles.statusCount}>{fRUB(stats.totalRevenue)}</Text>
            </View>
            <View style={styles.statusItem}>
              <Text style={styles.statusName}>Расходы</Text>
              <Text style={styles.statusCount}>{fRUB(stats.totalCosts)}</Text>
            </View>
            <View style={[styles.statusItem, { borderBottomWidth: 0 }]}>
              <Text style={[styles.statusName, { fontWeight: '700' }]}>Чистая прибыль</Text>
              <Text style={[styles.statusCount, { color: TOK.SUCCESS }]}>
                {fRUB(stats.netProfit)}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* User Picker Modal */}
      <Modal visible={userPickerOpen} animationType="slide" onRequestClose={closeUserPicker}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Выбор сотрудника</Text>
            <TouchableOpacity style={styles.closeButton} onPress={closeUserPicker}>
              <Ionicons name="close" size={24} color={TOK.TEXT} />
            </TouchableOpacity>
          </View>

          <RNTextInput
            style={styles.searchInput}
            placeholder="Поиск по имени..."
            placeholderTextColor={TOK.SUBTEXT}
            value={usersSearch}
            onChangeText={setUsersSearch}
          />

          <FlatList
            data={filteredUsers}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.userItem} onPress={() => selectUser(item)}>
                <View
                  style={[
                    styles.selectedIndicator,
                    { borderColor: selectedUserId === item.id ? TOK.PRIMARY : TOK.OUTLINE },
                  ]}
                >
                  {selectedUserId === item.id && <View style={styles.selectedDot} />}
                </View>
                <View style={styles.userInfo}>
                  <Text style={styles.userName}>{item.full_name}</Text>
                  <Text style={styles.userRole}>{item.role}</Text>
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons name="search" size={48} color={TOK.SUBTEXT} />
                <Text style={styles.emptyText}>Сотрудники не найдены</Text>
              </View>
            }
          />
        </SafeAreaView>
      </Modal>

      {/* Custom Period Modal */}
      <Modal visible={customModalOpen} animationType="slide" onRequestClose={closeCustomPeriod}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Выбор периода</Text>
            <TouchableOpacity style={styles.closeButton} onPress={closeCustomPeriod}>
              <Ionicons name="close" size={24} color={TOK.TEXT} />
            </TouchableOpacity>
          </View>

          <View style={styles.rangeDisplay}>
            <Text style={styles.rangeText}>
              {rangeStart && rangeEnd
                ? `${fmt(fromISODate(rangeStart))} — ${fmt(fromISODate(rangeEnd))}`
                : 'Выберите диапазон дат'}
            </Text>
          </View>

          <View style={styles.calendarContainer}>
            <Calendar
              onDayPress={onDayPress}
              markedDates={markedDates}
              markingType="period"
              maxDate={toISODate(new Date())}
              theme={{
                backgroundColor: TOK.SURFACE,
                calendarBackground: TOK.SURFACE,
                textSectionTitleColor: TOK.SUBTEXT,
                dayTextColor: TOK.TEXT,
                monthTextColor: TOK.TEXT,
                arrowColor: TOK.PRIMARY,
                selectedDayBackgroundColor: TOK.PRIMARY,
                selectedDayTextColor: '#FFFFFF',
                todayTextColor: TOK.PRIMARY,
              }}
              firstDay={1}
              enableSwipeMonths
            />
          </View>

          <View style={styles.modalActions}>
            <TouchableOpacity
              style={[styles.actionButton, styles.secondaryAction]}
              onPress={closeCustomPeriod}
            >
              <Text style={[styles.actionText, styles.secondaryActionText]}>Отмена</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.actionButton,
                styles.primaryAction,
                !(rangeStart && rangeEnd) && styles.disabledAction,
              ]}
              onPress={applyCustomPeriod}
              disabled={!(rangeStart && rangeEnd)}
            >
              <Text style={[styles.actionText, styles.primaryActionText]}>Применить</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
