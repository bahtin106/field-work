// Keep the route wrapper lightweight; this screen is evaluated after the
// destination frame is already visible.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActivityIndicator, FlatList, InteractionManager, Keyboard, Platform, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import AppHeader from '../../components/navigation/AppHeader';
import SearchFiltersBar from '../../components/filters/SearchFiltersBar';
import SortSelectModal from '../../components/filters/SortSelectModal';
import FiltersPanel from '../../components/filters/FiltersPanel';
import DismissKeyboardArea from '../../components/layout/DismissKeyboardArea';
import { useFilters } from '../../components/hooks/useFilters';
import ObjectCard from '../../components/objects/ObjectCard';
import EmptyListState from '../../components/ui/EmptyListState';
import {
  ThemedRefreshControl,
  useManagedRefresh,
  usePullToRefreshFeedback,
} from '../../components/ui/PullToRefreshFeedback';
import { formatPersonName } from '../../lib/personName';
import { usePermissions } from '../../lib/permissions';
import { useTheme } from '../../theme/ThemeProvider';
import { useMyCompanyIdQuery } from '../../src/features/profile/queries';
import { useAuthContext } from '../../providers/SimpleAuthProvider';
import { useClients } from '../../src/features/clients/queries';
import { collectClientPhoneSearchValues } from '../../src/features/clients/additionalPhones';
import {
  ensureClientObjectPrefetch,
  useCompanyObjects,
  useClientObjectsRealtimeSync,
} from '../../src/features/objects/queries';
import { useTranslation } from '../../src/i18n/useTranslation';
import {
  ENTITY_FIELD_TYPES,
  buildFallbackEntityFieldSettings,
  getEntityFieldMap,
} from '../../src/features/fieldSettings/catalog';
import { useEntityFieldSettings } from '../../src/features/fieldSettings/queries';
import { t } from '../../src/i18n';
import { getPrefetchRegistry } from '../../src/shared/query/prefetchRegistry';
import { runAfterNavigationFrame } from '../../src/shared/perf/navigationWork';
import { joinFilterSummary, summarizeFilterPart } from '../../src/shared/filters/summary';
import { buildSearchIndex, matchesSearch } from '../../src/shared/search/matching';
import { OBJECT_SORT, objectSortOptions, sortObjects } from '../../src/shared/sorting/objectSort';
import {
  buildTagFacetCounts,
  buildTagFilterOptions,
  matchesSelectedTags,
} from '../../src/features/tags/filtering';
import { useCompanyTags } from '../../src/features/tags/queries';
import { getClientObjectLocationMode } from '../../src/features/objects/addressing';

const OBJECT_FILTER_DEFAULTS = {
  cities: [],
  streets: [],
  clientIds: [],
  objectTags: [],
};

function applyObjectFilters(items, values) {
  const list = Array.isArray(items) ? items : [];
  const selectedCities = Array.isArray(values?.cities) ? values.cities.map(String) : [];
  const selectedStreets = Array.isArray(values?.streets) ? values.streets.map(String) : [];
  const selectedClientIds = Array.isArray(values?.clientIds) ? values.clientIds.map(String) : [];
  const selectedObjectTags = Array.isArray(values?.objectTags) ? values.objectTags.map(String) : [];

  return list.filter((item) => {
    const usesManualAddress = getClientObjectLocationMode(item) === 'address';
    if (selectedCities.length > 0) {
      const city = usesManualAddress ? String(item?.city || '').trim() : '';
      if (!city || !selectedCities.includes(city)) return false;
    }
    if (selectedStreets.length > 0) {
      const street = usesManualAddress ? String(item?.street || '').trim() : '';
      if (!street || !selectedStreets.includes(street)) return false;
    }
    if (selectedClientIds.length > 0) {
      const clientId = String(item?.client_id || '');
      if (!clientId || !selectedClientIds.includes(clientId)) return false;
    }
    if (!matchesSelectedTags(item?.tags, selectedObjectTags)) return false;
    return true;
  });
}

function buildObjectAttributeFacetCounts(items) {
  const list = Array.isArray(items) ? items : [];
  const counts = {
    cities: {},
    streets: {},
    clients: {},
  };

  const increment = (target, rawValue) => {
    const value = String(rawValue || '').trim();
    if (!value) return;
    target[value] = (target[value] || 0) + 1;
  };

  list.forEach((item) => {
    if (getClientObjectLocationMode(item) === 'address') {
      increment(counts.cities, item?.city);
      increment(counts.streets, item?.street);
    }
    increment(counts.clients, item?.client_id);
  });

  return counts;
}

