import { memo, useCallback, useMemo, useState } from 'react';
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
  onValueLongPress = null,
  rowPressDisabled = false,
  valuePressOnly = false,
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
  const [textOverflows, setTextOverflows] = useState(false);
  const [valuePressed, setValuePressed] = useState(false);
  const measurementValue = normalizedValue || normalizedCollapsedValue;
  const hasControlledExpansion = typeof onChevronPress === 'function';
  const canExpand = hasControlledExpansion || textOverflows;
  const panelToggleMs =
    theme._raw?.timings?.panelToggleMs ?? theme.timings?.panelToggleMs ?? theme.components?.listItem?.height;
  const chevronHitSlop = useMemo(
    () => ({
      top: 4,
      right: Math.max(theme.components?.interactive?.hitSlop?.right ?? 10, 14),
      bottom: 4,
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
  const showExpandedAction = canExpand && expanded && !!normalizedExpandedActionText && typeof onValuePress === 'function';
  const showCollapsedValue = !canExpand || !expanded;
  const valueLongPress = onValueLongPress || onCollapsedLongPress;

  const handleMeasurementTextLayout = useCallback((event) => {
    const nextOverflows = (event?.nativeEvent?.lines?.length ?? 0) > 1;
    setTextOverflows((current) => (current === nextOverflows ? current : nextOverflows));
    if (!nextOverflows) setExpanded(false);
  }, []);
  if (!forceShow && !normalizedValue && !hasExpandedItems) return null;
  const toggleExpanded = () => {
    if (!canExpand) return;
    setExpanded((current) => !current);
  };
  const handleRowPress = () => {
    if (showCollapsedValue && typeof onCollapsedPress === 'function') {
      onCollapsedPress();
      return;
    }
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
  const hasRowPress = typeof onValuePress === 'function' || (
    showCollapsedValue && typeof onCollapsedPress === 'function'
  );

  const rowOnPress = rowPressDisabled || (toggleOnChevronOnly && expanded) || (
    valuePressOnly || (!hasRowPress && (toggleOnChevronOnly || !canExpand))
  )
    ? undefined
    : handleRowPress;
  const rowOnLongPress = !rowPressDisabled && !valuePressOnly && showCollapsedValue && typeof valueLongPress === 'function'
    ? valueLongPress
    : undefined;
  const showValuePressFeedback = showCollapsedValue && !!(rowOnPress || rowOnLongPress);
  const valueOnlyOnPress = valuePressOnly && showCollapsedValue && hasRowPress
    ? handleRowPress
    : undefined;
  const valueOnlyOnLongPress =
    valuePressOnly && showCollapsedValue && typeof valueLongPress === 'function'
      ? valueLongPress
      : undefined;
  const collapsedContent = (
    <Text
      style={[base.value, styles.collapsedValue, collapsedValueStyle]}
      numberOfLines={1}
      ellipsizeMode="tail"
    >
      {normalizedCollapsedValue}
    </Text>
  );
  const expandedContent = hasExpandedItems ? (
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
  );

  return (
    <View>
      <Pressable
        style={base.row}
        pointerEvents={valuePressOnly ? 'box-none' : 'auto'}
        onPress={rowOnPress}
        onLongPress={rowOnLongPress}
        onPressIn={showValuePressFeedback ? () => setValuePressed(true) : undefined}
        onPressOut={showValuePressFeedback ? () => setValuePressed(false) : undefined}
        delayLongPress={450}
        accessibilityRole={rowOnPress || rowOnLongPress ? 'button' : undefined}
        accessibilityState={canExpand ? { expanded } : undefined}
      >
        <Text style={[base.label, expanded && expandedLabelBold ? styles.expandedLabel : null]}>
          {label}
        </Text>
        <View style={base.middleSpacer} />
        <View style={styles.rightWrap}>
          {showCollapsedValue ? (
            valueOnlyOnPress || valueOnlyOnLongPress ? (
              <Pressable
                style={({ pressed }) => [
                  styles.valueWrap,
                  styles.inlineValuePressable,
                  pressed ? styles.inlineValuePressablePressed : null,
                ]}
                onPress={valueOnlyOnPress}
                onLongPress={valueOnlyOnLongPress}
                delayLongPress={450}
                accessibilityRole="link"
              >
                {collapsedContent}
              </Pressable>
            ) : (
              <View style={[styles.valueWrap, valuePressed ? styles.inlineValuePressablePressed : null]}>
                {collapsedContent}
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
          {!hasControlledExpansion && measurementValue ? (
            <Text
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[base.value, styles.measurementText, collapsedValueStyle]}
              onTextLayout={handleMeasurementTextLayout}
            >
              {measurementValue}
            </Text>
          ) : null}
          {canExpand ? (
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
          ) : null}
        </View>
      </Pressable>

      {canExpand && expanded ? (
        <Animated.View
          entering={FadeIn.duration(panelToggleMs)}
          exiting={FadeOut.duration(panelToggleMs)}
          style={styles.expandedWrap}
        >
          {typeof valueLongPress === 'function' ? (
            <Pressable
              onLongPress={valueLongPress}
              delayLongPress={450}
              style={({ pressed }) => (pressed ? styles.expandedValuePressed : null)}
            >
              {expandedContent}
            </Pressable>
          ) : expandedContent}
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
      flex: 1,
      flexShrink: 1,
      minWidth: 0,
      paddingRight: theme.spacing.xs,
      position: 'relative',
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
      transform: [{ scale: 0.99 }],
    },
    collapsedValue: {
      flexShrink: 1,
      minWidth: 0,
      alignSelf: 'center',
    },
    measurementText: {
      position: 'absolute',
      left: 0,
      right: 0,
      opacity: 0,
      textAlign: 'right',
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
      paddingLeft: theme.spacing.md,
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
    expandedValuePressed: {
      opacity: 0.6,
      transform: [{ scale: 0.99 }],
    },
    expandedKey: {
      fontWeight: theme.typography.weight.semibold,
      color: theme.colors.text,
    },
  });
}

const ExpandableTextRow = memo(ExpandableTextRowComponent);

export default ExpandableTextRow;
