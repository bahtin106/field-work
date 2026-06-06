// app/orders/calendar.jsx (REFACTORED)
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { addDays, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from 'date-fns';
import { enUS as dfnsEnUS, ru as dfnsRu } from 'date-fns/locale';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  InteractionManager,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolate,
  interpolate,
  runOnJS,
  scrollTo,
  useAnimatedRef,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDecay,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CalendarMonthHeader } from '../../components/calendar/CalendarMonthHeader';
import { CalendarWeekRow } from '../../components/calendar/CalendarWeekRow';
import YearView from '../../components/calendar/YearView';
import DynamicOrderCard from '../../components/DynamicOrderCard';
import FiltersPanel from '../../components/filters/FiltersPanel';
import { useAuth } from '../../components/hooks/useAuth';
import Screen from '../../components/layout/Screen';
import AppHeader from '../../components/navigation/AppHeader';
import { useToast } from '../../components/ui/ToastProvider';
import { useCompanySettings } from '../../hooks/useCompanySettings';
import { clamp, getMonthWeeks } from '../../hooks/useCalendarLogic';
import goBackSmart from '../../lib/navigation/goBackSmart';
import dismissToRoute from '../../lib/navigation/dismissToRoute';
import { usePermissions } from '../../lib/permissions';
import {
  ENTITY_FIELD_TYPES,
  buildFallbackEntityFieldSettings,
  getEntityFieldMap,
} from '../../src/features/fieldSettings/catalog';
import { useEntityFieldSettings } from '../../src/features/fieldSettings/queries';
import {
  ensureRequestPrefetch,
  useCalendarRequests,
  useRequestExecutors,
  useRequestRealtimeSync,
} from '../../src/features/requests/queries';
import { enrichOrdersWithKnownExecutorRows } from '../../src/features/requests/executorNameCache';
import { preloadOrderDetailsScreen } from '../../src/features/requests/orderDetailsPreload';
import { useDepartmentsQuery } from '../../src/features/employees/queries';
import { formatDateKey } from '../../lib/calendarUtils';
import { isPerfLoggingEnabled, markFirstContent, markScreenMount } from '../../src/shared/perf/devMetrics';
import { getPrefetchRegistry } from '../../src/shared/query/prefetchRegistry';
import { useTranslation } from '../../src/i18n/useTranslation';
import { withAlpha } from '../../theme/colors';
import { useTheme } from '../../theme/ThemeProvider';
import { CALENDAR_GESTURE, CALENDAR_LAYOUT } from '../../constants/layout';

const DAY_KEYS = [
  'day_short_mo',
  'day_short_tu',
  'day_short_we',
  'day_short_th',
  'day_short_fr',
  'day_short_sa',
  'day_short_su',
];

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList);
const CALENDAR_VIEW_MODE = Object.freeze({
  YEAR: 'year',
  MONTH: 'month',
  WEEK: 'week',
  DAY: 'day',
  SCHEDULE: 'schedule',
});
const CALENDAR_VIEW_TABS = Object.freeze([
  { labelKey: 'calendar_view_year', mode: CALENDAR_VIEW_MODE.YEAR, disabled: false },
  { labelKey: 'calendar_view_month', mode: CALENDAR_VIEW_MODE.MONTH, disabled: false },
  { labelKey: 'calendar_view_week', mode: CALENDAR_VIEW_MODE.WEEK, disabled: false },
  { labelKey: 'calendar_view_day', mode: CALENDAR_VIEW_MODE.DAY, disabled: false },
  { labelKey: 'calendar_view_schedule', mode: CALENDAR_VIEW_MODE.SCHEDULE, disabled: true },
]);
const CALENDAR_SCOPE = Object.freeze({
  MY: 'my',
  ALL: 'all',
});
const CALENDAR_SCOPE_OPTIONS = Object.freeze([CALENDAR_SCOPE.MY, CALENDAR_SCOPE.ALL]);
const DATE_FNS_LOCALES = Object.freeze({
  en: dfnsEnUS,
  ru: dfnsRu,
});
const logCalendarPerf = (message) => {
  if (isPerfLoggingEnabled()) console.debug?.(message);
};
const CALENDAR_WEEK_STARTS_ON = 1;
const CALENDAR_DAYS_IN_WEEK = 7;
const CALENDAR_MONTH_KEY_LENGTH = 7;
const CALENDAR_EMPTY_MONTH_KEY = 'none';
const CALENDAR_NAV_LOCK_MS = 1200;
const CALENDAR_YEAR_WINDOW_RADIUS = 120;
const CALENDAR_TIME = Object.freeze({
  DAY_START_MONTH: 0,
  DATE_PART_MONTH_OFFSET: 1,
  MAX_HOUR: 23,
  MAX_MINUTE: 59,
  MAX_SECOND: 59,
  DAY_END_HOUR: 23,
  DAY_END_MINUTE: 59,
  DAY_END_SECOND: 59,
  DAY_END_MS: 999,
  MONTHS_IN_YEAR: 12,
  SECONDS_PER_MINUTE: 60,
  SECONDS_PER_HOUR: 3600,
});
const CALENDAR_RENDER = Object.freeze({
  MONTH_INITIAL_ITEMS: 2,
  MONTH_BATCH_ITEMS: 4,
  YEAR_INITIAL_ITEMS: 1,
  YEAR_WINDOW_SIZE: 2,
  YEAR_BATCH_ITEMS: 1,
  CELL_BATCH_PERIOD_MS: 16,
});
const CALENDAR_UI = Object.freeze({
  MIN_DAY_CELL_SIZE: 28,
  MAX_DAY_CELL_SIZE: 48,
  WEEK_ROW_EXTRA_SPACING_RATIO: 1.6,
  MONTH_HEADER_LINE_RATIO: 1.5,
  DAY_NAMES_HEIGHT_RATIO: 1.2,
  DAY_NAME_LINE_RATIO: 1.3,
  WEEKDAY_LINE_HEIGHT_RATIO: 0.6,
  DAY_NUMBER_LINE_HEIGHT_RATIO: 1.15,
  WEEK_SECTION_DAY_NUMBER_LINE_RATIO: 1.05,
  WEEK_SECTION_DAY_NAME_FONT_RATIO: 0.82,
  EVENT_SLOT_SPACING_RATIO: 0.2,
  EVENT_COUNT_FONT_RATIO: 0.9,
  HALF_SPACING_RATIO: 0.5,
  TAB_INDICATOR_HEIGHT: 2,
  BORDER_WIDTH: 1,
  SCOPE_SWITCH_PADDING: 2,
  SCOPE_SWITCH_HEIGHT: 28,
  SCOPE_PILL_MIN_WIDTH: 49,
  SCOPE_PILL_HEIGHT: 24,
  SCOPE_PILL_PADDING_X: 9,
  COMPACT_ICON_BUTTON_SIZE: 28,
  WEEK_DAY_BUTTON_MIN_HEIGHT: 58,
  WEEK_DAY_COUNT_SIZE: 18,
  WEEK_DAY_COUNT_MIN_WIDTH: 18,
  WEEK_DATE_BADGE_SIZE: 46,
  WEEK_SECTION_COUNT_MIN_WIDTH: 34,
  WEEK_SECTION_COUNT_HEIGHT: 26,
  WEEK_TIMELINE_OFFSET_X: 22,
  WEEK_ORDER_OFFSET_X: 58,
  DAY_TIMELINE_OFFSET_X: 18,
  DAY_ORDER_OFFSET_X: 42,
  DAY_DOT_OFFSET_X: 13,
  DAY_DOT_OFFSET_Y: 22,
  DAY_DOT_SIZE: 11,
  ACTIVE_BG_ALPHA: 0.08,
  ACTIVE_BORDER_ALPHA: 0.4,
  SUBTLE_BG_ALPHA: 0.07,
  PRESSED_OPACITY: 0.92,
  YEAR_SCROLL_SETTLE_VELOCITY_X: 0.05,
  COLLAPSE_PROGRESS_EPSILON: 0.001,
  COLLAPSED_EVENT_SLOT_RATIO: 0.5,
  EVENT_COUNT_COLLAPSED_SCALE: 0.24,
  EVENT_DOT_FADE_START_PROGRESS: 0.03,
  EVENT_DOT_VISIBLE_PROGRESS: 0.65,
  MONTH_HEADER_FADE_PROGRESS: 0.85,
  MONTH_HEADER_FADE_OPACITY: 0.18,
  SNAP_DISTANCE_EPSILON: 0.5,
});
const MONTH_COLLAPSE_SNAP_THRESHOLD = 0.5;
const MONTH_COLLAPSE_VELOCITY_THRESHOLD = 560;
const MONTH_COLLAPSE_MIN_DURATION = 180;
const MONTH_COLLAPSE_MAX_DURATION = 280;
const MONTH_ORDERS_DECAY = 0.998;
const MONTH_ORDERS_HEADER_FALLBACK_HEIGHT = 72;

function nowMs() {
  const perf = globalThis?.performance;
  if (perf && typeof perf.now === 'function') return perf.now();
  return Date.now();
}

function parseCalendarDateKey(value, fallback = new Date()) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const parsed = new Date(
      Number(match[1]),
      Number(match[2]) - CALENDAR_TIME.DATE_PART_MONTH_OFFSET,
      Number(match[3]),
    );
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return fallback;
}

function resolveDateFnsLocale(locale) {
  const key = String(locale || '').trim().toLowerCase().split(/[-_]/)[0];
  return DATE_FNS_LOCALES[key] || dfnsRu;
}

function formatWeekRangeLabel(startDate, endDate, dateLocale) {
  if (!startDate || !endDate) return '';
  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const sameMonth = sameYear && startDate.getMonth() === endDate.getMonth();
  if (sameMonth) {
    return `${format(startDate, 'd', { locale: dateLocale })}–${format(endDate, 'd MMMM yyyy', { locale: dateLocale })}`;
  }
  if (sameYear) {
    return `${format(startDate, 'd MMM', { locale: dateLocale })} – ${format(endDate, 'd MMM yyyy', { locale: dateLocale })}`;
  }
  return `${format(startDate, 'd MMM yyyy', { locale: dateLocale })} – ${format(endDate, 'd MMM yyyy', { locale: dateLocale })}`;
}

