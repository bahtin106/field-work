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

function resolveMonthSwipeOffset(translationX, velocityX, pageWidth) {
  'worklet';
  const distanceThreshold = pageWidth * CALENDAR_GESTURE.MONTH_SWIPE_DISTANCE_RATIO;
  if (translationX <= -distanceThreshold || velocityX <= -CALENDAR_GESTURE.MONTH_SWIPE_VELOCITY_X) {
    return 1;
  }
  if (translationX >= distanceThreshold || velocityX >= CALENDAR_GESTURE.MONTH_SWIPE_VELOCITY_X) {
    return -1;
  }
  return 0;
}

function isHorizontalMonthSwipeIntent(translationX, translationY, velocityX, velocityY) {
  'worklet';
  const absTx = Math.abs(translationX);
  const absTy = Math.abs(translationY);
  const absVx = Math.abs(velocityX);
  const absVy = Math.abs(velocityY);
  const distanceDominant = absTx >= absTy * CALENDAR_GESTURE.MONTH_SWIPE_DIRECTION_RATIO;
  const velocityDominant = absVx >= absVy * CALENDAR_GESTURE.MONTH_SWIPE_VELOCITY_DIRECTION_RATIO;
  return distanceDominant || velocityDominant;
}

export default function CalendarScreen() {
  const { user, profile, isAuthenticated, isInitializing } = useAuth();
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
  const flatListRef = useRef(null);
  const lastHandledPageIndex = useRef(MONTH_LIST_MIDDLE_INDEX);
  const visibleMonthIndexRef = useRef(MONTH_LIST_MIDDLE_INDEX);
  const [visibleMonthRenderIndex, setVisibleMonthRenderIndex] = useState(MONTH_LIST_MIDDLE_INDEX);
  const initialMonthRef = useRef(startOfMonth(new Date()));

  const dynamicMonths = useMemo(() => {
    const months = [];
    const baseMonth = initialMonthRef.current;
    for (
      let i = -CALENDAR_LAYOUT.MONTH_WINDOW_RADIUS;
      i <= CALENDAR_LAYOUT.MONTH_WINDOW_RADIUS - 1;
      i++
    ) {
      months.push(startOfMonth(new Date(baseMonth.getFullYear(), baseMonth.getMonth() + i, 1)));
    }
    return months;
  }, []);
  const weekRowsByIndex = useMemo(
    () =>
      dynamicMonths.map(
        (monthDate) => getMonthWeeks(monthDate.getFullYear(), monthDate.getMonth()).length,
      ),
    [dynamicMonths],
  );

  const activeVisibleMonth = useMemo(
    () => dynamicMonths[visibleMonthRenderIndex] ?? currentMonth,
    [currentMonth, dynamicMonths, visibleMonthRenderIndex],
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

  const syncVisibleRenderIndex = useCallback((pageIndex) => {
    setVisibleMonthRenderIndex(pageIndex);
  }, []);

  const monthScrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      monthScrollX.value = event.contentOffset.x;
      const pageWidth = layoutMetrics.cardWidth;
      if (!pageWidth) return;
      const maxIndex = Math.max(0, dynamicMonths.length - 1);
      const nextIndex = clamp(Math.round(event.contentOffset.x / pageWidth), 0, maxIndex);
      if (nextIndex !== visibleMonthIndex.value) {
        visibleMonthIndex.value = nextIndex;
        runOnJS(syncVisibleRenderIndex)(nextIndex);
      }
    },
    onMomentumEnd: (event) => {
      const pageWidth = layoutMetrics.cardWidth;
      if (!pageWidth) return;
      const maxIndex = Math.max(0, dynamicMonths.length - 1);
      const nextIndex = clamp(Math.round(event.contentOffset.x / pageWidth), 0, maxIndex);
      visibleMonthIndex.value = nextIndex;
      runOnJS(handlePageChange)(nextIndex);
    },
  });

  useEffect(() => {
    monthScrollX.value = layoutMetrics.cardWidth * visibleMonthIndex.value;
  }, [layoutMetrics.cardWidth, monthScrollX, visibleMonthIndex]);

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
    if (flatListRef.current && !isCollapsed) {
      try {
        flatListRef.current.scrollToIndex({ index: targetIndex, animated: false });
      } catch {}
    }
  }, [
    currentMonth,
    dynamicMonths,
    isCollapsed,
    layoutMetrics.cardWidth,
    monthScrollX,
    visibleMonthIndex,
  ]);

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
      }),
    [theme, layoutMetrics],
  );

  const stageAtoBProgress = useDerivedValue(() => {
    return Math.min(collapseTranslate.value / stageOneDistanceSafe, 1);
  });
  const monthCollapsePhaseSplit = CALENDAR_GESTURE.MONTH_COLLAPSE_PHASE_SPLIT;

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
        const pageWidth = layoutMetrics.cardWidth || 1;
        const maxIndex = Math.max(0, dynamicMonths.length - 1);
        const pagePosition = monthScrollX.value / pageWidth;
        const leftIndex = Math.max(0, Math.min(Math.floor(pagePosition), maxIndex));
        const rightIndex = Math.max(0, Math.min(leftIndex + 1, maxIndex));
        const rawT = pagePosition - leftIndex;
        const t = Math.max(0, Math.min(rawT, 1));
        const leftRows = weekRowsByIndex[leftIndex] ?? actualWeekRows;
        const rightRows = weekRowsByIndex[rightIndex] ?? leftRows;
        const swipeRows = leftRows + (rightRows - leftRows) * t;
        if (progress <= 0.001) {
          return resolvedMonthHeaderHeight + measuredDayNamesHeight + measuredWeekRowHeight * swipeRows;
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
      dynamicMonths.length,
      layoutMetrics.cardWidth,
      measuredDayNamesHeight,
      resolvedMonthHeaderHeight,
      measuredWeekRowHeight,
      monthCollapsePhaseSplit,
      selectedWeekIndex,
      weekRowsByIndex,
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
    const pageWidth = layoutMetrics.cardWidth || 1;
    const maxIndex = Math.max(0, dynamicMonths.length - 1);
    const pagePosition = monthScrollX.value / pageWidth;
    const leftIndex = Math.max(0, Math.min(Math.floor(pagePosition), maxIndex));
    const rightIndex = Math.max(0, Math.min(leftIndex + 1, maxIndex));
    const rawT = pagePosition - leftIndex;
    const t = Math.max(0, Math.min(rawT, 1));
    const leftRows = weekRowsByIndex[leftIndex] ?? actualWeekRows;
    const rightRows = weekRowsByIndex[rightIndex] ?? leftRows;
    const swipeRows = leftRows + (rightRows - leftRows) * t;
    if (progress <= 0.001) {
      return { height: measuredWeekRowHeight * swipeRows, overflow: 'hidden' };
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
    dynamicMonths.length,
    layoutMetrics.cardWidth,
    measuredWeekRowHeight,
    monthCollapsePhaseSplit,
    selectedWeekIndex,
    weekRowsByIndex,
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
    if (nextMode === 'month' && opts.newMonth) {
      setCurrentMonth(opts.newMonth);
      setSelectedDate(format(opts.newMonth, 'yyyy-MM-dd'));
    }
    setViewMode(nextMode);
  }, []);

  const scrollToMonthByOffset = useCallback(
    (offset) => {
      const nextIndex = clamp(
        visibleMonthIndexRef.current + offset,
        0,
        Math.max(0, dynamicMonths.length - 1),
      );
      if (nextIndex === visibleMonthIndexRef.current) return;
      visibleMonthIndexRef.current = nextIndex;
      visibleMonthIndex.value = nextIndex;
      setVisibleMonthRenderIndex(nextIndex);
      flatListRef.current?.scrollToIndex?.({ index: nextIndex, animated: true });
    },
    [dynamicMonths.length, visibleMonthIndex],
  );

  const goToPreviousMonth = useCallback(() => scrollToMonthByOffset(-1), [scrollToMonthByOffset]);
  const goToNextMonth = useCallback(() => scrollToMonthByOffset(1), [scrollToMonthByOffset]);

  const getItemLayout = useCallback(
    (data, index) => ({
      length: layoutMetrics.cardWidth,
      offset: layoutMetrics.cardWidth * index,
      index,
    }),
    [layoutMetrics.cardWidth],
  );

  const listScrollTopThreshold = theme.spacing.sm + theme.spacing.xs;
  const gestureActiveOffsetY = theme.spacing.xs;
  const gestureFailOffsetX = theme.spacing.xl;
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
    .activeOffsetY([-gestureActiveOffsetY, gestureActiveOffsetY])
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
    });

  const ordersListNativeGesture = useMemo(
    () => Gesture.Native(),
    [visibleMonthRenderIndex],
  );
  const ordersMonthGesture = Gesture.Pan()
    .activeOffsetX([-gestureActiveOffsetY, gestureActiveOffsetY])
    .failOffsetY([-gestureActiveOffsetY, gestureActiveOffsetY])
    .onEnd((event) => {
      'worklet';
      if (isSnappingShared.value) return;
      const translationX = Number.isFinite(event?.translationX) ? event.translationX : 0;
      const translationY = Number.isFinite(event?.translationY) ? event.translationY : 0;
      const velocityX = Number.isFinite(event?.velocityX) ? event.velocityX : 0;
      const velocityY = Number.isFinite(event?.velocityY) ? event.velocityY : 0;
      if (!isHorizontalMonthSwipeIntent(translationX, translationY, velocityX, velocityY)) return;
      const offset = resolveMonthSwipeOffset(translationX, velocityX, layoutMetrics.cardWidth);
      if (!offset) return;
      runOnJS(scrollToMonthByOffset)(offset);
    });

  const ordersPanGesture = Gesture.Pan()
    .enabled(true)
    .activeOffsetY([-gestureActiveOffsetY, gestureActiveOffsetY])
    .failOffsetX([-gestureFailOffsetX, gestureFailOffsetX])
    .requireExternalGestureToFail(ordersListNativeGesture)
    .simultaneousWithExternalGesture(ordersListNativeGesture)
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
      if (absTy < absTx) return;

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
      if (!panHasDrivenCollapse.value) {
        const atEdge =
          collapseTranslate.value <= 0 ||
          collapseTranslate.value >= stageOneDistanceSafe * CALENDAR_GESTURE.COLLAPSED_PROGRESS_THRESHOLD;
        if (atEdge) return;
      }
      const velocityY = Number.isFinite(event?.velocityY) ? event.velocityY : 0;
      snapCollapseToNearest(velocityY);
    });

  const ordersCombinedGesture = Gesture.Simultaneous(ordersPanGesture, ordersMonthGesture);

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
  const selectedMonthKey = selectedDate ? selectedDate.slice(0, 7) : '';
  const ordersRenderNeighbors = CALENDAR_LAYOUT.MONTH_RENDER_NEIGHBORS;

  const getOrdersForDateKey = useCallback(
    (dateKey) => (dateKey ? calendarIndex.byDate[dateKey] ?? [] : []),
    [calendarIndex.byDate],
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
    } catch (e) {
      console.error('Failed to refresh orders:', e);
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

  const ordersInnerStyle = useAnimatedStyle(
    () => ({
      transform: [
        {
          translateX: -monthScrollX.value,
        },
      ],
    }),
    [layoutMetrics.cardWidth],
  );

  return (
    <Screen
      scroll={false}
      headerOptions={{
        headerTitleAlign: 'left',
        title: t('routes.orders/calendar'),
        onBackPress: () => router.replace('/orders'),
        showBack: true,
        backIcon: { pack: 'Feather', name: 'chevron-left' },
      }}
    >
      <View style={styles.container}>
        {viewMode === 'month' ? (
          <>
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
                    ref={flatListRef}
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
                    renderItem={({ item: monthDate }) => {
                      const itemMonthWeeks = getMonthWeeks(
                        monthDate.getFullYear(),
                        monthDate.getMonth(),
                      );
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
                    style={[
                      {
                        flexDirection: 'row',
                        width: layoutMetrics.cardWidth * dynamicMonths.length,
                        flex: 1,
                      },
                      ordersInnerStyle,
                    ]}
                  >
                    {dynamicMonths.map((monthDate, index) => {
                      const isNearbyPage =
                        Math.abs(index - visibleMonthRenderIndex) <= ordersRenderNeighbors;
                      if (!isNearbyPage) {
                        return (
                          <View
                            key={`orders-placeholder-${monthDate.getTime()}-${index}`}
                            style={{ width: layoutMetrics.cardWidth, flex: 1 }}
                          />
                        );
                      }

                      const monthKey = format(monthDate, 'yyyy-MM');
                      const pageDateKey =
                        monthKey === selectedMonthKey
                          ? selectedDate
                          : format(startOfMonth(monthDate), 'yyyy-MM-dd');
                      const ordersForPage = getOrdersForDateKey(pageDateKey);

                      return (
                        <View
                          key={`orders-page-${monthDate.getTime()}-${index}`}
                          style={{ width: layoutMetrics.cardWidth, flex: 1 }}
                        >
                          <View style={styles.ordersHeader}>
                            <Text style={styles.ordersTitle}>
                              Заявки на {formatDayLabel(pageDateKey)}
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
                                  <Feather
                                    name="refresh-cw"
                                    size={16}
                                    color={theme.colors.textSecondary}
                                  />
                                )}
                              </Pressable>
                            </View>
                          </View>
                          {index === visibleMonthRenderIndex ? (
                            <GestureDetector gesture={ordersListNativeGesture}>
                              <FlatList
                                data={ordersForPage}
                                extraData={{
                                  selectedDate,
                                  count: ordersForPage.length,
                                  isCollapsed,
                                  isSnapping,
                                  pageDateKey,
                                }}
                                initialNumToRender={6}
                                maxToRenderPerBatch={8}
                                updateCellsBatchingPeriod={40}
                                removeClippedSubviews={true}
                                keyExtractor={(item) =>
                                  String(item?.id ?? item?.order_id ?? item?.uuid)
                                }
                                contentContainerStyle={{
                                  paddingHorizontal: theme.spacing.md,
                                  paddingBottom: Math.max(theme.spacing.xl, insets.bottom),
                                }}
                                style={{ flex: 1 }}
                                scrollEnabled={isCollapsed && !isSnapping}
                                bounces={false}
                                scrollEventThrottle={16}
                                onScroll={(event) => {
                                  const pageActive = index === visibleMonthIndexRef.current;
                                  if (!pageActive) return;
                                  scrollY.value = Math.max(0, event.nativeEvent.contentOffset.y);
                                }}
                                onScrollBeginDrag={() => {
                                  if (!isCollapsed) scrollY.value = 0;
                                }}
                                onMomentumScrollEnd={(event) => {
                                  const pageActive = index === visibleMonthIndexRef.current;
                                  if (!pageActive) return;
                                  scrollY.value = Math.max(0, event.nativeEvent.contentOffset.y);
                                }}
                                ListEmptyComponent={<Text style={styles.noOrders}>Нет заявок</Text>}
                                renderItem={({ item }) => (
                                  <DynamicOrderCard
                                    order={item}
                                    context="calendar"
                                    onPress={() => router.push(`/orders/${item.id}`)}
                                  />
                                )}
                              />
                            </GestureDetector>
                          ) : (
                            <FlatList
                              data={ordersForPage}
                              extraData={{
                                selectedDate,
                                count: ordersForPage.length,
                                isCollapsed,
                                isSnapping,
                                pageDateKey,
                              }}
                              initialNumToRender={6}
                              maxToRenderPerBatch={8}
                              updateCellsBatchingPeriod={40}
                              removeClippedSubviews={true}
                              keyExtractor={(item) =>
                                String(item?.id ?? item?.order_id ?? item?.uuid)
                              }
                              contentContainerStyle={{
                                paddingHorizontal: theme.spacing.md,
                                paddingBottom: Math.max(theme.spacing.xl, insets.bottom),
                              }}
                              style={{ flex: 1 }}
                              scrollEnabled={isCollapsed && !isSnapping}
                              bounces={false}
                              scrollEventThrottle={16}
                              onScroll={(event) => {
                                const pageActive = index === visibleMonthIndexRef.current;
                                if (!pageActive) return;
                                scrollY.value = Math.max(0, event.nativeEvent.contentOffset.y);
                              }}
                              onScrollBeginDrag={() => {
                                if (!isCollapsed) scrollY.value = 0;
                              }}
                              onMomentumScrollEnd={(event) => {
                                const pageActive = index === visibleMonthIndexRef.current;
                                if (!pageActive) return;
                                scrollY.value = Math.max(0, event.nativeEvent.contentOffset.y);
                              }}
                              ListEmptyComponent={<Text style={styles.noOrders}>Нет заявок</Text>}
                              renderItem={({ item }) => (
                                <DynamicOrderCard
                                  order={item}
                                  context="calendar"
                                  onPress={() => router.push(`/orders/${item.id}`)}
                                />
                              )}
                            />
                          )}
                        </View>
                      );
                    })}
                  </Animated.View>
                </View>
              </View>
            </GestureDetector>
          </>
        ) : (
          <YearView
            style={styles.yearViewContainer}
            year={currentMonth.getFullYear()}
            currentMonthIndex={currentMonth.getMonth()}
            onMonthPress={(newMonth) => switchMode('month', { newMonth })}
            markedDates={markedDates}
          />
        )}
      </View>
    </Screen>
  );
}
