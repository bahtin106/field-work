import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { listItemStyles } from './listItemStyles';

/**
 * Universal label/value row component.
 * 
 * Algorithm:
 * 1. Label is always fully visible on the left (flexShrink: 0)
 * 2. Value is right-aligned with standard right padding
 * 3. If value is short - it stays on same line as label, aligned right
 * 4. If value is long and would get too close to label - wraps to multiple lines (max 3)
 * 5. If still doesn't fit in 3 lines - shows ellipsis at end of 3rd line
 * 6. If copy button present - value shifts left to accommodate it
 * 
 * Props:
 * - label: string|node — left label (always fully displayed)
 * - value: string — simple text value
 * - valueComponent: node — custom component for value (e.g., Pressable with link)
 * - rightActions: node — actions on far right (copy buttons, etc)
 * - maxValueLines: number — max lines for value (default 3)
 * - style: additional styles for container
 */
export default function LabelValueRow({
  label,
  value,
  valueComponent,
  rightActions,
  maxValueLines = 3,
  style,
}) {
  const theme = (require('../../theme')?.useTheme?.() || {}).theme || {};
  const base = useMemo(() => listItemStyles(theme), [theme]);

  const renderLabel = () => {
    if (typeof label === 'string') {
      return <Text style={base.label}>{label}</Text>;
    }
    return label;
  };

  const renderValue = () => {
    if (valueComponent) {
      return valueComponent;
    }
    return (
      <Text
        style={base.value}
        numberOfLines={maxValueLines}
        ellipsizeMode="tail"
      >
        {value}
      </Text>
    );
  };

  return (
    <View style={[base.row, style]}>
      {/* Label: always full width, never truncated */}
      <View style={{ flexShrink: 0 }}>
        {renderLabel()}
      </View>

      {/* Spacer: fills available space between label and value */}
      <View style={{ flex: 1, minWidth: 8 }} />

      {/* Right side: value + optional actions */}
      <View style={base.rightWrap}>
        <View style={base.valueWrapper}>
          {renderValue()}
        </View>
        
        {rightActions && (
          <View style={{ marginLeft: theme.spacing?.xs || 8 }}>
            {rightActions}
          </View>
        )}
      </View>
    </View>
  );
}
