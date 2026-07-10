// components/calendar/CalendarMonthHeader.jsx
import { Feather } from '@expo/vector-icons';
import { format } from 'date-fns';
import { Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { resolveDateFnsLocale } from '../../lib/localeFormatting';

function capitalizeLabel(value) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function CalendarMonthHeader({
  monthDate,
  label,
  dateLocale = resolveDateFnsLocale(),
  onPreviousMonth,
  onNextMonth,
  arrowHitSlop,
  headerAnimatedStyle,
  styles,
  theme,
}) {
  const monthLabel = label ?? capitalizeLabel(format(monthDate, 'LLLL yyyy', { locale: dateLocale }));
  const arrowIconSize = theme.icons?.md ?? theme.typography.sizes.md + theme.spacing.xs;

  return (
    <Animated.View style={[headerAnimatedStyle]}>
      <View style={[styles.monthHeaderRow]}>
        <View style={styles.monthHeaderSide}>
          <Pressable
            onPress={onPreviousMonth}
            hitSlop={arrowHitSlop}
            android_ripple={{ color: theme.colors.overlay }}
            style={styles.calendarArrow}
          >
            <Feather name="chevron-left" size={arrowIconSize} color={theme.colors.text} />
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
            <Feather name="chevron-right" size={arrowIconSize} color={theme.colors.text} />
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}
