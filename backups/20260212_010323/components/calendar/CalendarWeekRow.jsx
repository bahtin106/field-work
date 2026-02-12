// components/calendar/CalendarWeekRow.jsx
import React from 'react';
import { View } from 'react-native';
import { formatDateKey } from '../../lib/calendarUtils';
import { CalendarGridCell } from './CalendarGridCell';

export function CalendarWeekRow({
  week,
  monthDate,
  weekIdx,
  selectedDate,
  todayKey,
  eventCountsByDate,
  isCollapsed,
  dayCellSize,
  onDatePress,
  styles,
  theme,
  indicatorSlotAnimatedStyle,
  onRowLayout,
}) {
  return (
    <View key={`w-${monthDate.getTime()}-${weekIdx}`} style={styles.weekRow} onLayout={onRowLayout}>
      {week.map((cell, cellIdx) => {
        if (!cell.day) {
          return (
            <View
              key={`empty-${monthDate.getTime()}-${weekIdx}-${cellIdx}`}
              style={[styles.dayCell, { width: dayCellSize, height: dayCellSize }]}
            />
          );
        }

        const dayKey = formatDateKey(cell.date);
        const eventCount = eventCountsByDate?.[dayKey] || 0;
        const isSelectedDay = dayKey === selectedDate;
        const isToday = dayKey === todayKey;
        const isTodaySelected = isSelectedDay && isToday;
        const showOutline = isSelectedDay && !isToday;
        const highlightTodayWhenNotSelected = isToday && selectedDate !== todayKey;
        const isCurrentMonth = cell?.isCurrentMonth !== false;

        return (
          <CalendarGridCell
            key={`${monthDate.getTime()}-${dayKey}`}
            cell={cell}
            dayKey={dayKey}
            eventCount={eventCount}
            isSelectedDay={isSelectedDay}
            isToday={isToday}
            isTodaySelected={isTodaySelected}
            showOutline={showOutline}
            highlightTodayWhenNotSelected={highlightTodayWhenNotSelected}
            isCurrentMonth={isCurrentMonth}
            showCounts={!isCollapsed}
            dayCellSize={dayCellSize}
            onPress={() => onDatePress(dayKey)}
            styles={styles}
            theme={theme}
            indicatorSlotAnimatedStyle={indicatorSlotAnimatedStyle}
          />
        );
      })}
    </View>
  );
}
