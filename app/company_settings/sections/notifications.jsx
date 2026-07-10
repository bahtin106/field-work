import { useNavigation } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import Screen from '../../../components/layout/Screen';
import Card from '../../../components/ui/Card';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

export default function NotificationsSettingsPlaceholderScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const nav = useNavigation();

  React.useLayoutEffect(() => {
    nav.setParams({ headerTitle: t('settings_management_notifications') });
  }, [nav, t]);

  return (
    <Screen background="background">
      <ScrollView contentContainerStyle={styles(theme).content}>
        <Card style={styles(theme).cardContent}>
          <Text style={styles(theme).title}>{t('settings_management_notifications')}</Text>
          <Text style={styles(theme).text}>{t('company_notifications_placeholder')}</Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = (theme) =>
  StyleSheet.create({
    content: {
      paddingHorizontal: theme.components.screenLayout.contentPaddingX,
      paddingBottom: theme.components.screenLayout.contentPaddingBottom,
    },
    cardContent: { gap: theme.spacing.xs },
    title: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.lg,
      fontWeight: theme.typography.weight.bold,
    },
    text: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.md,
    },
  });
