// app/orders/calendar.jsx (REFACTORED)
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { format, startOfMonth } from 'date-fns';
import { ru as dfnsRu } from 'date-fns/locale';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Dimensions,
  FlatList,
  InteractionManager,
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
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CalendarMonthHeader } from '../../components/calendar/CalendarMonthHeader';
import { CalendarWeekRow } from '../../components/calendar/CalendarWeekRow';
import YearView from '../../components/calendar/YearView';
import DynamicOrderCard from '../../components/DynamicOrderCard';
import { useAuth } from '../../components/hooks/useAuth';
import Screen from '../../components/layout/Screen';
import AppHeader from '../../components/navigation/AppHeader';
import { clamp, getMonthWeeks } from '../../hooks/useCalendarLogic';
import {
  ensureRequestPrefetch,
  useCalendarRequests,
  useRequestRealtimeSync,
} from '../../src/features/requests/queries';
import { formatDateKey } from '../../lib/calendarUtils';
import { markFirstContent, markScreenMount } from '../../src/shared/perf/devMetrics';
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

function capitalizeLabel(value) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDayLabel(dateKey) {
  try {
    return capitalizeLabel(format(new Date(dateKey), 'd MMMM', { locale: dfnsRu }));
  } catch {
    return dateKey;
  }
}

