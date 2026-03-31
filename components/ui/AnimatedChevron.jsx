import { Feather } from '@expo/vector-icons';
import { useEffect, useMemo } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useTheme } from '../../theme/ThemeProvider';

function resolveRotateDeg(iconName) {
  if (iconName === 'chevron-right') return 90;
  if (iconName === 'chevron-left') return -90;
  return 180;
}

export default function AnimatedChevron({
  expanded = false,
  iconName = 'chevron-down',
  size = null,
  color = null,
  duration = null,
  style = null,
}) {
  const { theme } = useTheme();
  const progress = useSharedValue(expanded ? 1 : 0);

  const resolvedDuration =
    duration ??
    theme._raw?.timings?.panelToggleMs ??
    theme.timings?.panelToggleMs ??
    theme.components?.listItem?.height ??
    220;
  const rotateDeg = useMemo(() => resolveRotateDeg(iconName), [iconName]);

  useEffect(() => {
    progress.value = withTiming(expanded ? 1 : 0, { duration: resolvedDuration });
  }, [expanded, progress, resolvedDuration]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.value * rotateDeg}deg` }],
  }));

  return (
    <Animated.View style={[animatedStyle, style]}>
      <Feather
        name={iconName}
        size={size ?? theme.components?.listItem?.chevronSize ?? theme.icons?.md ?? 18}
        color={color ?? theme.colors.textSecondary}
      />
    </Animated.View>
  );
}
