// app/orders/calendar.jsx

import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { format, startOfMonth } from 'date-fns';
import { ru as dfnsRu } from 'date-fns/locale';
import { useNavigation, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LocaleConfig } from 'react-native-calendars';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolate,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import YearView from '../../components/calendar/YearView';
import DynamicOrderCard from '../../components/DynamicOrderCard';
import { useAuth } from '../../components/hooks/useAuth';
import AppHeader from '../../components/navigation/AppHeader';
import { formatDateKey, getMonthDays } from '../../lib/calendarUtils';
import { supabase } from '../../lib/supabase';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme/ThemeProvider';

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

const CalendarFoldState = {
  FULL: 0,
  WEEK: 1,
};

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList);

function clamp(value, min, max) {
  'worklet';
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function getMonthWeeks(year, month) {
  const days = getMonthDays(year, month, 1);
  const padded = [...days];
  while (padded.length % 7 !== 0) padded.push({ day: null, date: null });
  const weeks = [];
  for (let i = 0; i < padded.length; i += 7) {
    weeks.push(padded.slice(i, i + 7));
  }
  return weeks;
}

function capitalizeLabel(value) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function CalendarScreen() {
  const { user, profile, isAuthenticated, isInitializing } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const todayKey = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [orders, setOrders] = useState([]);
  const [activeViewIndex, setActiveViewIndex] = useState(1); // 1 = 'Месяц' по умолчанию
  const [viewMode, setViewMode] = useState('month'); // 'month' | 'year'
  const [showCounts, setShowCounts] = useState(true);
  const showCountsRef = useRef(true);

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
    const handleSpacing = theme.spacing.xs * 1.5;
    const topSectionsHeight = monthHeaderHeight + dayNamesHeight;
    return {
      cardWidth,
      innerPadding,
      dayCellSize,
      weekRowHeight,
      monthHeaderHeight,
      dayNamesHeight,
      handleSpacing,
      topSectionsHeight,
    };
  }, [screenWidth, theme]);

  const MONTH_LIST_MIDDLE_INDEX = 50;
  const monthScrollX = useSharedValue(layoutMetrics.cardWidth * MONTH_LIST_MIDDLE_INDEX);
  const visibleMonthIndex = useSharedValue(MONTH_LIST_MIDDLE_INDEX);

  const monthWeeks = useMemo(
    () => getMonthWeeks(currentMonth.getFullYear(), currentMonth.getMonth()),
    [currentMonth],
  );
  const actualWeekRows = useMemo(() => monthWeeks.length, [monthWeeks]);
  const fixedWeekRows = 6; // используется только для паддинга в renderItem
  const selectedWeekIndex = useMemo(() => {
    if (!selectedDate) return 0;
    const found = monthWeeks.findIndex((week) =>
      week.some((cell) => cell.date && formatDateKey(cell.date) === selectedDate),
    );
    return found >= 0 ? found : 0;
  }, [monthWeeks, selectedDate]);
  const selectedYearMonth = useMemo(
    () => (selectedDate ? selectedDate.slice(0, 7) : null),
    [selectedDate],
  );
  const [weekOffset, setWeekOffset] = useState(0);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const collapsedRef = useRef(false);
  const isCollapsedShared = useSharedValue(false);
  // Высота сетки рассчитывается по фактическому числу недель, чтобы handle/контент ниже сидели ближе к реальной сетке
  const weeksHeight = layoutMetrics.weekRowHeight * actualWeekRows;
  const expandedCalendarHeight = layoutMetrics.topSectionsHeight + weeksHeight;
  const collapsedCalendarHeight = layoutMetrics.dayNamesHeight + layoutMetrics.weekRowHeight;
  const stageOneDistance = Math.max(expandedCalendarHeight - collapsedCalendarHeight, 1);
  const stageOneDistanceSafe = stageOneDistance;
  const stateSnapPoints = useMemo(
    () => ({
      [CalendarFoldState.FULL]: 0,
      [CalendarFoldState.WEEK]: stageOneDistanceSafe,
    }),
    [stageOneDistanceSafe],
  );
  const snapPoints = useMemo(
    () => [stateSnapPoints[CalendarFoldState.FULL], stateSnapPoints[CalendarFoldState.WEEK]],
    [stateSnapPoints],
  );

  const collapseTranslate = useSharedValue(0);
  const gestureStart = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const flatListRef = useRef(null);
  const initialMonthRef = useRef(startOfMonth(new Date()));

  // Генерируем статичный массив из 100 месяцев (50 назад + текущий + 49 вперёд)
  const dynamicMonths = useMemo(() => {
    const months = [];
    const baseMonth = initialMonthRef.current;
    for (let i = -50; i <= 49; i++) {
      months.push(startOfMonth(new Date(baseMonth.getFullYear(), baseMonth.getMonth() + i, 1)));
    }
    return months;
  }, []); // Пустой массив зависимостей - генерируем один раз
  const dynamicMonthsLength = dynamicMonths.length;
  const lastHandledPageIndex = useRef(MONTH_LIST_MIDDLE_INDEX);
  const handlePageChange = useCallback(
    (pageIndex) => {
      if (
        pageIndex < 0 ||
        pageIndex >= dynamicMonthsLength ||
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
    [dynamicMonths, dynamicMonthsLength, setCurrentMonth, setSelectedDate],
  );
  const monthScrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      monthScrollX.value = event.contentOffset.x;
    },
  });
  useEffect(() => {
    monthScrollX.value = layoutMetrics.cardWidth * visibleMonthIndex.value;
  }, [layoutMetrics.cardWidth, monthScrollX, visibleMonthIndex]);
  useDerivedValue(
    () => {
      const width = Math.max(1, layoutMetrics.cardWidth);
      const rawPage = monthScrollX.value / width;
      const nextIndex = Math.max(
        0,
        Math.min(dynamicMonthsLength - 1, Math.round(rawPage)),
      );
      if (visibleMonthIndex.value === nextIndex) return;
      visibleMonthIndex.value = nextIndex;
      runOnJS(handlePageChange)(nextIndex);
    },
    [layoutMetrics.cardWidth, dynamicMonthsLength, handlePageChange],
  );

  const calendarContentStyle = useAnimatedStyle(
    () => ({
      height: interpolate(
        collapseTranslate.value,
        [0, stageOneDistanceSafe],
        [expandedCalendarHeight, collapsedCalendarHeight],
        Extrapolate.CLAMP,
      ),
    }),
    [expandedCalendarHeight, collapsedCalendarHeight, stageOneDistanceSafe],
  );

  useFocusEffect(
    useCallback(() => {
      collapseTranslate.value = 0;
    }, [collapseTranslate]),
  );
  useEffect(() => {
    if (viewMode === 'month') {
      collapseTranslate.value = 0;
    }
  }, [viewMode]);
  useEffect(() => {
    collapseTranslate.value = clamp(collapseTranslate.value, 0, stageOneDistanceSafe);
  }, [stageOneDistanceSafe]);

  const arrowHitSlop = useMemo(() => {
    const gap = theme.spacing?.md ?? 14;
    return { top: gap, bottom: gap, left: gap, right: gap };
  }, [theme.spacing?.md]);

  const indicatorSlotBaseHeight =
    (theme.typography.sizes?.xs ?? 0) + (theme.spacing?.xs ?? 0) * 0.2;
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1 },
        calendarCard: {
          backgroundColor: theme.colors.card || theme.colors.surface,
          borderRadius: theme.radii?.lg ?? 16,
          marginHorizontal: theme.spacing.md,
          width: layoutMetrics.cardWidth,
          borderWidth: 1,
          borderColor: theme.colors.border,
          overflow: 'hidden',
          alignSelf: 'center',
        },
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
        monthHeaderRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.md, // добавлено: больше отступы сверху и снизу
        },
        monthHeaderLabel: {
          flex: 1,
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
        weekdayLabel: {
          width: layoutMetrics.dayCellSize,
          textAlign: 'center',
          fontSize: theme.typography.sizes.xs,
          fontWeight: theme.typography.weight.medium,
          color: theme.colors.textSecondary,
        },
        weeksClip: {
          overflow: 'hidden',
          width: layoutMetrics.cardWidth,
          alignSelf: 'center',
        },
        weeksContent: {
          flexDirection: 'column',
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
          height: layoutMetrics.dayCellSize,
          width: layoutMetrics.dayCellSize,
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
          borderRadius: (theme.spacing.xs ?? 0) / 2,
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
          borderRadius: theme.radii?.sm ?? 8,
        },
        noOrders: {
          fontSize: theme.typography.sizes.sm,
          color: theme.colors.textSecondary,
          textAlign: 'center',
          marginTop: theme.spacing.lg,
        },
        centered: {
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
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
  useDerivedValue(() => {
    const next = stageAtoBProgress.value < 0.5;
    if (next !== showCountsRef.current) {
      showCountsRef.current = next;
      runOnJS(setShowCounts)(next);
    }
  }, [stageAtoBProgress, setShowCounts]);
  useDerivedValue(() => {
    const progress = stageAtoBProgress.value;
    const shouldEnterCollapsed = progress >= 0.8;
    const shouldExitCollapsed = progress <= 0.2;
    if (shouldEnterCollapsed && !collapsedRef.current) {
      collapsedRef.current = true;
      isCollapsedShared.value = true;
      runOnJS(setIsCollapsed)(true);
    } else if (shouldExitCollapsed && collapsedRef.current) {
      collapsedRef.current = false;
      isCollapsedShared.value = false;
      runOnJS(setIsCollapsed)(false);
      runOnJS(setWeekOffset)(0);
    }
  }, [stageAtoBProgress]);
  const indicatorSlotAnimatedStyle = useAnimatedStyle(
    () => {
      const collapsedHeight = indicatorSlotBaseHeight * 0.5;
      const height = interpolate(
        stageAtoBProgress.value,
        [0, 1],
        [indicatorSlotBaseHeight, collapsedHeight],
        Extrapolate.CLAMP,
      );
      return { height };
    },
    [indicatorSlotBaseHeight],
  );
  const tabsAnimatedStyle = useAnimatedStyle(() => ({}), []);

  const currentMonthRef = useCallback(
    (offset = 0) =>
      startOfMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + offset, 1)),
    [currentMonth],
  );
  const headerAnimatedStyle = useAnimatedStyle(
    () => ({
      height: interpolate(
        stageAtoBProgress.value,
        [0, 1],
        [layoutMetrics.monthHeaderHeight, 0],
        Extrapolate.CLAMP,
      ),
      opacity: interpolate(stageAtoBProgress.value, [0, 0.5, 1], [1, 0.5, 0], Extrapolate.CLAMP),
      overflow: 'hidden',
    }),
    [layoutMetrics.monthHeaderHeight],
  );
  const weekdayAnimatedStyle = useAnimatedStyle(
    () => ({
      height: layoutMetrics.dayNamesHeight,
      opacity: 1,
      transform: [{ translateY: 0 }],
    }),
    [layoutMetrics.dayNamesHeight],
  );
    const weeksClipStyle = useAnimatedStyle(() => {
      const height = interpolate(
        stageAtoBProgress.value,
        [0, 1],
        [weeksHeight, layoutMetrics.weekRowHeight],
        Extrapolate.CLAMP,
      );
      return { height };
    }, [layoutMetrics.weekRowHeight, weeksHeight]);
    const weekOffsetAnim = useSharedValue(selectedWeekIndex);
    const weekPageX = useSharedValue(-selectedWeekIndex * layoutMetrics.cardWidth);
    const weekPanStartX = useSharedValue(0);
    useEffect(() => {
      const maxIdx = Math.max(0, monthWeeks.length - 1);
      const displayed = isCollapsed ? clamp(selectedWeekIndex + weekOffset, 0, maxIdx) : selectedWeekIndex;
      if (isCollapsed) {
        // В момент схлопывания сразу устанавливаем положение недели без анимации, чтобы первый свайп не ловил промежуточные значения
        weekOffsetAnim.value = displayed;
        weekPageX.value = -displayed * layoutMetrics.cardWidth;
      } else {
        weekOffsetAnim.value = withTiming(displayed, {
          duration: 220,
          easing: Easing.inOut(Easing.ease),
        });
        weekPageX.value = withTiming(0, {
          duration: 220,
          easing: Easing.inOut(Easing.ease),
        });
      }
    }, [isCollapsed, monthWeeks.length, selectedWeekIndex, weekOffset, weekOffsetAnim, weekPageX, layoutMetrics.cardWidth]);
    const weekTranslateStyle = useAnimatedStyle(
      () => ({
        transform: [
          {
            translateY: -interpolate(
              stageAtoBProgress.value,
              [0, 1],
              [0, weekOffsetAnim.value * layoutMetrics.weekRowHeight],
              Extrapolate.CLAMP,
            ),
          },
        ],
      }),
      [layoutMetrics.weekRowHeight],
    );
    const weekCollapsedTranslateStyle = useAnimatedStyle(
      () => ({
        transform: [
          {
            translateX: weekPageX.value,
          },
        ],
      }),
      [layoutMetrics.cardWidth],
    );
    const collapsedOverlayStyle = useAnimatedStyle(
      () => ({
        opacity: stageAtoBProgress.value,
      }),
      [stageAtoBProgress],
    );
    const weekSwipeGesture = Gesture.Pan()
      // Чуть раньше активируем горизонтальный жест и даём больше вертикального допуска
      .activeOffsetX([-6, 6])
      .failOffsetY([-24, 24])
      .onStart(() => {
        'worklet';
        const maxIdx = Math.max(0, monthWeeks.length - 1);
        const currentIndex = clamp(selectedWeekIndex + weekOffset, 0, maxIdx);
        // На всякий случай выравниваем стартовую позицию перед первым свайпом
        weekPageX.value = -currentIndex * layoutMetrics.cardWidth;
        weekPanStartX.value = weekPageX.value;
      })
      .onUpdate((event) => {
        'worklet';
        if (!isCollapsedShared.value) return;
        const translation = Number.isFinite(event?.translationX) ? event.translationX : 0;
        const maxIdx = Math.max(0, monthWeeks.length - 1);
        const minX = -maxIdx * layoutMetrics.cardWidth;
        const maxX = 0;
        const nextX = clamp(weekPanStartX.value + translation, minX, maxX);
        weekPageX.value = nextX;
      })
      .onEnd((event) => {
        'worklet';
        if (!isCollapsedShared.value) {
          weekPageX.value = withTiming(-selectedWeekIndex * layoutMetrics.cardWidth, {
            duration: 180,
            easing: Easing.out(Easing.ease),
          });
          return;
        }
        const maxIdx = Math.max(0, monthWeeks.length - 1);
        const startIndex = clamp(
          Math.round(-weekPanStartX.value / layoutMetrics.cardWidth),
          0,
          maxIdx,
        );
        const translation = Number.isFinite(event?.translationX)
          ? event.translationX
          : weekPageX.value - weekPanStartX.value;
        const velocity = Number.isFinite(event?.velocityX) ? event.velocityX : 0;
        const threshold = layoutMetrics.cardWidth * 0.25;
        let delta = 0;
        if (translation < -threshold || velocity < -450) {
          delta = 1;
        } else if (translation > threshold || velocity > 450) {
          delta = -1;
        }
        const targetIndex = clamp(startIndex + delta, 0, maxIdx);
        const targetX = -targetIndex * layoutMetrics.cardWidth;
        weekPageX.value = withTiming(
          targetX,
          { duration: 220, easing: Easing.out(Easing.ease) },
          (finished) => {
            if (!finished) {
              weekPageX.value = withTiming(-startIndex * layoutMetrics.cardWidth, {
                duration: 180,
                easing: Easing.out(Easing.ease),
              });
              return;
            }
            weekOffsetAnim.value = targetIndex;
            runOnJS(setWeekOffset)(targetIndex - selectedWeekIndex);
          },
        );
      });
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

  const panGesture = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .activeOffsetY([-4, 4])
    .hitSlop({ top: 8, bottom: 8, left: 40, right: 40 })
    .onStart(() => {
      'worklet';
      gestureStart.value = collapseTranslate.value;
    })
    .onUpdate((event) => {
      'worklet';
      const ty = event?.translationY;
      if (!Number.isFinite(ty)) return;
      const next = gestureStart.value - ty;
      const safeMax = Number.isFinite(stageOneDistanceSafe) ? stageOneDistanceSafe : 0;
      collapseTranslate.value = clamp(next, 0, safeMax);
    })
    .onEnd((event) => {
      'worklet';
      const velocityY = Number.isFinite(event?.velocityY) ? event.velocityY : 0;
      const threshold = 450;
      const current = collapseTranslate.value;

      const nearest = snapPoints.reduce(
        (closest, point) =>
          Math.abs(point - current) < Math.abs(closest - current) ? point : closest,
        snapPoints[0],
      );

      let target = nearest;

      if (Math.abs(velocityY) > threshold) {
        if (velocityY < 0) {
          const nextPoint = snapPoints.find((p) => p > current + 1);
          target = nextPoint ?? snapPoints[snapPoints.length - 1];
        } else {
          const prevPoint = [...snapPoints].reverse().find((p) => p < current - 1);
          target = prevPoint ?? snapPoints[0];
        }
      }
      collapseTranslate.value = withTiming(target, {
        duration: 260,
        easing: Easing.inOut(Easing.ease),
      });
    })
    .failOffsetX([-20, 20]);

  // Жест для сворачивания/раскрытия календаря из области заявок
  const ordersGesture = Gesture.Pan()
    .activeOffsetY([-4, 4])
    .failOffsetX([-24, 24])
    .simultaneousWithExternalGesture()
    .onStart(() => {
      'worklet';
      gestureStart.value = collapseTranslate.value;
    })
    .onUpdate((event) => {
      'worklet';
      const ty = Number.isFinite(event?.translationY) ? event.translationY : 0;
      const tx = Number.isFinite(event?.translationX) ? event.translationX : 0;
      const absTy = Math.abs(ty);
      const absTx = Math.abs(tx);
      if (absTy === 0 && absTx === 0) return;
      const isMostlyVertical = absTy >= absTx * 0.6;
      if (!isMostlyVertical) return;

      // Для свайпа вверх (сворачивание): проверяем позицию скролла
      if (ty < 0 && scrollY.value > 5) return;

      const next = gestureStart.value - ty;
      const safeMax = Number.isFinite(stageOneDistanceSafe) ? stageOneDistanceSafe : 0;
      // Позволяем движение в обе стороны
      collapseTranslate.value = clamp(next, 0, safeMax);
    })
    .onEnd((event) => {
      'worklet';
      const velocityY = Number.isFinite(event?.velocityY) ? event.velocityY : 0;
      const threshold = 450;
      const current = collapseTranslate.value;

      const nearest = snapPoints.reduce(
        (closest, point) =>
          Math.abs(point - current) < Math.abs(closest - current) ? point : closest,
        snapPoints[0],
      );

      let target = nearest;

      if (Math.abs(velocityY) > threshold) {
        if (velocityY < 0) {
          const nextPoint = snapPoints.find((p) => p > current + 1);
          target = nextPoint ?? snapPoints[snapPoints.length - 1];
        } else {
          const prevPoint = [...snapPoints].reverse().find((p) => p < current - 1);
          target = prevPoint ?? snapPoints[0];
        }
      }
      collapseTranslate.value = withTiming(target, {
        duration: 260,
        easing: Easing.inOut(Easing.ease),
      });
    });

  const headerMonthLabel = useMemo(() => {
    if (viewMode === 'year') {
      return currentMonth.getFullYear().toString();
    }
    return capitalizeLabel(format(currentMonth, 'LLLL yyyy', { locale: dfnsRu }));
  }, [currentMonth, viewMode]);
  const currentMonthIndex = useMemo(() => currentMonth.getMonth(), [currentMonth]);

  const switchMode = useCallback(
    (nextMode, opts = {}) => {
      setActiveViewIndex(nextMode === 'year' ? 0 : 1);
      if (nextMode === 'month' && opts.newMonth) {
        setCurrentMonth(opts.newMonth);
        setSelectedDate(format(opts.newMonth, 'yyyy-MM-dd'));
      }
      setViewMode(nextMode);
    },
    [setCurrentMonth, setSelectedDate],
  );

  const shiftMonth = useCallback(
    (offset) => {
      setCurrentMonth((prev) => {
        const next = startOfMonth(new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
        setSelectedDate(format(next, 'yyyy-MM-dd'));
        return next;
      });
    },
    [setSelectedDate],
  );

  // FlatList: отслеживание видимого месяца
  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    if (viewableItems.length > 0 && typeof viewableItems[0]?.index === 'number') {
      visibleMonthIndex.value = viewableItems[0].index;
      handlePageChange(viewableItems[0].index);
    }
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 80,
    minimumViewTime: 100,
  }).current;

  const getItemLayout = useCallback(
    (data, index) => ({
      length: layoutMetrics.cardWidth,
      offset: layoutMetrics.cardWidth * index,
      index,
    }),
    [layoutMetrics.cardWidth],
  );

  const goToPreviousMonth = useCallback(() => {
    shiftMonth(-1);
  }, [shiftMonth]);

  const goToNextMonth = useCallback(() => {
    shiftMonth(1);
  }, [shiftMonth]);

  const handleTabPress = useCallback(
    (index) => {
      setActiveViewIndex(index);
      if (index === 0) {
        switchMode('year');
      } else if (index === 1) {
        switchMode('month');
      }
    },
    [switchMode],
  );

  const viewPanelLabels = useMemo(
    () => [
      t('calendar_view_year'),
      t('calendar_view_month'),
      t('calendar_view_week'),
      t('calendar_view_day'),
      t('calendar_view_schedule'),
    ],
    [t],
  );
  const headerOptions = useMemo(
    () => ({
      headerTitleAlign: 'left',
      title: t('routes.orders/calendar'),
    }),
    [t],
  );

  const getDateKey = useCallback((v) => {
    if (!v) return null;
    try {
      // Приводим к локальной дате, чтобы избежать сдвига по часовому поясу
      const parsed = new Date(v);
      if (!Number.isNaN(parsed.getTime())) {
        return formatDateKey(parsed);
      }
    } catch (e) {
      // fallback ниже
    }
    return typeof v === 'string' ? v.slice(0, 10) : null;
  }, []);

  const orderDateKey = useCallback(
    (o) =>
      getDateKey(
        o?.datetime ??
          o?.date ??
          o?.scheduled_at ??
          o?.planned_at ??
          o?.date_time ??
          o?.start_at ??
          o?.when,
      ),
    [getDateKey],
  );

  useEffect(() => {
    if (!isAuthenticated || isInitializing || !profile) return;
    let ignore = false;

  const loadOrders = async () => {
    try {
      setLoading(true);
      let query = supabase.from('orders_secure').select('*');
      if (profile?.role === 'worker') {
        query = query.eq('assigned_to', profile.id);
      }
      const { data: ordersData, error: ordersError } = await query;
      if (ignore) return;
      if (!ordersError && Array.isArray(ordersData)) {
        setOrders(ordersData);
      }
    } catch (error) {
      console.error('Error loading orders:', error);
    } finally {
      if (!ignore) setLoading(false);
    }
  };

  loadOrders();
  return () => {
    ignore = true;
  };
}, [isAuthenticated, isInitializing, profile?.id, profile?.role]);

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

