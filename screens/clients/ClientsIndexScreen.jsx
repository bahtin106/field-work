// Keep the route wrapper lightweight; this screen is evaluated after the
// destination frame is already visible.
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  InteractionManager,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import AppHeader from '../../components/navigation/AppHeader';
import FiltersPanel from '../../components/filters/FiltersPanel';
import SearchFiltersBar from '../../components/filters/SearchFiltersBar';
import SortSelectModal from '../../components/filters/SortSelectModal';
import { useFilters } from '../../components/hooks/useFilters';
import DismissKeyboardArea from '../../components/layout/DismissKeyboardArea';
import TagList from '../../components/tags/TagList';
import Card from '../../components/ui/Card';
import EmptyListState from '../../components/ui/EmptyListState';
import {
  ThemedRefreshControl,
  useManagedRefresh,
  usePullToRefreshFeedback,
} from '../../components/ui/PullToRefreshFeedback';
import { usePermissions } from '../../lib/permissions';
import { useMyCompanyIdQuery } from '../../src/features/profile/queries';
import { ensureClientPrefetch, useClients, useClientsRealtimeSync } from '../../src/features/clients/queries';
import { collectClientPhoneSearchValues } from '../../src/features/clients/additionalPhones';
import { useCompanyTags } from '../../src/features/tags/queries';
import { hasDisplayValue } from '../../src/shared/display/value';
import { getPrefetchRegistry } from '../../src/shared/query/prefetchRegistry';
import { runAfterNavigationFrame } from '../../src/shared/perf/navigationWork';
import { buildSearchIndex, matchesSearch } from '../../src/shared/search/matching';
import { CLIENT_SORT, clientSortOptions, sortClients } from '../../src/shared/sorting/clientSort';
import { joinFilterSummary, summarizeFilterPart } from '../../src/shared/filters/summary';
import {
  buildTagFacetCounts,
  buildTagFilterOptions,
  matchesSelectedTags,
} from '../../src/features/tags/filtering';
import { useTheme } from '../../theme/ThemeProvider';
import { useTranslation } from '../../src/i18n/useTranslation';

const SAFE_AREA_EDGES = ['left', 'right'];
const CLIENT_FILTER_DEFAULTS = Object.freeze({
  clientTags: [],
  objectTags: [],
});

function applyClientFilters(items, values) {
  const clientTags = Array.isArray(values?.clientTags) ? values.clientTags : [];
  const objectTags = Array.isArray(values?.objectTags) ? values.objectTags : [];

  return (Array.isArray(items) ? items : []).filter((client) => {
    if (!matchesSelectedTags(client?.tags, clientTags)) return false;
    const relatedObjectTags = (Array.isArray(client?.objects) ? client.objects : []).flatMap((object) =>
      Array.isArray(object?.tags) ? object.tags : [],
    );
    return matchesSelectedTags(relatedObjectTags, objectTags);
  });
}

