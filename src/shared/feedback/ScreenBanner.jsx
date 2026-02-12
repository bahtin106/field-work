// src/shared/feedback/ScreenBanner.jsx
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { t as T } from '../../i18n';
import { withAlpha } from '../../../theme/colors';

const palette = (theme, severity) => {
  const base = {
    info: {
      bg: withAlpha(theme.colors.primary, 0.08),
      border: withAlpha(theme.colors.primary, 0.35),
      text: theme.colors.text,
      action: theme.colors.primary,
    },
    success: {
      bg: withAlpha(theme.colors.success || theme.colors.primary, 0.12),
      border: withAlpha(theme.colors.success || theme.colors.primary, 0.35),
      text: theme.colors.text,
      action: theme.colors.success || theme.colors.primary,
    },
    warning: {
      bg: withAlpha(theme.colors.warning || theme.colors.primary, 0.12),
      border: withAlpha(theme.colors.warning || theme.colors.primary, 0.35),
      text: theme.colors.text,
      action: theme.colors.warning || theme.colors.primary,
    },
    error: {
      bg: withAlpha(theme.colors.danger, 0.12),
      border: withAlpha(theme.colors.danger, 0.35),
      text: theme.colors.text,
      action: theme.colors.danger,
    },
  };
  return base[severity] || base.error;
};

export default function ScreenBanner({ message, onClose, style }) {
  const { theme } = useTheme();
  if (!message) return null;
  const severity = message?.severity || 'error';
  const p = palette(theme, severity);
  const action = message?.action;

  return (
    <View style={[styles.container, { backgroundColor: p.bg, borderColor: p.border }, style]}>
      <Text style={[styles.text, { color: p.text }]}>{message?.message || ''}</Text>
      <View style={styles.actions}>
        {action?.label ? (
          <Pressable
            onPress={action.onPress}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={[styles.actionText, { color: p.action }]}>{action.label}</Text>
          </Pressable>
        ) : null}
        {onClose ? (
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={T('btn_close')}
            style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={[styles.closeText, { color: p.text }]}>×</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  text: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  closeBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  closeText: {
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 18,
  },
});
