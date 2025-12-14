// app/orders/calendar.jsx (REFACTORED)
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { format, startOfMonth } from 'date-fns';
import { ru as dfnsRu } from 'date-fns/locale';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Screen from '../../components/layout/Screen';
import YearView from '../../components/calendar/YearView';
import DynamicOrderCard from '../../components/DynamicOrderCard';
import { useAuth } from '../../components/hooks/useAuth';
import { formatDateKey } from '../../lib/calendarUtils';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme/ThemeProvider';
import { getMonthWeeks, fetchCalendarOrders, clamp, CalendarFoldState } from '../../hooks/useCalendarLogic';
import { CalendarMonthHeader } from '../../components/calendar/CalendarMonthHeader';
import { CalendarWeekRow } from '../../components/calendar/CalendarWeekRow';

/** ======= RU locale for react-native-calendars ======= */
LocaleConfig.locales['ru'] = {
  monthNames: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
  monthNamesShort: ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'],
  dayNames: ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'],
  dayNamesShort: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
  today: 'Сегодня',
};
LocaleConfig.defaultLocale = 'ru';

const DAY_KEYS = ['day_short_mo', 'day_short_tu', 'day_short_we', 'day_short_th', 'day_short_fr', 'day_short_sa', 'day_short_su'];
const AnimatedFlatList = Animated.createAnimatedComponent(FlatList);

function capitalizeLabel(value) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatMonthLabel(date) {
  return capitalizeLabel(format(date, 'LLLL yyyy', { locale: dfnsRu }));
}

function formatDayLabel(dateKey) {
  try {
    return capitalizeLabel(format(new Date(dateKey), 'd MMMM', { locale: dfnsRu }));
  } catch {
    return dateKey;
  }
}

