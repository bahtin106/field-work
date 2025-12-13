// components/calendar/YearView.jsx
import React, { useMemo } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

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
    months.push({ monthIndex: m, weeks });
  }
  return months;
}

export default function YearView({ year, onMonthPress, markedDates, style, currentMonthIndex }) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const screenWidth = Dimensions.get('window').width;
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

  const baseTypography = {
    title: theme.typography?.sizes?.md ?? 15,
    header: theme.typography?.sizes?.xs ?? 11,
    number: theme.typography?.sizes?.sm ?? 13,
    fontFamily: theme.typography?.fontFamily,
    weight: theme.typography?.weight ?? {},
  };

  const horizontalPadding = spacing.lg;
  const columnGap = spacing.md;
  const availableWidth = Math.max(0, screenWidth - horizontalPadding * 2 - columnGap * 2);
  const monthWidth = availableWidth / 3;
  const innerPad = spacing.sm * 0.45;
  const dayCellWidth = (monthWidth - innerPad * 2) / 7;
  const verticalPadding = spacing.lg;

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
          marginHorizontal: spacing.md,
          borderWidth: 1,
          borderColor: theme.colors.border,
          overflow: 'hidden',
        },
        content: {
          paddingVertical: verticalPadding,
          gap: spacing.lg,
        },
        row: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          paddingHorizontal: horizontalPadding,
        },
        monthCard: {
          width: monthWidth,
          paddingHorizontal: innerPad,
          paddingVertical: spacing.xs,
        },
        monthTitle: {
          fontFamily: typography.fontFamily,
          fontWeight: typography.weight?.bold ?? '700',
          fontSize: typography.title,
          color: theme.colors.text,
          textAlign: 'center',
          lineHeight: typography.title * 1.2,
          includeFontPadding: false,
          numberOfLines: 1,
          ellipsizeMode: 'clip',
        },
        monthTitleCurrent: {
          color: theme.colors.primary,
        },
        dayHeaderRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginTop: spacing.xs * 0.5,
          marginBottom: spacing.xs * 0.5,
        },
        dayHeader: {
          width: dayCellWidth,
          fontFamily: typography.fontFamily,
          fontWeight: typography.weight?.medium ?? '500',
          fontSize: typography.header,
          lineHeight: typography.header * 1.15,
          color: theme.colors.textSecondary,
          textAlign: 'center',
          includeFontPadding: false,
          numberOfLines: 1,
          ellipsizeMode: 'clip',
          adjustsFontSizeToFit: true,
          minimumFontScale: 0.75,
        },
        weeks: {
          flexDirection: 'column',
          gap: spacing.xs * 0.35,
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
          numberOfLines: 1,
          ellipsizeMode: 'clip',
          adjustsFontSizeToFit: true,
          minimumFontScale: 0.75,
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
    [theme, typography, spacing, monthWidth, dayCellWidth, horizontalPadding, innerPad],
  );

  const renderMonth = (monthIndex) => {
    const { weeks } = monthsMatrix[monthIndex];
    const monthDate = new Date(year, monthIndex, 1);
    return (
      <Pressable
        key={monthIndex}
        style={styles.monthCard}
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
    <ScrollView style={[styles.container, style]} contentContainerStyle={styles.content}>
      {monthRows.map((row, rowIdx) => (
        <View key={`row-${rowIdx}`} style={styles.row}>
          {row.map((_, idx) => {
            const monthIndex = rowIdx * 3 + idx;
            return renderMonth(monthIndex);
          })}
        </View>
      ))}
    </ScrollView>
  );
}