function hasExplicitTimeInDatetime(input) {
  const raw = String(input || '').trim();
  if (!raw) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const timeMatch = raw.match(/[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?/);
  if (!timeMatch) return false;
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const seconds = Number(timeMatch[3] || 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return false;
  }
  return hours !== 0 || minutes !== 0 || seconds !== 0;
}

function getOrderScheduleSortValue(order) {
  const rawDepartureTime = String(order?.departure_time || '').trim();
  const timeMatch = rawDepartureTime.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (timeMatch) {
    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    const seconds = Number(timeMatch[3] || 0);
    if (
      Number.isFinite(hours) &&
      Number.isFinite(minutes) &&
      Number.isFinite(seconds) &&
      hours >= 0 &&
      hours <= CALENDAR_TIME.MAX_HOUR &&
      minutes >= 0 &&
      minutes <= CALENDAR_TIME.MAX_MINUTE &&
      seconds >= 0 &&
      seconds <= CALENDAR_TIME.MAX_SECOND
    ) {
      return hours * CALENDAR_TIME.SECONDS_PER_HOUR + minutes * CALENDAR_TIME.SECONDS_PER_MINUTE + seconds;
    }
  }

  const startRaw = order?.time_window_start;
  if (!hasExplicitTimeInDatetime(startRaw)) return Number.POSITIVE_INFINITY;
  if (!startRaw) return Number.POSITIVE_INFINITY;
  const parsed = new Date(startRaw);
  if (Number.isNaN(parsed.getTime())) return Number.POSITIVE_INFINITY;
  const hours = parsed.getHours();
  const minutes = parsed.getMinutes();
  const seconds = parsed.getSeconds();
  if (hours === 0 && minutes === 0 && seconds === 0) return Number.POSITIVE_INFINITY;
  return hours * CALENDAR_TIME.SECONDS_PER_HOUR + minutes * CALENDAR_TIME.SECONDS_PER_MINUTE + seconds;
}

function CalendarScreenContent() {
  const { profile, user, isAuthenticated, isInitializing } = useAuth();
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const toast = useToast();
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const dateLocale = useMemo(() => resolveDateFnsLocale(locale), [locale]);
  const localeTag = useMemo(
    () => String(locale || '').replace('_', '-') || undefined,
    [locale],
  );
  const returnTo = useMemo(() => {
    try {
      return Reflect.has(params, 'returnTo') ? String(params.returnTo) : '';
    } catch {
      return '';
    }
  }, [params]);
  const returnParams = useMemo(() => {
    try {
      return Reflect.has(params, 'returnParams') ? JSON.parse(String(params.returnParams)) : {};
    } catch {
      return {};
    }
  }, [params]);
  const initialSelectedDate = useMemo(() => {
    try {
      if (!Reflect.has(params, 'selectedDate')) return '';
      return String(params.selectedDate || '').trim();
    } catch {
      return '';
    }
  }, [params]);
  const initialSelectedUserId = useMemo(() => {
    try {
      if (!Reflect.has(params, 'selectedUserId')) return '';
      return String(params.selectedUserId || '').trim();
    } catch {
      return '';
    }
  }, [params]);
  const openedFromOrder = useMemo(() => returnTo.startsWith('/orders/'), [returnTo]);

  const layoutMetrics = useMemo(() => {
    const horizontalMargin = theme.spacing.md;
    const innerPadding = theme.spacing.sm;
    const cardWidth = Math.max(0, screenWidth - horizontalMargin * 2);
    const rawCellSize = Math.max(
      CALENDAR_UI.MIN_DAY_CELL_SIZE,
      Math.min(
        (cardWidth - innerPadding * 2) / CALENDAR_DAYS_IN_WEEK,
        CALENDAR_UI.MAX_DAY_CELL_SIZE,
      ),
    );
    const dayCellSize = rawCellSize;
    const weekRowHeight = dayCellSize + theme.spacing.xs * CALENDAR_UI.WEEK_ROW_EXTRA_SPACING_RATIO;
    const monthHeaderHeight =
      theme.spacing.md * 2 + theme.typography.sizes.lg * CALENDAR_UI.MONTH_HEADER_LINE_RATIO;
    const dayNamesHeight =
      theme.spacing.sm * CALENDAR_UI.DAY_NAMES_HEIGHT_RATIO +
      theme.typography.sizes.xs * CALENDAR_UI.DAY_NAME_LINE_RATIO;
    const topSectionsHeight = monthHeaderHeight + dayNamesHeight;
    return {
      cardWidth,
      innerPadding,
      dayCellSize,
      weekRowHeight,
      monthHeaderHeight,
      dayNamesHeight,
      topSectionsHeight,
    };
  }, [screenWidth, theme]);

  const todayKey = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [viewMode, setViewMode] = useState(CALENDAR_VIEW_MODE.MONTH);
  const [scope, setScope] = useState(CALENDAR_SCOPE.MY);
  const [executorFilterIds, setExecutorFilterIds] = useState([]);
  const [executorModalVisible, setExecutorModalVisible] = useState(false);
  const [calendarQueryAnchorMonth, setCalendarQueryAnchorMonth] = useState(startOfMonth(new Date()));
  const hasEmployeeFilter = Array.isArray(executorFilterIds) && executorFilterIds.length > 0;
  const { has, loading: permissionsLoading } = usePermissions();
  const canViewAllOrders = !permissionsLoading && has('canViewAllOrders');
  const authAccountType = String(user?.user_metadata?.account_type || '').toLowerCase();
  const isSoloAdmin =
    String(profile?.role || '').toLowerCase() === 'admin' && authAccountType === 'solo';
  const canUseCalendarAllScope = canViewAllOrders && !isSoloAdmin;
  const companyId = profile?.company_id || null;
  const { settings: companySettings } = useCompanySettings(companyId);
  const { data: orderFieldSettingsData } = useEntityFieldSettings(ENTITY_FIELD_TYPES.ORDER, {
    enabled: !!companyId,
  });
  const orderFieldSettings = useMemo(
    () => orderFieldSettingsData || buildFallbackEntityFieldSettings(ENTITY_FIELD_TYPES.ORDER),
    [orderFieldSettingsData],
  );
  const orderFieldsByKey = useMemo(
    () => getEntityFieldMap(orderFieldSettings),
    [orderFieldSettings],
  );
  const departureTimeEnabled = orderFieldsByKey.get('departure_time')?.isEnabled !== false;
  const navigationPresetRef = useRef('');

  useEffect(() => {
    markScreenMount('Calendar');
  }, []);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      preloadOrderDetailsScreen().catch(() => {});
    });
    return () => {
      try {
        task.cancel?.();
      } catch {}
    };
  }, []);

  const calendarQueryRange = useMemo(() => {
    const base = viewMode === CALENDAR_VIEW_MODE.YEAR ? calendarQueryAnchorMonth : currentMonth;
    if (viewMode !== CALENDAR_VIEW_MODE.YEAR) {
      const start = startOfWeek(startOfMonth(base), { weekStartsOn: CALENDAR_WEEK_STARTS_ON });
      const end = endOfWeek(endOfMonth(base), { weekStartsOn: CALENDAR_WEEK_STARTS_ON });
      end.setHours(
        CALENDAR_TIME.DAY_END_HOUR,
        CALENDAR_TIME.DAY_END_MINUTE,
        CALENDAR_TIME.DAY_END_SECOND,
        CALENDAR_TIME.DAY_END_MS,
      );
      return {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      };
    }

    const start = new Date(base.getFullYear(), CALENDAR_TIME.DAY_START_MONTH, 1);
    const end = new Date(
      base.getFullYear(),
      CALENDAR_TIME.MONTHS_IN_YEAR - 1,
      31,
      CALENDAR_TIME.DAY_END_HOUR,
      CALENDAR_TIME.DAY_END_MINUTE,
      CALENDAR_TIME.DAY_END_SECOND,
      CALENDAR_TIME.DAY_END_MS,
    );
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    };
  }, [calendarQueryAnchorMonth, currentMonth, viewMode]);

  useEffect(() => {
    const yearsDelta = currentMonth.getFullYear() - calendarQueryAnchorMonth.getFullYear();
    if (yearsDelta === 0) return;
    setCalendarQueryAnchorMonth(startOfMonth(currentMonth));
  }, [calendarQueryAnchorMonth, currentMonth]);

  const {
    data: orders = [],
    isLoading: isCalendarLoading,
    isFetching: isCalendarFetching,
    isPlaceholderData: isCalendarPlaceholderData,
  } = useCalendarRequests({
    userId: profile?.id,
    role: profile?.role,
    scope: canUseCalendarAllScope ? (hasEmployeeFilter ? CALENDAR_SCOPE.ALL : scope) : CALENDAR_SCOPE.MY,
    startDate: calendarQueryRange.startDate,
    endDate: calendarQueryRange.endDate,
    refetchIntervalMs: false,
    enabled: isAuthenticated && !isInitializing && !!profile?.id && !!profile?.role,
    isScreenActive: isFocused,
  });

  useRequestRealtimeSync({ enabled: false });
  const calendarHasAssignedOrders = useMemo(
    () => Array.isArray(orders) && orders.some((order) => String(order?.assigned_to || '').trim()),
    [orders],
  );
  const { data: executors = [] } = useRequestExecutors({
    companyId,
    enabled:
      isAuthenticated &&
      !isInitializing &&
      !!profile?.id &&
      (calendarHasAssignedOrders || (canUseCalendarAllScope && (executorModalVisible || hasEmployeeFilter))),
    placeholderData: (prev) => prev ?? [],
  });
  const { data: departments = [] } = useDepartmentsQuery({
    companyId,
    enabled: !!companyId && canUseCalendarAllScope && (executorModalVisible || hasEmployeeFilter),
    onlyEnabled: true,
  });

  const executorFilterItems = useMemo(
    () =>
      (Array.isArray(executors) ? executors : [])
        .map((row) => {
          const id = String(row?.id || '').trim();
          if (!id) return null;
          const fullName =
            `${String(row?.first_name || '').trim()} ${String(row?.middle_name || '').trim()} ${String(row?.last_name || '').trim()}`.trim();
          return {
            id,
            label: fullName || String(row?.full_name || row?.email || '').trim() || id,
          };
        })
        .filter(Boolean)
        .sort((a, b) => String(a.label).localeCompare(String(b.label), localeTag)),
    [executors, localeTag],
  );
  const executorFilterSet = useMemo(
    () => new Set((executorFilterIds || []).map((id) => String(id))),
    [executorFilterIds],
  );
  const assignmentEmployees = useMemo(
    () =>
      executorFilterItems.map((item) => {
        const source = (Array.isArray(executors) ? executors : []).find(
          (row) => String(row?.id || '') === String(item.id),
        );
        return {
          id: item.id,
          display_name: item.label,
          role: String(source?.role || '').toLowerCase() || undefined,
          email: source?.email || '',
          department_id: source?.department_id ?? null,
        };
      }),
    [executorFilterItems, executors],
  );
  const assignmentPanelConfig = useMemo(
    () => ({
      title: t('placeholder_pick_employee'),
      employees: assignmentEmployees,
      multiple: true,
      selectedIds: executorFilterIds,
      defaults: { selectedIds: [] },
      includeUnassigned: false,
      onApply: (selection) => {
        const next = Array.isArray(selection)
          ? selection.map((id) => String(id)).filter(Boolean)
          : [];
        setExecutorFilterIds(next);
        if (next.length > 0) setScope(CALENDAR_SCOPE.ALL);
      },
      onReset: () => setExecutorFilterIds([]),
    }),
    [assignmentEmployees, executorFilterIds, t],
  );

  const firstContentMarkedRef = useRef(false);
  const perfMountStartedRef = useRef(false);
  const perfMountStartMsRef = useRef(0);
  const perfFirstContentLoggedRef = useRef(false);
  const perfGridLoggedRef = useRef(false);
  const perfYearMountStartedRef = useRef(false);
  const perfYearMountStartMsRef = useRef(0);
  const perfYearFirstContentLoggedRef = useRef(false);

  useEffect(() => {
    if (perfMountStartedRef.current) return;
    perfMountStartedRef.current = true;
    perfMountStartMsRef.current = nowMs();
    logCalendarPerf('[perf] calendar-mount.start');
  }, []);

  useEffect(() => {
    if (firstContentMarkedRef.current) return;
    if (isCalendarLoading || isCalendarPlaceholderData) return;
    firstContentMarkedRef.current = true;
    markFirstContent('Calendar');
    if (!perfFirstContentLoggedRef.current) {
      perfFirstContentLoggedRef.current = true;
      const elapsedMs = Math.max(0, nowMs() - perfMountStartMsRef.current);
      logCalendarPerf(`[perf] calendar.first-content.now: ${Math.round(elapsedMs)}ms`);
    }
  }, [isCalendarLoading, isCalendarPlaceholderData]);

  useEffect(() => {
    if (canUseCalendarAllScope) return;
    if (scope !== CALENDAR_SCOPE.MY) setScope(CALENDAR_SCOPE.MY);
    if (executorFilterIds.length) setExecutorFilterIds([]);
    if (executorModalVisible) setExecutorModalVisible(false);
  }, [canUseCalendarAllScope, executorFilterIds, executorModalVisible, scope]);

  useFocusEffect(
    useCallback(() => {
      if (!canUseCalendarAllScope || openedFromOrder) return undefined;
      setScope(CALENDAR_SCOPE.MY);
      setExecutorFilterIds([]);
      return undefined;
    }, [canUseCalendarAllScope, openedFromOrder]),
  );

  useEffect(() => {
    if (!openedFromOrder) return;

    const presetKey = JSON.stringify({
      selectedDate: initialSelectedDate || '',
      selectedUserId: initialSelectedUserId || '',
      profileId: profile?.id || '',
      canUseCalendarAllScope,
    });
    if (navigationPresetRef.current === presetKey) return;

    if (initialSelectedDate) {
      const parsedDate = new Date(initialSelectedDate);
      if (!Number.isNaN(parsedDate.getTime())) {
        const monthStart = startOfMonth(parsedDate);
        setSelectedDate(format(parsedDate, 'yyyy-MM-dd'));
        setCurrentMonth(monthStart);
        setCalendarQueryAnchorMonth(monthStart);
      }
    }

    const myProfileId = String(profile?.id || '').trim();
    if (!initialSelectedUserId) {
      if (canUseCalendarAllScope) {
        setExecutorFilterIds([]);
        setScope(CALENDAR_SCOPE.ALL);
      } else {
        setExecutorFilterIds([]);
        setScope(CALENDAR_SCOPE.MY);
      }
      navigationPresetRef.current = presetKey;
      return;
    }

    if (myProfileId && initialSelectedUserId === myProfileId) {
      setExecutorFilterIds([]);
      setScope(CALENDAR_SCOPE.MY);
      navigationPresetRef.current = presetKey;
      return;
    }

    if (canUseCalendarAllScope) {
      setExecutorFilterIds([initialSelectedUserId]);
      setScope(CALENDAR_SCOPE.ALL);
    } else {
      setExecutorFilterIds([]);
      setScope(CALENDAR_SCOPE.MY);
    }
    navigationPresetRef.current = presetKey;
  }, [canUseCalendarAllScope, initialSelectedDate, initialSelectedUserId, openedFromOrder, profile?.id]);

  const MONTH_LIST_MIDDLE_INDEX = CALENDAR_LAYOUT.MONTH_WINDOW_RADIUS;

  const [measuredMonthHeaderHeight, setMeasuredMonthHeaderHeight] = useState(
    layoutMetrics.monthHeaderHeight,
  );
  const [measuredDayNamesHeight, setMeasuredDayNamesHeight] = useState(layoutMetrics.dayNamesHeight);
  const [measuredWeekRowHeight, setMeasuredWeekRowHeight] = useState(layoutMetrics.weekRowHeight);

  const [isCollapsed, setIsCollapsed] = useState(false);

  const collapseTranslate = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const visibleMonthIndex = useSharedValue(MONTH_LIST_MIDDLE_INDEX);
  const isCollapsedShared = useSharedValue(false);
  const monthPagerRef = useAnimatedRef();
  const ordersListRef = useAnimatedRef();
  const lastHandledPageIndex = useRef(MONTH_LIST_MIDDLE_INDEX);
  const visibleMonthIndexRef = useRef(MONTH_LIST_MIDDLE_INDEX);
  const monthScrollRafRef = useRef(null);
  const pendingScrollTargetIndexRef = useRef(null);
  const [visibleMonthRenderIndex, setVisibleMonthRenderIndex] = useState(MONTH_LIST_MIDDLE_INDEX);
  const settledMonthOffsetX = useSharedValue(layoutMetrics.cardWidth * MONTH_LIST_MIDDLE_INDEX);
  const monthSwipeInteraction = useSharedValue(0);
  const monthOrdersPanStartCollapse = useSharedValue(0);
  const monthOrdersPanStartScrollY = useSharedValue(0);
  const monthOrdersMaxScrollY = useSharedValue(0);
  const monthOrdersHeaderHeight = useSharedValue(MONTH_ORDERS_HEADER_FALLBACK_HEIGHT);
  const monthOrdersContentHeightRef = useRef(0);
  const monthOrdersViewportHeightRef = useRef(0);
  const [monthWindowAnchor, setMonthWindowAnchor] = useState(startOfMonth(new Date()));
  const YEAR_LIST_MIDDLE_INDEX = CALENDAR_YEAR_WINDOW_RADIUS;
  const initialYearRef = useRef(currentMonth.getFullYear());
  const yearFlatListRef = useRef(null);
  const lastHandledYearPageIndex = useRef(YEAR_LIST_MIDDLE_INDEX);
  const visibleYearIndexRef = useRef(YEAR_LIST_MIDDLE_INDEX);
  const [visibleYearRenderIndex, setVisibleYearRenderIndex] = useState(YEAR_LIST_MIDDLE_INDEX);

  const dynamicMonths = useMemo(() => {
    const months = [];
    const baseMonth = monthWindowAnchor;
    for (
      let i = -CALENDAR_LAYOUT.MONTH_WINDOW_RADIUS;
      i <= CALENDAR_LAYOUT.MONTH_WINDOW_RADIUS - 1;
      i++
    ) {
      months.push(startOfMonth(new Date(baseMonth.getFullYear(), baseMonth.getMonth() + i, 1)));
    }
    return months;
  }, [monthWindowAnchor]);
  const dynamicYears = useMemo(() => {
    const years = [];
    const baseYear = initialYearRef.current;
    for (let i = -CALENDAR_YEAR_WINDOW_RADIUS; i <= CALENDAR_YEAR_WINDOW_RADIUS; i++) {
      years.push(baseYear + i);
    }
    return years;
  }, []);
  const monthWeeksCacheRef = useRef(new Map());
  const getWeeksForMonth = useCallback((monthDate) => {
    const key = monthDate?.getTime?.();
    if (!Number.isFinite(key)) return [];
    const cached = monthWeeksCacheRef.current.get(key);
    if (cached) return cached;
    const weeks = getMonthWeeks(monthDate.getFullYear(), monthDate.getMonth());
    monthWeeksCacheRef.current.set(key, weeks);
    return weeks;
  }, []);
  useEffect(() => {
    monthWeeksCacheRef.current.clear();
  }, [monthWindowAnchor]);
  const activeVisibleMonth = useMemo(
    () => dynamicMonths[visibleMonthRenderIndex] ?? currentMonth,
    [currentMonth, dynamicMonths, visibleMonthRenderIndex],
  );
  const activeVisibleYear = useMemo(
    () => dynamicYears[visibleYearRenderIndex] ?? currentMonth.getFullYear(),
    [currentMonth, dynamicYears, visibleYearRenderIndex],
  );
  const monthWeeks = useMemo(
    () => getMonthWeeks(activeVisibleMonth.getFullYear(), activeVisibleMonth.getMonth()),
    [activeVisibleMonth],
  );
  const actualWeekRows = useMemo(() => monthWeeks.length, [monthWeeks]);
  const selectedWeekIndex = useMemo(() => {
    if (!selectedDate) return 0;
    const found = monthWeeks.findIndex((week) =>
      week.some((cell) => cell.date && formatDateKey(cell.date) === selectedDate),
    );
    return found >= 0 ? found : 0;
  }, [monthWeeks, selectedDate]);
  const selectedDateObj = useMemo(
    () => parseCalendarDateKey(selectedDate, currentMonth),
    [currentMonth, selectedDate],
  );
  const activeWeekStart = useMemo(
    () => startOfWeek(selectedDateObj, { weekStartsOn: CALENDAR_WEEK_STARTS_ON }),
    [selectedDateObj],
  );
  const activeWeekEnd = useMemo(
    () => endOfWeek(selectedDateObj, { weekStartsOn: CALENDAR_WEEK_STARTS_ON }),
    [selectedDateObj],
  );
  const activeWeekDates = useMemo(
    () => Array.from({ length: CALENDAR_DAYS_IN_WEEK }, (_, index) => addDays(activeWeekStart, index)),
    [activeWeekStart],
  );
  const activeWeekLabel = useMemo(
    () => formatWeekRangeLabel(activeWeekStart, activeWeekEnd, dateLocale),
    [activeWeekEnd, activeWeekStart, dateLocale],
  );
  const activeDayLabel = useMemo(
    () => format(selectedDateObj, 'd MMMM yyyy', { locale: dateLocale }),
    [dateLocale, selectedDateObj],
  );

  const collapsedRef = useRef(false);
  const resolvedMonthHeaderHeight = Math.max(
    measuredMonthHeaderHeight,
    layoutMetrics.monthHeaderHeight,
  );
  const weeksHeight = measuredWeekRowHeight * actualWeekRows;
  const expandedCalendarHeight = resolvedMonthHeaderHeight + measuredDayNamesHeight + weeksHeight;
  const collapsedCalendarHeight = measuredDayNamesHeight + measuredWeekRowHeight;
  const stageOneDistance = Math.max(expandedCalendarHeight - collapsedCalendarHeight, 1);
  const stageOneDistanceSafe = stageOneDistance;

  const handlePageChange = useCallback(
    (pageIndex) => {
      if (
        pageIndex < 0 ||
        pageIndex >= dynamicMonths.length ||
        lastHandledPageIndex.current === pageIndex
      ) {
        return;
      }
      lastHandledPageIndex.current = pageIndex;
      const nextMonth = dynamicMonths[pageIndex];
      if (!nextMonth) return;
      setCurrentMonth(nextMonth);
      setSelectedDate(format(startOfMonth(nextMonth), 'yyyy-MM-dd'));
    },
    [dynamicMonths],
  );

  const resolveYearPageIndex = useCallback(
    (offsetX) => {
      const pageWidth = layoutMetrics.cardWidth;
      if (!pageWidth) return 0;
      const maxIndex = Math.max(0, dynamicYears.length - 1);
      return clamp(Math.round(offsetX / pageWidth), 0, maxIndex);
    },
    [dynamicYears.length, layoutMetrics.cardWidth],
  );

  const _commitVisibleMonthIndex = useCallback(
    (pageIndex) => {
      visibleMonthIndex.value = pageIndex;
      settledMonthOffsetX.value = layoutMetrics.cardWidth * pageIndex;
      monthSwipeInteraction.value = 0;
      handlePageChange(pageIndex);
      pendingScrollTargetIndexRef.current = null;
      if (monthScrollRafRef.current != null) {
        try {
          cancelAnimationFrame(monthScrollRafRef.current);
        } catch {}
        monthScrollRafRef.current = null;
      }
    },
    [handlePageChange, layoutMetrics.cardWidth, monthSwipeInteraction, settledMonthOffsetX, visibleMonthIndex],
  );
  const commitVisibleYearIndex = useCallback(
    (pageIndex) => {
      if (
        pageIndex < 0 ||
        pageIndex >= dynamicYears.length ||
        lastHandledYearPageIndex.current === pageIndex
      ) {
        return;
      }
      lastHandledYearPageIndex.current = pageIndex;
      visibleYearIndexRef.current = pageIndex;
      setVisibleYearRenderIndex(pageIndex);
      const nextYear = dynamicYears[pageIndex];
      if (!Number.isFinite(nextYear)) return;
      if (perfYearMountStartedRef.current) {
        const elapsedMs = Math.max(0, nowMs() - perfYearMountStartMsRef.current);
        logCalendarPerf(`[perf] calendar.year.page-change.now: ${Math.round(elapsedMs)}ms`);
      }
      setCurrentMonth((prev) => startOfMonth(new Date(nextYear, prev.getMonth(), 1)));
    },
    [dynamicYears],
  );

  useEffect(() => {
    return () => {
      if (monthScrollRafRef.current != null) {
        try {
          cancelAnimationFrame(monthScrollRafRef.current);
        } catch {}
      }
    };
  }, []);

  useEffect(() => {
    if (viewMode !== CALENDAR_VIEW_MODE.YEAR) {
      perfYearMountStartedRef.current = false;
      perfYearFirstContentLoggedRef.current = false;
      return;
    }
    if (perfYearMountStartedRef.current) return;
    perfYearMountStartedRef.current = true;
    perfYearMountStartMsRef.current = nowMs();
    logCalendarPerf('[perf] calendar-year-mount.start');
  }, [viewMode]);

  useEffect(() => {
    if (!layoutMetrics.cardWidth) return;
    const targetIndex = dynamicMonths.findIndex(
      (monthDate) =>
        monthDate.getFullYear() === currentMonth.getFullYear() &&
        monthDate.getMonth() === currentMonth.getMonth(),
    );
    if (targetIndex < 0) return;
    lastHandledPageIndex.current = targetIndex;
    visibleMonthIndexRef.current = targetIndex;
    visibleMonthIndex.value = targetIndex;
    setVisibleMonthRenderIndex(targetIndex);
    settledMonthOffsetX.value = layoutMetrics.cardWidth * targetIndex;
    if (monthPagerRef.current && !isCollapsed) {
      try {
        monthPagerRef.current.scrollToIndex({ index: targetIndex, animated: false });
      } catch {}
    }
  }, [
    currentMonth,
    dynamicMonths,
    isCollapsed,
    layoutMetrics.cardWidth,
    monthPagerRef,
    settledMonthOffsetX,
    visibleMonthIndex,
  ]);
  useEffect(() => {
    if (!layoutMetrics.cardWidth) return;
    const targetIndex = dynamicYears.findIndex((yearValue) => yearValue === currentMonth.getFullYear());
    if (targetIndex < 0) return;
    lastHandledYearPageIndex.current = targetIndex;
    visibleYearIndexRef.current = targetIndex;
    setVisibleYearRenderIndex(targetIndex);
    try {
      yearFlatListRef.current?.scrollToIndex?.({ index: targetIndex, animated: false });
    } catch {}
  }, [currentMonth, dynamicYears, layoutMetrics.cardWidth]);

  useFocusEffect(
    useCallback(() => {
      collapseTranslate.value = 0;
    }, [collapseTranslate]),
  );

  useEffect(() => {
    if (viewMode === CALENDAR_VIEW_MODE.MONTH) {
      collapseTranslate.value = 0;
    }
  }, [viewMode, collapseTranslate]);

  useEffect(() => {
    if (!isCollapsed) {
      scrollY.value = 0;
    }
  }, [isCollapsed, scrollY]);

  useEffect(() => {
    collapseTranslate.value = clamp(collapseTranslate.value, 0, stageOneDistanceSafe);
  }, [stageOneDistanceSafe, collapseTranslate]);

  useEffect(() => {
    setMeasuredMonthHeaderHeight(layoutMetrics.monthHeaderHeight);
    setMeasuredDayNamesHeight(layoutMetrics.dayNamesHeight);
    setMeasuredWeekRowHeight(layoutMetrics.weekRowHeight);
  }, [layoutMetrics.dayNamesHeight, layoutMetrics.monthHeaderHeight, layoutMetrics.weekRowHeight]);

  useEffect(() => {
    if (!selectedDate) return;
    const selectedDateObj = new Date(selectedDate);
    setCurrentMonth((prevMonth) => {
      const prevStart = startOfMonth(prevMonth);
      if (
        selectedDateObj.getMonth() === prevStart.getMonth() &&
        selectedDateObj.getFullYear() === prevStart.getFullYear()
      ) {
        return prevMonth;
      }
      return startOfMonth(selectedDateObj);
    });
  }, [selectedDate]);

  const arrowHitSlop = useMemo(() => {
    const gap = theme.spacing.md;
    return { top: gap, bottom: gap, left: gap, right: gap };
  }, [theme.spacing.md]);

  useEffect(() => {
    if (perfGridLoggedRef.current || viewMode !== CALENDAR_VIEW_MODE.MONTH || !monthWeeks.length) return;
    perfGridLoggedRef.current = true;
    const elapsedMs = Math.max(0, nowMs() - perfMountStartMsRef.current);
    logCalendarPerf(`[perf] calendar.grid-ready.now: ${Math.round(elapsedMs)}ms`);
  }, [monthWeeks.length, viewMode]);

  const indicatorSlotBaseHeight =
    theme.typography.sizes.xs + theme.spacing.xs * CALENDAR_UI.EVENT_SLOT_SPACING_RATIO;
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1 },
        calendarLoadingOverlay: {
          position: 'absolute',
          top: theme.spacing.sm,
          right: theme.spacing.md,
          zIndex: 10,
        },
        calendarLoadingPill: {
          width: CALENDAR_UI.COMPACT_ICON_BUTTON_SIZE,
          height: CALENDAR_UI.COMPACT_ICON_BUTTON_SIZE,
          borderRadius: CALENDAR_UI.COMPACT_ICON_BUTTON_SIZE / 2,
          borderWidth: CALENDAR_UI.BORDER_WIDTH,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
        },
        tabsWrapper: {
          paddingHorizontal: theme.spacing.md,
          paddingTop: theme.spacing.xs,
          paddingBottom: theme.spacing.sm * CALENDAR_UI.HALF_SPACING_RATIO,
          marginTop: -theme.spacing.sm * CALENDAR_UI.HALF_SPACING_RATIO,
          marginBottom: theme.spacing.sm * CALENDAR_UI.HALF_SPACING_RATIO,
          backgroundColor: theme.colors.background,
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: theme.typography.sizes.sm + theme.spacing.md,
        },
        tabsContent: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          flex: 1,
        },
        tabItem: {
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.xs,
          justifyContent: 'center',
          alignItems: 'center',
        },
        tabItemDisabled: {
          opacity: theme.components?.listItem?.disabledOpacity,
        },
        tabIndicator: {
          height: CALENDAR_UI.TAB_INDICATOR_HEIGHT,
          marginTop: theme.spacing.xs,
          borderRadius: CALENDAR_UI.TAB_INDICATOR_HEIGHT / 2,
          alignSelf: 'stretch',
        },
        viewPanelText: {
          color: theme.colors.textSecondary,
          fontSize: theme.typography.sizes.sm,
          fontWeight: theme.typography.weight.medium,
        },
        viewPanelTextDisabled: {
          color: theme.colors.textSecondary,
        },
        calendarContent: {
          overflow: 'hidden',
          alignItems: 'center',
          alignSelf: 'center',
          width: layoutMetrics.cardWidth,
        },
        monthPage: {
          paddingHorizontal: 0,
          width: layoutMetrics.cardWidth,
          alignSelf: 'center',
        },
        monthHeaderRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-start',
          width: layoutMetrics.cardWidth,
          height: layoutMetrics.monthHeaderHeight,
          alignSelf: 'center',
          paddingHorizontal: theme.spacing.md,
        },
        monthHeaderSide: {
          width: layoutMetrics.dayCellSize + theme.spacing.md,
          alignItems: 'center',
          justifyContent: 'center',
        },
        monthHeaderCenter: {
          flex: 1,
          minWidth: 0,
          alignItems: 'center',
          justifyContent: 'center',
        },
        monthHeaderLabel: {
          width: '100%',
          marginHorizontal: theme.spacing.sm,
          fontSize: theme.typography.sizes.lg,
          fontWeight: theme.typography.weight.bold,
          color: theme.colors.text,
          textAlign: 'center',
        },
        calendarArrow: {
          padding: theme.spacing.xs,
        },
        weekdayRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          width: layoutMetrics.cardWidth,
          height: layoutMetrics.dayNamesHeight,
          alignSelf: 'center',
          paddingHorizontal: layoutMetrics.innerPadding,
          alignItems: 'center',
        },
        weekdayLabel: {
          width: layoutMetrics.dayCellSize,
          textAlign: 'center',
          fontSize: theme.typography.sizes.xs,
          fontWeight: theme.typography.weight.medium,
          color: theme.colors.textSecondary,
          lineHeight: layoutMetrics.dayCellSize * CALENDAR_UI.WEEKDAY_LINE_HEIGHT_RATIO,
        },
        weekRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          width: layoutMetrics.cardWidth,
          alignSelf: 'center',
          paddingHorizontal: layoutMetrics.innerPadding,
          height: layoutMetrics.weekRowHeight,
          alignItems: 'center',
        },
        dayCell: {
          alignItems: 'center',
          justifyContent: 'center',
          width: layoutMetrics.dayCellSize,
          height: layoutMetrics.dayCellSize,
          borderRadius: layoutMetrics.dayCellSize / 2,
        },
        dayCellSelectedOutline: {
          borderWidth: 2,
          borderColor: theme.colors.primary,
        },
        dayCellSelectedFilled: {
          backgroundColor: theme.colors.primary,
        },
        dayContent: {
          width: '100%',
          height: '100%',
          alignItems: 'center',
          justifyContent: 'center',
        },
        dayNumber: {
          fontFamily: theme.typography.fontFamily,
          fontWeight: theme.typography.weight.regular,
          fontSize: theme.typography.sizes.md,
          lineHeight: theme.typography.sizes.md * CALENDAR_UI.DAY_NUMBER_LINE_HEIGHT_RATIO,
          color: theme.colors.text,
          textAlign: 'center',
        },
        dayNumberToday: {
          color: theme.colors.onPrimary,
          fontWeight: theme.typography.weight.bold,
        },
        dayNumberSelected: {
          color: theme.colors.primary,
          fontWeight: theme.typography.weight.bold,
        },
        dayNumberMuted: {
          color: theme.colors.textSecondary,
        },
        dayIndicatorSlot: {
          marginTop: Math.max(CALENDAR_UI.BORDER_WIDTH, theme.spacing.xs * 0.15),
          minHeight: indicatorSlotBaseHeight,
          alignItems: 'center',
          justifyContent: 'center',
        },
        eventCount: {
          fontSize: theme.typography.sizes.xs * CALENDAR_UI.EVENT_COUNT_FONT_RATIO,
          fontWeight: theme.typography.weight.semibold,
          color: theme.colors.primary,
          textAlign: 'center',
        },
        eventDot: {
          marginTop: theme.spacing.xs * CALENDAR_UI.HALF_SPACING_RATIO,
          width: theme.spacing.xs,
          height: theme.spacing.xs,
          borderRadius: theme.spacing.xs / 2,
          backgroundColor: theme.colors.primary,
        },
        ordersHeader: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          borderBottomWidth: CALENDAR_UI.BORDER_WIDTH,
          borderBottomColor: theme.colors.border,
          gap: theme.spacing.xs,
        },
        ordersTitle: {
          fontSize: theme.typography.sizes.md,
          fontWeight: theme.typography.weight.semibold,
          color: theme.colors.text,
          flexShrink: 1,
          marginRight: theme.spacing.sm,
        },
        ordersHeaderActions: {
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'nowrap',
          justifyContent: 'flex-start',
          gap: theme.spacing.xs,
        },
        scopeSwitch: {
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: CALENDAR_UI.BORDER_WIDTH,
          borderColor: theme.colors.border,
          borderRadius: theme.radii.pill,
          padding: CALENDAR_UI.SCOPE_SWITCH_PADDING,
          height: CALENDAR_UI.SCOPE_SWITCH_HEIGHT,
          backgroundColor: theme.colors.surface,
        },
        scopePill: {
          minWidth: CALENDAR_UI.SCOPE_PILL_MIN_WIDTH,
          height: CALENDAR_UI.SCOPE_PILL_HEIGHT,
          paddingHorizontal: CALENDAR_UI.SCOPE_PILL_PADDING_X,
          borderRadius: theme.radii.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'transparent',
        },
        scopePillActive: {
          backgroundColor: theme.colors.primary,
        },
        scopeText: {
          fontSize: theme.typography.sizes.xs,
          color: theme.colors.textSecondary || theme.colors.text,
        },
        scopeTextActive: {
          color: theme.colors.onPrimary,
          fontWeight: theme.typography.weight.semibold,
        },
        filterButton: {
          width: CALENDAR_UI.COMPACT_ICON_BUTTON_SIZE,
          height: CALENDAR_UI.COMPACT_ICON_BUTTON_SIZE,
          borderRadius: CALENDAR_UI.COMPACT_ICON_BUTTON_SIZE / 2,
          borderWidth: CALENDAR_UI.BORDER_WIDTH,
          borderColor: theme.colors.border,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.surface,
        },
        filterButtonActive: {
          borderColor: theme.colors.primary,
          backgroundColor: withAlpha(theme.colors.primary, CALENDAR_UI.ACTIVE_BG_ALPHA),
        },
        resetFilterButton: {
          width: CALENDAR_UI.COMPACT_ICON_BUTTON_SIZE,
          height: CALENDAR_UI.COMPACT_ICON_BUTTON_SIZE,
          borderRadius: CALENDAR_UI.COMPACT_ICON_BUTTON_SIZE / 2,
          borderWidth: CALENDAR_UI.BORDER_WIDTH,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
        },
        noOrders: {
          fontSize: theme.typography.sizes.sm,
          color: theme.colors.textSecondary,
          textAlign: 'center',
          marginTop: theme.spacing.lg,
        },
        ordersLoadingPlaceholder: {
          minHeight: layoutMetrics.weekRowHeight * 2,
        },
        weekContent: {
          flex: 1,
          width: layoutMetrics.cardWidth,
          alignSelf: 'center',
        },
        weekStrip: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          paddingHorizontal: theme.spacing.md,
          paddingBottom: theme.spacing.sm,
          gap: theme.spacing.xs,
        },
        weekDayButton: {
          flex: 1,
          minWidth: 0,
          minHeight: CALENDAR_UI.WEEK_DAY_BUTTON_MIN_HEIGHT,
          borderRadius: theme.radii.md,
          borderWidth: CALENDAR_UI.BORDER_WIDTH,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: theme.spacing.xs,
        },
        weekDayButtonActive: {
          borderColor: theme.colors.primary,
          backgroundColor: withAlpha(theme.colors.primary, CALENDAR_UI.ACTIVE_BG_ALPHA),
        },
        weekDayName: {
          fontSize: theme.typography.sizes.xs,
          fontWeight: theme.typography.weight.medium,
          color: theme.colors.textSecondary,
          textAlign: 'center',
        },
        weekDayNumber: {
          marginTop: CALENDAR_UI.SCOPE_SWITCH_PADDING,
          fontSize: theme.typography.sizes.md,
          fontWeight: theme.typography.weight.semibold,
          color: theme.colors.text,
          textAlign: 'center',
        },
        weekDayNumberActive: {
          color: theme.colors.primary,
        },
        weekDayCount: {
          marginTop: CALENDAR_UI.SCOPE_SWITCH_PADDING,
          minWidth: CALENDAR_UI.WEEK_DAY_COUNT_MIN_WIDTH,
          height: CALENDAR_UI.WEEK_DAY_COUNT_SIZE,
          borderRadius: CALENDAR_UI.WEEK_DAY_COUNT_SIZE / 2,
          paddingHorizontal: theme.spacing.xs,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.badgeBg || theme.colors.inputBg,
        },
        weekDayCountActive: {
          backgroundColor: theme.colors.primary,
        },
        weekDayCountText: {
          fontSize: theme.typography.sizes.xs * CALENDAR_UI.EVENT_COUNT_FONT_RATIO,
          fontWeight: theme.typography.weight.semibold,
          color: theme.colors.textSecondary,
          textAlign: 'center',
        },
        weekDayCountTextActive: {
          color: theme.colors.onPrimary,
        },
        weekToolbar: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          borderTopWidth: CALENDAR_UI.BORDER_WIDTH,
          borderBottomWidth: CALENDAR_UI.BORDER_WIDTH,
          borderColor: theme.colors.border,
          gap: theme.spacing.xs,
        },
        weekToolbarTitle: {
          flexShrink: 1,
          fontSize: theme.typography.sizes.md,
          fontWeight: theme.typography.weight.semibold,
          color: theme.colors.text,
        },
        weekList: {
          flex: 1,
          width: '100%',
        },
        weekListContent: {
          paddingHorizontal: theme.spacing.md,
          paddingBottom: Math.max(theme.spacing.xl, insets.bottom),
        },
        weekSectionHeader: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: theme.spacing.md,
          paddingTop: theme.spacing.xs,
          paddingBottom: theme.spacing.sm,
          gap: theme.spacing.sm,
        },
        weekSectionHeaderActive: {
          opacity: 1,
        },
        weekSectionDateBadge: {
          width: CALENDAR_UI.WEEK_DATE_BADGE_SIZE,
          height: CALENDAR_UI.WEEK_DATE_BADGE_SIZE,
          borderRadius: theme.radii.lg,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.surface,
          borderWidth: CALENDAR_UI.BORDER_WIDTH,
          borderColor: theme.colors.border,
        },
        weekSectionDateBadgeActive: {
          borderColor: theme.colors.primary,
          backgroundColor: theme.colors.primary,
        },
        weekSectionDayNumber: {
          fontSize: theme.typography.sizes.lg,
          lineHeight: theme.typography.sizes.lg * CALENDAR_UI.WEEK_SECTION_DAY_NUMBER_LINE_RATIO,
          fontWeight: theme.typography.weight.bold,
          color: theme.colors.text,
          textAlign: 'center',
        },
        weekSectionDayNumberActive: {
          color: theme.colors.onPrimary,
        },
        weekSectionDayNameSmall: {
          marginTop: CALENDAR_UI.BORDER_WIDTH,
          fontSize: theme.typography.sizes.xs * CALENDAR_UI.WEEK_SECTION_DAY_NAME_FONT_RATIO,
          lineHeight: theme.typography.sizes.xs,
          fontWeight: theme.typography.weight.semibold,
          color: theme.colors.textSecondary,
          textAlign: 'center',
          textTransform: 'uppercase',
        },
        weekSectionDayNameSmallActive: {
          color: theme.colors.onPrimary,
        },
        weekSectionTitleBlock: {
          flex: 1,
          minWidth: 0,
        },
        weekSectionTitle: {
          fontSize: theme.typography.sizes.md,
          fontWeight: theme.typography.weight.semibold,
          color: theme.colors.text,
        },
        weekSectionTitleActive: {
          color: theme.colors.text,
        },
        weekSectionDate: {
          marginTop: CALENDAR_UI.SCOPE_SWITCH_PADDING,
          fontSize: theme.typography.sizes.xs,
          color: theme.colors.textSecondary,
        },
        weekSectionToday: {
          color: theme.colors.primary,
          fontWeight: theme.typography.weight.semibold,
        },
        weekSectionCount: {
          minWidth: CALENDAR_UI.WEEK_SECTION_COUNT_MIN_WIDTH,
          height: CALENDAR_UI.WEEK_SECTION_COUNT_HEIGHT,
          borderRadius: CALENDAR_UI.WEEK_SECTION_COUNT_HEIGHT / 2,
          paddingHorizontal: theme.spacing.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.surface,
          borderWidth: CALENDAR_UI.BORDER_WIDTH,
          borderColor: theme.colors.border,
        },
        weekSectionCountActive: {
          borderColor: withAlpha(theme.colors.primary, CALENDAR_UI.ACTIVE_BORDER_ALPHA),
          backgroundColor: withAlpha(theme.colors.primary, CALENDAR_UI.SUBTLE_BG_ALPHA),
        },
        weekSectionCountText: {
          fontSize: theme.typography.sizes.xs,
          fontWeight: theme.typography.weight.bold,
          color: theme.colors.text,
        },
        weekSectionCountTextActive: {
          color: theme.colors.primary,
        },
        weekOrderRow: {
          marginLeft: CALENDAR_UI.WEEK_ORDER_OFFSET_X,
        },
        weekOrderConnector: {
          position: 'absolute',
          left: CALENDAR_UI.WEEK_TIMELINE_OFFSET_X,
          top: 0,
          bottom: 0,
          width: CALENDAR_UI.BORDER_WIDTH,
          backgroundColor: theme.colors.border,
        },
        weekEmptyRow: {
          marginLeft: CALENDAR_UI.WEEK_ORDER_OFFSET_X,
          paddingVertical: theme.spacing.sm,
          paddingHorizontal: theme.spacing.sm,
        },
        weekEmptyText: {
          fontSize: theme.typography.sizes.sm,
          color: theme.colors.textSecondary,
        },
        weekLoadingLine: {
          width: '42%',
          height: theme.spacing.sm,
          borderRadius: theme.radii.pill,
          backgroundColor: withAlpha(theme.colors.textSecondary, CALENDAR_UI.SUBTLE_BG_ALPHA),
        },
        dayScheduleContent: {
          flex: 1,
          width: layoutMetrics.cardWidth,
          alignSelf: 'center',
        },
        daySummary: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.spacing.xs,
          marginHorizontal: theme.spacing.md,
          marginBottom: theme.spacing.xs,
          minHeight: CALENDAR_UI.SCOPE_SWITCH_HEIGHT,
        },
        dayList: {
          flex: 1,
          width: '100%',
        },
        dayListContent: {
          paddingHorizontal: theme.spacing.md,
          paddingBottom: Math.max(theme.spacing.xl, insets.bottom),
        },
        dayOrderRow: {
          marginLeft: CALENDAR_UI.DAY_ORDER_OFFSET_X,
        },
        dayOrderConnector: {
          position: 'absolute',
          left: CALENDAR_UI.DAY_TIMELINE_OFFSET_X,
          top: 0,
          bottom: 0,
          width: CALENDAR_UI.BORDER_WIDTH,
          backgroundColor: theme.colors.border,
        },
        dayOrderDot: {
          position: 'absolute',
          left: CALENDAR_UI.DAY_DOT_OFFSET_X,
          top: CALENDAR_UI.DAY_DOT_OFFSET_Y,
          width: CALENDAR_UI.DAY_DOT_SIZE,
          height: CALENDAR_UI.DAY_DOT_SIZE,
          borderRadius: CALENDAR_UI.DAY_DOT_SIZE / 2,
          backgroundColor: theme.colors.primary,
          borderWidth: CALENDAR_UI.BORDER_WIDTH * 2,
          borderColor: theme.colors.background,
        },
        dayEmptyState: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: theme.spacing.xxl,
        },
        dayEmptyTitle: {
          fontSize: theme.typography.sizes.md,
          fontWeight: theme.typography.weight.semibold,
          color: theme.colors.text,
          textAlign: 'center',
        },
        dayEmptySubtitle: {
          marginTop: theme.spacing.xs,
          fontSize: theme.typography.sizes.sm,
          color: theme.colors.textSecondary,
          textAlign: 'center',
        },
        yearViewContainer: {
          flex: 1,
        },
        yearPager: {
          flex: 1,
          width: layoutMetrics.cardWidth,
        },
        yearPage: {
          width: layoutMetrics.cardWidth,
          flex: 1,
        },
      }),
    [theme, layoutMetrics, indicatorSlotBaseHeight, insets.bottom],
  );

  const stageAtoBProgress = useDerivedValue(() => {
    return Math.min(collapseTranslate.value / stageOneDistanceSafe, 1);
  }, [dynamicMonths.length, layoutMetrics.cardWidth, visibleMonthIndex]);
  const settledWeeksHeight = useSharedValue(measuredWeekRowHeight * actualWeekRows);

  useEffect(() => {
    const targetRows = getWeeksForMonth(activeVisibleMonth)?.length ?? actualWeekRows;
    const targetHeight = measuredWeekRowHeight * targetRows;
    settledWeeksHeight.value = targetHeight;
  }, [
    activeVisibleMonth,
    actualWeekRows,
    getWeeksForMonth,
    measuredWeekRowHeight,
    settledWeeksHeight,
  ]);

  useDerivedValue(() => {
    const progress = stageAtoBProgress.value;
    let collapsed = isCollapsedShared.value;
    if (!collapsed && progress >= CALENDAR_GESTURE.COLLAPSED_SET_THRESHOLD) {
      collapsed = true;
    } else if (collapsed && progress <= CALENDAR_GESTURE.EXPANDED_SET_THRESHOLD) {
      collapsed = false;
    }

    if (collapsed !== isCollapsedShared.value) {
      isCollapsedShared.value = collapsed;
    }
    if (collapsed !== collapsedRef.current) {
      collapsedRef.current = collapsed;
      runOnJS(setIsCollapsed)(collapsed);
    }
  });

  const calendarContentStyle = useAnimatedStyle(
    () => ({
      height: (() => {
        const progress = stageAtoBProgress.value;
        if (progress <= CALENDAR_UI.COLLAPSE_PROGRESS_EPSILON) {
          return resolvedMonthHeaderHeight + measuredDayNamesHeight + settledWeeksHeight.value;
        }
        const fullWeeksHeight = measuredWeekRowHeight * actualWeekRows;
        const weeksVisibleHeight = interpolate(
          progress,
          [0, 1],
          [fullWeeksHeight, measuredWeekRowHeight],
          Extrapolate.CLAMP,
        );
        const monthHeaderVisibleHeight = resolvedMonthHeaderHeight * (1 - progress);
        return monthHeaderVisibleHeight + measuredDayNamesHeight + weeksVisibleHeight;
      })(),
    }),
    [
      actualWeekRows,
      measuredDayNamesHeight,
      resolvedMonthHeaderHeight,
      measuredWeekRowHeight,
      settledWeeksHeight,
    ],
  );

  const indicatorSlotAnimatedStyle = useAnimatedStyle(() => {
    const collapsedHeight = indicatorSlotBaseHeight * CALENDAR_UI.COLLAPSED_EVENT_SLOT_RATIO;
    const height = interpolate(
      stageAtoBProgress.value,
      [0, 1],
      [indicatorSlotBaseHeight, collapsedHeight],
      Extrapolate.CLAMP,
    );
    return { height };
  }, [indicatorSlotBaseHeight]);
  const eventCountAnimatedStyle = useAnimatedStyle(() => {
    const progress = stageAtoBProgress.value;
    return {
      opacity: interpolate(progress, [0, 1], [1, 0], Extrapolate.CLAMP),
      transform: [{ scale: interpolate(progress, [0, 1], [1, CALENDAR_UI.EVENT_COUNT_COLLAPSED_SCALE], Extrapolate.CLAMP) }],
    };
  });
  const eventDotAnimatedStyle = useAnimatedStyle(() => {
    const progress = stageAtoBProgress.value;
    return {
      opacity: interpolate(
        progress,
        [0, CALENDAR_UI.EVENT_DOT_FADE_START_PROGRESS, CALENDAR_UI.EVENT_DOT_VISIBLE_PROGRESS],
        [0, 0, 1],
        Extrapolate.CLAMP,
      ),
      transform: [
        {
          scale: interpolate(
            progress,
            [0, CALENDAR_UI.EVENT_DOT_VISIBLE_PROGRESS],
            [CALENDAR_UI.EVENT_COUNT_COLLAPSED_SCALE, 1],
            Extrapolate.CLAMP,
          ),
        },
      ],
    };
  });

  const headerAnimatedStyle = useAnimatedStyle(
    () => ({
      height: interpolate(
        stageAtoBProgress.value,
        [0, 1],
        [resolvedMonthHeaderHeight, 0],
        Extrapolate.CLAMP,
      ),
      opacity: interpolate(stageAtoBProgress.value, [0, 1], [1, 0], Extrapolate.CLAMP),
      overflow: 'hidden',
    }),
    [resolvedMonthHeaderHeight],
  );

  const weeksClipStyle = useAnimatedStyle(() => {
    const progress = stageAtoBProgress.value;
    if (progress <= CALENDAR_UI.COLLAPSE_PROGRESS_EPSILON) {
      return { height: settledWeeksHeight.value, overflow: 'hidden' };
    }
    const fullHeight = measuredWeekRowHeight * actualWeekRows;
    const height = interpolate(
      progress,
      [0, 1],
      [fullHeight, measuredWeekRowHeight],
      Extrapolate.CLAMP,
    );
    return { height, overflow: 'hidden' };
  }, [
    actualWeekRows,
    measuredWeekRowHeight,
    settledWeeksHeight,
  ]);

  const weeksTranslateStyle = useAnimatedStyle(() => {
    const progress = stageAtoBProgress.value;
    const selectedWeekTop = selectedWeekIndex * measuredWeekRowHeight;
    const weekOffset = -selectedWeekTop * progress;
    return { transform: [{ translateY: weekOffset }] };
  }, [measuredWeekRowHeight, selectedWeekIndex]);

  const monthOrdersHeaderAnimatedStyle = useAnimatedStyle(() => {
    const progress = stageAtoBProgress.value;
    return {
      height: interpolate(
        progress,
        [0, 1],
        [monthOrdersHeaderHeight.value, 0],
        Extrapolate.CLAMP,
      ),
      opacity: interpolate(
        progress,
        [0, CALENDAR_UI.MONTH_HEADER_FADE_PROGRESS, 1],
        [1, CALENDAR_UI.MONTH_HEADER_FADE_OPACITY, 0],
        Extrapolate.CLAMP,
      ),
      overflow: 'hidden',
    };
  });

  const updateMonthOrdersScrollLimit = useCallback(() => {
    monthOrdersMaxScrollY.value = Math.max(
      0,
      monthOrdersContentHeightRef.current - monthOrdersViewportHeightRef.current,
    );
    scrollY.value = Math.min(scrollY.value, monthOrdersMaxScrollY.value);
  }, [monthOrdersMaxScrollY, scrollY]);

  useAnimatedReaction(
    () => scrollY.value,
    (currentScrollY) => {
      scrollTo(ordersListRef, 0, currentScrollY, false);
    },
    [ordersListRef],
  );

  const snapMonthCalendar = useCallback(
    (velocityY = 0) => {
      'worklet';
      const maxCollapse = stageOneDistanceSafe;
      if (maxCollapse <= 1) return;
      const current = clamp(collapseTranslate.value, 0, maxCollapse);
      const progress = current / maxCollapse;
      let shouldCollapse = progress >= MONTH_COLLAPSE_SNAP_THRESHOLD;
      if (velocityY < -MONTH_COLLAPSE_VELOCITY_THRESHOLD) {
        shouldCollapse = true;
      } else if (velocityY > MONTH_COLLAPSE_VELOCITY_THRESHOLD) {
        shouldCollapse = false;
      }
      const target = shouldCollapse ? maxCollapse : 0;
      const distance = Math.abs(target - current);
      if (distance <= CALENDAR_UI.SNAP_DISTANCE_EPSILON) {
        collapseTranslate.value = target;
        return;
      }
      const distanceProgress = Math.min(distance / maxCollapse, 1);
      const duration = Math.round(
        MONTH_COLLAPSE_MIN_DURATION +
          (MONTH_COLLAPSE_MAX_DURATION - MONTH_COLLAPSE_MIN_DURATION) * distanceProgress,
      );
      cancelAnimation(collapseTranslate);
      scrollY.value = 0;
      scrollTo(ordersListRef, 0, 0, false);
      collapseTranslate.value = withTiming(target, {
        duration,
        easing: Easing.out(Easing.cubic),
      });
    },
    [collapseTranslate, ordersListRef, scrollY, stageOneDistanceSafe],
  );

  const monthOrdersPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-3, 3])
        .failOffsetX([-42, 42])
        .onBegin(() => {
          cancelAnimation(scrollY);
          cancelAnimation(collapseTranslate);
          monthOrdersPanStartCollapse.value = clamp(
            collapseTranslate.value,
            0,
            stageOneDistanceSafe,
          );
          monthOrdersPanStartScrollY.value = Math.min(
            monthOrdersMaxScrollY.value,
            Math.max(0, scrollY.value),
          );
          scrollY.value = monthOrdersPanStartScrollY.value;
          scrollTo(ordersListRef, 0, scrollY.value, false);
        })
        .onUpdate((event) => {
          const maxCollapse = stageOneDistanceSafe;
          if (maxCollapse <= 1) return;

          const dragDistance = -event.translationY;
          const maxScrollY = monthOrdersMaxScrollY.value;
          let nextCollapse = monthOrdersPanStartCollapse.value;
          let nextScrollY = monthOrdersPanStartScrollY.value;

          if (dragDistance >= 0) {
            const collapseRoom = Math.max(0, maxCollapse - monthOrdersPanStartCollapse.value);
            const collapseDelta = Math.min(collapseRoom, dragDistance);
            nextCollapse = monthOrdersPanStartCollapse.value + collapseDelta;
            nextScrollY = Math.min(
              maxScrollY,
              monthOrdersPanStartScrollY.value + Math.max(0, dragDistance - collapseRoom),
            );
          } else {
            const scrollDelta = Math.max(-monthOrdersPanStartScrollY.value, dragDistance);
            nextScrollY = monthOrdersPanStartScrollY.value + scrollDelta;
            nextCollapse = monthOrdersPanStartCollapse.value + Math.min(0, dragDistance - scrollDelta);
          }

          collapseTranslate.value = clamp(nextCollapse, 0, maxCollapse);
          scrollY.value = Math.min(maxScrollY, Math.max(0, nextScrollY));
        })
        .onEnd((event) => {
          const maxCollapse = stageOneDistanceSafe;
          const currentCollapse = clamp(collapseTranslate.value, 0, maxCollapse);
          if (
            event.velocityY > MONTH_COLLAPSE_VELOCITY_THRESHOLD &&
            scrollY.value <= 1 &&
            currentCollapse > 0
          ) {
            snapMonthCalendar(event.velocityY);
            return;
          }

          const canScrollOrders =
            maxCollapse <= 1 ||
            currentCollapse >= maxCollapse - 1 ||
            scrollY.value > 0;

          if (canScrollOrders && monthOrdersMaxScrollY.value > 0) {
            scrollY.value = withDecay({
              velocity: -event.velocityY,
              deceleration: MONTH_ORDERS_DECAY,
              clamp: [0, monthOrdersMaxScrollY.value],
            });
            return;
          }

          snapMonthCalendar(event.velocityY);
        }),
    [
      collapseTranslate,
      monthOrdersMaxScrollY,
      monthOrdersPanStartCollapse,
      monthOrdersPanStartScrollY,
      ordersListRef,
      scrollY,
      snapMonthCalendar,
      stageOneDistanceSafe,
    ],
  );

  const switchMode = useCallback((nextMode, opts = {}) => {
    if (nextMode === CALENDAR_VIEW_MODE.MONTH) {
      const targetMonth = startOfMonth(opts.newMonth ?? currentMonth);
      setMonthWindowAnchor(targetMonth);
      setCurrentMonth(targetMonth);
      setSelectedDate(format(targetMonth, 'yyyy-MM-dd'));
      lastHandledPageIndex.current = MONTH_LIST_MIDDLE_INDEX;
      visibleMonthIndexRef.current = MONTH_LIST_MIDDLE_INDEX;
      visibleMonthIndex.value = MONTH_LIST_MIDDLE_INDEX;
      setVisibleMonthRenderIndex(MONTH_LIST_MIDDLE_INDEX);
      settledMonthOffsetX.value = layoutMetrics.cardWidth * MONTH_LIST_MIDDLE_INDEX;
      requestAnimationFrame(() => {
        try {
          monthPagerRef.current?.scrollToIndex?.({ index: MONTH_LIST_MIDDLE_INDEX, animated: false });
        } catch {}
      });
    }
    if (nextMode === CALENDAR_VIEW_MODE.WEEK) {
      const targetDate = parseCalendarDateKey(selectedDate, currentMonth);
      setSelectedDate(formatDateKey(targetDate));
      setCurrentMonth(startOfMonth(targetDate));
      setCalendarQueryAnchorMonth(startOfMonth(targetDate));
      if (isCollapsed) {
        setIsCollapsed(false);
        isCollapsedShared.value = false;
        collapseTranslate.value = 0;
        scrollY.value = 0;
      }
    }
    if (nextMode === CALENDAR_VIEW_MODE.DAY) {
      const targetDate = parseCalendarDateKey(selectedDate, currentMonth);
      setSelectedDate(formatDateKey(targetDate));
      setCurrentMonth(startOfMonth(targetDate));
      setCalendarQueryAnchorMonth(startOfMonth(targetDate));
      if (isCollapsed) {
        setIsCollapsed(false);
        isCollapsedShared.value = false;
        collapseTranslate.value = 0;
        scrollY.value = 0;
      }
    }
    setViewMode(nextMode);
  }, [
    collapseTranslate,
    currentMonth,
    isCollapsed,
    isCollapsedShared,
    layoutMetrics.cardWidth,
    monthPagerRef,
    scrollY,
    selectedDate,
    settledMonthOffsetX,
    visibleMonthIndex,
    MONTH_LIST_MIDDLE_INDEX,
  ]);

  const scrollToMonthByOffset = useCallback(
    (offset) => {
      const baseIndex =
        typeof pendingScrollTargetIndexRef.current === 'number'
          ? pendingScrollTargetIndexRef.current
          : visibleMonthIndexRef.current;
      const nextIndex = clamp(
        baseIndex + offset,
        0,
        Math.max(0, dynamicMonths.length - 1),
      );
      if (nextIndex === baseIndex) return;
      pendingScrollTargetIndexRef.current = nextIndex;
      if (monthScrollRafRef.current != null) return;
      monthScrollRafRef.current = requestAnimationFrame(() => {
        monthScrollRafRef.current = null;
        const targetIndex = pendingScrollTargetIndexRef.current;
        pendingScrollTargetIndexRef.current = null;
        if (typeof targetIndex !== 'number') return;
        const nextMonth = dynamicMonths[targetIndex];
        if (!nextMonth) return;
        visibleMonthIndexRef.current = targetIndex;
        visibleMonthIndex.value = targetIndex;
        setVisibleMonthRenderIndex(targetIndex);
        setCurrentMonth(nextMonth);
        setSelectedDate(format(startOfMonth(nextMonth), 'yyyy-MM-dd'));
        try {
          monthPagerRef.current?.scrollToIndex?.({ index: targetIndex, animated: false });
        } catch {}
      });
    },
    [dynamicMonths, monthPagerRef, visibleMonthIndex],
  );

  const goToPreviousMonth = useCallback(() => scrollToMonthByOffset(-1), [scrollToMonthByOffset]);
  const goToNextMonth = useCallback(() => scrollToMonthByOffset(1), [scrollToMonthByOffset]);
  const goToWeekByOffset = useCallback(
    (offset) => {
      const nextDate = addDays(activeWeekStart, offset * 7);
      setSelectedDate(formatDateKey(nextDate));
      setCurrentMonth(startOfMonth(nextDate));
      setCalendarQueryAnchorMonth(startOfMonth(nextDate));
    },
    [activeWeekStart],
  );
  const goToPreviousWeek = useCallback(() => goToWeekByOffset(-1), [goToWeekByOffset]);
  const goToNextWeek = useCallback(() => goToWeekByOffset(1), [goToWeekByOffset]);
  const goToDayByOffset = useCallback(
    (offset) => {
      const nextDate = addDays(selectedDateObj, offset);
      setSelectedDate(formatDateKey(nextDate));
      setCurrentMonth(startOfMonth(nextDate));
      setCalendarQueryAnchorMonth(startOfMonth(nextDate));
    },
    [selectedDateObj],
  );
  const goToPreviousDay = useCallback(() => goToDayByOffset(-1), [goToDayByOffset]);
  const goToNextDay = useCallback(() => goToDayByOffset(1), [goToDayByOffset]);
  const scrollYearByOffset = useCallback(
    (offset) => {
      const baseIndex = visibleYearIndexRef.current;
      const nextIndex = clamp(baseIndex + offset, 0, Math.max(0, dynamicYears.length - 1));
      if (nextIndex === baseIndex) return;
      visibleYearIndexRef.current = nextIndex;
      try {
        yearFlatListRef.current?.scrollToIndex?.({ index: nextIndex, animated: true });
      } catch {}
    },
    [dynamicYears.length],
  );
  const goToPreviousYear = useCallback(() => scrollYearByOffset(-1), [scrollYearByOffset]);
  const goToNextYear = useCallback(() => scrollYearByOffset(1), [scrollYearByOffset]);

  const getItemLayout = useCallback(
    (data, index) => ({
      length: layoutMetrics.cardWidth,
      offset: layoutMetrics.cardWidth * index,
      index,
    }),
    [layoutMetrics.cardWidth],
  );

  // Swipe animations/gestures were intentionally removed for deterministic instant toggles.

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        goBackSmart(
          navigation,
          router,
          returnTo ? { pathname: returnTo, params: returnParams } : null,
          '/orders',
        );
        return true;
      });
      return () => sub.remove();
    }, [navigation, returnParams, returnTo, router]),
  );

  useFocusEffect(
    useCallback(() => {
      const removeSub = navigation.addListener('beforeRemove', (e) => {
        const actionType = e?.data?.action?.type;
        if (
          actionType &&
          actionType !== 'GO_BACK' &&
          actionType !== 'POP' &&
          actionType !== 'POP_TO_TOP'
        ) {
          return;
        }
        const navCanGoBack = typeof navigation?.canGoBack === 'function' && navigation.canGoBack();
        const routerCanGoBack = typeof router?.canGoBack === 'function' && router.canGoBack();

        if (navCanGoBack || routerCanGoBack) return;

        e.preventDefault();
        if (returnTo) {
          dismissToRoute(router, { pathname: returnTo, params: returnParams });
          return;
        }
        dismissToRoute(router, '/orders');
      });
      return removeSub;
    }, [navigation, returnParams, returnTo, router]),
  );

  const filteredOrders = useMemo(() => {
    const base = enrichOrdersWithKnownExecutorRows(Array.isArray(orders) ? orders : [], executors);
    if (!base.length) return [];
    if (!hasEmployeeFilter) return base;
    return base.filter((order) => executorFilterSet.has(String(order?.assigned_to || '')));
  }, [executorFilterSet, executors, hasEmployeeFilter, orders]);

  const calendarIndex = useMemo(() => {
    const byDate = {};
    const countByDate = {};

    for (const order of filteredOrders) {
      const dateField = order?.time_window_start;
      if (!dateField) continue;
      const parsedDate = new Date(dateField);
      if (Number.isNaN(parsedDate.getTime())) continue;
      const key = formatDateKey(parsedDate);
      if (!key) continue;

      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(order);
      countByDate[key] = (countByDate[key] || 0) + 1;

    }

    Object.keys(byDate).forEach((date) => {
      byDate[date].sort((a, b) => {
        const byScheduleTime = getOrderScheduleSortValue(a) - getOrderScheduleSortValue(b);
        if (byScheduleTime !== 0) return byScheduleTime;
        const leftCreated = new Date(a?.created_at || a?.updated_at || 0).getTime();
        const rightCreated = new Date(b?.created_at || b?.updated_at || 0).getTime();
        const safeLeftCreated = Number.isFinite(leftCreated) ? leftCreated : 0;
        const safeRightCreated = Number.isFinite(rightCreated) ? rightCreated : 0;
        return safeLeftCreated - safeRightCreated;
      });
    });

    const marksBase = {};
    Object.keys(countByDate).forEach((date) => {
      marksBase[date] = { marked: true, dotColor: theme.colors.primary };
    });

    return { byDate, marksBase, countByDate };
  }, [filteredOrders, theme.colors.primary]);

  const committedMonthKey = format(currentMonth, 'yyyy-MM');
  const selectedMonthKey = selectedDate
    ? selectedDate.slice(0, CALENDAR_MONTH_KEY_LENGTH)
    : CALENDAR_EMPTY_MONTH_KEY;
  const targetMonthKey = committedMonthKey;
  const effectiveSelectedDate = useMemo(
    () => (selectedMonthKey === targetMonthKey ? selectedDate : `${targetMonthKey}-01`),
    [selectedDate, selectedMonthKey, targetMonthKey],
  );
  const detailNavLockRef = useRef({ id: '', ts: 0 });
  const displayedOrders = useMemo(
    () => (effectiveSelectedDate ? (calendarIndex.byDate[effectiveSelectedDate] ?? []) : []),
    [calendarIndex.byDate, effectiveSelectedDate],
  );
  const shouldShowCalendarEmptyStates = !isCalendarLoading && !isCalendarPlaceholderData;
  const showCalendarLoadingOverlay = isCalendarFetching && (isCalendarLoading || isCalendarPlaceholderData);
  const weekSections = useMemo(
    () =>
      activeWeekDates.map((date) => {
        const dateKey = formatDateKey(date);
        const dayOrders = calendarIndex.byDate[dateKey] ?? [];
        return {
          date,
          dateKey,
          count: dayOrders.length,
          data: dayOrders.length
            ? dayOrders
            : [
                {
                  id: `${shouldShowCalendarEmptyStates ? 'empty' : 'loading'}-${dateKey}`,
                  dateKey,
                  __empty: shouldShowCalendarEmptyStates,
                  __loading: !shouldShowCalendarEmptyStates,
                },
              ],
        };
      }),
    [activeWeekDates, calendarIndex.byDate, shouldShowCalendarEmptyStates],
  );
  const weekTotalCount = useMemo(
    () => weekSections.reduce((sum, section) => sum + section.count, 0),
    [weekSections],
  );
  const dayListExtraData = useMemo(
    () => ({ selectedDate: effectiveSelectedDate, count: displayedOrders.length, scope }),
    [displayedOrders.length, effectiveSelectedDate, scope],
  );
  const ordersListExtraData = useMemo(
    () => ({ selectedDate: effectiveSelectedDate, count: displayedOrders.length }),
    [displayedOrders.length, effectiveSelectedDate],
  );
  const weekListExtraData = useMemo(
    () => ({ selectedDate, weekTotalCount, scope, filters: executorFilterIds.join('|') }),
    [executorFilterIds, scope, selectedDate, weekTotalCount],
  );
  const ordersTitleDateLabel = useMemo(
    () => {
      if (!effectiveSelectedDate) return '';
      const parsedDate = new Date(effectiveSelectedDate);
      if (Number.isNaN(parsedDate.getTime())) return '';
      return format(parsedDate, 'd MMMM', { locale: dateLocale });
    },
    [dateLocale, effectiveSelectedDate],
  );
  const ordersListContentContainerStyle = useMemo(
    () => ({
      paddingBottom: Math.max(theme.spacing.xl, insets.bottom),
    }),
    [insets.bottom, theme.spacing.xl],
  );
  const orderKeyExtractor = useCallback(
    (item) => String(item?.id ?? item?.order_id ?? item?.uuid),
    [],
  );
  const openOrderDetails = useCallback(
    (orderIdRaw) => {
      const orderId = String(orderIdRaw || '').trim();
      if (!orderId) return;
      const now = Date.now();
      const prev = detailNavLockRef.current;
      if (prev.id === orderId && now - prev.ts < CALENDAR_NAV_LOCK_MS) return;
      detailNavLockRef.current = { id: orderId, ts: now };
      router.push(`/orders/${orderId}`);
      InteractionManager.runAfterInteractions(() => {
        const registry = getPrefetchRegistry();
        registry
          .run(`request-detail:${orderId}`, () => ensureRequestPrefetch(queryClient, orderId))
          .catch(() => {});
      });
    },
    [queryClient, router],
  );
  const renderOrderItem = useCallback(
    ({ item }) => (
      <DynamicOrderCard
        order={item}
        context={scope === CALENDAR_SCOPE.MY ? 'my_orders' : 'all_orders'}
        onPress={openOrderDetails}
        departureTimeEnabled={departureTimeEnabled}
        orderFieldsByKey={orderFieldsByKey}
        companyCurrency={companySettings?.currency || null}
        companySettingsOverride={companySettings || null}
      />
    ),
    [companySettings, departureTimeEnabled, openOrderDetails, orderFieldsByKey, scope],
  );
  const ordersEmptyComponent = useMemo(
    () =>
      shouldShowCalendarEmptyStates ? (
        <Text style={styles.noOrders}>{t('calendar_no_orders')}</Text>
      ) : (
        <View style={styles.ordersLoadingPlaceholder} />
      ),
    [shouldShowCalendarEmptyStates, styles.noOrders, styles.ordersLoadingPlaceholder, t],
  );
  const renderWeekOrderItem = useCallback(
    ({ item }) => {
      if (item?.__empty || item?.__loading) {
        return (
          <View style={{ position: 'relative' }}>
            <View pointerEvents="none" style={styles.weekOrderConnector} />
            <View style={styles.weekEmptyRow}>
              {item?.__loading ? (
                <View style={styles.weekLoadingLine} />
              ) : (
                <Text style={styles.weekEmptyText}>
                  {t('calendar_week_empty_day')}
                </Text>
              )}
            </View>
          </View>
        );
      }
      return (
        <View style={{ position: 'relative' }}>
          <View pointerEvents="none" style={styles.weekOrderConnector} />
          <View style={styles.weekOrderRow}>
            <DynamicOrderCard
              order={item}
              context="calendar"
              onPress={openOrderDetails}
              departureTimeEnabled={departureTimeEnabled}
              orderFieldsByKey={orderFieldsByKey}
              companyCurrency={companySettings?.currency || null}
              companySettingsOverride={companySettings || null}
            />
          </View>
        </View>
      );
    },
    [
      companySettings,
      departureTimeEnabled,
      openOrderDetails,
      orderFieldsByKey,
      styles.weekEmptyRow,
      styles.weekEmptyText,
      styles.weekLoadingLine,
      styles.weekOrderConnector,
      styles.weekOrderRow,
      t,
    ],
  );
  const renderWeekSectionHeader = useCallback(
    ({ section }) => {
      const isSelected = section.dateKey === selectedDate;
      const isTodaySection = section.dateKey === todayKey;
      return (
        <Pressable
          onPress={() => setSelectedDate(section.dateKey)}
          style={[styles.weekSectionHeader, isSelected && styles.weekSectionHeaderActive]}
          android_ripple={{ color: theme.colors.ripple || theme.colors.overlayNavBar }}
          accessibilityRole="button"
        >
          <View style={[styles.weekSectionDateBadge, isSelected && styles.weekSectionDateBadgeActive]}>
            <Text style={[styles.weekSectionDayNumber, isSelected && styles.weekSectionDayNumberActive]}>
              {format(section.date, 'd', { locale: dateLocale })}
            </Text>
            <Text
              style={[
                styles.weekSectionDayNameSmall,
                isSelected && styles.weekSectionDayNameSmallActive,
              ]}
            >
              {t(DAY_KEYS[section.date.getDay() === 0 ? 6 : section.date.getDay() - 1])}
            </Text>
          </View>
          <View style={styles.weekSectionTitleBlock}>
            <Text style={[styles.weekSectionTitle, isSelected && styles.weekSectionTitleActive]}>
              {format(section.date, 'EEEE', { locale: dateLocale })}
            </Text>
            <Text style={[styles.weekSectionDate, isTodaySection && styles.weekSectionToday]}>
              {format(section.date, 'd MMMM yyyy', { locale: dateLocale })}
            </Text>
          </View>
          <View style={[styles.weekSectionCount, isSelected && styles.weekSectionCountActive]}>
            <Text style={[styles.weekSectionCountText, isSelected && styles.weekSectionCountTextActive]}>
              {section.count}
            </Text>
          </View>
        </Pressable>
      );
    },
    [
      dateLocale,
      selectedDate,
      setSelectedDate,
      styles.weekSectionCount,
      styles.weekSectionCountActive,
      styles.weekSectionCountText,
      styles.weekSectionCountTextActive,
      styles.weekSectionDate,
      styles.weekSectionDateBadge,
      styles.weekSectionDateBadgeActive,
      styles.weekSectionDayNameSmall,
      styles.weekSectionDayNameSmallActive,
      styles.weekSectionDayNumber,
      styles.weekSectionDayNumberActive,
      styles.weekSectionHeader,
      styles.weekSectionHeaderActive,
      styles.weekSectionTitle,
      styles.weekSectionTitleActive,
      styles.weekSectionTitleBlock,
      styles.weekSectionToday,
      theme.colors.overlayNavBar,
      theme.colors.ripple,
      t,
      todayKey,
    ],
  );
  const weekOrderKeyExtractor = useCallback(
    (item) => String(item?.id ?? item?.order_id ?? item?.uuid ?? item?.dateKey),
    [],
  );
  const renderDayOrderItem = useCallback(
    ({ item }) => (
      <View style={{ position: 'relative' }}>
        <View pointerEvents="none" style={styles.dayOrderConnector} />
        <View pointerEvents="none" style={styles.dayOrderDot} />
        <View style={styles.dayOrderRow}>
          <DynamicOrderCard
            order={item}
            context="calendar"
            onPress={openOrderDetails}
            departureTimeEnabled={departureTimeEnabled}
            orderFieldsByKey={orderFieldsByKey}
            companyCurrency={companySettings?.currency || null}
            companySettingsOverride={companySettings || null}
          />
        </View>
      </View>
    ),
    [
      companySettings,
      departureTimeEnabled,
      openOrderDetails,
      orderFieldsByKey,
      styles.dayOrderConnector,
      styles.dayOrderDot,
      styles.dayOrderRow,
    ],
  );
  const dayEmptyComponent = useMemo(
    () =>
      shouldShowCalendarEmptyStates ? (
        <View style={styles.dayEmptyState}>
          <Text style={styles.dayEmptyTitle}>{t('calendar_day_empty_title')}</Text>
          <Text style={styles.dayEmptySubtitle}>
            {t('calendar_day_empty_subtitle')}
          </Text>
        </View>
      ) : (
        <View style={styles.dayEmptyState} />
      ),
    [
      shouldShowCalendarEmptyStates,
      styles.dayEmptyState,
      styles.dayEmptySubtitle,
      styles.dayEmptyTitle,
      t,
    ],
  );

  const markedDates = useMemo(
    () => ({
      ...calendarIndex.marksBase,
      [effectiveSelectedDate]: {
        ...(calendarIndex.marksBase[effectiveSelectedDate] || {}),
        selected: true,
        selectedColor: theme.colors.primary,
      },
    }),
    [calendarIndex, effectiveSelectedDate, theme.colors.primary],
  );

  const onScopeChange = useCallback((nextScope) => {
    const safeNext = nextScope === CALENDAR_SCOPE.ALL ? CALENDAR_SCOPE.ALL : CALENDAR_SCOPE.MY;
    setExecutorFilterIds([]);
    setScope(safeNext);
  }, []);

  const activeScope = hasEmployeeFilter ? null : scope;

  const onResetCalendarFilters = useCallback(() => {
    setExecutorFilterIds([]);
    setExecutorModalVisible(false);
  }, []);
  const scopeOptions = useMemo(
    () =>
      CALENDAR_SCOPE_OPTIONS.map((value) => ({
        value,
        label: value === CALENDAR_SCOPE.MY ? t('home_scope_my') : t('home_scope_all'),
      })),
    [t],
  );
  const renderCalendarActions = useCallback(() => {
    if (!canUseCalendarAllScope) return null;
    const filterIconSize = theme.icons.sm;
    const clearIconSize = Math.round(filterIconSize * CALENDAR_UI.EVENT_COUNT_FONT_RATIO);
    return (
      <View style={styles.ordersHeaderActions}>
        <View style={styles.scopeSwitch}>
          {scopeOptions.map((item) => {
            const active = activeScope === item.value;
            return (
              <Pressable
                key={item.value}
                onPress={() => onScopeChange(item.value)}
                android_ripple={{ color: theme.colors.border }}
                style={({ pressed }) => [
                  styles.scopePill,
                  active && styles.scopePillActive,
                  pressed && { opacity: CALENDAR_UI.PRESSED_OPACITY },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.scopeText, active && styles.scopeTextActive]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          onPress={() => setExecutorModalVisible(true)}
          android_ripple={{ color: theme.colors.ripple || theme.colors.overlayNavBar }}
          style={[styles.filterButton, hasEmployeeFilter && styles.filterButtonActive]}
          accessibilityRole="button"
          accessibilityLabel={t('common_filter')}
        >
          <Feather name="sliders" size={filterIconSize} color={theme.colors.text} />
        </Pressable>
        {hasEmployeeFilter ? (
          <Pressable
            onPress={onResetCalendarFilters}
            android_ripple={{ color: theme.colors.ripple || theme.colors.overlayNavBar }}
            style={styles.resetFilterButton}
            accessibilityRole="button"
          >
            <Feather name="x" size={clearIconSize} color={theme.colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
    );
  }, [
    activeScope,
    canUseCalendarAllScope,
    hasEmployeeFilter,
    onResetCalendarFilters,
    onScopeChange,
    scopeOptions,
    styles.filterButton,
    styles.filterButtonActive,
    styles.ordersHeaderActions,
    styles.resetFilterButton,
    styles.scopePill,
    styles.scopePillActive,
    styles.scopeSwitch,
    styles.scopeText,
    styles.scopeTextActive,
    t,
    theme.colors.border,
    theme.colors.overlayNavBar,
    theme.colors.ripple,
    theme.colors.text,
    theme.colors.textSecondary,
    theme.icons.sm,
  ]);
  useFocusEffect(
    useCallback(
      () => () => {
        queryClient.cancelQueries({ queryKey: ['requests', 'detail'] });
      },
      [queryClient],
    ),
  );

  const ordersSwipeFadeStyle = useAnimatedStyle(() => ({ opacity: 1 }));

  return (
    <Screen
      scroll={false}
      headerOptions={{ headerShown: false }}
    >
      <AppHeader
        back
        onBackPress={() => {
          goBackSmart(
            navigation,
            router,
            returnTo ? { pathname: returnTo, params: returnParams } : null,
            '/orders',
          );
        }}
        options={{
          headerTitleAlign: 'left',
          title: t('routes.orders/calendar'),
        }}
      />
      <View style={styles.container}>
        {showCalendarLoadingOverlay ? (
          <View pointerEvents="none" style={styles.calendarLoadingOverlay}>
            <View style={styles.calendarLoadingPill}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
            </View>
          </View>
        ) : null}
        <Animated.View style={styles.tabsWrapper}>
          <View style={styles.tabsContent}>
            {CALENDAR_VIEW_TABS.map((tab) => {
              const { labelKey, mode, disabled } = tab;
              const label = t(labelKey);
              const isActive = viewMode === mode;
              return (
                <Pressable
                  key={mode}
                  onPress={() => {
                    if (disabled) {
                      toast.info(t('feature_future'));
                      return;
                    }
                    switchMode(mode);
                  }}
                  style={[styles.tabItem, disabled && styles.tabItemDisabled]}
                  android_ripple={{ color: theme.colors.overlayNavBar }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive, disabled }}
                >
                  <Text
                    style={[
                      styles.viewPanelText,
                      disabled && styles.viewPanelTextDisabled,
                      isActive && { color: theme.colors.primary },
                    ]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {label}
                  </Text>
                  <View
                    style={[
                      styles.tabIndicator,
                      {
                        backgroundColor: isActive ? theme.colors.primary : 'transparent',
                      },
                    ]}
                  />
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
        {viewMode === CALENDAR_VIEW_MODE.MONTH ? (
          <>
            <Animated.View style={[calendarContentStyle]}>
                <View style={[styles.calendarContent]}>
                  <CalendarMonthHeader
                    monthDate={currentMonth}
                    dateLocale={dateLocale}
                    onPreviousMonth={goToPreviousMonth}
                    onNextMonth={goToNextMonth}
                    arrowHitSlop={arrowHitSlop}
                    headerAnimatedStyle={headerAnimatedStyle}
                    styles={styles}
                    theme={theme}
                  />
                  <View style={[styles.weekdayRow]}>
                    {DAY_KEYS.map((key) => (
                      <Text key={key} style={styles.weekdayLabel}>
                        {t(key)}
                      </Text>
                    ))}
                  </View>
                  <View style={[styles.monthPage]}>
                    <Animated.View
                      style={[
                        {
                          overflow: 'hidden',
                          width: layoutMetrics.cardWidth,
                          alignSelf: 'center',
                        },
                        weeksClipStyle,
                      ]}
                    >
                      <Animated.View style={[{ flexDirection: 'column' }, weeksTranslateStyle]}>
                        {monthWeeks.map((week, weekIdx) => (
                          <CalendarWeekRow
                            key={`w-${currentMonth.getTime()}-${weekIdx}`}
                            week={week}
                            monthDate={currentMonth}
                            weekIdx={weekIdx}
                            selectedDate={selectedDate}
                            todayKey={todayKey}
                            eventCountsByDate={calendarIndex.countByDate}
                            isCollapsed={isCollapsed}
                            dayCellSize={layoutMetrics.dayCellSize}
                            onDatePress={setSelectedDate}
                            styles={styles}
                            theme={theme}
                            indicatorSlotAnimatedStyle={indicatorSlotAnimatedStyle}
                            eventCountAnimatedStyle={eventCountAnimatedStyle}
                            eventDotAnimatedStyle={eventDotAnimatedStyle}
                          />
                        ))}
                      </Animated.View>
                    </Animated.View>
                  </View>
                </View>
              </Animated.View>
              <View style={{ flex: 1, width: '100%' }}>
                <View
                  style={{
                    width: layoutMetrics.cardWidth,
                    alignSelf: 'center',
                    overflow: 'hidden',
                    flex: 1,
                  }}
                >
                  <Animated.View
                    style={[{ width: layoutMetrics.cardWidth, flex: 1 }, ordersSwipeFadeStyle]}
                    collapsable={false}
                  >
                    <Animated.View style={monthOrdersHeaderAnimatedStyle}>
                      <View
                        style={styles.ordersHeader}
                        onLayout={(event) => {
                          monthOrdersHeaderHeight.value = Math.max(
                            event.nativeEvent.layout.height,
                            MONTH_ORDERS_HEADER_FALLBACK_HEIGHT,
                          );
                        }}
                      >
                        <Text style={styles.ordersTitle}>
                          {ordersTitleDateLabel}
                        </Text>
                        {renderCalendarActions()}
                      </View>
                    </Animated.View>
                    <GestureDetector gesture={monthOrdersPanGesture}>
                      <View style={{ flex: 1 }}>
                        <AnimatedFlatList
                          ref={ordersListRef}
                          data={displayedOrders}
                          extraData={ordersListExtraData}
                          initialNumToRender={CALENDAR_RENDER.MONTH_INITIAL_ITEMS}
                          maxToRenderPerBatch={CALENDAR_RENDER.MONTH_BATCH_ITEMS}
                          updateCellsBatchingPeriod={CALENDAR_RENDER.CELL_BATCH_PERIOD_MS}
                          removeClippedSubviews={Platform.OS === 'android'}
                          keyExtractor={orderKeyExtractor}
                          contentContainerStyle={ordersListContentContainerStyle}
                          style={{ flex: 1 }}
                          scrollEnabled={false}
                          bounces={false}
                          onLayout={(event) => {
                            monthOrdersViewportHeightRef.current = event.nativeEvent.layout.height;
                            updateMonthOrdersScrollLimit();
                          }}
                          onContentSizeChange={(_width, height) => {
                            monthOrdersContentHeightRef.current = height;
                            updateMonthOrdersScrollLimit();
                          }}
                          ListEmptyComponent={ordersEmptyComponent}
                          renderItem={renderOrderItem}
                        />
                      </View>
                    </GestureDetector>
                  </Animated.View>
                </View>
              </View>
          </>
        ) : viewMode === CALENDAR_VIEW_MODE.WEEK ? (
          <View style={styles.weekContent}>
            <CalendarMonthHeader
              label={activeWeekLabel}
              dateLocale={dateLocale}
              onPreviousMonth={goToPreviousWeek}
              onNextMonth={goToNextWeek}
              arrowHitSlop={arrowHitSlop}
              styles={styles}
              theme={theme}
            />
            <View style={styles.weekStrip}>
              {activeWeekDates.map((date) => {
                const dateKey = formatDateKey(date);
                const isActiveDay = dateKey === selectedDate;
                const count = calendarIndex.countByDate[dateKey] || 0;
                return (
                  <Pressable
                    key={dateKey}
                    onPress={() => setSelectedDate(dateKey)}
                    style={[styles.weekDayButton, isActiveDay && styles.weekDayButtonActive]}
                    android_ripple={{ color: theme.colors.ripple || theme.colors.overlayNavBar }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActiveDay }}
                  >
                    <Text style={styles.weekDayName}>{t(DAY_KEYS[date.getDay() === 0 ? 6 : date.getDay() - 1])}</Text>
                    <Text style={[styles.weekDayNumber, isActiveDay && styles.weekDayNumberActive]}>
                      {format(date, 'd', { locale: dateLocale })}
                    </Text>
                    <View style={[styles.weekDayCount, isActiveDay && styles.weekDayCountActive]}>
                      <Text
                        style={[
                          styles.weekDayCountText,
                          isActiveDay && styles.weekDayCountTextActive,
                        ]}
                      >
                        {count}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.weekToolbar}>
              <Text style={styles.weekToolbarTitle}>
                {t('calendar_week_schedule_title')}: {weekTotalCount}
              </Text>
              {renderCalendarActions()}
            </View>
            <SectionList
              sections={weekSections}
              extraData={weekListExtraData}
              keyExtractor={weekOrderKeyExtractor}
              renderSectionHeader={renderWeekSectionHeader}
              renderItem={renderWeekOrderItem}
              stickySectionHeadersEnabled={false}
              showsVerticalScrollIndicator={false}
              style={styles.weekList}
              contentContainerStyle={styles.weekListContent}
            />
          </View>
        ) : viewMode === CALENDAR_VIEW_MODE.DAY ? (
          <View style={styles.dayScheduleContent}>
            <CalendarMonthHeader
              label={activeDayLabel}
              dateLocale={dateLocale}
              onPreviousMonth={goToPreviousDay}
              onNextMonth={goToNextDay}
              arrowHitSlop={arrowHitSlop}
              styles={styles}
              theme={theme}
            />
            <View style={styles.daySummary}>
              {renderCalendarActions()}
              <Text style={styles.weekToolbarTitle}>
                {t('calendar_day_orders_count')}: {displayedOrders.length}
              </Text>
            </View>
            <FlatList
              data={displayedOrders}
              extraData={dayListExtraData}
              keyExtractor={orderKeyExtractor}
              renderItem={renderDayOrderItem}
              ListEmptyComponent={dayEmptyComponent}
              showsVerticalScrollIndicator={false}
              style={styles.dayList}
              contentContainerStyle={[
                styles.dayListContent,
                displayedOrders.length === 0 && { flexGrow: 1 },
              ]}
            />
          </View>
        ) : (
          <View style={[styles.calendarContent, { flex: 1 }]}>
            <CalendarMonthHeader
              label={String(activeVisibleYear)}
              dateLocale={dateLocale}
              onPreviousMonth={goToPreviousYear}
              onNextMonth={goToNextYear}
              arrowHitSlop={arrowHitSlop}
              headerAnimatedStyle={headerAnimatedStyle}
              styles={styles}
              theme={theme}
            />
            <FlatList
              ref={yearFlatListRef}
              style={styles.yearPager}
              onLayout={() => {
                if (!perfYearMountStartedRef.current || perfYearFirstContentLoggedRef.current) return;
                perfYearFirstContentLoggedRef.current = true;
                const elapsedMs = Math.max(0, nowMs() - perfYearMountStartMsRef.current);
                logCalendarPerf(`[perf] calendar.year.first-content.now: ${Math.round(elapsedMs)}ms`);
              }}
              data={dynamicYears}
              horizontal
              pagingEnabled
              initialNumToRender={CALENDAR_RENDER.YEAR_INITIAL_ITEMS}
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item, index) => `year-${item}-${index}`}
              getItemLayout={getItemLayout}
              initialScrollIndex={YEAR_LIST_MIDDLE_INDEX}
              windowSize={CALENDAR_RENDER.YEAR_WINDOW_SIZE}
              maxToRenderPerBatch={CALENDAR_RENDER.YEAR_BATCH_ITEMS}
              updateCellsBatchingPeriod={CALENDAR_RENDER.CELL_BATCH_PERIOD_MS}
              removeClippedSubviews={true}
              onScrollEndDrag={(event) => {
                const vx = Math.abs(Number(event?.nativeEvent?.velocity?.x) || 0);
                if (vx > CALENDAR_UI.YEAR_SCROLL_SETTLE_VELOCITY_X) return;
                const offsetX = Number(event?.nativeEvent?.contentOffset?.x) || 0;
                const nextIndex = resolveYearPageIndex(offsetX);
                commitVisibleYearIndex(nextIndex);
              }}
              onMomentumScrollEnd={(event) => {
                const offsetX = Number(event?.nativeEvent?.contentOffset?.x) || 0;
                const nextIndex = resolveYearPageIndex(offsetX);
                commitVisibleYearIndex(nextIndex);
              }}
              renderItem={({ item: yearValue }) => (
                <View style={styles.yearPage}>
                  <YearView
                    style={styles.yearViewContainer}
                    year={yearValue}
                    currentMonthIndex={currentMonth.getMonth()}
                    onMonthPress={(newMonth) => switchMode(CALENDAR_VIEW_MODE.MONTH, { newMonth })}
                    markedDates={markedDates}
                  />
                </View>
              )}
            />
          </View>
        )}
      </View>
      {canUseCalendarAllScope ? (
        <FiltersPanel
          visible={executorModalVisible}
          onClose={() => setExecutorModalVisible(false)}
          departments={departments}
          mode="assignment"
          assignment={assignmentPanelConfig}
        />
      ) : null}
    </Screen>
  );
}

export default function CalendarScreen() {
  return <CalendarScreenContent />;
}
