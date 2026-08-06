import Feather from '@expo/vector-icons/Feather';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Calendar, LocaleConfig } from 'react-native-calendars';

import FilterBarButton from '../components/filters/FilterBarButton';
import Screen from '../components/layout/Screen';
import StatisticsDetailModal from '../components/statistics/StatisticsDetailModal';
import StatisticsFiltersPanel from '../components/statistics/StatisticsFiltersPanel';
import StatisticsTeamScorecard from '../components/statistics/StatisticsTeamScorecard';
import StatisticsTrendChart from '../components/statistics/StatisticsTrendChart';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import {
  ThemedRefreshControl,
  useManagedRefresh,
  usePullToRefreshFeedback,
} from '../components/ui/PullToRefreshFeedback';
import SectionHeader from '../components/ui/SectionHeader';
import BaseModal from '../components/ui/modals/BaseModal';
import ModalActionsRow from '../components/ui/modals/ModalActionsRow';
import { useCompanySettings } from '../hooks/useCompanySettings';
import { formatCurrencyWithOptions } from '../lib/currency';
import { getOrderStatusLabel, useCompanyOrderStatuses } from '../lib/orderStatuses';
import { usePermissions } from '../lib/permissions';
import { useAuthContext } from '../providers/SimpleAuthProvider';
import HelpInfoButton from '../src/features/helpCenter/HelpInfoButton';
import {
  calculateChange,
  fromLocalISODate,
  getStatisticsPeriodRange,
  STATISTICS_PERIODS,
  toLocalISODate,
} from '../src/features/statistics/model';
import { useStatisticsDashboard } from '../src/features/statistics/queries';
import { useTranslation } from '../src/i18n/useTranslation';
import { useScreenRefreshRegistration } from '../src/shared/query/screenRefreshRegistry';
import DeferredScreen from '../src/shared/perf/DeferredScreen';
import { useTheme } from '../theme/ThemeProvider';
import { withAlpha } from '../theme/colors';

const CONTENT_MAX_WIDTH = 1120;
const TABLET_BREAKPOINT = 600;
const DESKTOP_BREAKPOINT = 900;
const KPI_COLUMNS_PHONE = 2;
const KPI_COLUMNS_TABLET = 3;
const KPI_COLUMNS_DESKTOP = 4;
const EMPTY_STATS_OBJECT = Object.freeze({});

// react-native-calendars uses a global XDate locale instead of the app i18n
// locale. Register both supported interface languages explicitly so the date
// picker never falls back to its English default.
LocaleConfig.locales.ru = {
  monthNames: [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
  ],
  monthNamesShort: [
    'Янв.', 'Фев.', 'Мар.', 'Апр.', 'Мая', 'Июн.',
    'Июл.', 'Авг.', 'Сент.', 'Окт.', 'Нояб.', 'Дек.',
  ],
  dayNames: [
    'Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота',
  ],
  dayNamesShort: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
  today: 'Сегодня',
};
LocaleConfig.locales.en = {
  monthNames: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ],
  monthNamesShort: [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ],
  dayNames: [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
  ],
  dayNamesShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  today: 'Today',
};

