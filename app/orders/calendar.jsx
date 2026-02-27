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
  InteractionManager,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LocaleConfig } from 'react-native-calendars';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolate,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
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

function resolveSnapTarget(progress, velocityY, totalDistance) {
  'worklet';
  const threshold = CALENDAR_GESTURE.SNAP_VELOCITY_Y;
  if (Math.abs(velocityY) > threshold) {
    return velocityY < 0 ? totalDistance : 0;
  }
  return progress > CALENDAR_GESTURE.SNAP_PROGRESS_THRESHOLD ? totalDistance : 0;
}

function resolveGestureIntent(tx, ty, vx, vy, distanceThreshold, dominanceRatio, velocityThreshold) {
  'worklet';
  const absTx = Math.abs(tx);
  const absTy = Math.abs(ty);
  if (absTx < distanceThreshold && absTy < distanceThreshold) return 0;

  const horizontalByDistance = absTx >= absTy * dominanceRatio;
  const verticalByDistance = absTy >= absTx * dominanceRatio;
  if (horizontalByDistance) return 1;
  if (verticalByDistance) return 2;

  const absVx = Math.abs(vx);
  const absVy = Math.abs(vy);
  if (absVx >= velocityThreshold && absVx > absVy) return 1;
  if (absVy >= velocityThreshold && absVy > absVx) return 2;
  return 0;
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
  const hasEmployeeFilter = Array.isArray(executorFilterIds) && executorFilterIds.length > 0;
  const ordersSwapOverlayOpacity = useSharedValue(0);
  const [isOrdersSwapping, setIsOrdersSwapping] = useState(false);
  const { has, loading: permissionsLoading } = usePermissions();
  const canViewAllOrders = !permissionsLoading && has('canViewAllOrders');
  const companyId = profile?.company_id || null;

  useEffect(() => {
    markScreenMount('Calendar');
  }, []);

  const {
    data: orders = [],
    isLoading: isCalendarLoading,
  } = useCalendarRequests({
    userId: profile?.id,
    role: profile?.role,
    scope: canViewAllOrders ? (hasEmployeeFilter ? 'all' : scope) : 'my',
    enabled: isAuthenticated && !isInitializing && !!profile?.id && !!profile?.role,
    isScreenActive: isFocused,
  });

  useRequestRealtimeSync({ enabled: isFocused && !!profile?.id });
  const { data: executors = [] } = useRequestExecutors({
    companyId,
    enabled: isAuthenticated && !isInitializing && !!profile?.id && canViewAllOrders,
    placeholderData: (prev) => prev ?? [],
  });
  const { data: departments = [] } = useDepartmentsQuery({
    companyId,
    enabled: !!companyId && canViewAllOrders,
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
  useEffect(() => {
    if (firstContentMarkedRef.current) return;
    if (isCalendarLoading) return;
    firstContentMarkedRef.current = true;
    markFirstContent('Calendar');
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
  const [isSnapping, setIsSnapping] = useState(false);

  const collapseTranslate = useSharedValue(0);
  const gestureStart = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const monthScrollX = useSharedValue(layoutMetrics.cardWidth * MONTH_LIST_MIDDLE_INDEX);
  const visibleMonthIndex = useSharedValue(MONTH_LIST_MIDDLE_INDEX);
  const isCollapsedShared = useSharedValue(false);
  const isSnappingShared = useSharedValue(false);
  const panHasDrivenCollapse = useSharedValue(false);
  const monthPagerRef = useAnimatedRef();
  const ordersListRef = useRef(null);
  const lastHandledPageIndex = useRef(MONTH_LIST_MIDDLE_INDEX);
  const visibleMonthIndexRef = useRef(MONTH_LIST_MIDDLE_INDEX);
  const monthMomentumStartedRef = useRef(false);
  const monthScrollRafRef = useRef(null);
  const pendingDragEndCommitRafRef = useRef(null);
  const pendingScrollTargetIndexRef = useRef(null);
  const [visibleMonthRenderIndex, setVisibleMonthRenderIndex] = useState(MONTH_LIST_MIDDLE_INDEX);
  const settledMonthOffsetX = useSharedValue(layoutMetrics.cardWidth * MONTH_LIST_MIDDLE_INDEX);
  const monthSwipeInteraction = useSharedValue(0);
  const deferInitialMeasureRef = useRef(true);
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
  const monthWeeksByIndex = useMemo(
    () => dynamicMonths.map((monthDate) => getMonthWeeks(monthDate.getFullYear(), monthDate.getMonth())),
    [dynamicMonths],
  );
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

  const resolvePageIndex = useCallback(
    (offsetX) => {
      const pageWidth = layoutMetrics.cardWidth;
      if (!pageWidth) return 0;
      const maxIndex = Math.max(0, dynamicMonths.length - 1);
      return clamp(Math.round(offsetX / pageWidth), 0, maxIndex);
    },
    [dynamicMonths.length, layoutMetrics.cardWidth],
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
  const resolveMonthDateKeyByIndex = useCallback(
    (pageIndex) => {
      const monthDate = dynamicMonths[pageIndex];
      if (!monthDate) return null;
      return format(startOfMonth(monthDate), 'yyyy-MM-dd');
    },
    [dynamicMonths],
  );
  const requestMonthCommit = useCallback(
    (nextIndex) => {
      const nextDateKey = resolveMonthDateKeyByIndex(nextIndex);
      if (nextDateKey && nextDateKey !== displayDateKey) {
        setIsOrdersSwapping(true);
        setDisplayDateKey(null);
        setDisplayTitleDateKey(null);
        cancelAnimation(ordersSwapOverlayOpacity);
        ordersSwapOverlayOpacity.value = 1;
        commitVisibleMonthIndex(nextIndex);
        setDisplayDateKey(nextDateKey);
        setDisplayTitleDateKey(nextDateKey);
        try {
          ordersListRef.current?.scrollToOffset?.({ offset: 0, animated: false });
        } catch {}
        ordersSwapOverlayOpacity.value = withTiming(0, {
          duration: CALENDAR_GESTURE.MONTH_TRANSITION_SHOW_DURATION,
        }, (finished) => {
          if (!finished) return;
          runOnJS(setIsOrdersSwapping)(false);
        });
        return;
      }
      commitVisibleMonthIndex(nextIndex);
    },
    [
      commitVisibleMonthIndex,
      displayDateKey,
      ordersSwapOverlayOpacity,
      resolveMonthDateKeyByIndex,
    ],
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
      setCurrentMonth((prev) => startOfMonth(new Date(nextYear, prev.getMonth(), 1)));
    },
    [dynamicYears],
  );

  const monthScrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      monthScrollX.value = event.contentOffset.x;
      const pageWidth = layoutMetrics.cardWidth;
      if (!pageWidth) return;
      const maxIndex = Math.max(0, dynamicMonths.length - 1);
      const rawIndex = clamp(event.contentOffset.x / pageWidth, 0, maxIndex);
      const committedIndex = clamp(Math.round(rawIndex), 0, maxIndex);
      visibleMonthIndex.value = committedIndex;
    },
  }, [dynamicMonths.length, layoutMetrics.cardWidth]);

  useEffect(() => {
    monthScrollX.value = layoutMetrics.cardWidth * visibleMonthIndex.value;
  }, [layoutMetrics.cardWidth, monthScrollX, visibleMonthIndex]);

  useEffect(() => {
    return () => {
      if (monthScrollRafRef.current != null) {
        try {
          cancelAnimationFrame(monthScrollRafRef.current);
        } catch {}
      }
      if (pendingDragEndCommitRafRef.current != null) {
        try {
          cancelAnimationFrame(pendingDragEndCommitRafRef.current);
        } catch {}
      }
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      deferInitialMeasureRef.current = false;
    }, 700);
    return () => clearTimeout(timer);
  }, []);

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
    monthScrollX.value = layoutMetrics.cardWidth * targetIndex;
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
    monthScrollX,
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
    },
    [setMeasuredWeekRowHeight],
  );

  const setSnappingState = useCallback((next) => {
    setIsSnapping(next);
  }, []);

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
        },
        dayCellSelectedOutline: {
          borderWidth: 2,
          borderColor: theme.colors.primary,
        },
        dayCellSelectedFilled: {
          backgroundColor: theme.colors.primary,
        },
        dayContent: {
          alignItems: 'center',
          justifyContent: 'center',
        },
        dayNumber: {
          fontFamily: theme.typography.fontFamily,
          fontWeight: theme.typography.weight.regular,
          fontSize: theme.typography.sizes.md,
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
          alignItems: 'center',
          justifyContent: 'center',
        },
        eventCount: {
          marginTop: theme.spacing.xs * 0.05,
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
    const targetRows = monthWeeksByIndex[visibleMonthRenderIndex]?.length ?? actualWeekRows;
    const targetHeight = measuredWeekRowHeight * targetRows;
    settledWeeksHeight.value = targetHeight;
  }, [
    actualWeekRows,
    measuredWeekRowHeight,
    monthWeeksByIndex,
    settledWeeksHeight,
    visibleMonthRenderIndex,
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
      monthScrollX.value = layoutMetrics.cardWidth * MONTH_LIST_MIDDLE_INDEX;
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
    monthScrollX,
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
        visibleMonthIndexRef.current = targetIndex;
        visibleMonthIndex.value = targetIndex;
        setVisibleMonthRenderIndex(targetIndex);
        try {
          monthPagerRef.current?.scrollToIndex?.({ index: targetIndex, animated: true });
        } catch {}
      });
    },
    [dynamicMonths.length, monthPagerRef, visibleMonthIndex],
  );

  const goToPreviousMonth = useCallback(() => scrollToMonthByOffset(-1), [scrollToMonthByOffset]);
  const goToNextMonth = useCallback(() => scrollToMonthByOffset(1), [scrollToMonthByOffset]);
  const commitOrdersHorizontalSwipe = useCallback(
    (translationX, velocityX) => {
      const pageWidth = Math.max(layoutMetrics.cardWidth, 1);
      const distanceThreshold = Math.max(
        12,
        pageWidth * CALENDAR_GESTURE.MONTH_SWIPE_DISTANCE_RATIO,
      );
      const velocityThreshold = CALENDAR_GESTURE.MONTH_SWIPE_VELOCITY_X;

      let offset = 0;
      if (translationX <= -distanceThreshold || velocityX <= -velocityThreshold) offset = 1;
      else if (translationX >= distanceThreshold || velocityX >= velocityThreshold) offset = -1;

      const baseIndex = visibleMonthIndexRef.current;
      const nextIndex = clamp(baseIndex + offset, 0, Math.max(0, dynamicMonths.length - 1));
      if (nextIndex === baseIndex) return;

      try {
        monthPagerRef.current?.scrollToIndex?.({ index: nextIndex, animated: true });
      } catch {}
      requestMonthCommit(nextIndex);
    },
    [dynamicMonths.length, layoutMetrics.cardWidth, monthPagerRef, requestMonthCommit],
  );
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

  // More forgiving for downward swipe: allow collapse even when the list
  // is slightly offset from top to avoid "hard" downward gesture feel.
  const listScrollTopThreshold = theme.spacing.lg * 1.4;
  const downwardUnlockDistance = Math.max(18, theme.spacing.md * 1.6);
  const gestureActiveOffsetX = CALENDAR_GESTURE.PAN_ACTIVE_OFFSET_X;
  const gestureActiveOffsetY = CALENDAR_GESTURE.PAN_ACTIVE_OFFSET_Y;
  const gestureFailOffsetX = CALENDAR_GESTURE.PAN_FAIL_OFFSET_X;
  const gestureHitSlop = CALENDAR_GESTURE.PAN_HIT_SLOP;
  const directionLockDistance = CALENDAR_GESTURE.DIRECTION_LOCK_DISTANCE;
  const directionLockRatio = CALENDAR_GESTURE.DIRECTION_LOCK_RATIO;
  const lockDistance = Math.max(8, directionLockDistance);
  const lockRatio = Math.max(1.3, directionLockRatio);
  const lockVelocity = 320;
  const verticalSwipeDistanceThreshold = Math.max(20, theme.spacing.md * 1.8);
  const verticalSwipeVelocityThreshold = Math.max(380, CALENDAR_GESTURE.SNAP_VELOCITY_Y * 0.8);
  const activeOffsetX = Math.max(6, gestureActiveOffsetX);
  const activeOffsetY = Math.max(6, gestureActiveOffsetY);
  const verticalFailOffsetX = gestureFailOffsetX + 12;
  const calendarGestureLock = useSharedValue(0); // 0 unknown, 1 horizontal, 2 vertical
  const ordersGestureLock = useSharedValue(0); // 0 unknown, 1 horizontal, 2 vertical
  const snapCollapseToNearest = useCallback((velocityY) => {
    'worklet';
    const total = stageOneDistanceSafe || 1;
    const progress = collapseTranslate.value / total;
    const target = resolveSnapTarget(progress, velocityY, total);
    const safeVelocityY = clamp(
      velocityY,
      -CALENDAR_GESTURE.SNAP_INPUT_VELOCITY_MAX,
      CALENDAR_GESTURE.SNAP_INPUT_VELOCITY_MAX,
    );
    isSnappingShared.value = true;
    runOnJS(setSnappingState)(true);
    collapseTranslate.value = withSpring(
      target,
      {
        damping: CALENDAR_GESTURE.SNAP_SPRING_DAMPING,
        stiffness: CALENDAR_GESTURE.SNAP_SPRING_STIFFNESS,
        mass: CALENDAR_GESTURE.SNAP_SPRING_MASS,
        velocity: -safeVelocityY,
        overshootClamping: CALENDAR_GESTURE.SNAP_SPRING_OVERSHOOT_CLAMPING,
        restSpeedThreshold: CALENDAR_GESTURE.SNAP_SPRING_REST_SPEED_THRESHOLD,
        restDisplacementThreshold: CALENDAR_GESTURE.SNAP_SPRING_REST_DISPLACEMENT_THRESHOLD,
      },
      () => {
        isSnappingShared.value = false;
        runOnJS(setSnappingState)(false);
        runOnJS(setIsCollapsed)(target > 0);
      },
    );
  }, [collapseTranslate, isSnappingShared, setSnappingState, stageOneDistanceSafe]);

  const createVerticalCollapseGesture = useCallback(
    (lockShared) =>
      Gesture.Pan()
        .enabled(true)
        .hitSlop(gestureHitSlop)
        .activeOffsetY([-activeOffsetY, activeOffsetY])
        .failOffsetX([-verticalFailOffsetX, verticalFailOffsetX])
        .onBegin(() => {
          'worklet';
          lockShared.value = 0;
        })
        .onStart(() => {
          'worklet';
          cancelAnimation(collapseTranslate);
          panHasDrivenCollapse.value = false;
          if (isSnappingShared.value) {
            isSnappingShared.value = false;
            runOnJS(setSnappingState)(false);
          }
          gestureStart.value = collapseTranslate.value;
        })
        .onUpdate((event) => {
          'worklet';
          const ty = event?.translationY;
          if (!Number.isFinite(ty)) return;
          const tx = Number.isFinite(event?.translationX) ? event.translationX : 0;
          const vx = Number.isFinite(event?.velocityX) ? event.velocityX : 0;
          const vy = Number.isFinite(event?.velocityY) ? event.velocityY : 0;
          if (lockShared.value === 0) {
            lockShared.value = resolveGestureIntent(
              tx,
              ty,
              vx,
              vy,
              lockDistance,
              lockRatio,
              lockVelocity,
            );
          }
          if (lockShared.value === 1) return;
          const isFullyCollapsed =
            collapseTranslate.value >=
            stageOneDistanceSafe * CALENDAR_GESTURE.COLLAPSED_PROGRESS_THRESHOLD;
          const isFullyExpanded = collapseTranslate.value <= 0;
          const listIsAwayFromTop = scrollY.value > listScrollTopThreshold;
          if (isSnappingShared.value) return;
          if (ty < 0 && isFullyCollapsed) return;
          if (ty > 0 && isFullyExpanded) return;
          if (ty > 0 && listIsAwayFromTop && Math.abs(ty) < downwardUnlockDistance) return;
          if (Math.abs(ty) >= 4) {
            panHasDrivenCollapse.value = true;
          }
        })
        .onEnd((event) => {
          'worklet';
          if (!panHasDrivenCollapse.value) {
            const atEdge =
              collapseTranslate.value <= 0 ||
              collapseTranslate.value >= stageOneDistanceSafe * CALENDAR_GESTURE.COLLAPSED_PROGRESS_THRESHOLD;
            if (atEdge) return;
          }
          const ty = Number.isFinite(event?.translationY) ? event.translationY : 0;
          const velocityY = Number.isFinite(event?.velocityY) ? event.velocityY : 0;
          const progress = collapseTranslate.value / Math.max(stageOneDistanceSafe, 1);
          const wantsCollapse =
            ty < -verticalSwipeDistanceThreshold || velocityY < -verticalSwipeVelocityThreshold;
          const wantsExpand =
            ty > verticalSwipeDistanceThreshold || velocityY > verticalSwipeVelocityThreshold;
          if (wantsCollapse) {
            snapCollapseToNearest(-Math.abs(CALENDAR_GESTURE.SNAP_VELOCITY_Y));
            return;
          }
          if (wantsExpand) {
            snapCollapseToNearest(Math.abs(CALENDAR_GESTURE.SNAP_VELOCITY_Y));
            return;
          }
          if (progress >= 0.5) {
            snapCollapseToNearest(-Math.abs(CALENDAR_GESTURE.SNAP_VELOCITY_Y) * 0.5);
            return;
          }
          snapCollapseToNearest(velocityY);
        })
        .onFinalize(() => {
          'worklet';
          lockShared.value = 0;
        }),
    [
      activeOffsetY,
      collapseTranslate,
      downwardUnlockDistance,
      gestureHitSlop,
      gestureStart,
      isSnappingShared,
      listScrollTopThreshold,
      lockDistance,
      lockRatio,
      lockVelocity,
      panHasDrivenCollapse,
      scrollY,
      setSnappingState,
      snapCollapseToNearest,
      stageOneDistanceSafe,
      verticalSwipeDistanceThreshold,
      verticalSwipeVelocityThreshold,
      verticalFailOffsetX,
    ],
  );

  // Единая вертикальная логика для верхней и нижней области.
  const calendarGesture = useMemo(
    () => createVerticalCollapseGesture(calendarGestureLock),
    [calendarGestureLock, createVerticalCollapseGesture],
  );

  const ordersListNativeGesture = useMemo(() => Gesture.Native(), []);
  const ordersCombinedGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(true)
        .hitSlop(gestureHitSlop)
        .activeOffsetX([-activeOffsetX, activeOffsetX])
        .activeOffsetY([-activeOffsetY, activeOffsetY])
        .simultaneousWithExternalGesture(ordersListNativeGesture)
        .onBegin(() => {
          'worklet';
          ordersGestureLock.value = 0;
        })
        .onStart(() => {
          'worklet';
          cancelAnimation(collapseTranslate);
          panHasDrivenCollapse.value = false;
          if (isSnappingShared.value) {
            isSnappingShared.value = false;
            runOnJS(setSnappingState)(false);
          }
          gestureStart.value = collapseTranslate.value;
        })
        .onUpdate((event) => {
          'worklet';
          const tx = Number.isFinite(event?.translationX) ? event.translationX : 0;
          const ty = Number.isFinite(event?.translationY) ? event.translationY : 0;
          const vx = Number.isFinite(event?.velocityX) ? event.velocityX : 0;
          const vy = Number.isFinite(event?.velocityY) ? event.velocityY : 0;
          if (ordersGestureLock.value === 0) {
            ordersGestureLock.value = resolveGestureIntent(
              tx,
              ty,
              vx,
              vy,
              lockDistance,
              lockRatio,
              lockVelocity,
            );
          }

          if (ordersGestureLock.value === 1) {
            monthSwipeInteraction.value = 1;
            return;
          }

          if (ordersGestureLock.value !== 2) return;

          const isFullyCollapsed =
            collapseTranslate.value >=
            stageOneDistanceSafe * CALENDAR_GESTURE.COLLAPSED_PROGRESS_THRESHOLD;
          const isFullyExpanded = collapseTranslate.value <= 0;
          const listIsAwayFromTop = scrollY.value > listScrollTopThreshold;

          if (isSnappingShared.value) return;
          if (ty < 0 && isFullyCollapsed) return;
          if (ty > 0 && isFullyExpanded) return;
          if (ty > 0 && listIsAwayFromTop && Math.abs(ty) < downwardUnlockDistance) return;
          if (Math.abs(ty) >= 4) {
            panHasDrivenCollapse.value = true;
          }
        })
        .onEnd((event) => {
          'worklet';
          if (isSnappingShared.value) return;

          if (ordersGestureLock.value === 1) {
            monthSwipeInteraction.value = 0;
            const tx = Number.isFinite(event?.translationX) ? event.translationX : 0;
            const vx = Number.isFinite(event?.velocityX) ? event.velocityX : 0;
            runOnJS(commitOrdersHorizontalSwipe)(tx, vx);
            return;
          }

          const tx = Number.isFinite(event?.translationX) ? event.translationX : 0;
          const ty = Number.isFinite(event?.translationY) ? event.translationY : 0;
          const isVerticalLike =
            ordersGestureLock.value === 2 || Math.abs(ty) >= Math.abs(tx) * 0.8;
          if (!isVerticalLike) return;
          monthSwipeInteraction.value = 0;
          if (!panHasDrivenCollapse.value) {
            const atEdge =
              collapseTranslate.value <= 0 ||
              collapseTranslate.value >= stageOneDistanceSafe * CALENDAR_GESTURE.COLLAPSED_PROGRESS_THRESHOLD;
            if (atEdge) return;
          }
          const velocityY = Number.isFinite(event?.velocityY) ? event.velocityY : 0;
          const progress = collapseTranslate.value / Math.max(stageOneDistanceSafe, 1);
          const wantsCollapse =
            ty < -verticalSwipeDistanceThreshold || velocityY < -verticalSwipeVelocityThreshold;
          const wantsExpand =
            ty > verticalSwipeDistanceThreshold || velocityY > verticalSwipeVelocityThreshold;
          if (wantsCollapse) {
            snapCollapseToNearest(-Math.abs(CALENDAR_GESTURE.SNAP_VELOCITY_Y));
            return;
          }
          if (wantsExpand) {
            snapCollapseToNearest(Math.abs(CALENDAR_GESTURE.SNAP_VELOCITY_Y));
            return;
          }
          if (progress >= 0.5) {
            snapCollapseToNearest(-Math.abs(CALENDAR_GESTURE.SNAP_VELOCITY_Y) * 0.5);
            return;
          }
          snapCollapseToNearest(velocityY);
        })
        .onFinalize(() => {
          'worklet';
          monthSwipeInteraction.value = 0;
          ordersGestureLock.value = 0;
        }),
    [
      activeOffsetX,
      activeOffsetY,
      collapseTranslate,
      commitOrdersHorizontalSwipe,
      downwardUnlockDistance,
      gestureHitSlop,
      gestureStart,
      isSnappingShared,
      listScrollTopThreshold,
      lockDistance,
      lockRatio,
      lockVelocity,
      monthSwipeInteraction,
      ordersGestureLock,
      ordersListNativeGesture,
      panHasDrivenCollapse,
      scrollY,
      setSnappingState,
      snapCollapseToNearest,
      stageOneDistanceSafe,
      verticalSwipeDistanceThreshold,
      verticalSwipeVelocityThreshold,
    ],
  );

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
  const [displayDateKey, setDisplayDateKey] = useState(effectiveSelectedDate);
  const [displayTitleDateKey, setDisplayTitleDateKey] = useState(effectiveSelectedDate);
  const detailNavLockRef = useRef({ id: '', ts: 0 });
  const calendarPrefetchRef = useRef({ key: '', ts: 0 });
  const displayedOrders = useMemo(
    () => (displayDateKey ? (calendarIndex.byDate[displayDateKey] ?? []) : []),
    [calendarIndex.byDate, displayDateKey],
  );
  const ordersListExtraData = useMemo(
    () => ({ selectedDate: displayDateKey, count: displayedOrders.length }),
    [displayDateKey, displayedOrders.length],
  );
  const ordersTitleDateLabel = useMemo(
    () => (displayTitleDateKey ? format(new Date(displayTitleDateKey), 'd MMMM', { locale: dfnsRu }) : ''),
    [displayTitleDateKey],
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
    () => (isOrdersSwapping ? null : <Text style={styles.noOrders}>Нет заявок</Text>),
    [isOrdersSwapping, styles.noOrders],
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

  useEffect(() => {
    if (isOrdersSwapping) return;
    if (!effectiveSelectedDate || !displayDateKey) return;
    if (effectiveSelectedDate === displayDateKey) return;
    if (effectiveSelectedDate.slice(0, 7) === displayDateKey.slice(0, 7)) {
      setDisplayDateKey(effectiveSelectedDate);
      setDisplayTitleDateKey(effectiveSelectedDate);
    }
  }, [displayDateKey, effectiveSelectedDate, isOrdersSwapping]);

  useEffect(() => {
    if (!Array.isArray(displayedOrders) || displayedOrders.length === 0) return;
    const idsKey = displayedOrders
      .slice(0, 5)
      .map((o) => String(o?.id || ''))
      .join('|');
    const now = Date.now();
    if (calendarPrefetchRef.current.key === idsKey && now - calendarPrefetchRef.current.ts < 4000) {
      return;
    }
    calendarPrefetchRef.current = { key: idsKey, ts: now };

    const task = InteractionManager.runAfterInteractions(() => {
      const registry = getPrefetchRegistry();
      displayedOrders.slice(0, 5).forEach((order) => {
        registry.run(`request-detail:${order?.id}`, () => ensureRequestPrefetch(queryClient, order?.id)).catch(() => {});
      });
    });

    return () => {
      try {
        task.cancel?.();
      } catch {}
    };
  }, [displayedOrders, queryClient]);

  useFocusEffect(
    useCallback(
      () => () => {
        queryClient.cancelQueries({ queryKey: ['requests', 'calendar'] });
        queryClient.cancelQueries({ queryKey: ['requests', 'detail'] });
      },
      [queryClient],
    ),
  );

  const ordersSwapOverlayStyle = useAnimatedStyle(() => ({
    opacity: ordersSwapOverlayOpacity.value,
  }));
  const ordersSwipeFadeStyle = useAnimatedStyle(() => {
    if (monthSwipeInteraction.value < 0.5) {
      return { opacity: 1 };
    }
    const pageWidth = Math.max(layoutMetrics.cardWidth, 1);
    const distance = Math.abs(monthScrollX.value - settledMonthOffsetX.value);
    const progress = Math.min(distance / (pageWidth * 0.6), 1);
    return { opacity: 1 - progress };
  });

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
            <GestureDetector gesture={calendarGesture}>
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
                    horizontal
                    pagingEnabled
                    initialNumToRender={5}
                    scrollEnabled={!isCollapsed}
                    showsHorizontalScrollIndicator={false}
                    keyExtractor={(item, index) => `month-${item.getTime()}-${index}`}
                    getItemLayout={getItemLayout}
                    initialScrollIndex={MONTH_LIST_MIDDLE_INDEX}
                    windowSize={3}
                    maxToRenderPerBatch={3}
                    updateCellsBatchingPeriod={16}
                    removeClippedSubviews={Platform.OS === 'android'}
                    scrollEventThrottle={16}
                    onScroll={monthScrollHandler}
                    onScrollBeginDrag={() => {
                      if (pendingDragEndCommitRafRef.current != null) {
                        try {
                          cancelAnimationFrame(pendingDragEndCommitRafRef.current);
                        } catch {}
                        pendingDragEndCommitRafRef.current = null;
                      }
                      monthMomentumStartedRef.current = false;
                      monthSwipeInteraction.value = 1;
                    }}
                    onMomentumScrollBegin={() => {
                      if (pendingDragEndCommitRafRef.current != null) {
                        try {
                          cancelAnimationFrame(pendingDragEndCommitRafRef.current);
                        } catch {}
                        pendingDragEndCommitRafRef.current = null;
                      }
                      monthMomentumStartedRef.current = true;
                      monthSwipeInteraction.value = 1;
                    }}
                    onScrollEndDrag={(event) => {
                      if (pendingDragEndCommitRafRef.current != null) {
                        try {
                          cancelAnimationFrame(pendingDragEndCommitRafRef.current);
                        } catch {}
                        pendingDragEndCommitRafRef.current = null;
                      }
                      pendingDragEndCommitRafRef.current = requestAnimationFrame(() => {
                        pendingDragEndCommitRafRef.current = null;
                        const offsetX = Number(event?.nativeEvent?.contentOffset?.x) || 0;
                        const nextIndex = resolvePageIndex(offsetX);
                        if (monthMomentumStartedRef.current) return;
                        requestMonthCommit(nextIndex);
                      });
                    }}
                    onMomentumScrollEnd={(event) => {
                      if (pendingDragEndCommitRafRef.current != null) {
                        try {
                          cancelAnimationFrame(pendingDragEndCommitRafRef.current);
                        } catch {}
                        pendingDragEndCommitRafRef.current = null;
                      }
                      monthMomentumStartedRef.current = false;
                      const offsetX = Number(event?.nativeEvent?.contentOffset?.x) || 0;
                      const nextIndex = resolvePageIndex(offsetX);
                      requestMonthCommit(nextIndex);
                    }}
                    renderItem={({ item: monthDate, index }) => {
                      const itemMonthWeeks = monthWeeksByIndex[index] ?? [];
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
            </GestureDetector>
            <GestureDetector gesture={ordersCombinedGesture}>
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
                    <GestureDetector gesture={ordersListNativeGesture}>
                      <View style={{ flex: 1 }}>
                        <FlatList
                          ref={ordersListRef}
                          data={displayedOrders}
                          extraData={ordersListExtraData}
                          initialNumToRender={6}
                          maxToRenderPerBatch={8}
                          updateCellsBatchingPeriod={40}
                          removeClippedSubviews={Platform.OS === 'android'}
                          keyExtractor={orderKeyExtractor}
                          contentContainerStyle={ordersListContentContainerStyle}
                          style={{ flex: 1 }}
                          scrollEnabled={isCollapsed && !isSnapping && !isOrdersSwapping}
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
                    </GestureDetector>
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        StyleSheet.absoluteFillObject,
                        { backgroundColor: theme.colors.background },
                        ordersSwapOverlayStyle,
                      ]}
                    />
                  </Animated.View>
                </View>
              </View>
            </GestureDetector>
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
              data={dynamicYears}
              horizontal
              pagingEnabled
              initialNumToRender={3}
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item, index) => `year-${item}-${index}`}
              getItemLayout={getItemLayout}
              initialScrollIndex={YEAR_LIST_MIDDLE_INDEX}
              windowSize={3}
              maxToRenderPerBatch={3}
              updateCellsBatchingPeriod={40}
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