export default function ClientsIndexScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { has } = usePermissions();
  const queryClient = useQueryClient();
  const clientPrefetchTaskRef = React.useRef(null);

  const canViewClients = has('canViewClients');
  const canCreateClients = has('canCreateClients');
  const canViewClientPhones = has('canViewClientPhones');

  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [sortVisible, setSortVisible] = React.useState(false);
  const [sortKey, setSortKey] = React.useState(CLIENT_SORT.NAME_ASC);
  const filters = useFilters({ screenKey: 'clients', defaults: CLIENT_FILTER_DEFAULTS });
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

  const { data: companyClientTags = [] } = useCompanyTags({
    companyId,
    tagType: 'client',
    enabled: !!companyId && canViewClients,
  });
  const { data: companyObjectTags = [] } = useCompanyTags({
    companyId,
    tagType: 'object',
    enabled: !!companyId && canViewClients,
  });

  const clientTagOptions = React.useMemo(
    () =>
      buildTagFilterOptions(
        [companyClientTags, ...allClients.map((client) => client?.tags)],
        filters.values.clientTags,
      ),
    [allClients, companyClientTags, filters.values.clientTags],
  );
  const objectTagOptions = React.useMemo(
    () =>
      buildTagFilterOptions(
        [
          companyObjectTags,
          ...allClients.flatMap((client) =>
            (Array.isArray(client?.objects) ? client.objects : []).map((object) => object?.tags || []),
          ),
        ],
        filters.values.objectTags,
      ),
    [allClients, companyObjectTags, filters.values.objectTags],
  );
  const clientTagFacetCounts = React.useMemo(
    () => buildTagFacetCounts(allClients, (client) => client?.tags),
    [allClients],
  );
  const objectTagFacetCounts = React.useMemo(
    () =>
      buildTagFacetCounts(allClients, (client) =>
        (Array.isArray(client?.objects) ? client.objects : []).flatMap((object) => object?.tags || []),
      ),
    [allClients],
  );
  const clientsFilteredByPanel = React.useMemo(
    () => applyClientFilters(allClients, filters.values),
    [allClients, filters.values],
  );

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
    return clientsFilteredByPanel.filter((client) => {
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
          phones: canViewClientPhones ? collectClientPhoneSearchValues(client) : [],
        }),
        debouncedSearch,
      );
    });
  }, [activeTagFilter, canViewClientPhones, clientsFilteredByPanel, debouncedSearch]);

  const filterSummaryData = React.useMemo(() => {
    const fullParts = [];
    const compactParts = [];
    const addPart = (label, values) => {
      if (!Array.isArray(values) || values.length === 0) return;
      fullParts.push(summarizeFilterPart({ label, values, countWhenMany: false }));
      compactParts.push(summarizeFilterPart({ label, values, countWhenMany: true }));
    };
    addPart(t('tags_clients_label'), filters.values.clientTags);
    addPart(t('tags_objects_label'), filters.values.objectTags);
    return {
      full: joinFilterSummary(fullParts, t('common_bullet')),
      compact: joinFilterSummary(compactParts, t('common_bullet')),
    };
  }, [filters.values.clientTags, filters.values.objectTags, t]);

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

  const { refreshing, didSucceed, onRefresh } = useManagedRefresh(refetch);
  const { indicator: refreshIndicator } = usePullToRefreshFeedback(refreshing, { didSucceed });

  const styles = React.useMemo(() => createStyles(theme), [theme]);

  React.useEffect(() => {
    return () => {
      try {
        clientPrefetchTaskRef.current?.cancel?.();
      } catch {}
    };
  }, []);

  const prefetchVisibleClients = React.useCallback(
    ({ viewableItems }) => {
      const ids = (Array.isArray(viewableItems) ? viewableItems : [])
        .map((item) => item?.item?.id)
        .filter(Boolean)
        .slice(0, 2);
      if (!ids.length) return;

      try {
        clientPrefetchTaskRef.current?.cancel?.();
      } catch {}
      clientPrefetchTaskRef.current = InteractionManager.runAfterInteractions(() => {
        const registry = getPrefetchRegistry();
        ids.forEach((id) => {
          registry.run(`client-detail:${id}`, () => ensureClientPrefetch(queryClient, id)).catch(() => {});
        });
      });
    },
    [queryClient],
  );
  const viewabilityConfig = React.useMemo(() => ({ itemVisiblePercentThreshold: 50 }), []);

  if ((companyLoading || isLoading) && allClients.length === 0) {
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
        <AppHeader back options={{ title: t('routes_clients_index'), helpTopic: 'clients' }} />
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
          helpTopic: 'clients',
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
          onOpenFilters={filters.open}
          onOpenSort={() => setSortVisible(true)}
          filterSummary={filterSummaryData.full}
          filterSummaryCompact={filterSummaryData.compact}
          onResetFilters={async () => {
            const reset = filters.reset();
            await filters.apply(reset);
          }}
          metaText={`${t('common_total')}: ${clients.length}`}
        />

        <View style={{ flex: 1 }}>
          {refreshIndicator}
          <FlatList
            data={clients}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={10}
            maxToRenderPerBatch={8}
            updateCellsBatchingPeriod={34}
            windowSize={9}
            removeClippedSubviews={Platform.OS === 'android'}
            onViewableItemsChanged={prefetchVisibleClients}
            viewabilityConfig={viewabilityConfig}
            refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            renderItem={({ item }) => {
              const fullName = String(item?.fullName || '').trim();
              const contactMeta = String((canViewClientPhones ? item?.phone : '') || item?.email || '').trim();
              const objectMeta =
                String(item?.primaryObjectSummary || '').trim() ||
                t('clients_objects_count_label').replace('{count}', String(item.objects?.length || 0));
              return (
                <Pressable
                  onPress={() => {
                    const id = String(item.id || '').trim();
                    if (!id) return;
                    router.push(`/clients/${id}`);
                    runAfterNavigationFrame(() => {
                      getPrefetchRegistry()
                        .run(`client-detail:${id}`, () => ensureClientPrefetch(queryClient, id))
                        .catch(() => {});
                    });
                  }}
                >
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
                      <TagList tags={item?.tags} compact />
                    </View>
                  </Card>
                </Pressable>
              );
            }}
            ListEmptyComponent={<EmptyListState />}
          />
        </View>
      </DismissKeyboardArea>

      <FiltersPanel
        visible={filters.visible}
        onClose={filters.close}
        mode="clients"
        showSearchCategory={false}
        inlineOptionSearch={{ categoryKeys: ['clients_clientTags', 'clients_objectTags'] }}
        clientFilters={{
          clientTags: clientTagOptions,
          objectTags: objectTagOptions,
          facetCounts: {
            total: allClients.length,
            clientTags: clientTagFacetCounts,
            objectTags: objectTagFacetCounts,
          },
        }}
        values={filters.values}
        defaults={CLIENT_FILTER_DEFAULTS}
        setValue={filters.setValue}
        onApply={(nextValues) => filters.apply(nextValues)}
        onReset={() => filters.reset()}
      />

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
      paddingHorizontal: theme.components.screenLayout.contentPaddingX,
      paddingBottom: theme.components.screenLayout.contentPaddingBottom,
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
