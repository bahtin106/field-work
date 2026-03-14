import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { listItemStyles } from './listItemStyles';

const EMPTY_PLACEHOLDER_VALUES = new Set(['-', '–', '—']);

function normalizeDisplayValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function isEmptyDisplayValue(value) {
  const normalized = normalizeDisplayValue(value).trim();
  if (!normalized) return true;
  return EMPTY_PLACEHOLDER_VALUES.has(normalized);
}

function mergeComponentStyle(existingStyle, nextStyle) {
  if (typeof existingStyle === 'function') {
    return (...args) => [existingStyle(...args), nextStyle];
  }
  return existingStyle ? [existingStyle, nextStyle] : nextStyle;
}

const styles = {
  customValueWrap: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '100%',
    alignItems: 'flex-end',
  },
  customValueComponent: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '100%',
    alignSelf: 'flex-end',
  },
};

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
  labelContainerStyle,
  middleSpacerStyle,
  rightWrapStyle,
  fullRow = false,
  hideWhenEmpty = true,
}) {
  const { theme } = useTheme();
  const base = useMemo(() => listItemStyles(theme), [theme]);
  const hasCustomValue = valueComponent !== null && valueComponent !== undefined && valueComponent !== false;
  const shouldHide = hideWhenEmpty && !hasCustomValue && isEmptyDisplayValue(value);

  const renderLabel = () => {
    if (typeof label === 'string') {
      return <Text style={base.label}>{label}</Text>;
    }
    return label;
  };

  const renderValue = () => {
    if (valueComponent) {
      if (!React.isValidElement(valueComponent)) {
        return <View style={styles.customValueWrap}>{valueComponent}</View>;
      }

      const nextProps = {
        style: mergeComponentStyle(valueComponent.props?.style, styles.customValueComponent),
      };

      if (valueComponent.type === Text) {
        if (valueComponent.props?.numberOfLines == null) {
          nextProps.numberOfLines = maxValueLines;
        }
        if (valueComponent.props?.ellipsizeMode == null) {
          nextProps.ellipsizeMode = 'tail';
        }
      }

      return <View style={styles.customValueWrap}>{React.cloneElement(valueComponent, nextProps)}</View>;
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

  if (fullRow) {
    if (shouldHide) return null;
    return (
      <View style={[{ flexDirection: 'column', paddingVertical: 2 }, style]}>
        <View>{renderLabel()}</View>
        <View style={{ marginTop: 6 }}>{renderValue()}</View>
      </View>
    );
  }

  if (shouldHide) return null;

  return (
    <View style={[base.row, style]}>
      <View style={[{ flexShrink: 1, minWidth: 0 }, labelContainerStyle]}>
        {renderLabel()}
      </View>

      <View style={[base.middleSpacer, middleSpacerStyle]} />

      <View style={[base.rightWrap, { flex: 1, paddingRight: 0 }, rightWrapStyle]}>
        <View style={base.valueWrapper}>
          {renderValue()}
        </View>
        {rightActions && (
          <View style={{ marginLeft: 4 }}>
            {rightActions}
          </View>
        )}
      </View>
    </View>
  );
}
