// components/calendar/CalendarWeekRow.jsx
import { memo } from 'react';
import { View } from 'react-native';
import { formatDateKey } from '../../lib/calendarUtils';
import { CalendarGridCell } from './CalendarGridCell';

function CalendarWeekRowComponent({
  week,
  monthDate,
  weekIdx,
  selectedDate,
  todayKey,
  eventCountsByDate,
  dayCellSize,
  onDatePress,
  styles,
  theme,
  indicatorSlotAnimatedStyle,
  eventCountAnimatedStyle,
  eventDotAnimatedStyle,
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
        const isCurrentMonth = cell?.isCurrentMonth !== false;
        const isSelectedDay = isCurrentMonth && dayKey === selectedDate;
        const isToday = dayKey === todayKey;
        const isTodaySelected = isSelectedDay && isToday;
        const showOutline = isSelectedDay && !isToday;
        const highlightTodayWhenNotSelected = false;

        return (
          <CalendarGridCell
            key={`${monthDate.getTime()}-${dayKey}-${selectedDate}`}
            cell={cell}
            dayKey={dayKey}
            eventCount={eventCount}
            isTodaySelected={isTodaySelected}
            showOutline={showOutline}
            highlightTodayWhenNotSelected={highlightTodayWhenNotSelected}
            isCurrentMonth={isCurrentMonth}
            dayCellSize={dayCellSize}
            onDatePress={onDatePress}
            styles={styles}
            theme={theme}
            indicatorSlotAnimatedStyle={indicatorSlotAnimatedStyle}
            eventCountAnimatedStyle={eventCountAnimatedStyle}
            eventDotAnimatedStyle={eventDotAnimatedStyle}
          />
        );
      })}
    </View>
  );
}

export const CalendarWeekRow = memo(CalendarWeekRowComponent);