export default function CalendarScreen() {
  const { user, profile, isAuthenticated, isInitializing } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
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
  const [orders, setOrders] = useState([]);
  const [viewMode, setViewMode] = useState('month');
  const [showCounts, setShowCounts] = useState(true);

  const MONTH_LIST_MIDDLE_INDEX = 50;
  const monthWeeks = useMemo(
    () => getMonthWeeks(currentMonth.getFullYear(), currentMonth.getMonth()),
    [currentMonth],
  );
  const actualWeekRows = useMemo(() => monthWeeks.length, [monthWeeks]);
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

  const [isCollapsed, setIsCollapsed] = useState(false);
  const collapsedRef = useRef(false);
  const weeksHeight = layoutMetrics.weekRowHeight * actualWeekRows;
  const expandedCalendarHeight = layoutMetrics.topSectionsHeight + weeksHeight;
  const collapsedCalendarHeight = layoutMetrics.dayNamesHeight + layoutMetrics.weekRowHeight;
  const stageOneDistance = Math.max(expandedCalendarHeight - collapsedCalendarHeight, 1);
  const stageOneDistanceSafe = stageOneDistance;

  const collapseTranslate = useSharedValue(0);
  const gestureStart = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const monthScrollX = useSharedValue(layoutMetrics.cardWidth * MONTH_LIST_MIDDLE_INDEX);
  const visibleMonthIndex = useSharedValue(MONTH_LIST_MIDDLE_INDEX);
  const isCollapsedShared = useSharedValue(false);
  const flatListRef = useRef(null);
  const lastHandledPageIndex = useRef(MONTH_LIST_MIDDLE_INDEX);
  const initialMonthRef = useRef(startOfMonth(new Date()));

  const dynamicMonths = useMemo(() => {
    const months = [];
    const baseMonth = initialMonthRef.current;
    for (let i = -50; i <= 49; i++) {
      months.push(startOfMonth(new Date(baseMonth.getFullYear(), baseMonth.getMonth() + i, 1)));
    }
    return months;
  }, []);

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

  const monthScrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      monthScrollX.value = event.contentOffset.x;
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
    visibleMonthIndex.value = targetIndex;
    monthScrollX.value = layoutMetrics.cardWidth * targetIndex;
    if (flatListRef.current && !isCollapsed) {
      try {
        flatListRef.current.scrollToIndex({ index: targetIndex, animated: false });
      } catch {}
    }
  }, [currentMonth, dynamicMonths, isCollapsed, layoutMetrics.cardWidth, monthScrollX, visibleMonthIndex]);

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
    collapseTranslate.value = clamp(collapseTranslate.value, 0, stageOneDistanceSafe);
  }, [stageOneDistanceSafe, collapseTranslate]);

  const arrowHitSlop = useMemo(() => {
    const gap = theme.spacing.md;
    return { top: gap, bottom: gap, left: gap, right: gap };
  }, [theme.spacing.md]);

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

  useDerivedValue(() => {
    const collapsed = stageAtoBProgress.value >= 0.99;
    if (isCollapsedShared.value !== collapsed) {
      isCollapsedShared.value = collapsed;
    }
    if (collapsed !== collapsedRef.current) {
      collapsedRef.current = collapsed;
      runOnJS(setIsCollapsed)(collapsed);
    }
  });

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
        [layoutMetrics.monthHeaderHeight, 0],
        Extrapolate.CLAMP,
      ),
      opacity: interpolate(stageAtoBProgress.value, [0, 0.5, 1], [1, 0.5, 0], Extrapolate.CLAMP),
      overflow: 'hidden',
    }),
    [layoutMetrics.monthHeaderHeight],
  );

  const weeksClipStyleExpanded = useMemo(
    () => ({
      height: weeksHeight,
      overflow: 'hidden',
    }),
    [weeksHeight],
  );

  const weeksClipStyle = useAnimatedStyle(() => {
    const height = interpolate(
      stageAtoBProgress.value,
      [0, 1],
      [weeksHeight, layoutMetrics.weekRowHeight],
      Extrapolate.CLAMP,
    );
    return { height, overflow: 'hidden' };
  }, [layoutMetrics.weekRowHeight, weeksHeight]);

  const switchMode = useCallback(
    (nextMode, opts = {}) => {
      if (nextMode === 'month' && opts.newMonth) {
        setCurrentMonth(opts.newMonth);
        setSelectedDate(format(opts.newMonth, 'yyyy-MM-dd'));
      }
      setViewMode(nextMode);
    },
    [],
  );

  const shiftMonth = useCallback(
    (offset) => {
      setCurrentMonth((prev) => {
        const next = startOfMonth(new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
        setSelectedDate(format(next, 'yyyy-MM-dd'));
        return next;
      });
    },
    [],
  );

  const goToPreviousMonth = useCallback(() => shiftMonth(-1), [shiftMonth]);
  const goToNextMonth = useCallback(() => shiftMonth(1), [shiftMonth]);

  const getItemLayout = useCallback(
    (data, index) => ({
      length: layoutMetrics.cardWidth,
      offset: layoutMetrics.cardWidth * index,
      index,
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
      const current = collapseTranslate.value;
      const total = stageOneDistanceSafe || 1;
      const progress = current / total;
      const threshold = 450;
      let target = 0;
      if (Math.abs(velocityY) > threshold) {
        target = velocityY < 0 ? total : 0;
      } else {
        target = progress > 0.5 ? total : 0;
      }
      collapseTranslate.value = withTiming(target, { duration: 260, easing: Easing.inOut(Easing.ease) });
    })
    .failOffsetX([-20, 20]);

  const {
    data: ordersData,
    isFetching: ordersFetching,
    refetch: refetchOrders,
  } = useQuery({
    queryKey: ['calendar-orders', profile?.id, profile?.role],
    queryFn: () => fetchCalendarOrders(profile?.id, profile?.role),
    enabled: isAuthenticated && !!profile?.id,
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnMount: 'stale',
    refetchOnReconnect: true,
    placeholderData: (prev) => prev ?? [],
    initialData: () => [],
  });

  useEffect(() => {
    if (Array.isArray(ordersData)) {
      setOrders(ordersData);
    }
  }, [ordersData]);

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

  const { ordersByDate } = useMemo(() => {
    const byDate = {};
    orders.forEach((order) => {
      const dateField = order.datetime || order.date || order.created_at;
      if (dateField) {
        const key = formatDateKey(new Date(dateField));
        if (!byDate[key]) byDate[key] = [];
        byDate[key].push(order);
      }
    });
    return { ordersByDate: byDate };
  }, [orders]);

  const selectedDateOrders = useMemo(
    () => (selectedDate ? ordersByDate[selectedDate] ?? [] : []),
    [selectedDate, ordersByDate],
  );

  const markedDates = useMemo(() => {
    const marks = {};
    const counts = {};
    orders.forEach((o) => {
      const dateField = o.datetime || o.date || o.created_at;
      if (dateField) {
        const key = formatDateKey(new Date(dateField));
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
  }, [orders, selectedDate, theme.colors.primary]);

  const onRefresh = useCallback(async () => {
    if (!isAuthenticated || isInitializing || !profile) return;
    setRefreshing(true);
    await refetchOrders().finally(() => setRefreshing(false));
  }, [isAuthenticated, isInitializing, profile, refetchOrders]);

  useEffect(() => {
    if (!isAuthenticated || isInitializing || !profile?.id) return;
    refetchOrders();
  }, [isAuthenticated, isInitializing, profile?.id, profile?.role, refetchOrders]);

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
                {['Год', 'Месяц'].map((label, index) => {
                  const isActive = index === (viewMode === 'month' ? 1 : 0);
                  return (
                    <Pressable
                      key={label}
                      onPress={() => switchMode(index === 0 ? 'year' : 'month')}
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
                <AnimatedFlatList
                  ref={flatListRef}
                  data={dynamicMonths}
                  horizontal
                  pagingEnabled
                  scrollEnabled={!isCollapsed}
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={(item, index) => `month-${item.getTime()}-${index}`}
                  getItemLayout={getItemLayout}
                  initialScrollIndex={MONTH_LIST_MIDDLE_INDEX}
                  onViewableItemsChanged={({ viewableItems }) => {
                    if (viewableItems.length > 0 && typeof viewableItems[0]?.index === 'number') {
                      visibleMonthIndex.value = viewableItems[0].index;
                      handlePageChange(viewableItems[0].index);
                    }
                  }}
                  viewabilityConfig={{ itemVisiblePercentThreshold: 80, minimumViewTime: 100 }}
                  windowSize={3}
                  maxToRenderPerBatch={3}
                  removeClippedSubviews={true}
                  scrollEventThrottle={16}
                  onScroll={monthScrollHandler}
                  renderItem={({ item: monthDate }) => {
                    const itemMonthWeeks = getMonthWeeks(monthDate.getFullYear(), monthDate.getMonth());
                    const fixedWeekRows = 6;
                    const paddedWeeks = [...itemMonthWeeks];
                    while (paddedWeeks.length < fixedWeekRows) {
                      paddedWeeks.push(Array.from({ length: 7 }, () => ({ day: null, date: null })));
                    }
                    return (
                      <View style={[styles.monthPage]}>
                        <CalendarMonthHeader
                          monthDate={monthDate}
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
                        <Animated.View style={[{ overflow: 'hidden', width: layoutMetrics.cardWidth, alignSelf: 'center' }, weeksClipStyleExpanded]}>
                          <Animated.View style={[{ flexDirection: 'column' }]}>
                            {paddedWeeks.map((week, weekIdx) => (
                              <CalendarWeekRow
                                key={`w-${monthDate.getTime()}-${weekIdx}`}
                                week={week}
                                monthDate={monthDate}
                                selectedDate={selectedDate}
                                todayKey={todayKey}
                                markedDates={markedDates}
                                showCounts={showCounts}
                                dayCellSize={layoutMetrics.dayCellSize}
                                onDatePress={setSelectedDate}
                                styles={styles}
                                theme={theme}
                                indicatorSlotAnimatedStyle={indicatorSlotAnimatedStyle}
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
            <GestureDetector gesture={panGesture}>
              <View style={styles.handleContainer}>
                <View style={styles.handleBar} />
              </View>
            </GestureDetector>
            <View style={{ flex: 1 }}>
              <View style={{ width: layoutMetrics.cardWidth, alignSelf: 'center', overflow: 'hidden', flex: 1 }}>
                <View>
                  <View style={styles.ordersHeader}>
                    <Text style={styles.ordersTitle}>Заявки на {formatDayLabel(selectedDate)}</Text>
                    <View style={styles.ordersHeaderActions}>
                      <Pressable onPress={onRefresh} android_ripple={{ color: theme.colors.overlayNavBar }} style={styles.refreshButton} disabled={refreshing}>
                        {refreshing ? <ActivityIndicator size="small" color={theme.colors.primary} /> : <Feather name="refresh-cw" size={16} color={theme.colors.textSecondary} />}
                      </Pressable>
                    </View>
                  </View>
                  <FlatList
                    data={selectedDateOrders}
                    extraData={{ selectedDate, count: selectedDateOrders.length }}
                    keyExtractor={(item) => String(item?.id ?? item?.order_id ?? item?.uuid)}
                    contentContainerStyle={{ paddingHorizontal: theme.spacing.md, paddingBottom: Math.max(20, insets.bottom) }}
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
              </View>
            </View>
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