export default function ObjectsIndex() {
  const { theme } = useTheme();
  useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const objectPrefetchTaskRef = useRef(null);
  const params = useLocalSearchParams();
  const { profile } = useAuthContext();
  const { has } = usePermissions();
  const canViewClientPhones = has('canViewClientPhones');
  const [sortVisible, setSortVisible] = useState(false);
  const [sortKey, setSortKey] = useState(OBJECT_SORT.NAME_ASC);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');

  const filters = useFilters({
    screenKey: 'objects',
    defaults: OBJECT_FILTER_DEFAULTS,
  });
  const setFilterValue = filters.setValue;
  const applyFilters = filters.apply;
  const revalidateFilters = filters.revalidate;
  const routeObjectTag = useMemo(() => {
    const raw = Array.isArray(params?.filter_object_tag)
      ? params.filter_object_tag[0]
      : params?.filter_object_tag;
    return String(raw || '').trim();
  }, [params?.filter_object_tag]);
  const routeTagSeedRef = useRef('');

  useEffect(() => {
    if (!routeObjectTag) {
      routeTagSeedRef.current = '';
      return undefined;
    }
    if (routeTagSeedRef.current === routeObjectTag) return undefined;
    routeTagSeedRef.current = routeObjectTag;

    let cancelled = false;
    const seedTagFilter = async () => {
      await revalidateFilters();
      if (cancelled) return;

      const nextValues = {
        ...OBJECT_FILTER_DEFAULTS,
        objectTags: [routeObjectTag],
      };
      setQ('');
      setDebouncedQ('');
      Object.entries(nextValues).forEach(([key, value]) => setFilterValue(key, value));
      await applyFilters(nextValues);

      if (!cancelled) {
        router.setParams({ filter_object_tag: undefined });
      }
    };

    void seedTagFilter();
    return () => {
      cancelled = true;
    };
  }, [applyFilters, revalidateFilters, routeObjectTag, router, setFilterValue]);

  useFocusEffect(
    useCallback(() => {
      revalidateFilters({ extend: true });
    }, [revalidateFilters]),
  );

  const { data: companyIdFromQuery, isLoading: companyLoading } = useMyCompanyIdQuery();
  const companyId = companyIdFromQuery || profile?.company_id;
  const { data: objectFieldSettingsData } = useEntityFieldSettings(ENTITY_FIELD_TYPES.OBJECT, {
    enabled: !!companyId,
  });
  const objectFieldSettings = useMemo(
    () => objectFieldSettingsData || buildFallbackEntityFieldSettings(ENTITY_FIELD_TYPES.OBJECT),
    [objectFieldSettingsData],
  );
  const objectFieldsByKey = useMemo(
    () => getEntityFieldMap(objectFieldSettings),
    [objectFieldSettings],
  );

  const { data: allObjects = [], isLoading: objectsLoading, refetch: refetchObjects } = useCompanyObjects(
    companyId,
    { enabled: !!companyId && has('canViewObjects'), keepPreviousData: true, staleTime: 30 * 1000 },
  );
  const { data: companyObjectTags = [] } = useCompanyTags({
    companyId,
    tagType: 'object',
    enabled: !!companyId && has('canViewObjects'),
  });

  const { data: clients = [] } = useClients(
    { companyId, search: '' },
    { enabled: !!companyId && has('canViewClients'), staleTime: 30 * 1000 },
  );

  useClientObjectsRealtimeSync({ enabled: !!companyId && has('canViewObjects'), companyId });

  useEffect(() => {
    return () => {
      try {
        objectPrefetchTaskRef.current?.cancel?.();
      } catch {}
    };
  }, []);

  useEffect(() => {
    const ms = Number(theme?.timings?.backDelayMs ?? 300);
    const timer = setTimeout(() => setDebouncedQ(String(q || '').trim()), ms);
    return () => clearTimeout(timer);
  }, [q, theme?.timings?.backDelayMs]);

  const clientById = useMemo(() => {
    const map = new Map();
    clients.forEach((client) => {
      map.set(String(client.id), client);
    });
    return map;
  }, [clients]);

  const enrichedObjects = useMemo(
    () =>
      allObjects.map((item) => {
        const client = item?.client || clientById.get(String(item?.client_id || '')) || null;
        return {
          ...item,
          client,
          client_name:
            formatPersonName(client) || item?._client?.name || formatPersonName(item?.client) || '',
        };
      }),
    [allObjects, clientById],
  );

  const cityOptions = useMemo(() => {
    const set = new Set();
    enrichedObjects.forEach((item) => {
      if (getClientObjectLocationMode(item) !== 'address') return;
      const city = String(item?.city || '').trim();
      if (city) set.add(city);
    });
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b, 'ru', { sensitivity: 'base' }))
      .map((city) => ({ id: city, value: city, label: city }));
  }, [enrichedObjects]);

  const streetOptions = useMemo(() => {
    const set = new Set();
    enrichedObjects.forEach((item) => {
      if (getClientObjectLocationMode(item) !== 'address') return;
      const street = String(item?.street || '').trim();
      if (street) set.add(street);
    });
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b, 'ru', { sensitivity: 'base' }))
      .map((street) => ({ id: street, value: street, label: street }));
  }, [enrichedObjects]);

  const clientOptions = useMemo(
    () =>
      clients
        .map((client) => {
          const label = String(formatPersonName(client)).trim();
          if (!label) return null;
          return { id: String(client.id), value: String(client.id), label };
        })
        .filter(Boolean)
        .sort((a, b) => a.label.localeCompare(b.label, 'ru', { sensitivity: 'base' })),
    [clients],
  );
  const objectTagOptions = useMemo(
    () =>
      buildTagFilterOptions(
        [companyObjectTags, ...enrichedObjects.map((item) => item?.tags)],
        filters.values.objectTags,
      ),
    [companyObjectTags, enrichedObjects, filters.values.objectTags],
  );
  const objectTagFacetCounts = useMemo(
    () => buildTagFacetCounts(enrichedObjects, (item) => item?.tags),
    [enrichedObjects],
  );
  const objectAttributeFacetCounts = useMemo(
    () => buildObjectAttributeFacetCounts(enrichedObjects),
    [enrichedObjects],
  );

  const filteredByPanel = useMemo(() => {
    return applyObjectFilters(enrichedObjects, filters.values);
  }, [enrichedObjects, filters.values]);


  const filtered = useMemo(() => {
    return filteredByPanel.filter((item) => {
      if (!debouncedQ) return true;
      const client = item?.client || null;
      const usesManualAddress = getClientObjectLocationMode(item) === 'address';
      return matchesSearch(
        buildSearchIndex({
          texts: [
            item?.name,
            item?.summary,
            ...(usesManualAddress
              ? [item?.city, item?.street, item?.house, item?.region, item?.district, item?.country]
              : []),
            item?.client_name,
            client?.email,
            ...(Array.isArray(item?.tags) ? item.tags.map((tag) => tag?.value) : []),
          ],
          phones: canViewClientPhones ? collectClientPhoneSearchValues(client) : [],
        }),
        debouncedQ,
      );
    });
  }, [canViewClientPhones, debouncedQ, filteredByPanel]);

  const sortOptions = useMemo(() => objectSortOptions(t), []);

  const sortedFiltered = useMemo(
    () =>
      sortObjects(filtered, {
        sortKey,
        getName: (item) => item?.name || '',
        getCity: (item) => getClientObjectLocationMode(item) === 'address' ? item?.city || '' : '',
        getClientName: (item) => item?.client_name || '',
      }),
    [filtered, sortKey],
  );

  const filterSummaryData = useMemo(() => {
    const fullParts = [];
    const compactParts = [];
    if (filters.values.cities?.length) {
      fullParts.push(
        summarizeFilterPart({
          label: t('common_city'),
          values: filters.values.cities,
          countWhenMany: false,
        }),
      );
      compactParts.push(
        summarizeFilterPart({
          label: t('common_city'),
          values: filters.values.cities,
          countWhenMany: true,
        }),
      );
    }
    if (filters.values.streets?.length) {
      fullParts.push(
        summarizeFilterPart({
          label: t('common_street'),
          values: filters.values.streets,
          countWhenMany: false,
        }),
      );
      compactParts.push(
        summarizeFilterPart({
          label: t('common_street'),
          values: filters.values.streets,
          countWhenMany: true,
        }),
      );
    }
    if (filters.values.clientIds?.length) {
      const names = filters.values.clientIds
        .map((clientId) => clientById.get(String(clientId)))
        .map((client) => formatPersonName(client) || null)
        .filter(Boolean);
      if (names.length) {
        fullParts.push(
          summarizeFilterPart({
            label: t('common_client'),
            values: names,
            countWhenMany: false,
          }),
        );
        compactParts.push(
          summarizeFilterPart({
            label: t('common_client'),
            values: names,
            countWhenMany: true,
          }),
        );
      }
    }
    if (filters.values.objectTags?.length) {
      fullParts.push(
        summarizeFilterPart({
          label: t('tags_objects_label'),
          values: filters.values.objectTags,
          countWhenMany: false,
        }),
      );
      compactParts.push(
        summarizeFilterPart({
          label: t('tags_objects_label'),
          values: filters.values.objectTags,
          countWhenMany: true,
        }),
      );
    }
    return {
      full: joinFilterSummary(fullParts, t('common_bullet')),
      compact: joinFilterSummary(compactParts, t('common_bullet')),
    };
  }, [
    clientById,
    filters.values.cities,
    filters.values.clientIds,
    filters.values.objectTags,
    filters.values.streets,
  ]);

  const { refreshing, didSucceed, onRefresh } = useManagedRefresh(refetchObjects);
  const { indicator: refreshIndicator } = usePullToRefreshFeedback(refreshing, { didSucceed });

  const openObject = useCallback(
    (id) => {
      const normalizedId = String(id || '').trim();
      if (!normalizedId) return;
      Keyboard.dismiss();
      router.push(`/objects/${normalizedId}`);
      runAfterNavigationFrame(() => {
        getPrefetchRegistry()
          .run(`object-detail:${normalizedId}`, () => ensureClientObjectPrefetch(queryClient, normalizedId))
          .catch(() => {});
      });
    },
    [queryClient, router],
  );

  const prefetchVisibleObjects = useCallback(
    ({ viewableItems }) => {
      const ids = (Array.isArray(viewableItems) ? viewableItems : [])
        .map((item) => item?.item?.id)
        .filter(Boolean)
        .slice(0, 2);
      if (!ids.length) return;

      try {
        objectPrefetchTaskRef.current?.cancel?.();
      } catch {}
      objectPrefetchTaskRef.current = InteractionManager.runAfterInteractions(() => {
        const registry = getPrefetchRegistry();
        ids.forEach((id) => {
          registry.run(`object-detail:${id}`, () => ensureClientObjectPrefetch(queryClient, id)).catch(() => {});
        });
      });
    },
    [queryClient],
  );
  const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 50 }), []);

  const renderItem = useCallback(
    ({ item }) => (
      <ObjectCard
        item={item}
        canViewClients={has('canViewClients')}
        objectFieldsByKey={objectFieldsByKey}
        onPress={openObject}
      />
    ),
    [has, objectFieldsByKey, openObject],
  );

  const keyExtractor = useCallback((item) => String(item.id), []);

  if (!has('canViewObjects')) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['left', 'right']}>
        <AppHeader back options={{ title: t('clients_objects_section'), helpTopic: 'objects' }} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.lg }}>
          <Text style={{ color: theme.colors.textSecondary }}>{t('objects_no_view_permission')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if ((objectsLoading || companyLoading) && allObjects.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['left', 'right']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['left', 'right']}>
      <AppHeader back options={{ title: t('clients_objects_section'), helpTopic: 'objects' }} />

      <DismissKeyboardArea style={{ flex: 1 }}>
        <View style={{ paddingTop: theme.spacing.sm }}>
          <SearchFiltersBar
            value={q}
            onChangeText={setQ}
            onClear={() => setQ('')}
            placeholder={t('objects_select')}
            onOpenFilters={filters.open}
            onOpenSort={() => setSortVisible(true)}
            filterSummary={filterSummaryData.full}
            filterSummaryCompact={filterSummaryData.compact}
            onResetFilters={async () => {
              const reset = filters.reset();
              await filters.apply(reset);
            }}
            metaText={`${t('common_total')}: ${sortedFiltered.length}`}
          />
        </View>

        <View style={{ flex: 1 }}>
          {refreshIndicator}
          <FlatList
            data={sortedFiltered}
            contentContainerStyle={{
              paddingHorizontal: theme.components.screenLayout.contentPaddingX,
              paddingBottom: theme.components.screenLayout.contentPaddingBottom,
            }}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={10}
            maxToRenderPerBatch={8}
            updateCellsBatchingPeriod={34}
            windowSize={9}
            removeClippedSubviews={Platform.OS === 'android'}
            onViewableItemsChanged={prefetchVisibleObjects}
            viewabilityConfig={viewabilityConfig}
            refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            ListEmptyComponent={<EmptyListState />}
          />
        </View>
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

      <FiltersPanel
        visible={filters.visible}
        onClose={filters.close}
        mode="objects"
        showSearchCategory={false}
        inlineOptionSearch={{
          categoryKeys: ['objects_cities', 'objects_streets', 'objects_clients', 'objects_tags'],
        }}
        objectFilters={{
          cities: cityOptions,
          streets: streetOptions,
          clients: clientOptions,
          tags: objectTagOptions,
          facetCounts: {
            total: enrichedObjects.length,
            cities: objectAttributeFacetCounts.cities,
            streets: objectAttributeFacetCounts.streets,
            clients: objectAttributeFacetCounts.clients,
            objectTags: objectTagFacetCounts,
          },
        }}
        values={filters.values}
        defaults={OBJECT_FILTER_DEFAULTS}
        setValue={filters.setValue}
        onApply={(nextValues) => filters.apply(nextValues)}
        onReset={() => filters.reset()}
      />
    </SafeAreaView>
  );
}
