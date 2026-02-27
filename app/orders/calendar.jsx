// app/orders/calendar.jsx (REFACTORED)
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { format, startOfMonth } from 'date-fns';
import { ru as dfnsRu } from 'date-fns/locale';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Dimensions,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LocaleConfig } from 'react-native-calendars';
import Animated, {
  Extrapolate,
  interpolate,
  runOnJS,
  useAnimatedRef,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
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
import { clamp, getMonthWeeks } from '../../hooks/useCalendarLogic';
import { usePermissions } from '../../lib/permissions';
import {
  ensureRequestPrefetch,
  useCalendarRequests,
  useRequestExecutors,
  useRequestRealtimeSync,
} from '../../src/features/requests/queries';
import { useDepartmentsQuery } from '../../src/features/employees/queries';
import { formatDateKey } from '../../lib/calendarUtils';
import { markFirstContent, markScreenMount } from '../../src/shared/perf/devMetrics';
import { getPrefetchRegistry } from '../../src/shared/query/prefetchRegistry';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme/ThemeProvider';
import { CALENDAR_GESTURE, CALENDAR_LAYOUT } from '../../constants/layout';

/** ======= RU locale for react-native-calendars ======= */
LocaleConfig.locales['ru'] = {
  monthNames: [
    'Январь',
    'Февраль',
    'Март',
    'Апрель',
    'Май',
    'Июнь',
    'Июль',
    'Август',
    'Сентябрь',
    'Октябрь',
    'Ноябрь',
    'Декабрь',
  ],
  monthNamesShort: [
    'Янв',
    'Фев',
    'Мар',
    'Апр',
    'Май',
    'Июн',
    'Июл',
    'Авг',
    'Сен',
    'Окт',
    'Ноя',
    'Дек',
  ],
  dayNames: ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'],
  dayNamesShort: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
  today: 'Сегодня',
};
LocaleConfig.defaultLocale = 'ru';

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

function nowMs() {
  const perf = globalThis?.performance;
  if (perf && typeof perf.now === 'function') return perf.now();
  return Date.now();
}

export default function CalendarScreen() {
  const { profile, isAuthenticated, isInitializing } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();

  const screenWidth = Dimensions.get('window').width;
  const layoutMetrics = useMemo(() => {
    const horizontalMargin = theme.spacing.md;
    const innerPadding = theme.spacing.sm;
    const cardWidth = Math.max(0, screenWidth - horizontalMargin * 2);
    const rawCellSize = Math.max(28, Math.min((cardWidth - innerPadding * 2) / 7, 48));
    const dayCellSize = rawCellSize;
    const weekRowHeight = dayCellSize + theme.spacing.xs * 1.6;
    const monthHeaderHeight = theme.spacing.md * 2 + theme.typography.sizes.lg * 1.5;
    const dayNamesHeight = theme.spacing.sm * 1.2 + theme.typography.sizes.xs * 1.3;
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
  const [viewMode, setViewMode] = useState('month');
  const [scope, setScope] = useState('my');
  const [executorFilterIds, setExecutorFilterIds] = useState([]);
  const [executorModalVisible, setExecutorModalVisible] = useState(false);
  const [calendarQueryAnchorMonth, setCalendarQueryAnchorMonth] = useState(startOfMonth(new Date()));
  const hasEmployeeFilter = Array.isArray(executorFilterIds) && executorFilterIds.length > 0;
  const { has, loading: permissionsLoading } = usePermissions();
  const canViewAllOrders = !permissionsLoading && has('canViewAllOrders');
  const companyId = profile?.company_id || null;

  useEffect(() => {
    markScreenMount('Calendar');
  }, []);

  const calendarQueryRange = useMemo(() => {
    const base = calendarQueryAnchorMonth;
    const start = new Date(base.getFullYear(), 0, 1);
    const end = new Date(base.getFullYear(), 11, 31, 23, 59, 59, 999);
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    };
  }, [calendarQueryAnchorMonth]);

  useEffect(() => {
    const yearsDelta = currentMonth.getFullYear() - calendarQueryAnchorMonth.getFullYear();
    if (yearsDelta === 0) return;
    setCalendarQueryAnchorMonth(startOfMonth(currentMonth));
  }, [calendarQueryAnchorMonth, currentMonth]);

  const {
    data: orders = [],
    isLoading: isCalendarLoading,
  } = useCalendarRequests({
    userId: profile?.id,
    role: profile?.role,
    scope: canViewAllOrders ? (hasEmployeeFilter ? 'all' : scope) : 'my',
    startDate: calendarQueryRange.startDate,
    endDate: calendarQueryRange.endDate,
    refetchIntervalMs: false,
    enabled: isAuthenticated && !isInitializing && !!profile?.id && !!profile?.role,
    isScreenActive: isFocused,
  });

  useRequestRealtimeSync({ enabled: false });
  const { data: executors = [] } = useRequestExecutors({
    companyId,
    enabled:
      isAuthenticated &&
      !isInitializing &&
      !!profile?.id &&
      canViewAllOrders &&
      (executorModalVisible || hasEmployeeFilter),
    placeholderData: (prev) => prev ?? [],
  });
  const { data: departments = [] } = useDepartmentsQuery({
    companyId,
    enabled: !!companyId && canViewAllOrders && (executorModalVisible || hasEmployeeFilter),
    onlyEnabled: true,
  });

  const executorFilterItems = useMemo(
    () =>
      (Array.isArray(executors) ? executors : [])
        .map((row) => {
          const id = String(row?.id || '').trim();
          if (!id) return null;
          const fullName = `${String(row?.first_name || '').trim()} ${String(row?.last_name || '').trim()}`.trim();
          return {
            id,
            label: fullName || String(row?.full_name || row?.email || '').trim() || id,
          };
        })
        .filter(Boolean)
        .sort((a, b) => String(a.label).localeCompare(String(b.label), 'ru')),
    [executors],
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
        if (next.length > 0) setScope('all');
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
    console.time('calendar-mount');
  }, []);

  useEffect(() => {
    if (firstContentMarkedRef.current) return;
    if (isCalendarLoading) return;
    firstContentMarkedRef.current = true;
    markFirstContent('Calendar');
    if (!perfFirstContentLoggedRef.current) {
      perfFirstContentLoggedRef.current = true;
      const elapsedMs = Math.max(0, nowMs() - perfMountStartMsRef.current);
      console.log(`[perf] calendar.first-content.now: ${Math.round(elapsedMs)}ms`);
      try {
        console.timeEnd('calendar-mount');
      } catch {}
    }
  }, [isCalendarLoading]);

  useEffect(() => {
    if (canViewAllOrders) return;
    if (scope !== 'my') setScope('my');
    if (executorFilterIds.length) setExecutorFilterIds([]);
    if (executorModalVisible) setExecutorModalVisible(false);
  }, [canViewAllOrders, executorFilterIds, executorModalVisible, scope]);

  useFocusEffect(
    useCallback(() => {
      if (!canViewAllOrders) return undefined;
      setScope('my');
      setExecutorFilterIds([]);
      return undefined;
    }, [canViewAllOrders]),
  );

  const MONTH_LIST_MIDDLE_INDEX = CALENDAR_LAYOUT.MONTH_WINDOW_RADIUS;

  const [measuredMonthHeaderHeight, setMeasuredMonthHeaderHeight] = useState(
    layoutMetrics.monthHeaderHeight,
  );
  const [measuredDayNamesHeight, setMeasuredDayNamesHeight] = useState(layoutMetrics.dayNamesHeight);
  const [measuredWeekRowHeight, setMeasuredWeekRowHeight] = useState(layoutMetrics.weekRowHeight);

  const [isCollapsed, setIsCollapsed] = useState(false);
  const isSnapping = false;

  const collapseTranslate = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const visibleMonthIndex = useSharedValue(MONTH_LIST_MIDDLE_INDEX);
  const isCollapsedShared = useSharedValue(false);
  const monthPagerRef = useAnimatedRef();
  const ordersListRef = useRef(null);
  const lastHandledPageIndex = useRef(MONTH_LIST_MIDDLE_INDEX);
  const visibleMonthIndexRef = useRef(MONTH_LIST_MIDDLE_INDEX);
  const monthScrollRafRef = useRef(null);
  const pendingScrollTargetIndexRef = useRef(null);
  const [visibleMonthRenderIndex, setVisibleMonthRenderIndex] = useState(MONTH_LIST_MIDDLE_INDEX);
  const settledMonthOffsetX = useSharedValue(layoutMetrics.cardWidth * MONTH_LIST_MIDDLE_INDEX);
  const monthSwipeInteraction = useSharedValue(0);
  const deferInitialMeasureRef = useRef(false);
  const [monthWindowAnchor, setMonthWindowAnchor] = useState(startOfMonth(new Date()));
  const YEAR_LIST_RADIUS = 120;
  const YEAR_LIST_MIDDLE_INDEX = YEAR_LIST_RADIUS;
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
    for (let i = -YEAR_LIST_RADIUS; i <= YEAR_LIST_RADIUS; i++) {
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

  const commitVisibleMonthIndex = useCallback(
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
        console.log(`[perf] calendar.year.page-change.now: ${Math.round(elapsedMs)}ms`);
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
    if (viewMode !== 'year') {
      perfYearMountStartedRef.current = false;
      perfYearFirstContentLoggedRef.current = false;
      return;
    }
    if (perfYearMountStartedRef.current) return;
    perfYearMountStartedRef.current = true;
    perfYearMountStartMsRef.current = nowMs();
    console.time('calendar-year-mount');
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
    if (viewMode === 'month') {
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

  const onMonthHeaderLayout = useCallback(
    (event) => {
      if (deferInitialMeasureRef.current) return;
      const nextHeight = event?.nativeEvent?.layout?.height;
      const minStableHeight = layoutMetrics.monthHeaderHeight * CALENDAR_LAYOUT.HEADER_LAYOUT_MIN_RATIO;
      if (!Number.isFinite(nextHeight) || nextHeight <= minStableHeight) return;
      setMeasuredMonthHeaderHeight((prev) =>
        Math.abs(prev - nextHeight) <= CALENDAR_LAYOUT.MEASURE_DELTA_EPSILON ? prev : nextHeight,
      );
    },
    [layoutMetrics.monthHeaderHeight, setMeasuredMonthHeaderHeight],
  );

  const onWeekdayRowLayout = useCallback(
    (event) => {
      if (deferInitialMeasureRef.current) return;
      const nextHeight = event?.nativeEvent?.layout?.height;
      if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;
      setMeasuredDayNamesHeight((prev) =>
        Math.abs(prev - nextHeight) <= CALENDAR_LAYOUT.MEASURE_DELTA_EPSILON ? prev : nextHeight,
      );
    },
    [setMeasuredDayNamesHeight],
  );

  const onWeekRowLayout = useCallback(
    (event) => {
      if (deferInitialMeasureRef.current) return;
      const nextHeight = event?.nativeEvent?.layout?.height;
      if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;
      setMeasuredWeekRowHeight((prev) =>
        Math.abs(prev - nextHeight) <= CALENDAR_LAYOUT.MEASURE_DELTA_EPSILON ? prev : nextHeight,
      );
      if (!perfGridLoggedRef.current) {
        perfGridLoggedRef.current = true;
        const elapsedMs = Math.max(0, nowMs() - perfMountStartMsRef.current);
        console.log(`[perf] calendar.grid-ready.now: ${Math.round(elapsedMs)}ms`);
      }
    },
    [setMeasuredWeekRowHeight],
  );

  const indicatorSlotBaseHeight = theme.typography.sizes.xs + theme.spacing.xs * 0.2;
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1 },
        tabsWrapper: {
          paddingHorizontal: theme.spacing.md,
          paddingTop: theme.spacing.xs,
          paddingBottom: theme.spacing.sm * 0.5,
          marginTop: -theme.spacing.sm * 0.5,
          marginBottom: theme.spacing.sm * 0.5,
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
        tabIndicator: {
          height: 2,
          marginTop: theme.spacing.xs,
          borderRadius: 1,
          alignSelf: 'stretch',
        },
        viewPanelText: {
          color: theme.colors.textSecondary,
          fontSize: theme.typography.sizes.sm,
          fontWeight: theme.typography.weight.medium,
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
          alignSelf: 'center',
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.md,
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
          alignSelf: 'center',
          paddingHorizontal: layoutMetrics.innerPadding,
          paddingVertical: theme.spacing.xs,
        },
        weekdayLabel: {
          width: layoutMetrics.dayCellSize,
          textAlign: 'center',
          fontSize: theme.typography.sizes.xs,
          fontWeight: theme.typography.weight.medium,
          color: theme.colors.textSecondary,
          lineHeight: layoutMetrics.dayCellSize * 0.6,
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
          overflow: 'hidden',
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
          position: 'relative',
          alignItems: 'center',
          justifyContent: 'center',
        },
        dayNumberLayer: {
          ...StyleSheet.absoluteFillObject,
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1,
        },
        dayNumber: {
          fontFamily: theme.typography.fontFamily,
          fontWeight: theme.typography.weight.regular,
          fontSize: theme.typography.sizes.md,
          lineHeight: theme.typography.sizes.md * 1.15,
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
          position: 'absolute',
          left: 2,
          right: 2,
          bottom: Math.max(1, theme.spacing.xs * 0.35),
          minHeight: indicatorSlotBaseHeight,
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 0,
        },
        eventCount: {
          fontSize: theme.typography.sizes.xs * 0.9,
          fontWeight: theme.typography.weight.semibold,
          color: theme.colors.primary,
          textAlign: 'center',
        },
        eventDot: {
          marginTop: theme.spacing.xs * 0.5,
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
          borderBottomWidth: 1,
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
        collapseToggleRow: {
          width: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          paddingTop: theme.spacing.xs * 0.5,
          paddingBottom: theme.spacing.xs,
        },
        collapseToggleButton: {
          width: '100%',
          height: 30,
          borderRadius: 11,
          alignItems: 'center',
          justifyContent: 'center',
        },
        scopeSwitch: {
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 999,
          padding: 2,
          height: 28,
          backgroundColor: theme.colors.surface,
        },
        scopePill: {
          minWidth: 49,
          height: 24,
          paddingHorizontal: 9,
          borderRadius: 999,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'transparent',
        },
        scopePillActive: {
          backgroundColor: theme.colors.primary,
        },
        scopeText: {
          fontSize: 12,
          color: theme.colors.textSecondary || theme.colors.text,
        },
        scopeTextActive: {
          color: theme.colors.onPrimary || '#fff',
          fontWeight: '600',
        },
        filterButton: {
          width: 28,
          height: 28,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: theme.colors.border,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.surface,
        },
        filterButtonActive: {
          borderColor: theme.colors.primary,
          backgroundColor: `${theme.colors.primary}14`,
        },
        resetFilterButton: {
          width: 28,
          height: 28,
          borderRadius: 14,
          borderWidth: 1,
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
    [theme, layoutMetrics],
  );

  const stageAtoBProgress = useDerivedValue(() => {
    return Math.min(collapseTranslate.value / stageOneDistanceSafe, 1);
  }, [dynamicMonths.length, layoutMetrics.cardWidth, visibleMonthIndex]);
  const monthCollapsePhaseSplit = CALENDAR_GESTURE.MONTH_COLLAPSE_PHASE_SPLIT;
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
        if (progress <= 0.001) {
          return resolvedMonthHeaderHeight + measuredDayNamesHeight + settledWeeksHeight.value;
        }
        const fullWeeksHeight = measuredWeekRowHeight * actualWeekRows;
        const selectedWeekTop = selectedWeekIndex * measuredWeekRowHeight;
        const selectedWeekBottom = Math.max(
          0,
          fullWeeksHeight - (selectedWeekIndex + 1) * measuredWeekRowHeight,
        );
        const selectedBottomEdge = selectedWeekTop + measuredWeekRowHeight;
        const phaseAProgress = Math.min(progress / monthCollapsePhaseSplit, 1);
        const phaseBDenominator = Math.max(1 - monthCollapsePhaseSplit, Number.EPSILON);
        const phaseBProgress =
          progress <= monthCollapsePhaseSplit
            ? 0
            : Math.min((progress - monthCollapsePhaseSplit) / phaseBDenominator, 1);
        const weeksVisibleHeight =
          progress <= monthCollapsePhaseSplit
            ? fullWeeksHeight - selectedWeekBottom * phaseAProgress
            : selectedBottomEdge - (selectedBottomEdge - measuredWeekRowHeight) * phaseBProgress;
        const monthHeaderVisibleHeight = resolvedMonthHeaderHeight * (1 - progress);
        return monthHeaderVisibleHeight + measuredDayNamesHeight + weeksVisibleHeight;
      })(),
    }),
    [
      actualWeekRows,
      measuredDayNamesHeight,
      resolvedMonthHeaderHeight,
      measuredWeekRowHeight,
      monthCollapsePhaseSplit,
      settledWeeksHeight,
      selectedWeekIndex,
    ],
  );

  const indicatorSlotAnimatedStyle = useAnimatedStyle(() => {
    const collapsedHeight = indicatorSlotBaseHeight * 0.5;
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
      transform: [{ scale: interpolate(progress, [0, 1], [1, 0.24], Extrapolate.CLAMP) }],
    };
  });
  const eventDotAnimatedStyle = useAnimatedStyle(() => {
    const progress = stageAtoBProgress.value;
    return {
      opacity: interpolate(progress, [0, 0.03, 0.65], [0, 0, 1], Extrapolate.CLAMP),
      transform: [{ scale: interpolate(progress, [0, 0.65], [0.24, 1], Extrapolate.CLAMP) }],
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
    if (progress <= 0.001) {
      return { height: settledWeeksHeight.value, overflow: 'hidden' };
    }
    const fullHeight = measuredWeekRowHeight * actualWeekRows;
    const selectedWeekTop = selectedWeekIndex * measuredWeekRowHeight;
    const selectedWeekBottom = Math.max(
      0,
      fullHeight - (selectedWeekIndex + 1) * measuredWeekRowHeight,
    );
    const selectedBottomEdge = selectedWeekTop + measuredWeekRowHeight;
    const phaseAProgress = Math.min(progress / monthCollapsePhaseSplit, 1);
    const phaseBDenominator = Math.max(1 - monthCollapsePhaseSplit, Number.EPSILON);
    const phaseBProgress =
      progress <= monthCollapsePhaseSplit
        ? 0
        : Math.min((progress - monthCollapsePhaseSplit) / phaseBDenominator, 1);
    const height =
      progress <= monthCollapsePhaseSplit
        ? fullHeight - selectedWeekBottom * phaseAProgress
        : selectedBottomEdge - (selectedBottomEdge - measuredWeekRowHeight) * phaseBProgress;
    return { height, overflow: 'hidden' };
  }, [
    actualWeekRows,
    measuredWeekRowHeight,
    monthCollapsePhaseSplit,
    settledWeeksHeight,
    selectedWeekIndex,
  ]);

  const weeksTranslateStyle = useAnimatedStyle(() => {
    const progress = stageAtoBProgress.value;
    const selectedWeekTop = selectedWeekIndex * measuredWeekRowHeight;
    const phaseBDenominator = Math.max(1 - monthCollapsePhaseSplit, Number.EPSILON);
    const phaseBProgress =
      progress <= monthCollapsePhaseSplit
        ? 0
        : Math.min((progress - monthCollapsePhaseSplit) / phaseBDenominator, 1);
    const weekOffset = -selectedWeekTop * phaseBProgress;
    return { transform: [{ translateY: weekOffset }] };
  }, [measuredWeekRowHeight, monthCollapsePhaseSplit, selectedWeekIndex]);

  const switchMode = useCallback((nextMode, opts = {}) => {
    if (nextMode === 'month') {
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
    setViewMode(nextMode);
  }, [
    currentMonth,
    layoutMetrics.cardWidth,
    monthPagerRef,
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
        router.replace('/orders');
        return true;
      });
      return () => sub.remove();
    }, [router]),
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
        e.preventDefault();
        router.replace('/orders');
      });
      return removeSub;
    }, [navigation, router]),
  );

  const filteredOrders = useMemo(() => {
    const base = Array.isArray(orders) ? orders : [];
    if (!base.length) return [];
    if (!hasEmployeeFilter) return base;
    return base.filter((order) => executorFilterSet.has(String(order?.assigned_to || '')));
  }, [executorFilterSet, hasEmployeeFilter, orders]);

  const calendarIndex = useMemo(() => {
    const byDate = {};
    const countByDate = {};

    for (const order of filteredOrders) {
      const dateField = order?.time_window_start;
      if (!dateField) continue;
      const key = formatDateKey(new Date(dateField));
      if (!key) continue;

      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(order);
      countByDate[key] = (countByDate[key] || 0) + 1;

    }

    const marksBase = {};
    Object.keys(countByDate).forEach((date) => {
      marksBase[date] = { marked: true, dotColor: theme.colors.primary };
    });

    return { byDate, marksBase, countByDate };
  }, [filteredOrders, theme.colors.primary]);

  const committedMonthKey = format(currentMonth, 'yyyy-MM');
  const selectedMonthKey = selectedDate ? selectedDate.slice(0, 7) : 'none';
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
  const ordersListExtraData = useMemo(
    () => ({ selectedDate: effectiveSelectedDate, count: displayedOrders.length }),
    [displayedOrders.length, effectiveSelectedDate],
  );
  const monthPagerExtraData = useMemo(
    () => ({
      selectedDate,
      todayKey,
      isCollapsed,
      visibleMonthRenderIndex,
      countsKey: Object.keys(calendarIndex.countByDate).join('|'),
    }),
    [calendarIndex.countByDate, isCollapsed, selectedDate, todayKey, visibleMonthRenderIndex],
  );
  const ordersTitleDateLabel = useMemo(
    () => (effectiveSelectedDate ? format(new Date(effectiveSelectedDate), 'd MMMM', { locale: dfnsRu }) : ''),
    [effectiveSelectedDate],
  );
  const ordersListContentContainerStyle = useMemo(
    () => ({
      paddingHorizontal: theme.spacing.md,
      paddingBottom: Math.max(theme.spacing.xl, insets.bottom),
    }),
    [insets.bottom, theme.spacing.md, theme.spacing.xl],
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
      if (prev.id === orderId && now - prev.ts < 1200) return;
      detailNavLockRef.current = { id: orderId, ts: now };
      const registry = getPrefetchRegistry();
      registry
        .run(`request-detail:${orderId}`, () => ensureRequestPrefetch(queryClient, orderId))
        .catch(() => {});
      router.push(`/orders/${orderId}`);
    },
    [queryClient, router],
  );
  const renderOrderItem = useCallback(
    ({ item }) => (
      <DynamicOrderCard
        order={item}
        context="calendar"
        onPress={openOrderDetails}
      />
    ),
    [openOrderDetails],
  );
  const ordersEmptyComponent = useMemo(
    () => <Text style={styles.noOrders}>Нет заявок</Text>,
    [styles.noOrders],
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
    const safeNext = nextScope === 'all' ? 'all' : 'my';
    setExecutorFilterIds([]);
    setScope(safeNext);
  }, []);

  const activeScope = hasEmployeeFilter ? null : scope;

  const onResetCalendarFilters = useCallback(() => {
    setExecutorFilterIds([]);
    setExecutorModalVisible(false);
  }, []);
  const onToggleCollapsed = useCallback(() => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    isCollapsedShared.value = next;
    collapseTranslate.value = next ? stageOneDistanceSafe : 0;
    if (!next) {
      scrollY.value = 0;
    }
  }, [collapseTranslate, isCollapsed, isCollapsedShared, scrollY, stageOneDistanceSafe]);

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
        onBackPress={() => router.replace('/orders')}
        options={{
          headerTitleAlign: 'left',
          title: t('routes.orders/calendar'),
        }}
      />
      <View style={styles.container}>
        <Animated.View style={styles.tabsWrapper}>
          <View style={styles.tabsContent}>
            {['Год', 'Месяц', 'Неделя', 'День', 'Расписание'].map((label, index) => {
              const isActive =
                (index === 0 && viewMode === 'year') ||
                (index === 1 && viewMode === 'month') ||
                (index > 1 && viewMode === label.toLowerCase());
              return (
                <Pressable
                  key={label}
                  onPress={() => {
                    if (index === 0) switchMode('year');
                    else if (index === 1) switchMode('month');
                    // Other modes not yet implemented
                  }}
                  style={styles.tabItem}
                  android_ripple={{ color: theme.colors.overlayNavBar }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                >
                  <Text
                    style={[styles.viewPanelText, isActive && { color: theme.colors.primary }]}
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
        {viewMode === 'month' ? (
          <>
            <Animated.View style={[calendarContentStyle]}>
                <View style={[styles.calendarContent]}>
                  <CalendarMonthHeader
                    monthDate={activeVisibleMonth}
                    onPreviousMonth={goToPreviousMonth}
                    onNextMonth={goToNextMonth}
                    arrowHitSlop={arrowHitSlop}
                    headerAnimatedStyle={headerAnimatedStyle}
                    onHeaderLayout={onMonthHeaderLayout}
                    styles={styles}
                    theme={theme}
                  />
                  <View style={[styles.weekdayRow]} onLayout={onWeekdayRowLayout}>
                    {DAY_KEYS.map((key) => (
                      <Text key={key} style={styles.weekdayLabel}>
                        {t(key)}
                      </Text>
                    ))}
                  </View>
                  <AnimatedFlatList
                    ref={monthPagerRef}
                    data={dynamicMonths}
                    extraData={monthPagerExtraData}
                    horizontal
                    pagingEnabled
                    initialNumToRender={1}
                    scrollEnabled={false}
                    showsHorizontalScrollIndicator={false}
                    keyExtractor={(item, index) => `month-${item.getTime()}-${index}`}
                    getItemLayout={getItemLayout}
                    initialScrollIndex={MONTH_LIST_MIDDLE_INDEX}
                    windowSize={2}
                    maxToRenderPerBatch={1}
                    updateCellsBatchingPeriod={16}
                    removeClippedSubviews={Platform.OS === 'android'}
                    scrollEventThrottle={16}
                    renderItem={({ item: monthDate }) => {
                      const itemMonthWeeks = getWeeksForMonth(monthDate);
                      return (
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
                            <Animated.View
                              style={[{ flexDirection: 'column' }, weeksTranslateStyle]}
                            >
                              {itemMonthWeeks.map((week, weekIdx) => (
                                <CalendarWeekRow
                                  key={`w-${monthDate.getTime()}-${weekIdx}`}
                                  week={week}
                                  monthDate={monthDate}
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
                                  onRowLayout={weekIdx === 0 ? onWeekRowLayout : undefined}
                                />
                              ))}
                            </Animated.View>
                          </Animated.View>
                        </View>
                      );
                    }}
                  />
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
                    <View style={styles.ordersHeader}>
                      <Text style={styles.ordersTitle}>
                        {ordersTitleDateLabel}
                      </Text>
                      <View style={styles.ordersHeaderActions}>
                        {canViewAllOrders ? (
                          <View style={styles.scopeSwitch}>
                            {['my', 'all'].map((s) => {
                              const active = activeScope === s;
                              return (
                                <Pressable
                                  key={s}
                                  onPress={() => onScopeChange(s)}
                                  android_ripple={{ color: theme.colors.border }}
                                  style={({ pressed }) => [
                                    styles.scopePill,
                                    active && styles.scopePillActive,
                                    pressed && { opacity: 0.92 },
                                  ]}
                                  accessibilityRole="button"
                                >
                                  <Text style={[styles.scopeText, active && styles.scopeTextActive]}>
                                    {s === 'my' ? t('home_scope_my') : t('home_scope_all')}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        ) : null}
                        {canViewAllOrders ? (
                          <Pressable
                            onPress={() => setExecutorModalVisible(true)}
                            android_ripple={{ color: theme.colors.ripple || theme.colors.overlayNavBar }}
                            style={[styles.filterButton, hasEmployeeFilter && styles.filterButtonActive]}
                            accessibilityRole="button"
                            accessibilityLabel={t('common_filter')}
                          >
                            <Feather name="sliders" size={18} color={theme.colors.text} />
                          </Pressable>
                        ) : null}
                        {canViewAllOrders && hasEmployeeFilter ? (
                          <Pressable
                            onPress={onResetCalendarFilters}
                            android_ripple={{ color: theme.colors.ripple || theme.colors.overlayNavBar }}
                            style={styles.resetFilterButton}
                            accessibilityRole="button"
                          >
                            <Feather name="x" size={16} color={theme.colors.textSecondary} />
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                    <View style={styles.collapseToggleRow}>
                      <Pressable
                        onPress={onToggleCollapsed}
                        style={({ pressed }) => [styles.collapseToggleButton, pressed && { opacity: 0.8 }]}
                        android_ripple={{ color: theme.colors.ripple || theme.colors.overlayNavBar }}
                        hitSlop={8}
                        accessibilityRole="button"
                      >
                        <Feather
                          name={isCollapsed ? 'chevron-down' : 'chevron-up'}
                          size={16}
                          color={theme.colors.textSecondary}
                        />
                      </Pressable>
                    </View>
                    <View style={{ flex: 1 }}>
                      <FlatList
                        ref={ordersListRef}
                        data={displayedOrders}
                        extraData={ordersListExtraData}
                        initialNumToRender={2}
                        maxToRenderPerBatch={4}
                        updateCellsBatchingPeriod={16}
                        removeClippedSubviews={Platform.OS === 'android'}
                        keyExtractor={orderKeyExtractor}
                        contentContainerStyle={ordersListContentContainerStyle}
                        style={{ flex: 1 }}
                        scrollEnabled={isCollapsed && !isSnapping}
                        bounces={false}
                        scrollEventThrottle={16}
                        onScroll={(event) => {
                          scrollY.value = Math.max(0, event.nativeEvent.contentOffset.y);
                        }}
                        onScrollBeginDrag={() => {
                          if (!isCollapsed) scrollY.value = 0;
                        }}
                        onMomentumScrollEnd={(event) => {
                          scrollY.value = Math.max(0, event.nativeEvent.contentOffset.y);
                        }}
                        ListEmptyComponent={ordersEmptyComponent}
                        renderItem={renderOrderItem}
                      />
                    </View>
                  </Animated.View>
                </View>
              </View>
          </>
        ) : (
          <View style={[styles.calendarContent, { flex: 1 }]}>
            <CalendarMonthHeader
              label={String(activeVisibleYear)}
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
                console.log(`[perf] calendar.year.first-content.now: ${Math.round(elapsedMs)}ms`);
                try {
                  console.timeEnd('calendar-year-mount');
                } catch {}
              }}
              data={dynamicYears}
              horizontal
              pagingEnabled
              initialNumToRender={1}
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item, index) => `year-${item}-${index}`}
              getItemLayout={getItemLayout}
              initialScrollIndex={YEAR_LIST_MIDDLE_INDEX}
              windowSize={2}
              maxToRenderPerBatch={1}
              updateCellsBatchingPeriod={16}
              removeClippedSubviews={true}
              onScrollEndDrag={(event) => {
                const vx = Math.abs(Number(event?.nativeEvent?.velocity?.x) || 0);
                if (vx > 0.05) return;
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
                    onMonthPress={(newMonth) => switchMode('month', { newMonth })}
                    markedDates={markedDates}
                  />
                </View>
              )}
            />
          </View>
        )}
      </View>
      {canViewAllOrders ? (
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
