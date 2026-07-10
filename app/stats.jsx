// app/stats.jsx
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  TextInput as RNTextInput,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { Calendar } from 'react-native-calendars';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import AppHeader from '../components/navigation/AppHeader';
import {
  ThemedRefreshControl,
  useManagedRefresh,
  usePullToRefreshFeedback,
} from '../components/ui/PullToRefreshFeedback';
import AnimatedFullscreenModal from '../components/ui/modals/AnimatedFullscreenModal';
import { useCompanySettings } from '../hooks/useCompanySettings';
import { useCompanyOrderStatuses } from '../lib/orderStatuses';
import { usePermissions } from '../lib/permissions';
import { formatCurrencyWithOptions } from '../lib/currency';
import { getStatusDbAliases } from '../lib/orderFilters';
import { formatPersonName } from '../lib/personName';
import { supabase } from '../lib/supabase';
import { useTranslation } from '../src/i18n/useTranslation';
import { useScreenRefreshRegistration } from '../src/shared/query/screenRefreshRegistry';
import { useTheme } from '../theme/ThemeProvider';
import DeferredScreen from '../src/shared/perf/DeferredScreen';

// ------- Periods -------
const PERIODS = [
  { key: '7d', labelKey: 'stats_period_7d', days: 7 },
  { key: '30d', labelKey: 'stats_period_30d', days: 30 },
  { key: '90d', labelKey: 'stats_period_90d', days: 90 },
  { key: 'ytd', labelKey: 'stats_period_year', days: null },
  { key: 'custom', labelKey: 'stats_period_custom', days: null },
  { key: 'all', labelKey: 'stats_period_all', days: null },
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
const fmt = (d, locale) =>
  d ? d.toLocaleDateString(locale || undefined, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
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

const formatNumber = (n, locale) => new Intl.NumberFormat(locale || undefined).format(n);

function StatsScreenContent() {
  const { theme, mode } = useTheme();
  const { t, locale } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  // company settings hook must be used inside component body
  const { settings: companySettings } = useCompanySettings();
  const statusSystem = useCompanyOrderStatuses();

  // currency-aware formatter (uses company currency when available)
  const fRUB = (n) => {
    const cur = companySettings?.currency || 'RUB';
    return formatCurrencyWithOptions(Math.round(Number(n || 0)), cur, locale || undefined, {
      maximumFractionDigits: 0,
    });
  };

  const TOK = React.useMemo(
    () => ({
      isDark: mode === 'dark' || theme.mode === 'dark',
      PRIMARY: theme.colors.primary,
      PRIMARY_LIGHT: theme.colors.primary + '20',
      BG: theme.colors.background,
      SURFACE: theme.colors.surface,
      CARD_BORDER: theme.colors.border,
      TEXT: theme.colors.text,
      SUBTEXT: theme.colors.textSecondary,
      OUTLINE: theme.colors.border,
      SUCCESS: theme.colors.success,
      WARNING: theme.colors.warning,
      ERROR: theme.colors.danger,
      INFO: theme.colors.info || theme.colors.primary,
      ON_PRIMARY: theme.colors.onPrimary || theme.colors.primaryTextOn,
    }),
    [theme, mode],
  );
  const ui = React.useMemo(() => {
    const screenPadding = theme.spacing.lg;
    const cardGap = theme.spacing.md;
    const gridWidth = Math.max(0, screenWidth - screenPadding * 2 - cardGap);
    return {
      screenPadding,
      sectionGap: theme.spacing.lg,
      cardGap,
      cardWidth: Math.floor(gridWidth / 2),
      cardRadius: theme.radii.xl,
      controlRadius: theme.radii.lg,
      controlRadiusSm: theme.radii.sm,
      controlPaddingX: theme.spacing.md,
      controlPaddingY: theme.spacing.sm,
      cardPadding: theme.spacing.lg,
      smallGap: theme.spacing.xs,
      mediumGap: theme.spacing.md,
      bottomInset: theme.components?.scrollView?.paddingBottom ?? theme.spacing.xl,
      headerTitleSize: theme.typography.sizes.xxl,
      sectionTitleSize: theme.typography.sizes.lg,
      statValueSize: theme.typography.sizes.xl,
      metricValueSize: theme.typography.sizes.lg,
      bodySize: theme.typography.sizes.md,
      smallTextSize: theme.typography.sizes.sm,
      tinyTextSize: theme.typography.sizes.xs,
    };
  }, [screenWidth, theme]);

  const [loading, setLoading] = useState(true);

  const [me, setMe] = useState(null);
  const [role, setRole] = useState(null);

  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const [usersSearch, setUsersSearch] = useState('');

  const [selectedUserId, setSelectedUserId] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const { has } = usePermissions();

  const [period, setPeriod] = useState('30d');
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [rangeStart, setRangeStart] = useState(null);
  const [rangeEnd, setRangeEnd] = useState(null);

  const isAdmin = role === 'admin';
  const isDispatcher = role === 'dispatcher';
  const isManager = isAdmin || isDispatcher;
  const canViewFinanceStatsAll = has('canViewFinanceStatsAll');

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: TOK.BG },
        scrollContent: { paddingBottom: ui.bottomInset },

        // Header
        header: {
          paddingHorizontal: ui.screenPadding,
          paddingTop: theme.spacing.md,
          paddingBottom: ui.sectionGap,
        },
        headerTitle: {
          fontSize: ui.headerTitleSize,
          fontWeight: '700',
          color: TOK.TEXT,
          marginBottom: ui.smallGap,
        },
        headerSubtitle: {
          fontSize: ui.bodySize,
          color: TOK.SUBTEXT,
        },

        // Quick Stats
        quickStats: {
          paddingHorizontal: ui.screenPadding,
          marginBottom: ui.sectionGap,
        },
        statsGrid: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: ui.cardGap,
        },
        statCard: {
          width: ui.cardWidth,
          backgroundColor: TOK.SURFACE,
          borderRadius: ui.cardRadius,
          padding: ui.cardPadding,
          borderWidth: 1,
          borderColor: TOK.CARD_BORDER,
        },
        statValue: {
          fontSize: ui.statValueSize,
          fontWeight: '700',
          color: TOK.TEXT,
          marginBottom: ui.smallGap,
        },
        statLabel: {
          fontSize: ui.smallTextSize,
          color: TOK.SUBTEXT,
        },
        statTrend: {
          fontSize: ui.tinyTextSize,
          marginTop: ui.smallGap,
        },

        // Filters
        filters: {
          paddingHorizontal: ui.screenPadding,
          marginBottom: ui.sectionGap,
        },
        filterRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: ui.mediumGap,
        },
        periodSelector: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: ui.smallGap,
          backgroundColor: TOK.SURFACE,
          borderRadius: ui.controlRadius,
          padding: ui.smallGap,
          borderWidth: 1,
          borderColor: TOK.OUTLINE,
          flexShrink: 1,
          maxWidth: '100%',
        },
        periodButton: {
          paddingHorizontal: ui.controlPaddingX,
          paddingVertical: ui.controlPaddingY,
          borderRadius: ui.controlRadiusSm,
        },
        periodButtonActive: {
          backgroundColor: TOK.PRIMARY,
        },
        periodText: {
          fontSize: ui.smallTextSize,
          fontWeight: '600',
          color: TOK.SUBTEXT,
        },
        periodTextActive: {
          color: TOK.ON_PRIMARY,
        },
        userSelector: {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: TOK.SURFACE,
          padding: ui.mediumGap,
          borderRadius: ui.controlRadius,
          borderWidth: 1,
          borderColor: TOK.OUTLINE,
        },
        userText: {
          flex: 1,
          fontSize: ui.bodySize,
          color: TOK.TEXT,
          marginLeft: theme.spacing.sm,
        },

        // Charts & Details
        section: {
          marginBottom: ui.sectionGap,
          paddingHorizontal: ui.screenPadding,
        },
        sectionTitle: {
          fontSize: ui.sectionTitleSize,
          fontWeight: '700',
          color: TOK.TEXT,
          marginBottom: ui.sectionGap,
        },
        chartCard: {
          backgroundColor: TOK.SURFACE,
          borderRadius: ui.cardRadius,
          padding: ui.cardPadding,
          borderWidth: 1,
          borderColor: TOK.CARD_BORDER,
        },

        // Status Breakdown
        statusItem: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingVertical: ui.mediumGap,
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
          borderRadius: theme.radii.xs,
          marginRight: ui.mediumGap,
        },
        statusName: {
          fontSize: ui.bodySize,
          color: TOK.TEXT,
          flex: 1,
        },
        statusStats: {
          alignItems: 'flex-end',
        },
        statusCount: {
          fontSize: ui.bodySize,
          fontWeight: '600',
          color: TOK.TEXT,
        },
        statusAmount: {
          fontSize: ui.smallTextSize,
          color: TOK.SUBTEXT,
          marginTop: Math.max(1, Math.floor(ui.smallGap / 2)),
        },

        // Performance Metrics
        metricGrid: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: ui.cardGap,
        },
        metricCard: {
          width: ui.cardWidth,
          backgroundColor: TOK.SURFACE,
          borderRadius: ui.controlRadius,
          padding: ui.cardPadding,
          borderWidth: 1,
          borderColor: TOK.CARD_BORDER,
        },
        metricValue: {
          fontSize: ui.metricValueSize,
          fontWeight: '700',
          color: TOK.TEXT,
          marginBottom: ui.smallGap,
        },
        metricLabel: {
          fontSize: ui.smallTextSize,
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
          paddingHorizontal: ui.screenPadding,
          paddingVertical: ui.sectionGap,
          borderBottomWidth: 1,
          borderBottomColor: TOK.OUTLINE,
        },
        modalTitle: {
          fontSize: ui.sectionTitleSize,
          fontWeight: '700',
          color: TOK.TEXT,
        },
        closeButton: {
          padding: theme.spacing.sm,
        },
        searchInput: {
          margin: ui.screenPadding,
          borderRadius: ui.controlRadius,
          paddingHorizontal: ui.cardPadding,
          paddingVertical: ui.mediumGap,
          borderWidth: 1,
          backgroundColor: TOK.SURFACE,
          borderColor: TOK.OUTLINE,
          color: TOK.TEXT,
          fontSize: ui.bodySize,
        },
        userItem: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: ui.screenPadding,
          paddingVertical: ui.sectionGap,
          borderBottomWidth: 1,
          borderBottomColor: TOK.OUTLINE + '30',
        },
        userInfo: {
          flex: 1,
          marginLeft: ui.mediumGap,
        },
        userName: {
          fontSize: ui.bodySize,
          color: TOK.TEXT,
          marginBottom: Math.max(1, Math.floor(ui.smallGap / 2)),
        },
        userRole: {
          fontSize: ui.smallTextSize,
          color: TOK.SUBTEXT,
        },
        selectedIndicator: {
          width: 24,
          height: 24,
          borderRadius: theme.radii.pill,
          borderWidth: 2,
          borderColor: TOK.PRIMARY,
          justifyContent: 'center',
          alignItems: 'center',
        },
        selectedDot: {
          width: 12,
          height: 12,
          borderRadius: theme.radii.pill,
          backgroundColor: TOK.PRIMARY,
        },

        // Calendar
        calendarContainer: {
          margin: ui.screenPadding,
          borderRadius: ui.cardRadius,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: TOK.OUTLINE,
        },
        rangeDisplay: {
          padding: ui.cardPadding,
          backgroundColor: TOK.SURFACE,
          borderBottomWidth: 1,
          borderBottomColor: TOK.OUTLINE,
        },
        rangeText: {
          fontSize: ui.bodySize,
          color: TOK.TEXT,
          textAlign: 'center',
        },
        modalActions: {
          flexDirection: 'row',
          padding: ui.screenPadding,
          gap: ui.cardGap,
        },
        actionButton: {
          flex: 1,
          paddingVertical: ui.sectionGap,
          borderRadius: ui.controlRadius,
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
          fontSize: ui.bodySize,
          fontWeight: '600',
        },
        primaryActionText: {
          color: TOK.ON_PRIMARY,
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
          padding: theme.spacing.xxxl || theme.spacing.xxl,
        },
        emptyText: {
          fontSize: ui.bodySize,
          color: TOK.SUBTEXT,
          textAlign: 'center',
          marginTop: ui.mediumGap,
        },
      }),
    [TOK, insets.top, theme, ui],
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
      .select('id, role, first_name, middle_name, last_name, full_name, company_id')
      .eq('id', uid)
      .single();
    if (error) throw error;
    const normalizedMe = prof ? { ...prof, full_name: formatPersonName(prof) || prof.full_name } : prof;
    setMe(normalizedMe);
    setRole(prof.role);
    setSelectedUserId(normalizedMe.id);
    setSelectedUser(normalizedMe);
  }, []);

  // Load users (for managers)
  const loadUsers = useCallback(async () => {
    if (!isManager || !canViewFinanceStatsAll || !me?.company_id) {
      setUsers([]);
      return;
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('id, first_name, middle_name, last_name, full_name, role')
      .eq('company_id', me.company_id)
      .order('full_name', { ascending: true });
    if (error) throw error;
    const rows = (data || []).map((row) => ({
      ...row,
      full_name: formatPersonName(row) || row.full_name,
    }));
    setUsers([{ id: 'ALL', full_name: t('stats_all_employees'), role: 'all' }, ...rows]);
  }, [canViewFinanceStatsAll, isManager, me?.company_id, t]);

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
    expenseByRecipient: [],
  });

  const loadStats = useCallback(async () => {
    if (!selectedUserId) return;

    try {
      // Load orders data
      let query = supabase
        .from('orders_accessible')
        .select(
          'id, status, time_window_start, assigned_to, start_price, finance_income_total, finance_expense_total, finance_discount_total, finance_gross_total, finance_net_total',
        )
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
      const completedStatusAliases = getStatusDbAliases('done');
      const inProgressStatusAliases = getStatusDbAliases('in_progress');
      const newStatusAliases = getStatusDbAliases('new');
      const completedOrders = orders?.filter((o) => completedStatusAliases.includes(String(o.status || '').trim())).length || 0;
      const inProgressOrders = orders?.filter((o) => inProgressStatusAliases.includes(String(o.status || '').trim())).length || 0;
      const newOrders = orders?.filter((o) => newStatusAliases.includes(String(o.status || '').trim())).length || 0;

      const getGross = (o) => Number(o.finance_gross_total ?? o.start_price ?? 0) || 0;
      const getExtraIncome = (o) => Number(o.finance_income_total ?? 0) || 0;
      const getExpense = (o) => Number(o.finance_expense_total ?? 0) || 0;
      const getNet = (o) =>
        Number(o.finance_net_total ?? getGross(o) + getExtraIncome(o) - getExpense(o)) || 0;

      const totalRevenue = orders?.reduce((sum, o) => sum + getGross(o) + getExtraIncome(o), 0) || 0;
      const totalCosts = orders?.reduce((sum, o) => sum + getExpense(o), 0) || 0;
      const netProfit = orders?.reduce((sum, o) => sum + getNet(o), 0) || 0;

      // Status breakdown
      const statusColors = {
        done: TOK.SUCCESS,
        in_progress: TOK.WARNING,
        new: TOK.INFO,
      };
      const statusRows = statusSystem.isEnabled
        ? statusSystem.regularStatuses.map((status) => ({
            key: status.status_key,
            aliases: getStatusDbAliases(status.status_key),
            label: status.name,
            color: statusColors[status.status_key] || TOK.PRIMARY,
          }))
        : [];
      const statusBreakdown = statusRows
        .map((item) => {
          const filtered = (orders || []).filter((o) => item.aliases.includes(String(o.status || '').trim()));
          return {
            status: item.key,
            label: item.label,
            count: filtered.length,
            color: item.color,
            amount: filtered.reduce((sum, o) => sum + getNet(o), 0),
          };
        })
        .filter((item) => item.count > 0);

      let expenseByRecipient = [];
      const orderIds = (orders || []).map((o) => o.id).filter(Boolean);
      if (orderIds.length > 0) {
        const { data: entries } = await supabase
          .from('order_finance_entries')
          .select(
            'kind, calculated_amount, recipient_user_id, recipient:profiles!order_finance_entries_recipient_user_id_fkey(first_name, middle_name, last_name, full_name)',
          )
          .in('order_id', orderIds);
        const grouped = new Map();
        for (const entry of entries || []) {
          if (String(entry?.kind || '') !== 'expense') continue;
          const key = String(entry?.recipient_user_id || 'no_recipient');
          const prev = grouped.get(key) || {
            key,
            name: formatPersonName(entry?.recipient, t('stats_no_recipient')),
            amount: 0,
          };
          prev.amount += Number(entry?.calculated_amount || 0) || 0;
          grouped.set(key, prev);
        }
        expenseByRecipient = Array.from(grouped.values())
          .filter((row) => row.amount > 0)
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 6);
      }

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
        expenseByRecipient,
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  }, [selectedUserId, periodRange, period, TOK, statusSystem.isEnabled, statusSystem.regularStatuses, t]);

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
  }, [loadMe]);

  useEffect(() => {
    if (!me) return;
    if (isManager && canViewFinanceStatsAll) {
      loadUsers().catch(() => {});
    }
    loadStats().catch(() => {});
  }, [canViewFinanceStatsAll, isManager, loadStats, loadUsers, me]);

  useScreenRefreshRegistration(
    'stats.screen',
    async () => {
      if (!me) return;
      await Promise.allSettled([
        loadStats(),
        isManager && canViewFinanceStatsAll ? loadUsers() : Promise.resolve(),
      ]);
    },
    true,
  );

  const refreshAll = useCallback(async () => {
    await loadStats();
    if (isManager && canViewFinanceStatsAll) await loadUsers();
  }, [canViewFinanceStatsAll, loadStats, isManager, loadUsers]);
  const { refreshing, didSucceed, onRefresh } = useManagedRefresh(refreshAll);
  const { indicator: refreshIndicator } = usePullToRefreshFeedback(refreshing, { didSucceed });

  // User selection
  const openUserPicker = () => setUserPickerOpen(true);
  const closeUserPicker = () => setUserPickerOpen(false);
  const selectUser = (user) => {
    setSelectedUserId(user.id);
    setSelectedUser(user.id === 'ALL' ? { full_name: t('stats_all_employees'), role: 'all' } : user);
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
        textColor: TOK.ON_PRIMARY,
      };
    }
    return marks;
  }, [rangeStart, rangeEnd, TOK.ON_PRIMARY, TOK.PRIMARY]);

  const filteredUsers = useMemo(() => {
    const q = (usersSearch || '').trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        (u.full_name || '').toLowerCase().includes(q) || (u.role || '').toLowerCase().includes(q),
    );
  }, [users, usersSearch]);

  const displayName = isManager
    ? selectedUser?.full_name || t('stats_select_employee')
    : me?.full_name || t('stats_my_stats');

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={TOK.PRIMARY} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AppHeader options={{ title: t('stats_title') }} back />

      <View style={{ flex: 1 }}>
        {refreshIndicator}
        <ScrollView
          refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('stats_title')}</Text>
          <Text style={styles.headerSubtitle}>{displayName}</Text>
        </View>

        {/* Quick Stats */}
        <View style={styles.quickStats}>
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{formatNumber(stats.totalOrders, locale)}</Text>
              <Text style={styles.statLabel}>{t('stats_total_orders')}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{formatNumber(stats.completedOrders, locale)}</Text>
              <Text style={styles.statLabel}>{t('stats_completed')}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: TOK.SUCCESS }]}>
                {fRUB(stats.netProfit)}
              </Text>
              <Text style={styles.statLabel}>{t('stats_net_profit')}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{stats.performance.avgOrdersPerDay.toFixed(1)}</Text>
              <Text style={styles.statLabel}>{t('stats_per_day')}</Text>
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
                  onPress={() => {
                    if (p.key === 'custom') {
                      openCustomPeriod();
                      return;
                    }
                    setPeriod(p.key);
                  }}
                >
                  <Text style={[styles.periodText, period === p.key && styles.periodTextActive]}>
                    {t(p.labelKey)}
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

          {isManager && canViewFinanceStatsAll && (
            <TouchableOpacity style={styles.userSelector} onPress={openUserPicker}>
              <Ionicons name="people" size={20} color={TOK.SUBTEXT} />
              <Text style={styles.userText} numberOfLines={1}>
                {selectedUser?.full_name || t('stats_select_employee')}
              </Text>
              <Ionicons name="chevron-down" size={16} color={TOK.SUBTEXT} />
            </TouchableOpacity>
          )}
        </View>

        {/* Status Breakdown */}
        {stats.statusBreakdown.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('stats_by_status')}</Text>
            <View style={styles.chartCard}>
              {stats.statusBreakdown.map((item) => (
                <View key={item.status} style={styles.statusItem}>
                  <View style={styles.statusLeft}>
                    <View style={[styles.statusDot, { backgroundColor: item.color }]} />
                    <Text style={styles.statusName}>{item.label}</Text>
                  </View>
                  <View style={styles.statusStats}>
                    <Text style={styles.statusCount}>{formatNumber(item.count, locale)}</Text>
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
          <Text style={styles.sectionTitle}>{t('stats_efficiency')}</Text>
          <View style={styles.metricGrid}>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>
                {(stats.performance.completionRate * 100).toFixed(0)}%
              </Text>
              <Text style={styles.metricLabel}>{t('stats_completion_rate')}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>{fRUB(stats.performance.avgRevenuePerOrder)}</Text>
              <Text style={styles.metricLabel}>{t('stats_avg_check')}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>{formatNumber(stats.inProgressOrders, locale)}</Text>
              <Text style={styles.metricLabel}>{t('stats_in_progress')}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>{formatNumber(stats.newOrders, locale)}</Text>
              <Text style={styles.metricLabel}>{t('stats_new')}</Text>
            </View>
          </View>
        </View>

        {/* Financial Summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('stats_finance')}</Text>
          <View style={styles.chartCard}>
            <View style={styles.statusItem}>
              <Text style={styles.statusName}>{t('stats_total_revenue')}</Text>
              <Text style={styles.statusCount}>{fRUB(stats.totalRevenue)}</Text>
            </View>
            <View style={styles.statusItem}>
              <Text style={styles.statusName}>{t('stats_expenses')}</Text>
              <Text style={styles.statusCount}>{fRUB(stats.totalCosts)}</Text>
            </View>
            <View style={[styles.statusItem, { borderBottomWidth: 0 }]}>
              <Text style={[styles.statusName, { fontWeight: '700' }]}>{t('stats_net_profit')}</Text>
              <Text style={[styles.statusCount, { color: TOK.SUCCESS }]}>
                {fRUB(stats.netProfit)}
              </Text>
            </View>
          </View>
        </View>

        {stats.expenseByRecipient.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('stats_expenses_by_recipient')}</Text>
            <View style={styles.chartCard}>
              {stats.expenseByRecipient.map((item, index) => (
                <View
                  key={item.key}
                  style={[
                    styles.statusItem,
                    index === stats.expenseByRecipient.length - 1 ? { borderBottomWidth: 0 } : null,
                  ]}
                >
                  <Text style={styles.statusName}>{item.name}</Text>
                  <Text style={styles.statusCount}>{fRUB(item.amount)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
        </ScrollView>
      </View>

      {/* User Picker Modal */}
      <AnimatedFullscreenModal
        visible={userPickerOpen && canViewFinanceStatsAll}
        animation="slide"
        onRequestClose={closeUserPicker}
      >
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('stats_employee_picker')}</Text>
            <TouchableOpacity style={styles.closeButton} onPress={closeUserPicker}>
              <Ionicons name="close" size={24} color={TOK.TEXT} />
            </TouchableOpacity>
          </View>

          <RNTextInput
            style={styles.searchInput}
            placeholder={t('stats_search_by_name')}
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
                <Text style={styles.emptyText}>{t('stats_employees_not_found')}</Text>
              </View>
            }
          />
        </SafeAreaView>
      </AnimatedFullscreenModal>

      {/* Custom Period Modal */}
      <AnimatedFullscreenModal visible={customModalOpen} animation="slide" onRequestClose={closeCustomPeriod}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('stats_period_picker')}</Text>
            <TouchableOpacity style={styles.closeButton} onPress={closeCustomPeriod}>
              <Ionicons name="close" size={24} color={TOK.TEXT} />
            </TouchableOpacity>
          </View>

          <View style={styles.rangeDisplay}>
            <Text style={styles.rangeText}>
              {rangeStart && rangeEnd
                ? `${fmt(fromISODate(rangeStart), locale)} — ${fmt(fromISODate(rangeEnd), locale)}`
                : t('stats_select_date_range')}
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
                selectedDayTextColor: TOK.ON_PRIMARY,
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
              <Text style={[styles.actionText, styles.secondaryActionText]}>{t('btn_cancel')}</Text>
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
              <Text style={[styles.actionText, styles.primaryActionText]}>{t('btn_apply')}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </AnimatedFullscreenModal>
    </View>
  );
}

export default function StatsScreen() {
  return (
    <DeferredScreen>
      <StatsScreenContent />
    </DeferredScreen>
  );
}
