import { Feather } from '@expo/vector-icons';
import { memo, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '../../theme/ThemeProvider';
import { listItemStyles } from './listItemStyles';

function ExpandableTextRowComponent({ label, value, initiallyExpanded = false }) {
  const { theme } = useTheme();
  const base = useMemo(() => listItemStyles(theme), [theme]);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const normalizedValue = useMemo(() => String(value ?? '').trim(), [value]);
  const [expanded, setExpanded] = useState(Boolean(initiallyExpanded));
  const panelToggleMs =
    theme._raw?.timings?.panelToggleMs ?? theme.timings?.panelToggleMs ?? theme.components?.listItem?.height;
  const progress = useSharedValue(initiallyExpanded ? 1 : 0);
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.value * 180}deg` }],
  }));
  if (!normalizedValue) return null;

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    progress.value = withTiming(next ? 1 : 0, { duration: panelToggleMs });
  };

  return (
    <View>
      <Pressable
        style={base.row}
        onPress={toggleExpanded}
        hitSlop={theme.components?.interactive?.hitSlop}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <Text style={base.label}>{label}</Text>
        <View style={styles.rightWrap}>
          {!expanded ? (
            <Text style={[base.value, styles.collapsedValue]} numberOfLines={1} ellipsizeMode="tail">
              {normalizedValue}
            </Text>
          ) : null}
          <Animated.View style={[styles.chevronWrap, chevronStyle]}>
            <Feather
              name="chevron-down"
              size={theme.components?.listItem?.chevronSize ?? theme.icons?.md}
              color={theme.colors.textSecondary}
            />
          </Animated.View>
        </View>
      </Pressable>

      {expanded ? (
        <Animated.View
          entering={FadeIn.duration(panelToggleMs)}
          exiting={FadeOut.duration(panelToggleMs)}
          style={styles.expandedWrap}
        >
          <Text style={styles.expandedValue}>{normalizedValue}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    rightWrap: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      marginLeft: theme.components?.listItem?.labelValueGap ?? theme.spacing.lg,
      paddingRight: theme.spacing.xs,
    },
    collapsedValue: {
      flex: 1,
      minWidth: 0,
    },
    chevronWrap: {
      marginLeft: theme.components?.listItem?.chevronGap ?? theme.spacing.sm,
    },
    expandedWrap: {
      paddingLeft: theme.spacing.xs,
      paddingRight: theme.spacing.xs,
      paddingBottom: theme.spacing.xs,
    },
    expandedValue: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.regular,
      lineHeight:
        theme.typography.sizes.sm *
        (theme._raw?.typography?.lineHeights?.normal ?? theme.typography?.lineHeights?.normal ?? 1),
      textAlign: 'left',
    },
  });
}

const ExpandableTextRow = memo(ExpandableTextRowComponent);

export default ExpandableTextRow;
