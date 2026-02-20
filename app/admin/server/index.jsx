import { useNavigation } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import Screen from '../../../components/layout/Screen';
import Card from '../../../components/ui/Card';
import { useRequireSuperAdmin } from '../../../hooks/useRequireSuperAdmin';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

export default function AdminServerScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const nav = useNavigation();
  const { isAllowed, isLoading } = useRequireSuperAdmin();

  React.useLayoutEffect(() => {
    nav.setParams({ headerTitle: t('routes.admin/server') });
  }, [nav, t]);

  if (isLoading || !isAllowed) return <Screen background="background" />;

  return (
    <Screen background="background">
      <ScrollView contentContainerStyle={styles(theme).content}>
        <Card style={styles(theme).card}>
          <Text style={styles(theme).title}>{t('admin_server_placeholder_title')}</Text>
          <Text style={styles(theme).text}>{t('admin_server_placeholder_text')}</Text>
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
