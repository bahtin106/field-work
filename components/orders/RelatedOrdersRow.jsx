import Feather from '@expo/vector-icons/Feather';
import React from 'react';
import { ActivityIndicator, Pressable, Text } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import LabelValueRow from '../ui/LabelValueRow';
import { listItemStyles } from '../ui/listItemStyles';

export default function RelatedOrdersRow({
  label,
  count,
  isLoading = false,
  onPress,
}) {
  const { theme } = useTheme();
  const base = React.useMemo(() => listItemStyles(theme), [theme]);
  const hasCount = count !== null && count !== undefined && Number.isFinite(Number(count));
  const displayCount = hasCount ? String(Math.max(0, Number(count))) : '—';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${displayCount}`}
      disabled={typeof onPress !== 'function'}
      onPress={onPress}
      style={({ pressed }) => [{ width: '100%' }, pressed ? { opacity: 0.65 } : null]}
    >
      <LabelValueRow
        label={label}
        hideWhenEmpty={false}
        valueComponent={
          isLoading && !hasCount ? (
            <ActivityIndicator color={theme.colors.primary} size="small" />
          ) : (
            <Text style={base.value}>{displayCount}</Text>
          )
        }
        rightActions={
          <Feather
            name="chevron-right"
            size={Number(theme?.typography?.sizes?.md ?? 16)}
            color={theme.colors.textSecondary}
          />
        }
      />
    </Pressable>
  );
}
