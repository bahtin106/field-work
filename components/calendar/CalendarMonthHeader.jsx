// components/calendar/CalendarMonthHeader.jsx
import React from 'react';
import { Feather } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { format } from 'date-fns';
import { ru as dfnsRu } from 'date-fns/locale';

function capitalizeLabel(value) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function CalendarMonthHeader({
  monthDate,
  onPreviousMonth,
  onNextMonth,
  arrowHitSlop,
  headerAnimatedStyle,
  styles,
  theme,
}) {
  return (
    <Animated.View style={[headerAnimatedStyle]}>
      <View style={[styles.monthHeaderRow]}>
        <Pressable
          onPress={onPreviousMonth}
          hitSlop={arrowHitSlop}
          android_ripple={{ color: theme.colors.overlay }}
          style={styles.calendarArrow}
        >
          <Feather name="chevron-left" size={20} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.monthHeaderLabel} numberOfLines={1} ellipsizeMode="tail">
          {capitalizeLabel(format(monthDate, 'LLLL yyyy', { locale: dfnsRu }))}
        </Text>
        <Pressable
          onPress={onNextMonth}
          hitSlop={arrowHitSlop}
          android_ripple={{ color: theme.colors.overlay }}
          style={styles.calendarArrow}
        >
          <Feather name="chevron-right" size={20} color={theme.colors.text} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

export { CalendarMonthHeader };