const { ordersByDate, ordersByMonth, noDateOrders } = useMemo(() => {
  const byDate = {};
  const byMonth = {};
  const noDate = [];
  orders.forEach((order) => {
    const key = orderDateKey(order);
    if (key) {
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(order);

      const monthKey = key.slice(0, 7);
      if (!byMonth[monthKey]) byMonth[monthKey] = [];
      byMonth[monthKey].push(order);
    } else {
      noDate.push(order);
    }
  });
  return { ordersByDate: byDate, ordersByMonth: byMonth, noDateOrders: noDate };
}, [orders, orderDateKey]);

const selectedDateOrders = useMemo(
  () => ordersByDate[selectedDate] ?? [],
  [ordersByDate, selectedDate],
);

const selectedMonthOrders = useMemo(
  () => (selectedYearMonth ? ordersByMonth[selectedYearMonth] ?? [] : []),
  [ordersByMonth, selectedYearMonth],
);

const filteredOrders = useMemo(() => {
  if (selectedDateOrders.length > 0) return selectedDateOrders;
  if (selectedMonthOrders.length > 0) return selectedMonthOrders;
  if (noDateOrders.length > 0) return noDateOrders;
  return [];
}, [noDateOrders, selectedDateOrders, selectedMonthOrders]);

const isNoDateMode = useMemo(
  () => filteredOrders.length > 0 && filteredOrders.every((o) => !orderDateKey(o)),
  [filteredOrders, orderDateKey],
);