function syncCalendarLocale(locale) {
  const calendarLocale = String(locale || '').toLowerCase().startsWith('en') ? 'en' : 'ru';
  LocaleConfig.defaultLocale = calendarLocale;
  return calendarLocale;
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function hasStatisticsActivity(item) {
  return ['registered', 'completed', 'revenue', 'profit', 'earnings'].some(
    (key) => asNumber(item?.[key]) !== 0,
  );
}

function formatCount(value, locale) {
  return new Intl.NumberFormat(locale || undefined, { maximumFractionDigits: 0 }).format(
    asNumber(value),
  );
}

function formatPercent(value, locale) {
  return new Intl.NumberFormat(locale || undefined, {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(asNumber(value));
}

function formatDate(value, locale, options = {}) {
  const date = fromLocalISODate(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale || undefined, {
    day: '2-digit',
    month: 'short',
    year: options.year === false ? undefined : 'numeric',
  }).format(date);
}

function formatCurrentMonthLabel(locale) {
  const value = new Intl.DateTimeFormat(locale || undefined, { month: 'short' }).format(new Date());
  return value ? `${value.charAt(0).toLocaleUpperCase(locale || undefined)}${value.slice(1)}` : '';
}

function formatCurrentYearLabel() {
  return String(new Date().getFullYear());
}

function formatMessage(t, key, variables = {}) {
  return Object.entries(variables).reduce(
    (message, [name, value]) => message.split(`{${name}}`).join(String(value ?? '')),
    t(key),
  );
}

function resolveRoleLabel(role, t) {
  return t(
    {
      admin: 'role_admin',
      dispatcher: 'role_dispatcher',
      worker: 'role_worker',
    }[String(role || '').toLowerCase()] || 'role_worker',
  );
}

function resolveSourceLabel(source, t) {
  return t(
    {
      app: 'stats_source_app',
      telegram: 'stats_source_telegram',
      max: 'stats_source_max',
      unknown: 'stats_source_unknown',
    }[String(source || '').toLowerCase()] || 'stats_source_other',
  );
}

function resolvePaymentMethodLabel(method, t) {
  const normalized = String(method || '').trim().toLowerCase();
  const key = {
    cash: 'order_payment_method_cash',
    cashless: 'order_payment_method_cashless',
    card: 'order_payment_method_cashless',
    bank_card: 'order_payment_method_cashless',
    transfer: 'order_payment_method_cashless',
    bank_transfer: 'order_payment_method_cashless',
    unknown: 'stats_payment_unknown',
  }[normalized];
  return key ? t(key) : t('stats_payment_other');
}

function MetricCard({ label, value, valueColor, change, showComparison = true, icon, color, width, onPress, t }) {
  const { theme } = useTheme();
  const s = React.useMemo(() => styles(theme), [theme]);
  const normalizedChange = Number.isFinite(change) ? change : null;
  const trendColor = normalizedChange == null
    ? theme.colors.textSecondary
    : normalizedChange > 0
      ? theme.colors.success
      : normalizedChange < 0
        ? theme.colors.danger
        : theme.colors.textSecondary;
  const trendText = normalizedChange == null
    ? null
    : normalizedChange === 0
      ? t('stats_comparison_unchanged')
      : `${normalizedChange > 0 ? '+' : ''}${Math.round(normalizedChange)}%`;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.metricPressable, { width }, pressed && s.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
    >
      <Card style={s.metricCard}>
        <View style={s.metricHeader}>
          <View style={[s.metricIcon, { backgroundColor: withAlpha(color, 0.12) }]}>
            <Feather name={icon} size={theme.icons.sm} color={color} />
          </View>
          <Feather name="chevron-right" size={theme.icons.sm} color={theme.colors.textSecondary} />
        </View>
        <Text style={[s.metricValue, valueColor ? { color: valueColor } : null]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
          {value}
        </Text>
        <Text style={s.metricLabel} numberOfLines={2}>{label}</Text>
        {showComparison && trendText ? <Text style={[s.metricTrend, { color: trendColor }]}>{trendText}</Text> : null}
      </Card>
    </Pressable>
  );
}

function DisclosureHeader({ title, helpTopic, onHelp, onPress, t }) {
  const { theme } = useTheme();
  const s = React.useMemo(() => styles(theme), [theme]);
  return (
    <View style={s.disclosureHeader}>
      <SectionHeader
        containerStyle={s.sectionHeaderContainer}
        accessory={<HelpInfoButton topicId={helpTopic} onPress={onHelp} size={24} />}
      >
        {title}
      </SectionHeader>
      {onPress ? (
        <Pressable
          onPress={onPress}
          style={({ pressed }) => [s.detailsButton, pressed && s.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t('stats_open_details')}
        >
          <Text style={s.detailsButtonText}>{t('stats_details')}</Text>
          <Feather name="chevron-right" size={theme.icons.sm} color={theme.colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

function StatsScreenContent() {
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  syncCalendarLocale(locale);
  const { width: windowWidth } = useWindowDimensions();
  const { profile } = useAuthContext();
  const { settings: companySettings } = useCompanySettings();
  const { has } = usePermissions();
  const statusSystem = useCompanyOrderStatuses();
  const s = React.useMemo(() => styles(theme), [theme]);

  const role = String(profile?.role || '').toLowerCase();
  const profileId = String(profile?.id || '').trim();
  const companyId = String(profile?.company_id || profile?.companyId || '').trim();
  const isAdmin = role === 'admin';
  const isSolo = companySettings?.work_mode === 'solo';
  const canViewCompany = isAdmin || has('canViewFinanceStatsAll');
  const currency = companySettings?.currency || 'RUB';

  const initializedProfileRef = React.useRef('');
  const [scope, setScope] = React.useState('me');
  const [period, setPeriod] = React.useState('month');
  const [customRange, setCustomRange] = React.useState({ from: null, to: null });
  const [dateModalVisible, setDateModalVisible] = React.useState(false);
  const [draftRange, setDraftRange] = React.useState({ from: null, to: null });
  const [filtersVisible, setFiltersVisible] = React.useState(false);
  const [employeeIds, setEmployeeIds] = React.useState([]);
  const [departmentIds, setDepartmentIds] = React.useState([]);
  const [includeNoDepartment, setIncludeNoDepartment] = React.useState(false);
  const [workTypeIds, setWorkTypeIds] = React.useState([]);
  const [includeNoWorkType, setIncludeNoWorkType] = React.useState(false);
  const [detailType, setDetailType] = React.useState(null);
  const [infoType, setInfoType] = React.useState(null);
  const [chartMode, setChartMode] = React.useState('money');
  const [teamMetric, setTeamMetric] = React.useState('profit');
  const [selectedEmployeeId, setSelectedEmployeeId] = React.useState(null);
  const [selectedDepartmentId, setSelectedDepartmentId] = React.useState(null);

  React.useEffect(() => {
    if (!profileId || initializedProfileRef.current === profileId) return;
    initializedProfileRef.current = profileId;
    setScope(isAdmin || isSolo ? 'company' : 'me');
    setEmployeeIds([]);
    setDepartmentIds([]);
    setIncludeNoDepartment(false);
    setWorkTypeIds([]);
    setIncludeNoWorkType(false);
  }, [isAdmin, isSolo, profileId]);

  React.useEffect(() => {
    if (!isSolo && !canViewCompany && scope === 'company') setScope('me');
  }, [canViewCompany, isSolo, scope]);

  const periodRange = React.useMemo(
    () => getStatisticsPeriodRange(period, customRange),
    [customRange, period],
  );
  const requestedScope = isSolo
    ? 'company'
    : scope === 'company' && canViewCompany
      ? 'company'
      : 'me';
  const dashboardParams = React.useMemo(
    () => ({
      from: periodRange.from,
      to: periodRange.to,
      scope: requestedScope,
      employeeIds: requestedScope === 'company' && !isSolo ? employeeIds : [],
      departmentIds: requestedScope === 'company' && !isSolo ? departmentIds : [],
      includeNoDepartment:
        requestedScope === 'company' && !isSolo ? includeNoDepartment : false,
      workTypeIds,
      includeNoWorkType,
    }),
    [
      departmentIds,
      employeeIds,
      includeNoDepartment,
      includeNoWorkType,
      isSolo,
      periodRange.from,
      periodRange.to,
      requestedScope,
      workTypeIds,
    ],
  );
  const dashboardQuery = useStatisticsDashboard(dashboardParams, {
    enabled: Boolean(profileId && companyId),
  });
  const dashboard = dashboardQuery.data;
  const summary = dashboard?.summary || EMPTY_STATS_OBJECT;
  const comparison = dashboard?.comparison || EMPTY_STATS_OBJECT;
  const isWorkerView = !isSolo && requestedScope !== 'company';
  const formatMoney = React.useCallback(
    (value) =>
      formatCurrencyWithOptions(asNumber(value), dashboard?.meta?.currency || currency, locale, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }),
    [currency, dashboard?.meta?.currency, locale],
  );
  const formatDashboardCount = React.useCallback(
    (value) => formatCount(value, locale),
    [locale],
  );

  const periodLabel = React.useMemo(
    () => `${formatDate(periodRange.from, locale)} — ${formatDate(periodRange.to, locale)}`,
    [locale, periodRange.from, periodRange.to],
  );
  const scopeLabel = isSolo
    ? t('stats_scope_solo')
    : requestedScope === 'company'
      ? t('stats_scope_company')
      : t('stats_scope_me');
  const detailSubtitle = `${scopeLabel} · ${periodLabel}`;

  const refresh = React.useCallback(async () => {
    await dashboardQuery.refetch();
  }, [dashboardQuery]);
  useScreenRefreshRegistration('stats.screen', refresh, true);
  const { refreshing, didSucceed, onRefresh } = useManagedRefresh(refresh);
  const { indicator: refreshIndicator } = usePullToRefreshFeedback(refreshing, { didSucceed });

  const contentWidth = Math.min(windowWidth, CONTENT_MAX_WIDTH);
  const columns = contentWidth >= DESKTOP_BREAKPOINT
    ? KPI_COLUMNS_DESKTOP
    : contentWidth >= TABLET_BREAKPOINT
      ? KPI_COLUMNS_TABLET
      : KPI_COLUMNS_PHONE;
  const horizontalPadding = theme.components.screenLayout.contentPaddingX;
  const cardGap = theme.spacing.md;
  const metricWidth = Math.max(
    0,
    (contentWidth - horizontalPadding * 2 - cardGap * (columns - 1)) / columns,
  );

  const topMetrics = React.useMemo(() => {
    const completed = asNumber(summary.completed);
    const profit = asNumber(summary.profit);
    const revenue = asNumber(summary.revenue);
    const earnings = asNumber(summary.personal_earnings);
    const margin = revenue !== 0 ? profit / revenue : 0;

    if (isWorkerView) {
      const averageEarnings = completed > 0 ? earnings / completed : 0;
      return [
        {
          id: 'earnings',
          label: t('stats_earnings_accrued'),
          value: formatMoney(earnings),
          change: calculateChange(earnings, comparison.personal_earnings),
          icon: 'dollar-sign',
          color: theme.colors.success,
          detail: 'personal',
        },
        {
          id: 'completed',
          label: t('stats_completed_in_period'),
          value: formatCount(completed, locale),
          change: calculateChange(completed, comparison.completed),
          icon: 'check-circle',
          color: theme.colors.primary,
          detail: 'requests',
        },
        {
          id: 'average_earnings',
          label: t('stats_average_earnings_per_request'),
          value: formatMoney(averageEarnings),
          showComparison: false,
          icon: 'bar-chart-2',
          color: theme.colors.info,
          detail: 'personal',
        },
        {
          id: 'cycle',
          label: t('stats_average_cycle'),
          value: formatMessage(t, 'stats_hours_value', { count: asNumber(summary.average_cycle_hours) }),
          showComparison: false,
          icon: 'clock',
          color: theme.colors.warning,
          detail: 'requests',
        },
      ];
    }

    if (isSolo) {
      return [
        {
          id: 'profit',
          label: t('stats_solo_result'),
          value: formatMoney(profit),
          valueColor: profit > 0 ? theme.colors.success : theme.colors.danger,
          change: calculateChange(profit, comparison.profit),
          icon: 'trending-up',
          color: profit > 0 ? theme.colors.success : theme.colors.danger,
          detail: 'finance',
        },
        {
          id: 'revenue',
          label: t('stats_completed_revenue'),
          value: formatMoney(revenue),
          change: calculateChange(revenue, comparison.revenue),
          icon: 'credit-card',
          color: theme.colors.warning,
          detail: 'finance',
        },
        {
          id: 'expenses',
          label: t('stats_total_expenses'),
          value: formatMoney(summary.total_expenses),
          showComparison: false,
          icon: 'arrow-down-circle',
          color: theme.colors.danger,
          detail: 'finance',
        },
        {
          id: 'completed',
          label: t('stats_completed_in_period'),
          value: formatCount(completed, locale),
          change: calculateChange(completed, comparison.completed),
          icon: 'check-circle',
          color: theme.colors.primary,
          detail: 'requests',
        },
      ];
    }

    return [
      {
        id: 'profit',
        label: t('stats_job_profit'),
        value: formatMoney(profit),
        valueColor: profit > 0 ? theme.colors.success : theme.colors.danger,
        change: calculateChange(profit, comparison.profit),
        icon: 'trending-up',
        color: profit > 0 ? theme.colors.success : theme.colors.danger,
        detail: 'finance',
      },
      {
        id: 'revenue',
        label: t('stats_completed_revenue'),
        value: formatMoney(revenue),
        change: calculateChange(revenue, comparison.revenue),
        icon: 'credit-card',
        color: theme.colors.warning,
        detail: 'finance',
      },
      {
        id: 'completed',
        label: t('stats_completed_in_period'),
        value: formatCount(completed, locale),
        change: calculateChange(completed, comparison.completed),
        icon: 'check-circle',
        color: theme.colors.primary,
        detail: 'requests',
      },
      {
        id: 'margin',
        label: t('stats_job_margin'),
        value: formatPercent(margin, locale),
        showComparison: false,
        icon: 'percent',
        color: margin > 0 ? theme.colors.success : theme.colors.danger,
        valueColor: margin > 0 ? theme.colors.text : theme.colors.danger,
        detail: 'finance',
      },
    ];
  }, [
    comparison.completed,
    comparison.personal_earnings,
    comparison.profit,
    comparison.revenue,
    formatMoney,
    isSolo,
    isWorkerView,
    locale,
    summary.average_cycle_hours,
    summary.completed,
    summary.personal_earnings,
    summary.profit,
    summary.revenue,
    summary.total_expenses,
    t,
    theme.colors.danger,
    theme.colors.info,
    theme.colors.primary,
    theme.colors.success,
    theme.colors.text,
    theme.colors.warning,
  ]);

  const statusPreviewRows = React.useMemo(
    () =>
      (dashboard?.statuses || []).map((item) => ({
        key: String(item.key || item.name),
        label: getOrderStatusLabel(item.key, statusSystem.statuses, t) || item.name,
        value: asNumber(item.count),
        color: item.color || theme.colors.primary,
      })),
    [dashboard?.statuses, statusSystem.statuses, t, theme.colors.primary],
  );
  const employeeOptions = React.useMemo(
    () =>
      (dashboard?.filterOptions?.employees || []).map((employee) => ({
        id: employee.id,
        value: String(employee.id),
        label: employee.name,
        subtitle: [
          employee.department_name,
          resolveRoleLabel(employee.role, t),
          employee.is_blocked ? t('stats_employee_blocked') : null,
        ].filter(Boolean).join(' · '),
      })),
    [dashboard?.filterOptions?.employees, t],
  );
  const departmentOptions = React.useMemo(
    () => (dashboard?.filterOptions?.departments || []).map((department) => ({
        id: department.id,
        value: String(department.id),
        label: department.name,
      })),
    [dashboard?.filterOptions?.departments],
  );
  const workTypeOptions = React.useMemo(
    () => (dashboard?.filterOptions?.workTypes || []).map((workType) => ({
      id: workType.id,
      value: String(workType.id),
      label: workType.name,
      subtitle: workType.is_enabled === false ? t('stats_work_type_disabled') : null,
    })),
    [dashboard?.filterOptions?.workTypes, t],
  );
  const activeFilterCount = employeeIds.length
    + departmentIds.length
    + (includeNoDepartment ? 1 : 0)
    + workTypeIds.length
    + (includeNoWorkType ? 1 : 0);
  const statisticsFilterValue = React.useMemo(
    () => ({
      employeeIds,
      departmentIds,
      includeNoDepartment,
      workTypeIds,
      includeNoWorkType,
    }),
    [departmentIds, employeeIds, includeNoDepartment, includeNoWorkType, workTypeIds],
  );
  const canFilterByPeople = requestedScope === 'company'
    && !isSolo
    && canViewCompany
    && (employeeOptions.length > 0 || dashboard?.meta?.use_departments === true);
  const canFilterByWorkTypes = dashboard?.meta?.use_work_types === true;
  const canOpenFilters = canFilterByPeople || canFilterByWorkTypes;

  const openDatePicker = React.useCallback(() => {
    setDraftRange({ from: periodRange.from, to: periodRange.to });
    setDateModalVisible(true);
  }, [periodRange.from, periodRange.to]);
  const onCalendarDayPress = React.useCallback((day) => {
    const picked = String(day?.dateString || '');
    if (!picked) return;
    setDraftRange((current) => {
      if (!current.from || current.to) return { from: picked, to: null };
      return picked < current.from
        ? { from: picked, to: current.from }
        : { from: current.from, to: picked };
    });
  }, []);
  const markedDates = React.useMemo(() => {
    if (!draftRange.from) return {};
    const start = fromLocalISODate(draftRange.from);
    const end = fromLocalISODate(draftRange.to || draftRange.from);
    const result = {};
    for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      const key = toLocalISODate(cursor);
      result[key] = {
        startingDay: key === draftRange.from,
        endingDay: key === (draftRange.to || draftRange.from),
        color: theme.colors.primary,
        textColor: theme.colors.onPrimary,
      };
    }
    return result;
  }, [draftRange.from, draftRange.to, theme.colors.onPrimary, theme.colors.primary]);

  const applyStatisticsFilters = React.useCallback((next = {}) => {
    setEmployeeIds(Array.isArray(next.employeeIds) ? next.employeeIds.map(String) : []);
    setDepartmentIds(Array.isArray(next.departmentIds) ? next.departmentIds.map(String) : []);
    setIncludeNoDepartment(next.includeNoDepartment === true);
    setWorkTypeIds(Array.isArray(next.workTypeIds) ? next.workTypeIds.map(String) : []);
    setIncludeNoWorkType(next.includeNoWorkType === true);
  }, []);

  const openEmployeeDetails = React.useCallback((employee) => {
    const employeeId = String(employee?.id || '').trim();
    if (!employeeId) return;
    setSelectedEmployeeId(employeeId);
    setSelectedDepartmentId(null);
    setDetailType('employee');
  }, []);
  const openDepartmentDetails = React.useCallback((department) => {
    const departmentId = String(department?.id || '').trim();
    if (!departmentId) return;
    setSelectedDepartmentId(departmentId);
    setSelectedEmployeeId(null);
    setDetailType('department');
  }, []);

  const selectEmployeeDrilldown = React.useCallback((employeeId) => {
    setScope('company');
    setEmployeeIds([String(employeeId)]);
    setDepartmentIds([]);
    setIncludeNoDepartment(false);
    setDetailType(null);
    setSelectedEmployeeId(null);
  }, []);
  const selectDepartmentDrilldown = React.useCallback((departmentId) => {
    setScope('company');
    setEmployeeIds([]);
    if (String(departmentId) === 'none') {
      setDepartmentIds([]);
      setIncludeNoDepartment(true);
    } else {
      setDepartmentIds([String(departmentId)]);
      setIncludeNoDepartment(false);
    }
    setDetailType(null);
    setSelectedDepartmentId(null);
  }, []);
  const selectedEmployee = React.useMemo(
    () => (dashboard?.employees || []).find(
      (employee) => String(employee?.id || '') === String(selectedEmployeeId || ''),
    ) || null,
    [dashboard?.employees, selectedEmployeeId],
  );
  const selectedDepartment = React.useMemo(
    () => (dashboard?.departments || []).find(
      (department) => String(department?.id || '') === String(selectedDepartmentId || ''),
    ) || null,
    [dashboard?.departments, selectedDepartmentId],
  );
  const detailModel = React.useMemo(() => {
    const common = { visible: Boolean(detailType), subtitle: detailSubtitle };
    if (detailType === 'requests') {
      return {
        ...common,
        title: t('stats_requests_details_title'),
        sections: [
          {
            id: 'summary',
            title: t('stats_summary'),
            rows: [
              {
                key: 'registered',
                label: t('stats_registered'),
                value: formatCount(summary.registered, locale),
                info: t('stats_requests_hint_registered'),
              },
              {
                key: 'completed',
                label: t('stats_completed_in_period'),
                value: formatCount(summary.completed, locale),
                info: t('stats_requests_hint_completed'),
              },
              {
                key: 'cohort_done',
                label: t('stats_registered_completed'),
                value: formatCount(summary.completed_from_registered, locale),
                info: t('stats_requests_hint_registered_completed'),
              },
              {
                key: 'cohort_open',
                label: t('stats_registered_not_completed'),
                value: formatCount(summary.not_completed_from_registered, locale),
                info: t('stats_requests_hint_registered_not_completed'),
              },
              {
                key: 'rate',
                label: t('stats_completion_rate'),
                value: formatPercent(summary.completion_rate, locale),
                info: t('stats_requests_hint_completion_rate'),
              },
              {
                key: 'cycle',
                label: t('stats_average_cycle'),
                value: formatMessage(t, 'stats_hours_value', { count: asNumber(summary.average_cycle_hours) }),
                info: t('stats_requests_hint_average_cycle'),
              },
            ],
          },
          {
            id: 'statuses',
            title: t('stats_by_status'),
            rows: statusPreviewRows.map((item) => ({
              key: item.key,
              label: item.label,
              value: formatCount(item.value, locale),
              color: item.color,
              info: t('stats_requests_hint_status'),
            })),
          },
          {
            id: 'sources',
            title: t('stats_registration_sources'),
            rows: (dashboard?.sources || []).map((item) => ({
              key: item.key,
              label: resolveSourceLabel(item.key, t),
              value: formatCount(item.count, locale),
              info: t('stats_requests_hint_source'),
            })),
          },
        ],
      };
    }
    if (detailType === 'finance') {
      return {
        ...common,
        title: t(isSolo ? 'stats_solo_finance_details_title' : 'stats_finance_details_title'),
        sections: [
          {
            id: 'summary',
            title: t('stats_summary'),
            rows: [
              { key: 'base', label: t('stats_base_revenue'), value: formatMoney(summary.base_revenue) },
              { key: 'sales', label: t('stats_additional_sales'), value: formatMoney(summary.additional_sales) },
              { key: 'discounts', label: t('stats_discounts'), value: formatMoney(summary.discounts) },
              {
                key: 'revenue',
                label: t('stats_completed_revenue'),
                value: formatMoney(summary.revenue),
                info: t('stats_hint_completed_revenue'),
              },
              ...(!isSolo ? [{ key: 'compensation', label: t('stats_employee_compensation'), value: formatMoney(summary.employee_compensation) }] : []),
              { key: 'company_expenses', label: t(isSolo ? 'stats_expenses' : 'stats_company_expenses'), value: formatMoney(summary.company_expenses) },
              { key: 'total_expenses', label: t('stats_total_expenses'), value: formatMoney(summary.total_expenses) },
              {
                key: 'profit',
                label: t(isSolo ? 'stats_solo_result' : 'stats_job_profit'),
                value: formatMoney(summary.profit),
                valueColor: asNumber(summary.profit) > 0 ? theme.colors.success : theme.colors.danger,
                info: t(isSolo ? 'stats_hint_solo_result' : 'stats_hint_job_profit'),
              },
              { key: 'average', label: t('stats_avg_check'), value: formatMoney(summary.average_check) },
            ],
          },
          {
            id: 'expenses',
            title: t('stats_expense_breakdown'),
            rows: [
              ...(!isSolo && asNumber(summary.employee_compensation) > 0
                ? [{
                  key: 'employee-compensation',
                  label: t('stats_employee_compensation'),
                  value: formatMoney(summary.employee_compensation),
                }]
                : []),
              ...(dashboard?.expenses || []).map((item, index) => ({
                key: `${item.effect}-${item.name}-${index}`,
                label: item.name || t('stats_untitled_expense'),
                value: formatMoney(item.amount),
                secondary: formatMessage(t, 'stats_entries_count', { count: item.count }),
              })),
            ],
          },
          {
            id: 'sales',
            title: t('stats_additional_sales_breakdown'),
            rows: (dashboard?.additionalSales || []).map((item, index) => ({
              key: `${item.name}-${index}`,
              label: item.name || t('stats_untitled_additional_sale'),
              value: formatMoney(item.amount),
              secondary: formatMessage(t, 'stats_entries_count', { count: item.count }),
            })),
          },
          {
            id: 'payments',
            title: t('stats_payment_methods'),
            rows: (dashboard?.paymentMethods || []).map((item) => ({
              key: item.key,
              label: resolvePaymentMethodLabel(item.key, t),
              value: formatMoney(item.revenue),
              secondary: formatMessage(t, 'stats_completed_count', { count: item.completed }),
            })),
          },
        ],
      };
    }
    if (detailType === 'personal') {
      const averageEarnings = asNumber(summary.completed) > 0
        ? asNumber(summary.personal_earnings) / asNumber(summary.completed)
        : 0;
      return {
        ...common,
        title: t('stats_personal_details_title'),
        sections: [
          {
            id: 'personal',
            rows: [
              {
                key: 'earnings',
                label: t('stats_earnings_accrued'),
                value: formatMoney(summary.personal_earnings),
                valueColor: theme.colors.success,
                info: t('stats_hint_earnings_accrued'),
              },
              { key: 'completed', label: t('stats_completed_in_period'), value: formatCount(summary.completed, locale) },
              { key: 'average', label: t('stats_average_earnings_per_request'), value: formatMoney(averageEarnings) },
              {
                key: 'cycle',
                label: t('stats_average_cycle'),
                value: formatMessage(t, 'stats_hours_value', { count: asNumber(summary.average_cycle_hours) }),
              },
            ],
          },
        ],
      };
    }
    if (detailType === 'team') {
      return {
        ...common,
        title: t('stats_team_details_title'),
        sections: [
          {
            id: 'employees',
            title: t('stats_employees'),
            rows: [...(dashboard?.employees || [])]
              .filter(hasStatisticsActivity)
              .sort((left, right) => asNumber(right.profit) - asNumber(left.profit))
              .map((employee) => ({
              key: employee.id,
              label: employee.name,
              value: formatMoney(employee.profit),
              valueColor: asNumber(employee.profit) <= 0 ? theme.colors.danger : null,
              secondary: formatMessage(t, 'stats_team_row_revenue_completed', {
                revenue: formatMoney(employee.revenue),
                count: formatCount(employee.completed, locale),
              }),
              chevron: true,
              onPress: () => openEmployeeDetails(employee),
              })),
          },
          {
            id: 'departments',
            title: t('stats_departments'),
            rows: [...(dashboard?.departments || [])]
              .filter(hasStatisticsActivity)
              .sort((left, right) => asNumber(right.profit) - asNumber(left.profit))
              .map((department) => ({
              key: department.id,
              label: department.id === 'none' ? t('stats_without_department') : department.name,
              value: formatMoney(department.profit),
              valueColor: asNumber(department.profit) <= 0 ? theme.colors.danger : null,
              secondary: formatMessage(t, 'stats_team_row_revenue_completed', {
                revenue: formatMoney(department.revenue),
                count: formatCount(department.completed, locale),
              }),
              chevron: true,
              onPress: () => openDepartmentDetails(department),
              })),
          },
        ],
      };
    }
    if (detailType === 'employee' && selectedEmployee) {
      const completed = asNumber(selectedEmployee.completed);
      const revenue = asNumber(selectedEmployee.revenue);
      const profit = asNumber(selectedEmployee.profit);
      const margin = revenue !== 0 ? profit / revenue : 0;
      return {
        ...common,
        title: selectedEmployee.name,
        sections: [
          {
            id: 'employee-result',
            title: t('stats_employee_result'),
            rows: [
              {
                key: 'profit',
                label: t('stats_profit_contribution'),
                value: formatMoney(profit),
                valueColor: profit > 0 ? theme.colors.success : theme.colors.danger,
                info: t('stats_hint_profit_contribution'),
              },
              { key: 'revenue', label: t('stats_completed_revenue'), value: formatMoney(revenue) },
              { key: 'completed', label: t('stats_completed_in_period'), value: formatCount(completed, locale) },
              {
                key: 'average',
                label: t('stats_avg_check'),
                value: formatMoney(completed > 0 ? revenue / completed : 0),
              },
              { key: 'margin', label: t('stats_job_margin'), value: formatPercent(margin, locale) },
              {
                key: 'earnings',
                label: t('stats_employee_accrued'),
                value: formatMoney(selectedEmployee.earnings),
              },
            ],
          },
          {
            id: 'employee-action',
            rows: [
              {
                key: 'filter',
                label: t('stats_show_employee_only'),
                value: '',
                chevron: true,
                onPress: () => selectEmployeeDrilldown(selectedEmployee.id),
              },
            ],
          },
        ],
      };
    }
    if (detailType === 'department' && selectedDepartment) {
      const completed = asNumber(selectedDepartment.completed);
      const revenue = asNumber(selectedDepartment.revenue);
      const profit = asNumber(selectedDepartment.profit);
      const margin = revenue !== 0 ? profit / revenue : 0;
      return {
        ...common,
        title: selectedDepartment.id === 'none'
          ? t('stats_without_department')
          : selectedDepartment.name,
        sections: [
          {
            id: 'department-result',
            title: t('stats_department_result'),
            rows: [
              {
                key: 'profit',
                label: t('stats_job_profit'),
                value: formatMoney(profit),
                valueColor: profit > 0 ? theme.colors.success : theme.colors.danger,
              },
              { key: 'revenue', label: t('stats_completed_revenue'), value: formatMoney(revenue) },
              { key: 'completed', label: t('stats_completed_in_period'), value: formatCount(completed, locale) },
              { key: 'average', label: t('stats_avg_check'), value: formatMoney(completed > 0 ? revenue / completed : 0) },
              { key: 'margin', label: t('stats_job_margin'), value: formatPercent(margin, locale) },
            ],
          },
          {
            id: 'department-action',
            rows: [
              {
                key: 'filter',
                label: t('stats_show_department_only'),
                value: '',
                chevron: true,
                onPress: () => selectDepartmentDrilldown(selectedDepartment.id),
              },
            ],
          },
        ],
      };
    }
    return { ...common, title: '', sections: [] };
  }, [
    dashboard?.additionalSales,
    dashboard?.departments,
    dashboard?.employees,
    dashboard?.expenses,
    dashboard?.paymentMethods,
    dashboard?.sources,
    detailSubtitle,
    detailType,
    formatMoney,
    isSolo,
    locale,
    openDepartmentDetails,
    openEmployeeDetails,
    selectDepartmentDrilldown,
    selectEmployeeDrilldown,
    selectedDepartment,
    selectedEmployee,
    statusPreviewRows,
    summary,
    t,
    theme.colors.danger,
    theme.colors.success,
  ]);

  const infoModel = React.useMemo(() => {
    const key = infoType || 'overview';
    return {
      title: t(`stats_info_${key}_title`),
      body: t(`stats_info_${key}_body`),
    };
  }, [infoType, t]);

  if (dashboardQuery.isPending && !dashboard) {
    return (
      <Screen headerOptions={{ title: t('stats_title'), helpTopic: 'statistics' }} scroll={false}>
        <View style={s.centerState}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={s.loadingText}>{t('stats_loading')}</Text>
        </View>
      </Screen>
    );
  }

  if (dashboardQuery.isError && !dashboard) {
    return (
      <Screen headerOptions={{ title: t('stats_title'), helpTopic: 'statistics' }} scroll={false}>
        <View style={s.centerState}>
          <View style={s.errorIcon}>
            <Feather name="bar-chart-2" size={theme.icons.lg} color={theme.colors.danger} />
          </View>
          <Text style={s.errorTitle}>{t('stats_load_error_title')}</Text>
          <Text style={s.errorText}>{t('stats_load_error_body')}</Text>
          <Button title={t('btn_retry')} onPress={() => dashboardQuery.refetch()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      headerOptions={{ title: t('stats_title'), helpTopic: 'statistics' }}
      refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      contentContainerStyle={s.screenContent}
    >
      {refreshIndicator}
      <View style={s.content}>
        <View style={s.contextHeader}>
          <View style={s.contextText}>
            <Text style={s.contextTitle}>{scopeLabel}</Text>
            <Text style={s.contextSubtitle}>{periodLabel}</Text>
          </View>
          {dashboardQuery.isFetching && !refreshing ? (
            <ActivityIndicator size="small" color={theme.colors.primary} />
          ) : null}
        </View>

        {!isSolo && canViewCompany ? (
          <View style={s.scopeControl} accessibilityRole="tablist">
            {[
              { id: 'me', label: t('stats_scope_me') },
              { id: 'company', label: t('stats_scope_company') },
            ].map((item) => {
              const active = scope === item.id;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => setScope(item.id)}
                  style={({ pressed }) => [
                    s.scopeButton,
                    active && s.scopeButtonActive,
                    pressed && s.pressed,
                  ]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[s.scopeButtonText, active && s.scopeButtonTextActive]}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={s.periodControls}>
          <ScrollView
            horizontal
            style={s.periodScroll}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.periodRow}
          >
            {STATISTICS_PERIODS.map((item) => {
              const active = period === item.id;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => {
                    if (item.id === 'custom') {
                      openDatePicker();
                    } else {
                      setPeriod(item.id);
                    }
                  }}
                  style={({ pressed }) => [
                    s.periodChip,
                    active && s.periodChipActive,
                    pressed && s.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  {item.id === 'custom' ? (
                    <Feather
                      name="calendar"
                      size={theme.icons.sm}
                      color={active ? theme.colors.onPrimary : theme.colors.textSecondary}
                    />
                  ) : null}
                  <Text style={[s.periodChipText, active && s.periodChipTextActive]}>
                  {item.id === 'month'
                    ? formatCurrentMonthLabel(locale)
                    : item.id === 'year'
                      ? formatCurrentYearLabel()
                      : t(item.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {canOpenFilters ? (
            <FilterBarButton
              type="filter"
              active={activeFilterCount > 0}
              onPress={() => setFiltersVisible(true)}
              accessibilityLabel={t('stats_filters')}
            />
          ) : null}
        </View>

        <View style={s.metricGrid}>
          {topMetrics.map((metric) => (
            <MetricCard
              key={metric.id}
              {...metric}
              width={metricWidth}
              onPress={() => setDetailType(metric.detail)}
              t={t}
            />
          ))}
        </View>

        {!isSolo && requestedScope === 'company' ? (
          <>
            <DisclosureHeader
              title={t('stats_team_contribution')}
              onHelp={() => setInfoType('team')}
              onPress={() => setDetailType('team')}
              t={t}
            />
            <Card>
              <StatisticsTeamScorecard
                employees={dashboard?.employees || []}
                metric={teamMetric}
                onMetricChange={setTeamMetric}
                onEmployeePress={openEmployeeDetails}
                formatMoney={formatMoney}
                formatCount={formatDashboardCount}
                maxRows={3}
                t={t}
              />
            </Card>
          </>
        ) : null}

        <DisclosureHeader
          title={t(isWorkerView ? 'stats_my_dynamics' : 'stats_business_dynamics')}
          onHelp={() => setInfoType('trend')}
          t={t}
        />
        <Card>
          <StatisticsTrendChart
            rows={dashboard?.trend || []}
            mode={chartMode}
            onModeChange={setChartMode}
            locale={locale}
            granularity={dashboard?.meta?.granularity}
            formatMoney={formatMoney}
            personal={isWorkerView}
            t={t}
          />
        </Card>
      </View>

      <BaseModal
        visible={dateModalVisible}
        onClose={() => setDateModalVisible(false)}
        title={t('stats_period_picker')}
        presentation="sheet"
        maxHeightRatio={0.9}
        footer={
          <ModalActionsRow
            actions={[
              {
                key: 'cancel',
                title: t('btn_cancel'),
                variant: 'secondary',
                onPress: () => setDateModalVisible(false),
              },
              {
                key: 'apply',
                title: t('btn_apply'),
                disabled: !(draftRange.from && draftRange.to),
                onPress: () => {
                  if (!(draftRange.from && draftRange.to)) return;
                  setCustomRange(draftRange);
                  setPeriod('custom');
                  setDateModalVisible(false);
                },
              },
            ]}
          />
        }
      >
        <Text style={s.modalLead}>
          {draftRange.from && draftRange.to
            ? `${formatDate(draftRange.from, locale)} — ${formatDate(draftRange.to, locale)}`
            : t('stats_select_date_range')}
        </Text>
        <Calendar
          onDayPress={onCalendarDayPress}
          markedDates={markedDates}
          markingType="period"
          maxDate={toLocalISODate(new Date())}
          firstDay={1}
          enableSwipeMonths
          theme={{
            backgroundColor: theme.colors.surface,
            calendarBackground: theme.colors.surface,
            textSectionTitleColor: theme.colors.textSecondary,
            dayTextColor: theme.colors.text,
            monthTextColor: theme.colors.text,
            arrowColor: theme.colors.primary,
            todayTextColor: theme.colors.primary,
            selectedDayBackgroundColor: theme.colors.primary,
            selectedDayTextColor: theme.colors.onPrimary,
          }}
        />
      </BaseModal>

      <StatisticsFiltersPanel
        visible={filtersVisible}
        value={statisticsFilterValue}
        employees={canFilterByPeople ? employeeOptions : []}
        departments={canFilterByPeople ? departmentOptions : []}
        useDepartments={canFilterByPeople && dashboard?.meta?.use_departments === true}
        workTypes={workTypeOptions}
        useWorkTypes={canFilterByWorkTypes}
        onApply={applyStatisticsFilters}
        onClose={() => setFiltersVisible(false)}
      />

      <StatisticsDetailModal
        visible={Boolean(detailType)}
        title={detailModel.title}
        subtitle={detailModel.subtitle}
        sections={detailModel.sections}
        onClose={() => setDetailType(null)}
      />

      <BaseModal
        visible={Boolean(infoType)}
        onClose={() => setInfoType(null)}
        title={infoModel.title}
        presentation="sheet"
        footer={
          <Button title={t('btn_close')} onPress={() => setInfoType(null)} />
        }
      >
        <Text style={s.infoBody}>{infoModel.body}</Text>
      </BaseModal>
    </Screen>
  );
}

export default function StatsScreen() {
  return (
    <DeferredScreen>
      <StatsScreenContent />
    </DeferredScreen>
  );
}

const styles = (theme) =>
  StyleSheet.create({
    screenContent: { paddingBottom: theme.components.screenLayout.contentPaddingBottom },
    content: {
      width: '100%',
      maxWidth: CONTENT_MAX_WIDTH,
      alignSelf: 'center',
      paddingHorizontal: theme.components.screenLayout.contentPaddingX,
    },
    centerState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.xxl,
      gap: theme.spacing.md,
      backgroundColor: theme.colors.background,
    },
    loadingText: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm },
    errorIcon: {
      width: theme.spacing.xxl * 2 + theme.spacing.lg,
      height: theme.spacing.xxl * 2 + theme.spacing.lg,
      borderRadius: theme.radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(theme.colors.danger, 0.1),
    },
    errorTitle: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.lg,
      fontWeight: theme.typography.weight.bold,
      textAlign: 'center',
    },
    errorText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      textAlign: 'center',
      maxWidth: theme.spacing.xxl * 10,
    },
    contextHeader: {
      minHeight: theme.components.listItem.height,
      flexDirection: 'row',
      alignItems: 'center',
      paddingTop: theme.spacing.md,
      gap: theme.spacing.md,
    },
    contextText: { flex: 1, minWidth: 0 },
    contextTitle: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.xl,
      fontWeight: theme.typography.weight.bold,
    },
    contextSubtitle: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      marginTop: theme.spacing.xs,
    },
    scopeControl: {
      flexDirection: 'row',
      gap: theme.spacing.xs,
      padding: theme.spacing.xs,
      marginTop: theme.spacing.md,
      borderRadius: theme.radii.lg,
      backgroundColor: theme.colors.button.secondaryBg,
    },
    scopeButton: {
      flex: 1,
      minHeight: theme.components.input.height,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.md,
      paddingHorizontal: theme.spacing.md,
    },
    scopeButtonActive: { backgroundColor: theme.colors.primary },
    scopeButtonText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.semibold,
    },
    scopeButtonTextActive: { color: theme.colors.onPrimary },
    periodControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    periodScroll: { flex: 1, minWidth: 0 },
    periodRow: {
      gap: theme.spacing.sm,
      paddingTop: theme.spacing.md,
      paddingBottom: theme.spacing.sm,
    },
    periodChip: {
      minHeight: theme.components.button.sizes.sm.h,
      borderWidth: theme.components.button.borderWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.pill,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: theme.spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.xs,
    },
    periodChipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
    periodChipText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.semibold,
    },
    periodChipTextActive: { color: theme.colors.onPrimary },
    metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md },
    metricPressable: { minWidth: 0 },
    metricCard: { minHeight: theme.components.listItem.height * 3, justifyContent: 'space-between' },
    metricHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    metricIcon: {
      width: theme.components.input.height,
      height: theme.components.input.height,
      borderRadius: theme.radii.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    metricValue: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.xl,
      fontWeight: theme.typography.weight.bold,
      marginTop: theme.spacing.md,
    },
    metricLabel: {
      minHeight: Math.round(theme.typography.sizes.sm * theme.typography.lineHeights.normal * 2),
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      lineHeight: Math.round(theme.typography.sizes.sm * theme.typography.lineHeights.normal),
      marginTop: theme.spacing.xs,
    },
    metricTrend: {
      fontSize: theme.typography.sizes.xs,
      fontWeight: theme.typography.weight.semibold,
      marginTop: theme.spacing.sm,
    },
    disclosureHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
    },
    sectionHeaderContainer: { flex: 1, minWidth: 0 },
    detailsButton: {
      minHeight: theme.components.button.sizes.sm.h,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.xs,
      paddingLeft: theme.spacing.md,
    },
    detailsButtonText: {
      color: theme.colors.primary,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.semibold,
    },
    pressed: { opacity: theme.components.interactive?.pressedOpacity ?? 0.72 },
    modalLead: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm, lineHeight: Math.round(theme.typography.sizes.sm * theme.typography.lineHeights.relaxed), marginBottom: theme.spacing.md, textAlign: 'center' },
    infoBody: { color: theme.colors.text, fontSize: theme.typography.sizes.md, lineHeight: Math.round(theme.typography.sizes.md * theme.typography.lineHeights.relaxed) },
  });