function resolveSnapTarget(progress, velocityY, totalDistance) {
  'worklet';
  const threshold = CALENDAR_GESTURE.SNAP_VELOCITY_Y;
  if (Math.abs(velocityY) > threshold) {
    return velocityY < 0 ? totalDistance : 0;
  }
  return progress > CALENDAR_GESTURE.SNAP_PROGRESS_THRESHOLD ? totalDistance : 0;
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
  const [refreshing, setRefreshing] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [viewMode, setViewMode] = useState('month');

  useEffect(() => {
    markScreenMount('Calendar');
  }, []);

  const {
    data: orders = [],
    isLoading: isCalendarLoading,
    refetch: refetchCalendar,
  } = useCalendarRequests({
    userId: profile?.id,
    role: profile?.role,
    enabled: isAuthenticated && !isInitializing && !!profile?.id && !!profile?.role,
    isScreenActive: isFocused,
  });

  useRequestRealtimeSync({ enabled: isFocused && !!profile?.id });

  const firstContentMarkedRef = useRef(false);
  useEffect(() => {
    if (firstContentMarkedRef.current) return;
    if (isCalendarLoading) return;
    firstContentMarkedRef.current = true;
    markFirstContent('Calendar');
  }, [isCalendarLoading]);

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
  const lastHandledPageIndex = useRef(MONTH_LIST_MIDDLE_INDEX);
  const visibleMonthIndexRef = useRef(MONTH_LIST_MIDDLE_INDEX);
  const monthScrollRafRef = useRef(null);
  const pendingScrollTargetIndexRef = useRef(null);
  const [visibleMonthRenderIndex, setVisibleMonthRenderIndex] = useState(MONTH_LIST_MIDDLE_INDEX);
  const settledMonthOffsetX = useSharedValue(layoutMetrics.cardWidth * MONTH_LIST_MIDDLE_INDEX);
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
      setVisibleMonthRenderIndex(pageIndex);
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
      handlePageChange(pageIndex);
      pendingScrollTargetIndexRef.current = null;
      if (monthScrollRafRef.current != null) {
        try {
          cancelAnimationFrame(monthScrollRafRef.current);
        } catch {}
        monthScrollRafRef.current = null;
      }
    },
    [handlePageChange, visibleMonthIndex],
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
      const nextIndex = clamp(Math.round(event.contentOffset.x / pageWidth), 0, maxIndex);
      visibleMonthIndex.value = nextIndex;
    },
  });

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
        handleContainer: {
          alignItems: 'center',
          paddingVertical: theme.spacing.xs,
        },
        handleBar: {
          width: theme.spacing.xl,
          height: 4,
          borderRadius: 999,
          backgroundColor: theme.colors.border,
        },
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
        },
        ordersTitle: {
          fontSize: theme.typography.sizes.md,
          fontWeight: theme.typography.weight.semibold,
          color: theme.colors.text,
        },
        ordersHeaderActions: {
          flexDirection: 'row',
          alignItems: 'center',
        },
        refreshButton: {
          padding: theme.spacing.xs,
          borderRadius: theme.radii.sm,
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
  const ordersSwipeStartOffset = useSharedValue(0);
  const ordersSwipeLiveOffset = useSharedValue(0);
  const finishOrdersSwipe = useCallback(() => {
    const nextIndex = resolvePageIndex(ordersSwipeLiveOffset.value);
    try {
      monthPagerRef.current?.scrollToIndex?.({ index: nextIndex, animated: true });
    } catch {}
    commitVisibleMonthIndex(nextIndex);
  }, [commitVisibleMonthIndex, monthPagerRef, ordersSwipeLiveOffset, resolvePageIndex]);
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

  const listScrollTopThreshold = theme.spacing.sm + theme.spacing.xs;
  const gestureActiveOffsetX = CALENDAR_GESTURE.PAN_ACTIVE_OFFSET_X;
  const gestureActiveOffsetY = CALENDAR_GESTURE.PAN_ACTIVE_OFFSET_Y;
  const gestureFailOffsetX = CALENDAR_GESTURE.PAN_FAIL_OFFSET_X;
  const gestureFailOffsetY = CALENDAR_GESTURE.PAN_FAIL_OFFSET_Y;
  const gestureHitSlop = CALENDAR_GESTURE.PAN_HIT_SLOP;
  const directionLockDistance = CALENDAR_GESTURE.DIRECTION_LOCK_DISTANCE;
  const directionLockRatio = CALENDAR_GESTURE.DIRECTION_LOCK_RATIO;
  const calendarGestureLock = useSharedValue(0); // 0 unknown, 1 horizontal, 2 vertical
  const ordersGestureLock = useSharedValue(0); // 0 unknown, 1 horizontal, 2 vertical
  const snapCollapseToNearest = (velocityY) => {
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
  };

  // Жест для области календаря (всегда работает)
  const calendarGesture = Gesture.Pan()
    .enabled(false)
    .hitSlop(gestureHitSlop)
    .activeOffsetY([-gestureActiveOffsetY, gestureActiveOffsetY])
    .failOffsetX([-gestureFailOffsetX, gestureFailOffsetX])
    .onBegin(() => {
      'worklet';
      calendarGestureLock.value = 0;
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
      const absTx = Math.abs(tx);
      const absTy = Math.abs(ty);
      if (calendarGestureLock.value === 0 && (absTx > directionLockDistance || absTy > directionLockDistance)) {
        if (absTy > absTx * directionLockRatio) calendarGestureLock.value = 2;
        else if (absTx > absTy * directionLockRatio) calendarGestureLock.value = 1;
      }
      if (calendarGestureLock.value === 1) return;
      const isFullyCollapsed =
        collapseTranslate.value >=
        stageOneDistanceSafe * CALENDAR_GESTURE.COLLAPSED_PROGRESS_THRESHOLD;
      const isFullyExpanded = collapseTranslate.value <= 0;
      const listIsAwayFromTop = scrollY.value > listScrollTopThreshold;
      if (isSnappingShared.value) return;
      if (ty < 0 && isFullyCollapsed) return;
      if (ty > 0 && isFullyExpanded) return;
      if (ty > 0 && listIsAwayFromTop) return;
      const next = gestureStart.value - ty;
      const safeMax = Number.isFinite(stageOneDistanceSafe) ? stageOneDistanceSafe : 0;
      collapseTranslate.value = clamp(next, 0, safeMax);
      panHasDrivenCollapse.value = true;
    })
    .onEnd((event) => {
      'worklet';
      if (!panHasDrivenCollapse.value) {
        const atEdge =
          collapseTranslate.value <= 0 ||
          collapseTranslate.value >= stageOneDistanceSafe * CALENDAR_GESTURE.COLLAPSED_PROGRESS_THRESHOLD;
        if (atEdge) return;
      }
      const velocityY = Number.isFinite(event?.velocityY) ? event.velocityY : 0;
      snapCollapseToNearest(velocityY);
    })
    .onFinalize(() => {
      'worklet';
      calendarGestureLock.value = 0;
    });

  const ordersListNativeGesture = useMemo(() => Gesture.Native(), []);
  const ordersMonthGesture = Gesture.Pan()
    .hitSlop(gestureHitSlop)
    .activeOffsetX([-gestureActiveOffsetX, gestureActiveOffsetX])
    .failOffsetY([-gestureFailOffsetY, gestureFailOffsetY])
    .onBegin(() => {
      'worklet';
      ordersGestureLock.value = 0;
    })
    .onStart(() => {
      'worklet';
      const pageWidth = layoutMetrics.cardWidth;
      const baseOffset = visibleMonthIndex.value * pageWidth;
      ordersSwipeStartOffset.value = baseOffset;
      ordersSwipeLiveOffset.value = baseOffset;
      monthScrollX.value = baseOffset;
      scrollTo(monthPagerRef, baseOffset, 0, false);
    })
    .onUpdate((event) => {
      'worklet';
      const tx = Number.isFinite(event?.translationX) ? event.translationX : 0;
      const ty = Number.isFinite(event?.translationY) ? event.translationY : 0;
      const absTx = Math.abs(tx);
      const absTy = Math.abs(ty);
      if (ordersGestureLock.value === 0 && (absTx > directionLockDistance || absTy > directionLockDistance)) {
        if (absTx > absTy * directionLockRatio) ordersGestureLock.value = 1;
        else if (absTy > absTx * directionLockRatio) ordersGestureLock.value = 2;
      }
      if (ordersGestureLock.value !== 1) return;
      const pageWidth = layoutMetrics.cardWidth;
      const maxOffset = Math.max(0, (dynamicMonths.length - 1) * pageWidth);
      const nextOffset = clamp(ordersSwipeStartOffset.value - tx, 0, maxOffset);
      ordersSwipeLiveOffset.value = nextOffset;
      monthScrollX.value = nextOffset;
      scrollTo(monthPagerRef, nextOffset, 0, false);
    })
    .onEnd(() => {
      'worklet';
      if (isSnappingShared.value) return;
      if (ordersGestureLock.value === 2) return;
      if (ordersGestureLock.value !== 1) return;
      runOnJS(finishOrdersSwipe)();
    })
    .onFinalize(() => {
      'worklet';
      ordersGestureLock.value = 0;
    });

  const ordersPanGesture = Gesture.Pan()
    .enabled(false)
    .hitSlop(gestureHitSlop)
    .activeOffsetY([-gestureActiveOffsetY, gestureActiveOffsetY])
    .failOffsetX([-gestureFailOffsetX, gestureFailOffsetX])
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
      const ty = event?.translationY;
      if (!Number.isFinite(ty)) return;

      const absTy = Math.abs(ty);
      const absTx = Math.abs(Number.isFinite(event?.translationX) ? event.translationX : 0);
      if (ordersGestureLock.value === 0 && (absTx > directionLockDistance || absTy > directionLockDistance)) {
        if (absTy > absTx * directionLockRatio) ordersGestureLock.value = 2;
        else if (absTx > absTy * directionLockRatio) ordersGestureLock.value = 1;
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

      // Down: first return list to top, then start expanding calendar.
      if (ty > 0 && listIsAwayFromTop) return;

      const next = gestureStart.value - ty;
      const safeMax = Number.isFinite(stageOneDistanceSafe) ? stageOneDistanceSafe : 0;
      collapseTranslate.value = clamp(next, 0, safeMax);
      panHasDrivenCollapse.value = true;
    })
    .onEnd((event) => {
      'worklet';
      if (ordersGestureLock.value !== 2) return;
      if (!panHasDrivenCollapse.value) {
        const atEdge =
          collapseTranslate.value <= 0 ||
          collapseTranslate.value >= stageOneDistanceSafe * CALENDAR_GESTURE.COLLAPSED_PROGRESS_THRESHOLD;
        if (atEdge) return;
      }
      const velocityY = Number.isFinite(event?.velocityY) ? event.velocityY : 0;
      snapCollapseToNearest(velocityY);
    })
    .onFinalize(() => {
      'worklet';
      ordersGestureLock.value = 0;
    });

  const ordersCombinedGesture = Gesture.Race(ordersMonthGesture, ordersPanGesture);

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

  const calendarIndex = useMemo(() => {
    const byDate = {};
    const countByDate = {};

    for (const order of orders) {
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
  }, [orders, theme.colors.primary]);

  const selectedDateOrders = useMemo(
    () => (selectedDate ? (calendarIndex.byDate[selectedDate] ?? []) : []),
    [selectedDate, calendarIndex],
  );

  const displayedOrders = selectedDateOrders;
  const ordersListExtraData = useMemo(
    () => ({
      selectedDate,
      count: displayedOrders.length,
    }),
    [displayedOrders.length, selectedDate],
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
  const renderOrderItem = useCallback(
    ({ item }) => (
      <DynamicOrderCard
        order={item}
        context="calendar"
        onPress={() => router.push(`/orders/${item.id}`)}
      />
    ),
    [router],
  );
  const ordersEmptyComponent = useMemo(
    () => <Text style={styles.noOrders}>Нет заявок</Text>,
    [styles.noOrders],
  );

  const markedDates = useMemo(
    () => ({
      ...calendarIndex.marksBase,
      [selectedDate]: {
        ...(calendarIndex.marksBase[selectedDate] || {}),
        selected: true,
        selectedColor: theme.colors.primary,
      },
    }),
    [calendarIndex, selectedDate, theme.colors.primary],
  );

  const onRefresh = useCallback(async () => {
    if (!isAuthenticated || isInitializing || !profile) return;
    setRefreshing(true);
    try {
      await refetchCalendar();
    } catch {
      console.error('Failed to refresh orders');
    } finally {
      setRefreshing(false);
    }
  }, [isAuthenticated, isInitializing, profile, refetchCalendar]);

  useEffect(() => {
    if (!Array.isArray(displayedOrders) || displayedOrders.length === 0) return;

    const task = InteractionManager.runAfterInteractions(() => {
      displayedOrders.slice(0, 5).forEach((order) => {
        ensureRequestPrefetch(queryClient, order?.id).catch(() => {});
      });
    });

    return () => {
      try {
        task.cancel?.();
      } catch {}
    };
  }, [displayedOrders, queryClient]);

  const ordersContentAnimatedStyle = useAnimatedStyle(() => {
    const pageWidth = Math.max(layoutMetrics.cardWidth, 1);
    const distance = Math.abs(monthScrollX.value - settledMonthOffsetX.value);
    const startFade = 0;
    const endFade = pageWidth * 0.54;
    const fadeSpan = Math.max(endFade - startFade, 1);
    const progress = distance <= startFade ? 0 : Math.min((distance - startFade) / fadeSpan, 1);
    const eased = progress * progress * (3 - 2 * progress);
    return { opacity: 1 - eased };
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
                    initialNumToRender={3}
                    scrollEnabled={!isCollapsed}
                    showsHorizontalScrollIndicator={false}
                    keyExtractor={(item, index) => `month-${item.getTime()}-${index}`}
                    getItemLayout={getItemLayout}
                    initialScrollIndex={MONTH_LIST_MIDDLE_INDEX}
                    windowSize={3}
                    maxToRenderPerBatch={3}
                    updateCellsBatchingPeriod={40}
                    removeClippedSubviews={true}
                    scrollEventThrottle={16}
                    onScroll={monthScrollHandler}
                    onScrollEndDrag={(event) => {
                      const vx = Math.abs(Number(event?.nativeEvent?.velocity?.x) || 0);
                      if (vx > 0.05) return;
                      const offsetX = Number(event?.nativeEvent?.contentOffset?.x) || 0;
                      const nextIndex = resolvePageIndex(offsetX);
                      commitVisibleMonthIndex(nextIndex);
                    }}
                    onMomentumScrollEnd={(event) => {
                      const offsetX = Number(event?.nativeEvent?.contentOffset?.x) || 0;
                      const nextIndex = resolvePageIndex(offsetX);
                      commitVisibleMonthIndex(nextIndex);
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
                <Animated.View style={styles.handleContainer}>
                  <View style={styles.handleBar} />
                </Animated.View>
                <View
                  style={{
                    width: layoutMetrics.cardWidth,
                    alignSelf: 'center',
                    overflow: 'hidden',
                    flex: 1,
                  }}
                >
                  <Animated.View
                    style={[{ width: layoutMetrics.cardWidth, flex: 1 }, ordersContentAnimatedStyle]}
                    renderToHardwareTextureAndroid={true}
                    needsOffscreenAlphaCompositing={true}
                    collapsable={false}
                  >
                    <View style={styles.ordersHeader}>
                      <Text style={styles.ordersTitle}>
                        Заявки на {formatDayLabel(selectedDate)}
                      </Text>
                      <View style={styles.ordersHeaderActions}>
                        <Pressable
                          onPress={onRefresh}
                          android_ripple={{ color: theme.colors.overlayNavBar }}
                          style={styles.refreshButton}
                          disabled={refreshing}
                        >
                          {refreshing ? (
                            <ActivityIndicator size="small" color={theme.colors.primary} />
                          ) : (
                            <Feather name="refresh-cw" size={16} color={theme.colors.textSecondary} />
                          )}
                        </Pressable>
                      </View>
                    </View>
                    <GestureDetector gesture={ordersListNativeGesture}>
                      <FlatList
                        data={displayedOrders}
                        extraData={ordersListExtraData}
                        initialNumToRender={6}
                        maxToRenderPerBatch={8}
                        updateCellsBatchingPeriod={40}
                        removeClippedSubviews={false}
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
                    </GestureDetector>
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
    </Screen>
  );
}
