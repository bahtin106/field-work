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

function areEqual(prev, next) {
  return (
    prev.week === next.week &&
    prev.monthDate?.getTime?.() === next.monthDate?.getTime?.() &&
    prev.weekIdx === next.weekIdx &&
    prev.selectedDate === next.selectedDate &&
    prev.todayKey === next.todayKey &&
    prev.eventCountsByDate === next.eventCountsByDate &&
    prev.dayCellSize === next.dayCellSize &&
    prev.onDatePress === next.onDatePress &&
    prev.styles === next.styles &&
    prev.theme === next.theme &&
    prev.indicatorSlotAnimatedStyle === next.indicatorSlotAnimatedStyle &&
    prev.eventCountAnimatedStyle === next.eventCountAnimatedStyle &&
    prev.eventDotAnimatedStyle === next.eventDotAnimatedStyle &&
    prev.onRowLayout === next.onRowLayout
  );
}

export const CalendarWeekRow = memo(CalendarWeekRowComponent, areEqual);
