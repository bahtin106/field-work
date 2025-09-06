import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';

export default function NotificationSettings() {
  const { theme } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: 16 }}>
      <View style={{ backgroundColor: theme.colors.surface, borderRadius: 16, padding: 16 }}>
        <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 8, color: theme.colors.text }}>Настройки уведомлений</Text>
        <Text style={{ fontSize: 14, color: theme.colors.textSecondary }}>
          Экран-заглушка. Здесь позже добавим поля и логику.
        </Text>
      </View>
    </View>
  );
}