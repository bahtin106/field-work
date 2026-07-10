// app/company_settings/sections/NotificationSettings.jsx
import { StyleSheet, Text, View } from 'react-native';
import Screen from '../../../components/layout/Screen';
import Card from '../../../components/ui/Card';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

export default function NotificationSettings() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(theme);

  return (
    <Screen background="background">
      <View style={styles.content}>
        <Card>
          <Text style={styles.title}>
          {t('notification_settings_placeholder_title')}
          </Text>
          <Text style={styles.body}>{t('notification_settings_placeholder_body')}</Text>
        </Card>
      </View>
    </Screen>
  );
}

const createStyles = (theme) =>
  StyleSheet.create({
    content: {
      flex: 1,
      paddingHorizontal: theme.components.screenLayout.contentPaddingX,
      paddingBottom: theme.components.screenLayout.contentPaddingBottom,
    },
    title: {
      marginBottom: theme.spacing.sm,
      color: theme.colors.text,
      fontSize: theme.typography.sizes.lg,
      fontWeight: theme.typography.weight.semibold,
    },
    body: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
  });
