// app/billing/index.jsx
import React from 'react';
import { View, Text } from 'react-native';
import Screen from '../../components/layout/Screen';
import Card from '../../components/ui/Card';
import { useNavigation } from 'expo-router';
import { useTheme } from '../../theme/ThemeProvider';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useI18nVersion } from '../../src/i18n';

export default function BillingScreen() {
  const nav = useNavigation();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const ver = useI18nVersion();

  React.useLayoutEffect(() => {
    try {
      const titleKeyPrimary = 'routes.billing/index';
      const titleKeyFallback = 'routes.billing';
      nav.setParams({ headerTitle: t(titleKeyPrimary) || t(titleKeyFallback) || titleKeyFallback });
    } catch {}
  }, [ver, t]);

  return (
    <Screen background="background">
      <Card>
        <View style={{ gap: theme.spacing.sm }}>
          <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weight.bold }}>
            {t('billing_placeholder_title')}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: theme.typography.sizes.md }}>
            {t('billing_placeholder_text')}
          </Text>
        </View>
      </Card>
    </Screen>
  );
}
