import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AppHeader from '../../components/navigation/AppHeader';
import SearchFiltersBar from '../../components/filters/SearchFiltersBar';
import SortSelectModal from '../../components/filters/SortSelectModal';
import DismissKeyboardArea from '../../components/layout/DismissKeyboardArea';
import Card from '../../components/ui/Card';
import { usePermissions } from '../../lib/permissions';
import { useMyCompanyIdQuery } from '../../src/features/profile/queries';
import { useClients, useClientsRealtimeSync } from '../../src/features/clients/queries';
import { collectClientPhoneSearchValues } from '../../src/features/clients/additionalPhones';
import { hasDisplayValue } from '../../src/shared/display/value';
import { buildSearchIndex, matchesSearch } from '../../src/shared/search/matching';
import { CLIENT_SORT, clientSortOptions, sortClients } from '../../src/shared/sorting/clientSort';
import { useTheme } from '../../theme/ThemeProvider';
import { useTranslation } from '../../src/i18n/useTranslation';

const SAFE_AREA_EDGES = ['left', 'right'];

export default function ClientsIndexScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { has } = usePermissions();

  const canViewClients = has('canViewClients');
  const canCreateClients = has('canCreateClients');

  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [refreshing, setRefreshing] = React.useState(false);
  const [sortVisible, setSortVisible] = React.useState(false);
  const [sortKey, setSortKey] = React.useState(CLIENT_SORT.NAME_ASC);
  const selectedTag = React.useMemo(() => {
    const raw = Array.isArray(params?.tag) ? params.tag[0] : params?.tag;
    return String(raw || '').trim();
  }, [params?.tag]);
  const activeTagFilter = React.useMemo(
    () => (selectedTag && String(search || '').trim() === selectedTag ? selectedTag : ''),
    [search, selectedTag],
  );

  const { data: companyId, isLoading: companyLoading } = useMyCompanyIdQuery();

  const {
    data: allClients = [],
    isLoading,
    refetch,
  } = useClients(
    { companyId, search: '' },
    {
      enabled: !!companyId && canViewClients,
      staleTime: 30 * 1000,
    },
  );

  useClientsRealtimeSync({ enabled: !!companyId && canViewClients, companyId });

  React.useEffect(() => {
    const delayMs = Number(theme?.timings?.backDelayMs ?? 300);
    const timer = setTimeout(() => {
      setDebouncedSearch(String(search || '').trim());
    }, delayMs);
    return () => clearTimeout(timer);
  }, [search, theme?.timings?.backDelayMs]);

  React.useEffect(() => {
    if (!selectedTag) return;
    setSearch(selectedTag);
  }, [selectedTag]);

  const filteredClients = React.useMemo(() => {
    return allClients.filter((client) => {
      const tagMatch =
        !activeTagFilter ||
        (Array.isArray(client?.tags) &&
          client.tags.some((tag) => String(tag?.value || '').trim().toLowerCase() === activeTagFilter.toLowerCase()));
      if (!tagMatch) return false;
      if (!debouncedSearch) return true;
      return matchesSearch(
        buildSearchIndex({
          texts: [
            client?.fullName,
            client?.full_name,
            client?.email,
            client?.primaryObjectSummary,
            client?.objects?.[0]?.name,
            ...(Array.isArray(client?.tags) ? client.tags.map((tag) => tag?.value) : []),
          ],
          phones: collectClientPhoneSearchValues(client),
        }),
        debouncedSearch,
      );
    });
  }, [activeTagFilter, allClients, debouncedSearch]);

  const sortOptions = React.useMemo(() => clientSortOptions(t), [t]);

  const clients = React.useMemo(
    () =>
      sortClients(filteredClients, {
        sortKey,
        getName: (item) => item?.fullName || item?.full_name || '',
        getCreatedAt: (item) => item?.created_at,
        getObjectsCount: (item) => (Array.isArray(item?.objects) ? item.objects.length : 0),
      }),
    [filteredClients, sortKey],
  );

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
      <SafeAreaView edges={SAFE_AREA_EDGES} style={styles.safeArea}>
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!canViewClients) {
    return (
      <SafeAreaView edges={SAFE_AREA_EDGES} style={styles.safeArea}>
        <AppHeader back options={{ title: t('routes_clients_index') }} />
        <View style={styles.loaderWrap}>
          <Text style={styles.mutedText}>{t('clients_no_view_permission')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={SAFE_AREA_EDGES} style={styles.safeArea}>
      <AppHeader
        back
        options={{
          title: t('routes_clients_index'),
          rightTextLabel: canCreateClients ? t('btn_create') : undefined,
          onRightPress: canCreateClients ? () => router.push('/clients/new') : undefined,
        }}
      />

      <DismissKeyboardArea style={styles.container}>
        <SearchFiltersBar
          value={search}
          onChangeText={setSearch}
          onClear={() => setSearch('')}
          placeholder={t('clients_search_placeholder')}
          onOpenSort={() => setSortVisible(true)}
          metaText={`${t('common_total')}: ${clients.length}`}
        />

        <FlatList
          data={clients}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.primary}
            />
          }
          renderItem={({ item }) => {
            const fullName = String(item?.fullName || '').trim();
            const contactMeta = String(item?.phone || item?.email || '').trim();
            const objectMeta =
              String(item?.primaryObjectSummary || '').trim() ||
              t('clients_objects_count_label').replace('{count}', String(item.objects?.length || 0));
            return (
              <Pressable onPress={() => router.push(`/clients/${item.id}`)}>
                <Card paddedXOnly>
                  <View style={styles.row}>
                    {hasDisplayValue(fullName) ? <Text style={styles.nameText}>{fullName}</Text> : null}
                    {hasDisplayValue(contactMeta) ? (
                      <Text style={styles.metaText} numberOfLines={1}>
                        {contactMeta}
                      </Text>
                    ) : null}
                    {hasDisplayValue(objectMeta) ? (
                      <Text style={styles.metaText} numberOfLines={2}>
                        {objectMeta}
                      </Text>
                    ) : null}
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
      </DismissKeyboardArea>

      <SortSelectModal
        visible={sortVisible}
        onClose={() => setSortVisible(false)}
        options={sortOptions}
        value={sortKey}
        onChange={(nextSort) => {
          if (nextSort) setSortKey(nextSort);
        }}
      />
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
      paddingTop: theme.spacing.xs,
    },
    loaderWrap: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    listContent: {
      paddingHorizontal: theme.spacing.lg,
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
