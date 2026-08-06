import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { listItemStyles } from './listItemStyles';

const resolveSpacing = (value, fallback, theme) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'number') return value;
  return theme.spacing?.[value] ?? fallback;
};

export default function SectionHeader({
  children,
  containerStyle,
  style,
  accessory,
  ...rest
}) {
  const { theme } = useTheme();
  const base = useMemo(() => listItemStyles(theme), [theme]);
  // Vertical rhythm is owned exclusively by the theme.
  const marginTop = resolveSpacing(
    theme.components?.sectionHeader?.top,
    theme.spacing.md,
    theme,
  );
  const marginBottom = resolveSpacing(
    theme.components?.sectionHeader?.bottom,
    theme.spacing.xs,
    theme,
  );
  return (
    <View style={[{ marginTop, marginBottom }, accessory ? { flexDirection: 'row', alignItems: 'center' } : null, containerStyle]}>
      <Text
        style={[base.sectionTitle, { marginTop: 0, marginBottom: 0 }, accessory ? { flexShrink: 1 } : null, style]}
        {...rest}
      >
        {children}
      </Text>
      {accessory ? <View style={{ marginLeft: theme.spacing?.xs ?? 4 }}>{accessory}</View> : null}
    </View>
  );
}
