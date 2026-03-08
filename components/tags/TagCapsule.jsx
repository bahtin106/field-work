import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';

export default function TagCapsule({
  label,
  onPress,
  onRemove,
  onDeleteBadgePress,
  deleteBadgeColor,
  disabled = false,
  compact = false,
}) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme, compact), [theme, compact]);
  const content = (
    <View style={styles.capsule}>
      <Text style={styles.text} numberOfLines={1}>
        {label}
      </Text>
      {typeof onRemove === 'function' ? (
        <Pressable
          onPress={onRemove}
          hitSlop={theme.components?.interactive?.hitSlop ?? { top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
        >
          <Feather name="x" size={theme.icons?.sm ?? 16} color={theme.colors.tagText} />
        </Pressable>
      ) : null}
      {typeof onDeleteBadgePress === 'function' ? (
        <Pressable
          onPress={onDeleteBadgePress}
          style={styles.deleteBadge}
          hitSlop={{ top: 14, right: 14, bottom: 14, left: 14 }}
          accessibilityRole="button"
          accessibilityLabel="Удалить тег"
        >
          <Feather name="x" size={12} color={deleteBadgeColor || theme.colors.danger} />
        </Pressable>
      ) : null}
    </View>
  );

  if (typeof onPress !== 'function') return content;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={theme.components?.interactive?.hitSlop ?? { top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
    >
      {content}
    </Pressable>
  );
}

function createStyles(theme, compact) {
  const py = compact ? Math.max(2, theme.spacing.xs - 1) : theme.spacing.xs;
  const px = compact ? theme.spacing.sm : theme.spacing.md;

  return StyleSheet.create({
    capsule: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
      borderRadius: theme.radii.pill,
      paddingVertical: py,
      paddingHorizontal: px,
      backgroundColor: theme.colors.tagBg,
      borderWidth: 1,
      borderColor: theme.colors.tagBorder,
      maxWidth: '100%',
    },
    text: {
      color: theme.colors.tagText,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.medium,
      maxWidth: 220,
    },
    deleteBadge: {
      position: 'absolute',
      top: -6,
      right: -6,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: theme.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
  });
}