const markedDates = useMemo(() => {
    const marks = {};
    const counts = {};

    orders.forEach((o) => {
      const key = orderDateKey(o);
      if (key) {
        counts[key] = (counts[key] || 0) + 1;
      }
    });

    Object.keys(counts).forEach((date) => {
      marks[date] = { marked: true, dotColor: theme.colors.primary, count: counts[date] };
    });

    marks[selectedDate] = {
      ...(marks[selectedDate] || {}),
      selected: true,
      selectedColor: theme.colors.primary,
    };

    return marks;
  }, [orders, selectedDate, orderDateKey, theme.colors.primary]);

  const onRefresh = useCallback(async () => {
    if (!isAuthenticated || isInitializing || !profile) return;

    setRefreshing(true);
    try {
      let query = supabase.from('orders_secure').select('*');
      if (profile?.role === 'worker') {
        query = query.eq('assigned_to', profile.id);
      }

      const { data, error } = await query;
      if (!error && Array.isArray(data)) {
        setOrders(data);
      }
    } catch (error) {
      console.error('Error refreshing orders:', error);
    } finally {
      setRefreshing(false);
    }
  }, [isAuthenticated, isInitializing, profile?.id, profile?.role]);

  if (loading) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        edges={['left', 'right']}
      >
        <AppHeader
          back
          options={headerOptions}
          route={{ params: { onBackPress: () => router.replace('/orders') } }}
        />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      edges={['left', 'right']}
    >
      <AppHeader
        back
        options={headerOptions}
        route={{ params: { onBackPress: () => router.replace('/orders') } }}
      />

      <View style={styles.container}>
        {viewMode === 'month' ? (
          <>
            <Animated.View style={[styles.tabsWrapper, tabsAnimatedStyle]}>
              <View style={styles.tabsContent}>
                {viewPanelLabels.map((label, index) => {
                  const isActive = index === activeViewIndex;
                  return (
                    <Pressable
                      key={label}
                      onPress={() => handleTabPress(index)}
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
            <Animated.View style={[calendarContentStyle]}>
              <View style={[styles.calendarContent]}>
                {isCollapsed ? (
                  <GestureDetector gesture={weekSwipeGesture}>
                    <View style={[styles.monthPage, { width: layoutMetrics.cardWidth }]}>
                      <Animated.View style={[headerAnimatedStyle]}>
                        <View style={[styles.monthHeaderRow]}>
                          <Pressable
                            onPress={goToPreviousMonth}
                            hitSlop={arrowHitSlop}
                            android_ripple={{ color: theme.colors.overlay }}
                            style={styles.calendarArrow}
                          >
                            <Feather
                              name="chevron-left"
                              size={theme.icons?.md ?? 22}
                              color={theme.colors.text}
                            />
                          </Pressable>
                          <Text
                            style={styles.monthHeaderLabel}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                          >
                            {capitalizeLabel(format(currentMonth, 'LLLL yyyy', { locale: dfnsRu }))}
                          </Text>
                          <Pressable
                            onPress={goToNextMonth}
                            hitSlop={arrowHitSlop}
                            android_ripple={{ color: theme.colors.overlay }}
                            style={styles.calendarArrow}
                          >
                            <Feather
                              name="chevron-right"
                              size={theme.icons?.md ?? 22}
                              color={theme.colors.text}
                            />
                          </Pressable>
                        </View>
                      </Animated.View>
                      <View style={[styles.weekdayRow]}>
                        {DAY_KEYS.map((key) => (
                          <Text key={key} style={styles.weekdayLabel}>
                            {t(key)}
                          </Text>
                        ))}
                      </View>
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
                          style={[
                            {
                              flexDirection: 'row',
                              width: layoutMetrics.cardWidth * monthWeeks.length,
                            },
                            weekCollapsedTranslateStyle,
                          ]}
                        >
                          {monthWeeks.map((week, weekIdx) => (
                            <View
                              key={`w-${currentMonth.getTime()}-${weekIdx}`}
                              style={[styles.weekRow, { width: layoutMetrics.cardWidth }]}
                            >
                              {week.map((cell, cellIdx) => {
                                const cellSizeStyle = {
                                  width: layoutMetrics.dayCellSize,
                                  height: layoutMetrics.dayCellSize,
                                };
                                if (!cell.day) {
                                  return (
                                    <View
                                      key={`empty-${currentMonth.getTime()}-${weekIdx}-${cellIdx}`}
                                      style={[styles.dayCell, cellSizeStyle]}
                                    />
                                  );
                                }
                                const dayKey = formatDateKey(cell.date);
                                const eventCount = markedDates?.[dayKey]?.count || 0;
                                const hasEvent = eventCount > 0;
                                const isSelectedDay = dayKey === selectedDate;
                                const isToday = dayKey === todayKey;
                                const isTodaySelected = isSelectedDay && isToday;
                                const showOutline = isSelectedDay && !isToday;
                                const highlightTodayWhenNotSelected =
                                  isToday && selectedDate !== todayKey;
                                return (
                                  <Pressable
                                    key={`${currentMonth.getTime()}-${dayKey}`}
                                    onPress={() => setSelectedDate(dayKey)}
                                    delayPressIn={0}
                                    delayLongPress={200}
                                    android_ripple={{ color: theme.colors.overlay }}
                                    style={[
                                      styles.dayCell,
                                      cellSizeStyle,
                                      isTodaySelected && styles.dayCellSelectedFilled,
                                      showOutline && styles.dayCellSelectedOutline,
                                    ]}
                                  >
                                    <View style={styles.dayContent}>
                                      <Text
                                        style={[
                                          styles.dayNumber,
                                          isTodaySelected && styles.dayNumberToday,
                                          highlightTodayWhenNotSelected && styles.dayNumberSelected,
                                        ]}
                                      >
                                        {cell.day}
                                      </Text>
                                      <Animated.View
                                        style={[styles.dayIndicatorSlot, indicatorSlotAnimatedStyle]}
                                      >
                                        {hasEvent ? (
                                          showCounts ? (
                                            <Text style={styles.eventCount} numberOfLines={1}>
                                              {eventCount}
                                            </Text>
                                          ) : (
                                            <View style={styles.eventDot} />
                                          )
                                        ) : null}
                                      </Animated.View>
                                    </View>
                                  </Pressable>
                                );
                              })}
                            </View>
                          ))}
                        </Animated.View>
                      </Animated.View>
                    </View>
                  </GestureDetector>
                ) : (
                  <AnimatedFlatList
                    ref={flatListRef}
                    data={dynamicMonths}
                    horizontal
                    pagingEnabled
                    scrollEnabled={!isCollapsed}
                    showsHorizontalScrollIndicator={false}
                    keyExtractor={(item, index) => `month-${item.getTime()}-${index}`}
                    getItemLayout={getItemLayout}
                    initialScrollIndex={50}
                    onViewableItemsChanged={onViewableItemsChanged}
                    viewabilityConfig={viewabilityConfig}
                    windowSize={3}
                    maxToRenderPerBatch={3}
                    removeClippedSubviews={true}
                    scrollEventThrottle={16}
                    onScroll={monthScrollHandler}
                    renderItem={({ item: monthDate }) => {
                    // Рассчитываем недели и selectedWeekIndex для конкретного месяца
                    const itemMonthWeeks = getMonthWeeks(monthDate.getFullYear(), monthDate.getMonth());
                    const isCurrentMonth = monthDate.getTime() === currentMonth.getTime();

                    let itemSelectedWeekIndex = 0;
                    if (isCurrentMonth && selectedDate) {
                      const found = itemMonthWeeks.findIndex((week) =>
                        week.some((cell) => cell.date && formatDateKey(cell.date) === selectedDate),
                      );
                      itemSelectedWeekIndex = found >= 0 ? found : 0;
                    }

                    const gridRowCount = fixedWeekRows;
                    const paddedWeeks = [...itemMonthWeeks];
                    while (paddedWeeks.length < gridRowCount) {
                      paddedWeeks.push(
                        Array.from({ length: 7 }, () => ({ day: null, date: null })),
                      );
                    }
                    const itemWeeksHeight = layoutMetrics.weekRowHeight * itemMonthWeeks.length;

                    return (
                      <View style={[styles.monthPage, { width: layoutMetrics.cardWidth }]}>
                        <Animated.View style={[headerAnimatedStyle]}>
                          <View style={[styles.monthHeaderRow]}>
                            <Pressable
                              onPress={goToPreviousMonth}
                              hitSlop={arrowHitSlop}
                              android_ripple={{ color: theme.colors.overlay }}
                              style={styles.calendarArrow}
                            >
                              <Feather
                                name="chevron-left"
                                size={theme.icons?.md ?? 22}
                                color={theme.colors.text}
                              />
                            </Pressable>
                            <Text
                              style={styles.monthHeaderLabel}
                              numberOfLines={1}
                              ellipsizeMode="tail"
                            >
                              {capitalizeLabel(format(monthDate, 'LLLL yyyy', { locale: dfnsRu }))}
                            </Text>
                            <Pressable
                              onPress={goToNextMonth}
                              hitSlop={arrowHitSlop}
                              android_ripple={{ color: theme.colors.overlay }}
                              style={styles.calendarArrow}
                            >
                              <Feather
                                name="chevron-right"
                                size={theme.icons?.md ?? 22}
                                color={theme.colors.text}
                              />
                            </Pressable>
                          </View>
                        </Animated.View>
                        <View style={[styles.weekdayRow]}>
                          {DAY_KEYS.map((key) => (
                            <Text key={key} style={styles.weekdayLabel}>
                              {t(key)}
                            </Text>
                          ))}
                        </View>
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
                          <Animated.View style={[{ flexDirection: 'column' }, weekTranslateStyle]}>
                            {paddedWeeks.map((week, weekIdx) => (
                              <View
                                key={`w-${monthDate.getTime()}-${weekIdx}`}
                                style={styles.weekRow}
                              >
                                {week.map((cell, cellIdx) => {
                                  const cellSizeStyle = {
                                    width: layoutMetrics.dayCellSize,
                                    height: layoutMetrics.dayCellSize,
                                  };
                                  if (!cell.day) {
                                    return (
                                      <View
                                        key={`empty-${monthDate.getTime()}-${weekIdx}-${cellIdx}`}
                                        style={[styles.dayCell, cellSizeStyle]}
                                      />
                                    );
                                  }
                                  const dayKey = formatDateKey(cell.date);
                                  const eventCount = markedDates?.[dayKey]?.count || 0;
                                  const hasEvent = eventCount > 0;
                                  const isSelectedDay = dayKey === selectedDate;
                                  const isToday = dayKey === todayKey;
                                  const isTodaySelected = isSelectedDay && isToday;
                                  const showOutline = isSelectedDay && !isToday;
                                  const highlightTodayWhenNotSelected =
                                    isToday && selectedDate !== todayKey;
                                  return (
                                    <Pressable
                                      key={`${monthDate.getTime()}-${dayKey}`}
                                      onPress={() => setSelectedDate(dayKey)}
                                      delayPressIn={0}
                                      delayLongPress={200}
                                      android_ripple={{ color: theme.colors.overlay }}
                                      style={[
                                        styles.dayCell,
                                        cellSizeStyle,
                                        isTodaySelected && styles.dayCellSelectedFilled,
                                        showOutline && styles.dayCellSelectedOutline,
                                      ]}
                                    >
                                      <View style={styles.dayContent}>
                                        <Text
                                          style={[
                                            styles.dayNumber,
                                            isTodaySelected && styles.dayNumberToday,
                                            highlightTodayWhenNotSelected &&
                                              styles.dayNumberSelected,
                                          ]}
                                        >
                                          {cell.day}
                                        </Text>
                                        <Animated.View
                                          style={[
                                            styles.dayIndicatorSlot,
                                            indicatorSlotAnimatedStyle,
                                          ]}
                                        >
                                          {hasEvent ? (
                                            showCounts ? (
                                              <Text style={styles.eventCount} numberOfLines={1}>
                                                {eventCount}
                                              </Text>
                                            ) : (
                                              <View style={styles.eventDot} />
                                            )
                                          ) : null}
                                        </Animated.View>
                                      </View>
                                    </Pressable>
                                  );
                                })}
                              </View>
                            ))}
                          </Animated.View>
                        </Animated.View>
                      </View>
                    );
                  }}
                />
                )}
              </View>
            </Animated.View>
            <GestureDetector gesture={panGesture}>
              <View style={styles.handleContainer}>
                <View style={styles.handleBar} />
              </View>
            </GestureDetector>
            <GestureDetector gesture={ordersGesture}>
              <View style={{ flex: 1 }}>
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
                        width: layoutMetrics.cardWidth * dynamicMonthsLength,
                      },
                      ordersInnerStyle,
                    ]}
                  >
                    {dynamicMonths.map((monthDate, index) => {
                      const monthStart = startOfMonth(monthDate);
                      const pageKey = format(monthStart, 'yyyy-MM-dd');
                      const monthKey = format(monthStart, 'yyyy-MM');
                      const isSelectedMonth = selectedYearMonth === monthKey;
                      const targetDateKey = isSelectedMonth ? selectedDate : pageKey;
                      const dayOrders = ordersByDate[targetDateKey];
                      const monthOrders = ordersByMonth[monthKey];
                      const hasDayOrders = Array.isArray(dayOrders) && dayOrders.length > 0;
                      const hasMonthOrders = Array.isArray(monthOrders) && monthOrders.length > 0;
                      const fallbackOrders = noDateOrders;
                      const ordersForPage = isSelectedMonth
                        ? filteredOrders
                        : hasDayOrders
                        ? dayOrders ?? []
                        : hasMonthOrders || fallbackOrders.length === 0
                        ? monthOrders ?? []
                        : fallbackOrders;
                      const useMonthLabel = isSelectedMonth
                        ? selectedDateOrders.length === 0 && selectedMonthOrders.length > 0
                        : !hasDayOrders && hasMonthOrders;
                      const isNoDateModeForPage = isSelectedMonth
                        ? isNoDateMode
                        : !hasDayOrders && !hasMonthOrders && fallbackOrders.length > 0;
                      const headerDateText = isNoDateModeForPage
                        ? 'Без даты'
                        : useMonthLabel
                        ? capitalizeLabel(format(monthDate, 'LLLL yyyy', { locale: dfnsRu }))
                        : format(new Date(targetDateKey), 'd MMMM', { locale: dfnsRu });
                      return (
                        <View
                          key={`orders-page-${monthDate.getTime()}-${index}`}
                          style={{ width: layoutMetrics.cardWidth }}
                        >
                          <View style={styles.ordersHeader}>
                            <Text style={styles.ordersTitle}>Заявки на {headerDateText}</Text>
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
                                    size={theme.icons?.sm ?? 18}
                                    color={theme.colors.textSecondary}
                                  />
                                )}
                              </Pressable>
                            </View>
                          </View>
                          <FlatList
                            data={ordersForPage}
                            extraData={selectedDate}
                            keyExtractor={(item) => item.id.toString()}
                            contentContainerStyle={{
                              paddingHorizontal: 12,
                              paddingBottom: Math.max(20, insets.bottom),
                            }}
                            style={{ flex: 1 }}
                            scrollEventThrottle={16}
                            onScroll={(event) => {
                              scrollY.value = event.nativeEvent.contentOffset.y;
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
            currentMonthIndex={currentMonthIndex}
            onMonthPress={(newMonth) => {
              switchMode('month', { newMonth });
            }}
            markedDates={markedDates}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
