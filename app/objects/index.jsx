import { useCallback, useEffect, useMemo, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActivityIndicator, FlatList, Keyboard, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import AppHeader from '../../components/navigation/AppHeader';
import SearchFiltersBar from '../../components/filters/SearchFiltersBar';
import SortSelectModal from '../../components/filters/SortSelectModal';
import FiltersPanel from '../../components/filters/FiltersPanel';
import DismissKeyboardArea from '../../components/layout/DismissKeyboardArea';
import { useFilters } from '../../components/hooks/useFilters';
import ObjectCard from '../../components/objects/ObjectCard';
import {
  ThemedRefreshControl,
  useManagedRefresh,
  usePullToRefreshFeedback,
} from '../../components/ui/PullToRefreshFeedback';
import { usePermissions } from '../../lib/permissions';
import { useTheme } from '../../theme/ThemeProvider';
import { useMyCompanyIdQuery } from '../../src/features/profile/queries';
import { useAuthContext } from '../../providers/SimpleAuthProvider';
import { useClients } from '../../src/features/clients/queries';
import { collectClientPhoneSearchValues } from '../../src/features/clients/additionalPhones';
import { useCompanyObjects, useClientObjectsRealtimeSync } from '../../src/features/objects/queries';
import { useTranslation } from '../../src/i18n/useTranslation';
import { t } from '../../src/i18n';
import { joinFilterSummary, summarizeFilterPart } from '../../src/shared/filters/summary';
import { buildSearchIndex, matchesSearch } from '../../src/shared/search/matching';
import { OBJECT_SORT, objectSortOptions, sortObjects } from '../../src/shared/sorting/objectSort';

const OBJECT_FILTER_DEFAULTS = {
  cities: [],
  streets: [],
  clientIds: [],
};

function applyObjectFilters(items, values) {
  const list = Array.isArray(items) ? items : [];
  const selectedCities = Array.isArray(values?.cities) ? values.cities.map(String) : [];
  const selectedStreets = Array.isArray(values?.streets) ? values.streets.map(String) : [];
  const selectedClientIds = Array.isArray(values?.clientIds) ? values.clientIds.map(String) : [];

  return list.filter((item) => {
    if (selectedCities.length > 0) {
      const city = String(item?.city || '').trim();
      if (!city || !selectedCities.includes(city)) return false;
    }
    if (selectedStreets.length > 0) {
      const street = String(item?.street || '').trim();
      if (!street || !selectedStreets.includes(street)) return false;
    }
    if (selectedClientIds.length > 0) {
      const clientId = String(item?.client_id || '');
      if (!clientId || !selectedClientIds.includes(clientId)) return false;
    }
    return true;
  });
}

function isObjectsFilterApplied(values, defaults) {
  const normalize = (arr) =>
    Array.isArray(arr) ? arr.map((v) => String(v)).filter(Boolean).sort() : [];
  const eq = (a, b) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  };

  const cities = normalize(values?.cities);
  const streets = normalize(values?.streets);
  const clients = normalize(values?.clientIds);

  const defaultCities = normalize(defaults?.cities);
  const defaultStreets = normalize(defaults?.streets);
  const defaultClients = normalize(defaults?.clientIds);

  return !eq(cities, defaultCities) || !eq(streets, defaultStreets) || !eq(clients, defaultClients);
}

