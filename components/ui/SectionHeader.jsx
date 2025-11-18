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
  topSpacing,
  bottomSpacing,
  containerStyle,
  style,
  ...rest
}) {
  const { theme } = useTheme();
  const base = useMemo(() => listItemStyles(theme), [theme]);
  // Дефолты из темы: components.sectionHeader.top/bottom, с фолбэком на sectionTitle.mt/mb, затем xs
  const defTopKey =
    theme.components?.sectionHeader?.top ?? theme.components?.sectionTitle?.mt ?? 'xs';
  const defBottomKey =
    theme.components?.sectionHeader?.bottom ?? theme.components?.sectionTitle?.mb ?? 'xs';
  const marginTop = resolveSpacing(topSpacing ?? defTopKey, theme.spacing.xs, theme);
  const marginBottom = resolveSpacing(bottomSpacing ?? defBottomKey, theme.spacing.xs, theme);
  return (
    <View style={[{ marginTop, marginBottom }, containerStyle]}>
      <Text style={[base.sectionTitle, { marginTop: 0, marginBottom: 0 }, style]} {...rest}>
        {children}
      </Text>
    </View>
  );
}
