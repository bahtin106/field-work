// components/calendar/CalendarMonthHeader.jsx
import { Feather } from '@expo/vector-icons';
import { format } from 'date-fns';
import { ru as dfnsRu } from 'date-fns/locale';
import { Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

function capitalizeLabel(value) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function CalendarMonthHeader({
  monthDate,
  label,
  onPreviousMonth,
  onNextMonth,
  arrowHitSlop,
  headerAnimatedStyle,
  onHeaderLayout,
  styles,
  theme,
}) {
  const monthLabel = label ?? capitalizeLabel(format(monthDate, 'LLLL yyyy', { locale: dfnsRu }));

  return (
    <Animated.View style={[headerAnimatedStyle]}>
      <View style={[styles.monthHeaderRow]} onLayout={onHeaderLayout}>
        <View style={styles.monthHeaderSide}>
          <Pressable
            onPress={onPreviousMonth}
            hitSlop={arrowHitSlop}
            android_ripple={{ color: theme.colors.overlay }}
            style={styles.calendarArrow}
          >
            <Feather name="chevron-left" size={20} color={theme.colors.text} />
          </Pressable>
        </View>
        <View style={styles.monthHeaderCenter}>
          <Text style={styles.monthHeaderLabel} numberOfLines={1} ellipsizeMode="tail">
            {monthLabel}
          </Text>
        </View>
        <View style={styles.monthHeaderSide}>
          <Pressable
            onPress={onNextMonth}
            hitSlop={arrowHitSlop}
            android_ripple={{ color: theme.colors.overlay }}
            style={styles.calendarArrow}
          >
            <Feather name="chevron-right" size={20} color={theme.colors.text} />
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}