export default function ObjectsIndex() {
  const { theme } = useTheme();
  useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { profile } = useAuthContext();
  const { has } = usePermissions();
  const [sortVisible, setSortVisible] = useState(false);
  const [sortKey, setSortKey] = useState(OBJECT_SORT.NAME_ASC);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const selectedTag = useMemo(() => {
    const raw = Array.isArray(params?.tag) ? params.tag[0] : params?.tag;
    return String(raw || '').trim();
  }, [params?.tag]);
  const activeTagFilter = useMemo(
    () => (selectedTag && String(q || '').trim() === selectedTag ? selectedTag : ''),
    [q, selectedTag],
  );

  const filters = useFilters({
    screenKey: 'objects',
    defaults: OBJECT_FILTER_DEFAULTS,
  });
  const revalidateFilters = filters.revalidate;

  useFocusEffect(
    useCallback(() => {
      revalidateFilters({ extend: true });
    }, [revalidateFilters]),
  );

  const { data: companyIdFromQuery, isLoading: companyLoading } = useMyCompanyIdQuery();
  const companyId = companyIdFromQuery || profile?.company_id;

  const { data: allObjects = [], isLoading: objectsLoading, refetch: refetchObjects } = useCompanyObjects(
    companyId,
    { enabled: !!companyId && has('canViewObjects'), keepPreviousData: true, staleTime: 30 * 1000 },
  );

  const { data: clients = [] } = useClients(
    { companyId, search: '' },
    { enabled: !!companyId && has('canViewClients'), staleTime: 30 * 1000 },
  );

  useClientObjectsRealtimeSync({ enabled: !!companyId && has('canViewObjects'), companyId });

  useEffect(() => {
    const ms = Number(theme?.timings?.backDelayMs ?? 300);
    const timer = setTimeout(() => setDebouncedQ(String(q || '').trim()), ms);
    return () => clearTimeout(timer);
  }, [q, theme?.timings?.backDelayMs]);

  useEffect(() => {
    if (!selectedTag) return;
    setQ(selectedTag);
  }, [selectedTag]);

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
            client?.fullName || client?.full_name || item?._client?.name || item?.client?.full_name || '',
        };
      }),
    [allObjects, clientById],
  );

  const cityOptions = useMemo(() => {
    const set = new Set();
    enrichedObjects.forEach((item) => {
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
          const label = String(client?.fullName || client?.full_name || '').trim();
          if (!label) return null;
          return { id: String(client.id), value: String(client.id), label };
        })
        .filter(Boolean)
        .sort((a, b) => a.label.localeCompare(b.label, 'ru', { sensitivity: 'base' })),
    [clients],
  );

  const filteredByPanel = useMemo(() => {
    return applyObjectFilters(enrichedObjects, filters.values);
  }, [enrichedObjects, filters.values]);

  const previewCountResolver = useCallback(
    (draftValues) => applyObjectFilters(enrichedObjects, draftValues).length,
    [enrichedObjects],
  );
  const previewStatusResolver = useCallback(
    ({ draft, defaults, count }) => {
      const applied = isObjectsFilterApplied(draft, defaults);
      if (!applied) {
        return { visible: false };
      }
      return {
        visible: true,
        color: Number(count || 0) > 0 ? theme.colors.success : theme.colors.danger,
      };
    },
    [theme.colors.danger, theme.colors.success],
  );

  const filtered = useMemo(() => {
    return filteredByPanel.filter((item) => {
      const tagMatch =
        !activeTagFilter ||
        (Array.isArray(item?.tags) &&
          item.tags.some((tag) => String(tag?.value || '').trim().toLowerCase() === activeTagFilter.toLowerCase()));
      if (!tagMatch) return false;
      if (!debouncedQ) return true;
      const client = item?.client || null;
      return matchesSearch(
        buildSearchIndex({
          texts: [
            item?.name,
            item?.summary,
            item?.city,
            item?.street,
            item?.house,
            item?.region,
            item?.district,
            item?.country,
            item?.client_name,
            client?.email,
            ...(Array.isArray(item?.tags) ? item.tags.map((tag) => tag?.value) : []),
          ],
          phones: collectClientPhoneSearchValues(client),
        }),
        debouncedQ,
      );
    });
  }, [activeTagFilter, debouncedQ, filteredByPanel]);

  const sortOptions = useMemo(() => objectSortOptions(t), []);

  const sortedFiltered = useMemo(
    () =>
      sortObjects(filtered, {
        sortKey,
        getName: (item) => item?.name || '',
        getCity: (item) => item?.city || '',
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
        .map((client) => client?.fullName || client?.full_name || null)
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
    return {
      full: joinFilterSummary(fullParts, t('common_bullet')),
      compact: joinFilterSummary(compactParts, t('common_bullet')),
    };
  }, [clientById, filters.values.cities, filters.values.clientIds, filters.values.streets]);

  const { refreshing, didSucceed, onRefresh } = useManagedRefresh(refetchObjects);
  const { indicator: refreshIndicator } = usePullToRefreshFeedback(refreshing, { didSucceed });

  const renderItem = useCallback(
    ({ item }) => (
      <ObjectCard
        item={item}
        canViewClients={has('canViewClients')}
        onPress={(id) => {
          Keyboard.dismiss();
          router.push(`/objects/${id}`);
        }}
      />
    ),
    [has, router],
  );

  const keyExtractor = useCallback((item) => String(item.id), []);

  if (!has('canViewObjects')) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['left', 'right']}>
        <AppHeader back options={{ title: t('clients_objects_section') }} />
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
      <AppHeader back options={{ title: t('clients_objects_section') }} />

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
            contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.xl }}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
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
          categoryKeys: ['objects_cities', 'objects_streets', 'objects_clients'],
        }}
        objectFilters={{
          cities: cityOptions,
          streets: streetOptions,
          clients: clientOptions,
        }}
        values={filters.values}
        defaults={OBJECT_FILTER_DEFAULTS}
        previewCountResolver={previewCountResolver}
        previewCountLabel={t('common_found')}
        previewStatusResolver={previewStatusResolver}
        setValue={filters.setValue}
        onApply={(nextValues) => filters.apply(nextValues)}
        onReset={() => filters.reset()}
      />
    </SafeAreaView>
  );
}

