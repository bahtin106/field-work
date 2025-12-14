// components/calendar/CalendarGridCell.jsx
import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

export function CalendarGridCell({
  cell,
  dayKey,
  eventCount,
  isSelectedDay,
  isToday,
  isTodaySelected,
  showOutline,
  highlightTodayWhenNotSelected,
  showCounts,
  dayCellSize,
  onPress,
  styles,
  theme,
  indicatorSlotAnimatedStyle,
}) {
  if (!cell.day) {
    return <View style={[styles.dayCell, { width: dayCellSize, height: dayCellSize }]} />;
  }

  return (
    <Pressable
      key={dayKey}
      onPress={onPress}
      delayPressIn={0}
      delayLongPress={200}
      android_ripple={{ color: theme.colors.overlay }}
      style={[
        styles.dayCell,
        { width: dayCellSize, height: dayCellSize },
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
        <Animated.View style={[styles.dayIndicatorSlot, indicatorSlotAnimatedStyle]}>
          {eventCount > 0 ? (
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
}
