import Feather from '@expo/vector-icons/Feather';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useMemo } from 'react';
import { useTheme } from '../../theme';
import { withAlpha } from '../../theme/colors';

export default function SelectionToolbar({
  selectedCount = 0,
  totalCount = 0,
  allSelected = false,
  selectAllLabel,
  clearAllLabel,
  selectedLabel,
  onToggleAll,
  onClose,
  actions = [],
  busy = false,
  style,
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const toggleLabel = allSelected ? clearAllLabel : selectAllLabel;

  return (
    <View style={[styles.container, style]}>
      <View style={styles.summaryRow}>
        <View style={styles.summaryTextWrap}>
          <Text style={styles.summaryText}>{selectedLabel}</Text>
          <Text style={styles.counter}>{`${selectedCount}/${totalCount}`}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={clearAllLabel}
          disabled={busy}
          hitSlop={theme.components?.interactive?.hitSlop ?? 8}
          onPress={onClose}
          style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
        >
          <Feather name="x" size={theme.icons?.md ?? 22} color={theme.colors.text} />
        </Pressable>
      </View>
      <View style={styles.actionsRow}>
        <Pressable
          accessibilityRole="button"
          disabled={busy || totalCount === 0}
          onPress={onToggleAll}
          style={({ pressed }) => [styles.toggleButton, pressed && styles.pressed, (busy || totalCount === 0) && styles.disabled]}
        >
          <Feather name={allSelected ? 'check-square' : 'square'} size={18} color={theme.colors.primary} />
          <Text numberOfLines={1} style={styles.toggleText}>{toggleLabel}</Text>
        </Pressable>
        {actions.map((action) => {
          const destructive = action.variant === 'destructive';
          const actionDisabled = busy || action.disabled || selectedCount === 0;
          return (
            <Pressable
              key={action.id || action.label}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              disabled={actionDisabled}
              onPress={action.onPress}
              style={({ pressed }) => [
                styles.actionButton,
                destructive ? styles.destructiveButton : styles.primaryButton,
                pressed && styles.pressed,
                actionDisabled && styles.disabled,
              ]}
            >
              {busy && action.loading ? (
                <ActivityIndicator size="small" color={destructive ? theme.colors.danger : theme.colors.primary} />
              ) : (
                <Feather name={action.icon || 'check'} size={18} color={destructive ? theme.colors.danger : theme.colors.primary} />
              )}
              <Text numberOfLines={1} style={[styles.actionText, destructive ? styles.destructiveText : styles.primaryText]}>
                {action.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const createStyles = (theme) => StyleSheet.create({
  container: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.background,
  },
  summaryRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryTextWrap: { flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.sm, minWidth: 0 },
  summaryText: { color: theme.colors.text, fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weight.bold },
  counter: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weight.semibold },
  closeButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  actionsRow: { flexDirection: 'row', alignItems: 'stretch', gap: theme.spacing.xs },
  toggleButton: {
    flex: 1.2,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: theme.radii.lg,
    backgroundColor: withAlpha(theme.colors.primary, 0.1),
    paddingHorizontal: theme.spacing.sm,
  },
  toggleText: { color: theme.colors.primary, fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weight.semibold },
  actionButton: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderRadius: theme.radii.lg,
    paddingHorizontal: theme.spacing.xs,
  },
  primaryButton: { borderColor: theme.colors.primary, backgroundColor: withAlpha(theme.colors.primary, 0.08) },
  destructiveButton: { borderColor: theme.colors.danger, backgroundColor: withAlpha(theme.colors.danger, 0.1) },
  actionText: { fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weight.semibold },
  primaryText: { color: theme.colors.primary },
  destructiveText: { color: theme.colors.danger },
  pressed: { opacity: theme.components?.button?.pressedOpacity ?? 0.86 },
  disabled: { opacity: 0.45 },
});
