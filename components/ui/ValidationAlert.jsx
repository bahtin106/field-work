// components/ui/ValidationAlert.jsx
import { Feather } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { withAlpha } from '../../theme/colors';

/**
 * Компонент для отображения ошибок и предупреждений валидации
 * Следует современным UX практикам: информативно, ненавязчиво, помогает пользователю
 */
export default function ValidationAlert({
  messages = [],
  type = 'error', // 'error' | 'warning' | 'info'
  style,
}) {
  const { theme } = useTheme();

  const config = useMemo(() => {
    switch (type) {
      case 'warning':
        return {
          backgroundColor: withAlpha(theme.colors.warning || '#ff9800', 0.12),
          borderColor: theme.colors.warning || '#ff9800',
          textColor: theme.colors.warning || '#ff9800',
          icon: 'alert-triangle',
        };
      case 'info':
        return {
          backgroundColor: withAlpha(theme.colors.info || '#2196f3', 0.12),
          borderColor: theme.colors.info || '#2196f3',
          textColor: theme.colors.info || '#2196f3',
          icon: 'info',
        };
      default: // error
        return {
          backgroundColor: withAlpha(theme.colors.danger, 0.12),
          borderColor: theme.colors.danger,
          textColor: theme.colors.danger,
          icon: 'alert-circle',
        };
    }
  }, [type, theme]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          backgroundColor: config.backgroundColor,
          borderColor: config.borderColor,
          borderWidth: theme.components.card.borderWidth,
          padding: theme.spacing.md,
          borderRadius: theme.radii.xl,
          flexDirection: 'row',
          gap: theme.spacing.sm,
        },
        iconContainer: {
          marginTop: 2,
        },
        content: {
          flex: 1,
        },
        message: {
          color: config.textColor,
          fontSize: theme.typography.sizes.sm,
          lineHeight: theme.typography.sizes.sm * 1.5,
          marginBottom: theme.spacing.xs,
        },
        lastMessage: {
          marginBottom: 0,
        },
      }),
    [theme, config],
  );

  if (!messages || messages.length === 0) {
    return null;
  }

  // Фильтруем пустые сообщения
  const validMessages = messages.filter((msg) => msg && String(msg).trim());

  if (validMessages.length === 0) {
    return null;
  }

  return (
    <View style={[styles.container, style]}>
      <View style={styles.iconContainer}>
        <Feather name={config.icon} size={theme.icons?.sm ?? 18} color={config.textColor} />
      </View>
      <View style={styles.content}>
        {validMessages.map((msg, index) => (
          <Text
            key={index}
            style={[styles.message, index === validMessages.length - 1 && styles.lastMessage]}
          >
            {String(msg)}
          </Text>
        ))}
      </View>
    </View>
  );
}
