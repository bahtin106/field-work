import React from 'react';
import { Image, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AppHeader from '../../../components/navigation/AppHeader';
import Card from '../../../components/ui/Card';
import LabelValueRow from '../../../components/ui/LabelValueRow';
import SectionHeader from '../../../components/ui/SectionHeader';
import { usePermissions } from '../../../lib/permissions';
import { useClient, useClientOrderCount } from '../../../src/features/clients/queries';
import { useTheme } from '../../../theme/ThemeProvider';
import { useTranslation } from '../../../src/i18n/useTranslation';

export default function ClientViewScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const clientId = Array.isArray(id) ? id[0] : id;
  const { has } = usePermissions();

  const canViewClients = has('canViewClients');
  const canEditClients = has('canEditClients');

  const { data: client } = useClient(clientId, { enabled: !!clientId && canViewClients });
  const { data: orderCount = 0 } = useClientOrderCount(clientId, {
    enabled: !!clientId && canViewClients,
  });
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  if (!canViewClients) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <AppHeader back options={{ title: t('routes_clients_client') }} />
        <View style={styles.centered}>
          <Text style={styles.mutedText}>{t('clients_no_view_permission')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const fullName = client?.fullName || t('common_dash');

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader
        back
        options={{
          title: t('routes_clients_client'),
          rightTextLabel: canEditClients ? t('btn_edit') : undefined,
          onRightPress: canEditClients ? () => router.push(`/clients/${clientId}/edit`) : undefined,
        }}
      />

      <ScrollView contentContainerStyle={styles.contentWrap}>
        <View style={styles.avatarWrap}>
          <View style={styles.avatarBox}>
            {client?.avatarUrl ? (
              <Image source={{ uri: client.avatarUrl }} style={styles.avatarImg} />
            ) : (
              <Text style={styles.avatarText}>{getInitials(client)}</Text>
            )}
          </View>
        </View>

        <SectionHeader topSpacing="xs">{t('section_personal')}</SectionHeader>
        <Card paddedXOnly>
          <LabelValueRow label={t('view_label_name')} value={fullName} />
          <LabelValueRow label={t('view_label_email')} value={client?.email || t('common_dash')} />
          <LabelValueRow label={t('view_label_phone')} value={client?.phone || t('common_dash')} />
          <LabelValueRow label={t('clients_object_address')} value={client?.objectAddress || t('common_dash')} />
        </Card>

        <SectionHeader topSpacing="xs">{t('clients_requests_section')}</SectionHeader>
        <Card paddedXOnly>
          <LabelValueRow label={t('clients_requests_count')} value={String(orderCount)} />
        </Card>

      </ScrollView>
    </SafeAreaView>
  );
}

function getInitials(client) {
  const first = String(client?.firstName || '').slice(0, 1);
  const last = String(client?.lastName || '').slice(0, 1);
  return `${first}${last}`.toUpperCase() || '*';
}

function createStyles(theme) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    contentWrap: {
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.components?.scrollView?.paddingBottom ?? theme.spacing.xl,
    },
    avatarWrap: {
      alignItems: 'center',
      marginBottom: theme.spacing.md,
    },
    avatarBox: {
      width: theme.components?.avatar?.xl ?? 96,
      height: theme.components?.avatar?.xl ?? 96,
      borderRadius: (theme.components?.avatar?.xl ?? 96) / 2,
      backgroundColor: theme.colors.surface,
      borderWidth: theme.components?.card?.borderWidth ?? 1,
      borderColor: theme.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarImg: {
      width: '100%',
      height: '100%',
    },
    avatarText: {
      color: theme.colors.primary,
      fontSize: theme.typography.sizes.lg,
      fontWeight: theme.typography.weight.bold,
    },
    mutedText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
  });
}
