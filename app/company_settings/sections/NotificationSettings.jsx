// app/company_settings/sections/NotificationSettings.jsx
import { View, Text } from 'react-native';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

export default function NotificationSettings() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: 16 }}>
      <View style={{ backgroundColor: theme.colors.surface, borderRadius: 16, padding: 16 }}>
        <Text
          style={{ fontSize: 18, fontWeight: '600', marginBottom: 8, color: theme.colors.text }}
        >
          {t('notification_settings_placeholder_title')}
        </Text>
        <Text style={{ fontSize: 14, color: theme.colors.textSecondary }}>
          {t('notification_settings_placeholder_body')}
        </Text>
      </View>
    </View>
  );
}
