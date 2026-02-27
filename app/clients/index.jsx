import { useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AppHeader from '../../components/navigation/AppHeader';
import SearchFiltersBar from '../../components/filters/SearchFiltersBar';
import Card from '../../components/ui/Card';
import { usePermissions } from '../../lib/permissions';
import { useMyCompanyIdQuery } from '../../src/features/profile/queries';
import { useClients, useClientsRealtimeSync } from '../../src/features/clients/queries';
import { useTheme } from '../../theme/ThemeProvider';
import { useTranslation } from '../../src/i18n/useTranslation';

export default function ClientsIndexScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { has } = usePermissions();

  const canViewClients = has('canViewClients');
  const canCreateClients = has('canCreateClients');

  const [search, setSearch] = React.useState('');
  const [refreshing, setRefreshing] = React.useState(false);

  const { data: companyId, isLoading: companyLoading } = useMyCompanyIdQuery();

  const {
    data: clients = [],
    isLoading,
    refetch,
  } = useClients(
    { companyId, search },
    {
      enabled: !!companyId && canViewClients,
      staleTime: 30 * 1000,
    },
  );

  useClientsRealtimeSync({ enabled: !!companyId && canViewClients, companyId });

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const styles = React.useMemo(() => createStyles(theme), [theme]);

  if (companyLoading || isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!canViewClients) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <AppHeader back options={{ title: t('routes_clients_index') }} />
        <View style={styles.loaderWrap}>
          <Text style={styles.mutedText}>{t('clients_no_view_permission')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader
        back
        options={{
          title: t('routes_clients_index'),
          rightTextLabel: canCreateClients ? t('btn_create') : undefined,
          onRightPress: canCreateClients ? () => router.push('/clients/new') : undefined,
        }}
      />

      <View style={styles.container}>
        <SearchFiltersBar
          value={search}
          onChangeText={setSearch}
          onClear={() => setSearch('')}
          placeholder={t('clients_search_placeholder')}
          onOpenFilters={() => {}}
          metaText={`${t('clients_total')}: ${clients.length}`}
          metaTextStyle={{ marginLeft: theme.spacing.sm }}
        />

        <FlatList
          data={clients}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.primary}
            />
          }
          renderItem={({ item }) => {
            const fullName = item.fullName || t('common_dash');
            return (
              <Pressable onPress={() => router.push(`/clients/${item.id}`)}>
                <Card paddedXOnly>
                  <View style={styles.row}>
                    <Text style={styles.nameText}>{fullName}</Text>
                    <Text style={styles.metaText} numberOfLines={1}>
                      {item.phone || item.email || t('common_dash')}
                    </Text>
                    <Text style={styles.metaText} numberOfLines={2}>
                      {item.objectAddress || t('common_dash')}
                    </Text>
                  </View>
                </Card>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.mutedText}>{t('empty_noData')}</Text>
            </View>
          }
        />
      </View>
    </SafeAreaView>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    container: {
      flex: 1,
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.xs,
    },
    loaderWrap: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    listContent: {
      paddingBottom: theme.components?.scrollView?.paddingBottom ?? theme.spacing.xl,
      gap: theme.spacing.sm,
    },
    row: {
      paddingVertical: theme.spacing.sm,
      gap: theme.spacing.xs,
    },
    nameText: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
    },
    metaText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
    emptyWrap: {
      paddingVertical: theme.spacing.xl,
      alignItems: 'center',
    },
    mutedText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
  });
}
