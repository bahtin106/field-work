// hooks/useCalendarLogic.js
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSharedValue, useDerivedValue, withTiming, Easing } from 'react-native-reanimated';
import { format, startOfMonth, subMonths } from 'date-fns';
import { supabase } from '../lib/supabase';
import { formatDateKey, getMonthDays } from '../lib/calendarUtils';

const CalendarFoldState = {
  FULL: 0,
  WEEK: 1,
};

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

async function fetchCalendarOrders(userId, role) {
  if (!userId) return [];
  const since = subMonths(new Date(), 3);
  const sinceIso = new Date(since.setHours(0, 0, 0, 0)).toISOString();
  let query = supabase
    .from('orders_secure')
    .select('*')
    .or(`datetime.gte.${sinceIso},created_at.gte.${sinceIso}`)
    .order('datetime', { ascending: false })
    .order('created_at', { ascending: false });
  if (role === 'worker') {
    query = query.eq('assigned_to', userId);
  }
  const { data, error } = await query;
  if (error) {
    return [];
  }

  const rows = Array.isArray(data) ? data : [];
  if (role === 'worker' && userId) {
    return rows.filter((r) => r.assigned_to === userId || r.assigned_to == null);
  }
  return rows;
}

export function useCalendarLogic(layoutMetrics) {
  const todayKey = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [orders, setOrders] = useState([]);
  const [viewMode, setViewMode] = useState('month');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const collapsedRef = useRef(false);
  const isCollapsedShared = useSharedValue(false);

  const monthWeeks = useMemo(
    () => getMonthWeeks(currentMonth.getFullYear(), currentMonth.getMonth()),
    [currentMonth],
  );
  const actualWeekRows = useMemo(() => monthWeeks.length, [monthWeeks]);
  const selectedYearMonth = useMemo(
    () => (selectedDate ? selectedDate.slice(0, 7) : null),
    [selectedDate],
  );

  const weeksHeight = layoutMetrics.weekRowHeight * actualWeekRows;
  const expandedCalendarHeight = layoutMetrics.topSectionsHeight + weeksHeight;
  const collapsedCalendarHeight = layoutMetrics.dayNamesHeight + layoutMetrics.weekRowHeight;
  const stageOneDistance = Math.max(expandedCalendarHeight - collapsedCalendarHeight, 1);
  const stageOneDistanceSafe = stageOneDistance;

  const snapPoints = useMemo(() => [0, stageOneDistanceSafe], [stageOneDistanceSafe]);

  const collapseTranslate = useSharedValue(0);
  const gestureStart = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const monthScrollX = useSharedValue(layoutMetrics.cardWidth * 50);
  const visibleMonthIndex = useSharedValue(50);

  const MONTH_LIST_MIDDLE_INDEX = 50;
  const dynamicMonths = useMemo(() => {
    const months = [];
    const baseMonth = startOfMonth(new Date());
    for (let i = -50; i <= 49; i++) {
      months.push(startOfMonth(new Date(baseMonth.getFullYear(), baseMonth.getMonth() + i, 1)));
    }
    return months;
  }, []);

  const stageAtoBProgress = useDerivedValue(() => {
    return Math.min(collapseTranslate.value / stageOneDistanceSafe, 1);
  });

  const selectedWeekIndex = useMemo(() => {
    if (!selectedDate) return 0;
    const found = monthWeeks.findIndex((week) =>
      week.some((cell) => cell.date && formatDateKey(cell.date) === selectedDate),
    );
    return found >= 0 ? found : 0;
  }, [monthWeeks, selectedDate]);

  const snapToFull = useCallback(() => {
    collapseTranslate.value = withTiming(0, { duration: 260, easing: Easing.inOut(Easing.ease) });
  }, [collapseTranslate]);

  const snapToCollapsed = useCallback(() => {
    collapseTranslate.value = withTiming(stageOneDistanceSafe, {
      duration: 260,
      easing: Easing.inOut(Easing.ease),
    });
  }, [collapseTranslate, stageOneDistanceSafe]);

  const ordersByDate = useMemo(() => {
    const byDate = {};
    const noDate = [];
    orders.forEach((order) => {
      const key = orderDateKey(order);
      if (key) {
        if (!byDate[key]) byDate[key] = [];
        byDate[key].push(order);
      } else {
        noDate.push(order);
      }
    });
    return { byDate, noDate };
  }, [orders]);

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
      marks[date] = { marked: true, count: counts[date] };
    });

    marks[selectedDate] = {
      ...(marks[selectedDate] || {}),
      selected: true,
    };

    return marks;
  }, [orders, selectedDate]);

  useEffect(() => {
    collapseTranslate.value = clamp(collapseTranslate.value, 0, stageOneDistanceSafe);
  }, [stageOneDistanceSafe, collapseTranslate]);

  return {
    // State
    currentMonth,
    selectedDate,
    orders,
    viewMode,
    isCollapsed,
    weekOffset,
    todayKey,
    // Setters
    setCurrentMonth,
    setSelectedDate,
    setOrders,
    setViewMode,
    setIsCollapsed,
    setWeekOffset,
    // Computed
    monthWeeks,
    actualWeekRows,
    selectedYearMonth,
    selectedWeekIndex,
    weeksHeight,
    expandedCalendarHeight,
    collapsedCalendarHeight,
    stageOneDistanceSafe,
    snapPoints,
    dynamicMonths,
    ordersByDate,
    markedDates,
    MONTH_LIST_MIDDLE_INDEX,
    // Animated values
    collapseTranslate,
    gestureStart,
    scrollY,
    monthScrollX,
    visibleMonthIndex,
    isCollapsedShared,
    stageAtoBProgress,
    // Callbacks
    snapToFull,
    snapToCollapsed,
    collapsedRef,
  };
}

function orderDateKey(o) {
  if (!o) return null;
  const ORDER_DATE_FIELDS = [
    'datetime',
    'date',
    'scheduled_at',
    'planned_at',
    'departure_at',
    'arrival_at',
    'time_window_start',
    'time_window_end',
    'date_time',
    'start_at',
    'when',
    'created_at',
  ];
  const isCustomObj = o?.custom && typeof o.custom === 'object' && !Array.isArray(o.custom);
  const customFields = isCustomObj ? o.custom : null;
  for (const key of ORDER_DATE_FIELDS) {
    const candidate = o?.[key] ?? (customFields ? customFields[key] : undefined);
    if (candidate) {
      try {
        const parsed = new Date(candidate);
        if (!Number.isNaN(parsed.getTime())) {
          return formatDateKey(parsed);
        }
      } catch {
        // Ignore date parsing errors
      }
    }
  }
  return null;
}

export { getMonthWeeks, fetchCalendarOrders, clamp, CalendarFoldState };
