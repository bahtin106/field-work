// components/calendar/YearView.jsx
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { formatDateKey, getMonthDays, isToday } from '../../lib/calendarUtils';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme/ThemeProvider';

const MONTH_KEYS = [
  'month_january',
  'month_february',
  'month_march',
  'month_april',
  'month_may',
  'month_june',
  'month_july',
  'month_august',
  'month_september',
  'month_october',
  'month_november',
  'month_december',
];

const DAY_KEYS = [
  'day_short_mo',
  'day_short_tu',
  'day_short_we',
  'day_short_th',
  'day_short_fr',
  'day_short_sa',
  'day_short_su',
];

function capitalizeLabel(value) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getMonthMatrix(year) {
  const months = [];
  for (let m = 0; m < 12; m++) {
    const days = getMonthDays(year, m, 1);
    const padded = [...days];
    while (padded.length % 7 !== 0) padded.push({ day: null, date: null });
    const weeks = [];
    for (let i = 0; i < padded.length; i += 7) {
      weeks.push(padded.slice(i, i + 7));
    }
    while (weeks.length < 6) {
      weeks.push(Array.from({ length: 7 }, () => ({ day: null, date: null })));
    }
    months.push({ monthIndex: m, weeks });
  }
  return months;
}

export default function YearView({
  year,
  onMonthPress,
  markedDates,
  style,
  currentMonthIndex,
  transitionDirection = 0,
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [viewport, setViewport] = useState({ width: windowWidth, height: windowHeight });
  const activeMonthIndex =
    typeof currentMonthIndex === 'number' ? currentMonthIndex : new Date().getMonth();

  const monthsMatrix = useMemo(() => getMonthMatrix(year), [year]);
  const monthRows = useMemo(
    () => [0, 1, 2, 3].map((row) => MONTH_KEYS.slice(row * 3, row * 3 + 3)),
    [],
  );

  const spacing = {
    xs: theme.spacing?.xs ?? 4,
    sm: theme.spacing?.sm ?? 8,
    md: theme.spacing?.md ?? 12,
    lg: theme.spacing?.lg ?? 16,
  };

  const baseTypography = useMemo(
    () => ({
      title: theme.typography?.sizes?.md ?? 15,
      header: theme.typography?.sizes?.xs ?? 11,
      number: theme.typography?.sizes?.sm ?? 13,
      fontFamily: theme.typography?.fontFamily,
      weight: theme.typography?.weight ?? {},
    }),
    [theme],
  );

  const gridHorizontalPadding = spacing.md;
  const gridVerticalPadding = spacing.sm;
  const columnGap = spacing.sm;
  const rowGap = spacing.md;
  const monthInnerPad = spacing.xs * 0.9;

  const contentWidth = Math.max(0, viewport.width - gridHorizontalPadding * 2);
  const contentHeight = Math.max(0, viewport.height - gridVerticalPadding * 2);
  const monthWidth = Math.max(0, (contentWidth - columnGap * 2) / 3);
  const monthHeight = Math.max(0, (contentHeight - rowGap * 3) / 4);

  const titleLineHeight = Math.max(16, Math.min(baseTypography.title * 1.18, monthHeight * 0.14));
  const dayHeaderFontSizeEstimate = Math.max(
    7,
    Math.min(baseTypography.header * 0.95, monthHeight * 0.055),
  );
  const dayHeaderLineHeight = dayHeaderFontSizeEstimate * 1.15;
  const dayHeaderTopGap = spacing.xs * 0.75;
  const dayHeaderBottomGap = spacing.xs * 0.35;
  const weekGap = spacing.xs * 0.18;

  const dayCellWidthByColumns = (monthWidth - monthInnerPad * 2) / 7;
  const weeksHeightBudget =
    monthHeight -
    titleLineHeight -
    dayHeaderTopGap -
    dayHeaderLineHeight -
    dayHeaderBottomGap -
    weekGap * 5;
  const dayCellWidthByHeight = weeksHeightBudget / 6;
  const dayCellWidth = Math.max(7.8, Math.min(dayCellWidthByColumns, dayCellWidthByHeight));

  const typography = useMemo(() => {
    const header = Math.min(baseTypography.header * 1.15, dayCellWidth * 0.42);
    const number = Math.min(baseTypography.number * 1.1, dayCellWidth * 0.54);
    return {
      title: baseTypography.title * 1.1,
      header,
      number,
      fontFamily: baseTypography.fontFamily,
      weight: baseTypography.weight,
    };
  }, [baseTypography, dayCellWidth]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: theme.colors.card || theme.colors.surface,
          borderRadius: theme.radii?.lg ?? 16,
          marginHorizontal: spacing.xs,
          borderWidth: 1,
          borderColor: theme.colors.border,
          overflow: 'hidden',
        },
        content: {
          flex: 1,
          paddingHorizontal: gridHorizontalPadding,
          paddingVertical: gridVerticalPadding,
          alignItems: 'center',
          justifyContent: 'space-between',
        },
        row: {
          flexDirection: 'row',
          justifyContent: 'flex-start',
          width: monthWidth * 3 + columnGap * 2,
          height: monthHeight,
        },
        monthCard: {
          width: monthWidth,
          height: monthHeight,
          marginRight: columnGap,
          paddingHorizontal: monthInnerPad,
          paddingVertical: spacing.xs * 0.2,
        },
        monthCardLast: {
          marginRight: 0,
        },
        monthTitle: {
          fontFamily: typography.fontFamily,
          fontWeight: typography.weight?.bold ?? '700',
          fontSize: Math.min(typography.title, monthHeight * 0.155),
          color: theme.colors.text,
          textAlign: 'center',
          lineHeight: titleLineHeight,
          includeFontPadding: false,
        },
        monthTitleCurrent: {
          color: theme.colors.primary,
        },
        dayHeaderRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginTop: dayHeaderTopGap,
          marginBottom: dayHeaderBottomGap,
        },
        dayHeader: {
          width: dayCellWidth,
          fontFamily: typography.fontFamily,
          fontWeight: typography.weight?.medium ?? '500',
          fontSize: Math.min(typography.header, dayHeaderFontSizeEstimate),
          lineHeight: dayHeaderLineHeight,
          color: theme.colors.textSecondary,
          textAlign: 'center',
          includeFontPadding: false,
        },
        weeks: {
          flexDirection: 'column',
          rowGap: weekGap,
        },
        weekRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
        },
        dayCell: {
          width: dayCellWidth,
          height: dayCellWidth,
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: spacing.xs * 0.1,
        },
        dayNumber: {
          fontFamily: typography.fontFamily,
          fontWeight: typography.weight?.regular ?? '400',
          fontSize: typography.number,
          lineHeight: Math.max(typography.number * 1.2, typography.number + 1),
          color: theme.colors.text,
          textAlign: 'center',
          includeFontPadding: false,
        },
        dayNumberToday: {
          color: theme.colors.primary,
          fontWeight: typography.weight?.bold ?? typography.weight?.semibold ?? '700',
        },
        emptyDay: {
          width: dayCellWidth,
          height: dayCellWidth,
        },
        eventDot: {
          marginTop: spacing.xs * 0.1,
          width: spacing.xs * 0.5,
          height: spacing.xs * 0.5,
          borderRadius: (spacing.xs * 0.5) / 2,
          backgroundColor: theme.colors.primary,
        },
      }),
    [
      columnGap,
      dayCellWidth,
      dayHeaderBottomGap,
      dayHeaderFontSizeEstimate,
      dayHeaderLineHeight,
      dayHeaderTopGap,
      gridHorizontalPadding,
      gridVerticalPadding,
      monthHeight,
      monthInnerPad,
      monthWidth,
      spacing.xs,
      theme,
      titleLineHeight,
      typography,
      weekGap,
    ],
  );

  const transitionX = useSharedValue(0);
  const transitionOpacity = useSharedValue(1);

  useEffect(() => {
    const startOffset = transitionDirection > 0 ? 24 : transitionDirection < 0 ? -24 : 0;
    transitionX.value = startOffset;
    transitionOpacity.value = startOffset === 0 ? 1 : 0.82;
    transitionX.value = withTiming(0, { duration: 240 });
    transitionOpacity.value = withTiming(1, { duration: 240 });
  }, [transitionDirection, transitionOpacity, transitionX, year]);

  const transitionStyle = useAnimatedStyle(() => ({
    opacity: transitionOpacity.value,
    transform: [{ translateX: transitionX.value }],
  }));

  const onRootLayout = (event) => {
    const { width, height } = event.nativeEvent.layout;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    setViewport((prev) => {
      if (Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1) return prev;
      return { width, height };
    });
  };

  const renderMonth = (monthIndex, isLastInRow = false) => {
    const { weeks } = monthsMatrix[monthIndex];
    const monthDate = new Date(year, monthIndex, 1);
    return (
      <Pressable
        key={monthIndex}
        style={[styles.monthCard, isLastInRow && styles.monthCardLast]}
        onPress={() => onMonthPress?.(monthDate)}
        android_ripple={{ color: theme.colors.ripple }}
        accessibilityRole="button"
        accessibilityLabel={t(MONTH_KEYS[monthIndex])}
      >
        <Text
          style={[styles.monthTitle, monthIndex === activeMonthIndex && styles.monthTitleCurrent]}
        >
          {capitalizeLabel(t(MONTH_KEYS[monthIndex]))}
        </Text>

        <View style={styles.dayHeaderRow}>
          {DAY_KEYS.map((key) => (
            <Text key={key} style={styles.dayHeader}>
              {t(key)}
            </Text>
          ))}
        </View>

        <View style={styles.weeks}>
          {weeks.map((week, wi) => (
            <View key={`w-${wi}`} style={styles.weekRow}>
              {week.map((cell, di) => {
                if (!cell.day) return <View key={`e-${di}`} style={styles.emptyDay} />;
                const dayKey = formatDateKey(cell.date);
                const hasEvent = !!markedDates?.[dayKey]?.marked;
                const today = isToday(cell.date);
                return (
                  <View key={dayKey} style={styles.dayCell}>
                    <Text style={[styles.dayNumber, today && styles.dayNumberToday]}>
                      {cell.day}
                    </Text>
                    {hasEvent && <View style={styles.eventDot} />}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </Pressable>
    );
  };

  return (
    <Animated.View style={[{ flex: 1, width: '100%' }, transitionStyle]} onLayout={onRootLayout}>
      <View style={[styles.container, style]}>
        <View style={styles.content}>
        {monthRows.map((row, rowIdx) => (
          <View key={`row-${rowIdx}`} style={styles.row}>
            {row.map((_, idx) => {
              const monthIndex = rowIdx * 3 + idx;
              return renderMonth(monthIndex, idx === row.length - 1);
            })}
          </View>
        ))}
        </View>
      </View>
    </Animated.View>
  );
}
