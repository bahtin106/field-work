// components/calendar/CalendarGridCell.jsx
import { memo, useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

const OUTSIDE_MONTH_TEXT_OPACITY = 0.45;
const OUTSIDE_MONTH_META_TEXT_OPACITY = 0.55;
const OUTSIDE_MONTH_META_DOT_OPACITY = 0.45;
const EVENT_META_MIN_WIDTH_RATIO = 0.5;
const EVENT_META_HORIZONTAL_INSET = 4;

function CalendarGridCellComponent({
  cell,
  dayKey,
  eventCount,
  isTodaySelected,
  showOutline,
  highlightTodayWhenNotSelected,
  isCurrentMonth,
  dayCellSize,
  onDatePress,
  styles,
  theme,
  indicatorSlotAnimatedStyle,
  eventCountAnimatedStyle,
  eventDotAnimatedStyle,
}) {
  const handlePress = useCallback(() => {
    onDatePress(dayKey);
  }, [dayKey, onDatePress]);

  if (!cell.day) {
    return <View style={[styles.dayCell, { width: dayCellSize, height: dayCellSize }]} />;
  }

  const isOutsideMonth = !isCurrentMonth;
  const outsideMonthTextStyle = isOutsideMonth
    ? { color: theme.colors.textSecondary, opacity: OUTSIDE_MONTH_TEXT_OPACITY }
    : null;
  const outsideMonthMetaTextStyle = isOutsideMonth
    ? { color: theme.colors.textSecondary, opacity: OUTSIDE_MONTH_META_TEXT_OPACITY }
    : null;
  const outsideMonthMetaDotStyle = isOutsideMonth
    ? { backgroundColor: theme.colors.textSecondary, opacity: OUTSIDE_MONTH_META_DOT_OPACITY }
    : null;

  return (
    <Pressable
      key={dayKey}
      onPress={handlePress}
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
            !isCurrentMonth && styles.dayNumberMuted,
            outsideMonthTextStyle,
          ]}
        >
          {cell.day}
        </Text>
        <Animated.View style={[styles.dayIndicatorSlot, indicatorSlotAnimatedStyle]}>
          {eventCount > 0 ? (
            <View
              style={{
                minWidth: dayCellSize * EVENT_META_MIN_WIDTH_RATIO,
                maxWidth: Math.max(0, dayCellSize - EVENT_META_HORIZONTAL_INSET * 2),
                paddingHorizontal: EVENT_META_HORIZONTAL_INSET,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Animated.View style={[{ position: 'absolute' }, eventCountAnimatedStyle]}>
                <Text style={[styles.eventCount, outsideMonthMetaTextStyle]} numberOfLines={1}>
                  {eventCount}
                </Text>
              </Animated.View>
              <Animated.View style={eventDotAnimatedStyle}>
                <View style={[styles.eventDot, outsideMonthMetaDotStyle]} />
              </Animated.View>
            </View>
          ) : null}
        </Animated.View>
      </View>
    </Pressable>
  );
}

export const CalendarGridCell = memo(CalendarGridCellComponent);
