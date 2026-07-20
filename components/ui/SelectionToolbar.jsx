import Feather from '@expo/vector-icons/Feather';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useMemo } from 'react';
import { useTheme } from '../../theme';

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
  const primaryContent = theme.colors.onPrimary || '#fff';
  const destructiveContent = theme.colors.onDanger || '#fff';

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
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ checked: allSelected }}
        disabled={busy || totalCount === 0}
        onPress={onToggleAll}
        style={({ pressed }) => [styles.toggleButton, pressed && styles.pressed, (busy || totalCount === 0) && styles.disabled]}
      >
        <View style={[styles.toggleCheckbox, allSelected && styles.toggleCheckboxSelected]}>
          {allSelected ? <Feather name="check" size={15} color={primaryContent} /> : null}
        </View>
        <Text numberOfLines={1} style={styles.toggleText}>{toggleLabel}</Text>
        <Text style={styles.toggleCount}>{totalCount}</Text>
      </Pressable>
      {actions.length ? <View style={styles.actionsRow}>
        {actions.map((action) => {
          const destructive = action.variant === 'destructive';
          const actionDisabled = busy || action.disabled || selectedCount === 0;
          const contentColor = destructive ? destructiveContent : primaryContent;
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
                <ActivityIndicator size="small" color={contentColor} />
              ) : (
                <Feather name={action.icon || 'check'} size={18} color={contentColor} />
              )}
              <Text numberOfLines={1} style={[styles.actionText, { color: contentColor }]}>
                {action.label}
              </Text>
            </Pressable>
          );
        })}
      </View> : null}
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
  actionsRow: { flexDirection: 'row', alignItems: 'stretch', gap: theme.spacing.sm },
  toggleButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.card,
    paddingHorizontal: theme.spacing.md,
  },
  toggleCheckbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center' },
  toggleCheckboxSelected: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary },
  toggleText: { flex: 1, color: theme.colors.text, fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weight.semibold },
  toggleCount: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weight.semibold },
  actionButton: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    borderRadius: theme.radii.lg,
    paddingHorizontal: theme.spacing.md,
  },
  primaryButton: { backgroundColor: theme.colors.primary },
  destructiveButton: { backgroundColor: theme.colors.danger },
  actionText: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weight.bold },
  pressed: { opacity: theme.components?.button?.pressedOpacity ?? 0.88, transform: [{ scale: theme.components?.interactive?.pressedScale ?? 0.98 }] },
  disabled: { opacity: 0.45 },
});
