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
        <Card style={styles(theme).card}>
          <Text style={styles(theme).title}>{t('settings_management_notifications')}</Text>
          <Text style={styles(theme).text}>This section is a placeholder and will be expanded.</Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = (theme) =>
  StyleSheet.create({
    content: {
      padding: theme.spacing.lg,
    },
    card: {
      borderRadius: theme.radii.md,
      borderWidth: theme.components.card.borderWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      gap: theme.spacing.xs,
    },
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
