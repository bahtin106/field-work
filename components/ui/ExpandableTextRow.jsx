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

function ExpandableTextRowComponent({
  label,
  value,
  initiallyExpanded = false,
  collapsedValue = null,
  onValuePress = null,
  expandedActionText = null,
  toggleOnChevronOnly = false,
  collapsedValueStyle = null,
  expandedValueStyle = null,
  expandedLabelBold = false,
  expandedKeyValueItems = null,
}) {
  const { theme } = useTheme();
  const base = useMemo(() => listItemStyles(theme), [theme]);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const normalizedValue = useMemo(() => String(value ?? '').trim(), [value]);
  const normalizedCollapsedValue = useMemo(
    () => String(collapsedValue ?? normalizedValue ?? '').trim(),
    [collapsedValue, normalizedValue],
  );
  const [expanded, setExpanded] = useState(Boolean(initiallyExpanded));
  const panelToggleMs =
    theme._raw?.timings?.panelToggleMs ?? theme.timings?.panelToggleMs ?? theme.components?.listItem?.height;
  const progress = useSharedValue(initiallyExpanded ? 1 : 0);
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.value * 180}deg` }],
  }));
  const chevronHitSlop = useMemo(
    () => ({
      top: Math.max(theme.components?.interactive?.hitSlop?.top ?? 10, 14),
      right: Math.max(theme.components?.interactive?.hitSlop?.right ?? 10, 14),
      bottom: Math.max(theme.components?.interactive?.hitSlop?.bottom ?? 10, 14),
      left: Math.max(theme.components?.interactive?.hitSlop?.left ?? 10, 14),
    }),
    [theme],
  );
  const normalizedExpandedActionText = useMemo(
    () => String(expandedActionText ?? '').trim(),
    [expandedActionText],
  );
  const hasExpandedItems = Array.isArray(expandedKeyValueItems) && expandedKeyValueItems.length > 0;
  const showExpandedAction = expanded && !!normalizedExpandedActionText && typeof onValuePress === 'function';
  const showCollapsedValue = !expanded;
  if (!normalizedValue && !hasExpandedItems) return null;

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    progress.value = withTiming(next ? 1 : 0, { duration: panelToggleMs });
  };
  const handleRowPress = () => {
    if (toggleOnChevronOnly) {
      if (!expanded) onValuePress?.();
      return;
    }
    if (typeof onValuePress === 'function') {
      onValuePress();
      return;
    }
    toggleExpanded();
  };

  return (
    <View>
      <Pressable
        style={base.row}
        onPress={toggleOnChevronOnly && expanded ? undefined : handleRowPress}
        hitSlop={theme.components?.interactive?.hitSlop}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <Text style={[base.label, expanded && expandedLabelBold ? styles.expandedLabel : null]}>
          {label}
        </Text>
        <View style={styles.rightWrap}>
          {showCollapsedValue ? (
            <Text
              style={[base.value, styles.collapsedValue, collapsedValueStyle]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {normalizedCollapsedValue}
            </Text>
          ) : null}
          {showExpandedAction ? (
            <Text
              onPress={onValuePress}
              style={[base.value, styles.collapsedValue, collapsedValueStyle]}
            >
              {normalizedExpandedActionText}
            </Text>
          ) : null}
          <Pressable
            onPress={toggleExpanded}
            hitSlop={chevronHitSlop}
            style={styles.chevronPressable}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
          >
            <Animated.View style={[styles.chevronWrap, chevronStyle]}>
              <Feather
                name="chevron-down"
                size={theme.components?.listItem?.chevronSize ?? theme.icons?.md}
                color={theme.colors.textSecondary}
              />
            </Animated.View>
          </Pressable>
        </View>
      </Pressable>

      {expanded ? (
        <Animated.View
          entering={FadeIn.duration(panelToggleMs)}
          exiting={FadeOut.duration(panelToggleMs)}
          style={styles.expandedWrap}
        >
          {hasExpandedItems ? (
            <View style={styles.expandedList}>
              {expandedKeyValueItems.map((item, index) => {
                const key = `${item?.label || 'label'}-${index}`;
                return (
                  <Text key={key} style={[styles.expandedValue, expandedValueStyle]}>
                    <Text style={styles.expandedKey}>{String(item?.label || '').trim()}: </Text>
                    {String(item?.value || '').trim()}
                  </Text>
                );
              })}
            </View>
          ) : (
            <Text style={[styles.expandedValue, expandedValueStyle]}>{normalizedValue}</Text>
          )}
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
    chevronPressable: {
      borderRadius: theme.radii.sm,
      minWidth: 36,
      minHeight: 36,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.xs,
      marginRight: -theme.spacing.xs,
    },
    expandedWrap: {
      paddingLeft: theme.spacing.xs,
      paddingRight: theme.spacing.xs,
      paddingBottom: theme.spacing.xs,
    },
    expandedLabel: {
      fontWeight: theme.typography.weight.semibold,
      color: theme.colors.text,
    },
    expandedList: {
      gap: theme.spacing.xs,
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
    expandedKey: {
      fontWeight: theme.typography.weight.semibold,
      color: theme.colors.text,
    },
  });
}

const ExpandableTextRow = memo(ExpandableTextRowComponent);

export default ExpandableTextRow;
