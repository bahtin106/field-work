import { memo, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';

import { useTheme } from '../../theme/ThemeProvider';
import { listItemStyles } from './listItemStyles';
import AnimatedChevron from './AnimatedChevron';

function ExpandableTextRowComponent({
  label,
  value,
  initiallyExpanded = false,
  collapsedValue = null,
  onValuePress = null,
  expandedActionText = null,
  toggleOnChevronOnly = true,
  collapsedValueStyle = null,
  expandedValueStyle = null,
  expandedLabelBold = false,
  expandedKeyValueItems = null,
  onCollapsedPress = null,
  onCollapsedLongPress = null,
  rowPressDisabled = false,
  // new optional props
  chevronName = 'chevron-down',
  onChevronPress = null,
  // show row even if value is empty
  forceShow = false,
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
  const chevronHitSlop = useMemo(
    () => ({
      top: Math.max(theme.components?.interactive?.hitSlop?.top ?? 10, 14),
      right: Math.max(theme.components?.interactive?.hitSlop?.right ?? 10, 14),
      bottom: Math.max(theme.components?.interactive?.hitSlop?.bottom ?? 10, 14),
      // keep left hitSlop small to avoid overlapping neighboring action (e.g., "Карта")
      left: Math.min(Math.max(theme.components?.interactive?.hitSlop?.left ?? 6, 6), 8),
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
  if (!forceShow && !normalizedValue && !hasExpandedItems) return null;

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
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
        onPress={rowPressDisabled ? undefined : toggleOnChevronOnly && expanded ? undefined : handleRowPress}
        hitSlop={theme.components?.interactive?.hitSlop}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <Text style={[base.label, expanded && expandedLabelBold ? styles.expandedLabel : null]}>
          {label}
        </Text>
        <View style={base.middleSpacer} />
        <View style={styles.rightWrap}>
          {showCollapsedValue ? (
            onCollapsedPress || onCollapsedLongPress ? (
              <View style={styles.valueWrap}>
                <Pressable
                  style={({ pressed }) => [styles.inlineValuePressable, pressed ? styles.inlineValuePressablePressed : null]}
                  onPress={onCollapsedPress}
                  onLongPress={onCollapsedLongPress}
                  hitSlop={theme.components?.interactive?.hitSlop}
                >
                  <Text
                    style={[base.value, styles.collapsedValue, collapsedValueStyle]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {normalizedCollapsedValue}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.valueWrap}>
                <Text
                  style={[base.value, styles.collapsedValue, collapsedValueStyle]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {normalizedCollapsedValue}
                </Text>
              </View>
            )
          ) : null}
          {showExpandedAction ? (
            <View style={styles.valueWrap}>
              <Pressable
                style={({ pressed }) => [styles.inlineValuePressable, pressed ? styles.inlineValuePressablePressed : null]}
                onPress={onValuePress}
                hitSlop={theme.components?.interactive?.hitSlop}
              >
                <Text style={[base.value, styles.collapsedValue, collapsedValueStyle]}>
                  {normalizedExpandedActionText}
                </Text>
              </Pressable>
            </View>
          ) : null}
          <Pressable
            onPress={() => {
              if (typeof onChevronPress === 'function') return onChevronPress();
              return toggleExpanded();
            }}
            hitSlop={chevronHitSlop}
            style={styles.chevronPressable}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
          >
            <AnimatedChevron
              expanded={expanded}
              iconName={chevronName}
              duration={panelToggleMs}
              style={styles.chevronWrap}
            />
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
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      flexShrink: 1,
      minWidth: 0,
      paddingRight: theme.spacing.xs,
    },
    valueWrap: {
      flexShrink: 1,
      minWidth: 0,
    },
    inlineValuePressable: {
      borderRadius: theme.radii.xs,
    },
    inlineValuePressablePressed: {
      opacity: 0.6,
    },
    collapsedValue: {
      flexShrink: 1,
      minWidth: 0,
      alignSelf: 'center',
    },
    chevronWrap: {
      marginLeft: theme.components?.listItem?.chevronGap ?? theme.spacing.sm,
      alignSelf: 'center',
    },
    chevronPressable: {
      borderRadius: theme.radii.sm,
      minWidth: 36,
      minHeight: 36,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
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
