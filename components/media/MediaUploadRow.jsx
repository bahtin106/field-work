import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { listItemStyles } from '../ui/listItemStyles';
import { useTheme } from '../../theme/ThemeProvider';

export default function MediaUploadRow({
  label,
  countLabel,
  onPress,
  disabled = false,
  busy = false,
  rightActions = null,
  accessibilityLabel,
}) {
  const { theme } = useTheme();
  const base = React.useMemo(() => listItemStyles(theme), [theme]);
  const isDisabled = disabled || busy;

  return (
    <Pressable
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ busy, disabled: isDisabled }}
      style={({ pressed }) => [
        base.row,
        isDisabled && { opacity: 0.62 },
        pressed && !isDisabled && { opacity: 0.7 },
      ]}
      onPress={onPress}
    >
      <Text style={[base.label, { flexShrink: 1, minWidth: 0, paddingRight: theme.spacing.sm }]} numberOfLines={1}>
        {label}
      </Text>
      <View style={base.rightWrap}>
        {busy ? (
          <ActivityIndicator size="small" color={theme.colors.textSecondary} />
        ) : (
          <Text style={base.value} numberOfLines={1}>
            {countLabel}
          </Text>
        )}
        {rightActions}
        <Feather
          name="chevron-right"
          size={theme.icons?.sm ?? 18}
          color={busy ? theme.colors.border : theme.colors.textSecondary}
          style={{ marginLeft: theme.spacing.xs }}
        />
      </View>
    </Pressable>
  );
}
