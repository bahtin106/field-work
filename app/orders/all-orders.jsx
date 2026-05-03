import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
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

import DynamicOrderCard from '../../components/DynamicOrderCard';
import FiltersPanel from '../../components/filters/FiltersPanel';
import SearchFiltersBar from '../../components/filters/SearchFiltersBar';
import SortSelectModal from '../../components/filters/SortSelectModal';
import Screen from '../../components/layout/Screen';
import AppHeader from '../../components/navigation/AppHeader';
import {
  ThemedRefreshControl,
  useManagedRefresh,
  usePullToRefreshFeedback,
} from '../../components/ui/PullToRefreshFeedback';
import { useCompanySettings } from '../../hooks/useCompanySettings';
import goBackSmart from '../../lib/navigation/goBackSmart';
import { usePermissions } from '../../lib/permissions';
import { supabase } from '../../lib/supabase';
import { fetchWorkTypes, getMyCompanyId } from '../../lib/workTypes';
import {
  ensureRequestPrefetch,
  useAllRequests,
  useRequestExecutors,
  useRequestRealtimeSync,
} from '../../src/features/requests/queries';
import { resolveRequestTitle } from '../../src/features/requests/title';
import { useClients } from '../../src/features/clients/queries';
import { hasRelationFilters, parseRelationIdsParam } from '../../src/features/requests/relationFilters';
import { useMyCompanyIdQuery } from '../../src/features/profile/queries';
import {
  ENTITY_FIELD_TYPES,
  buildFallbackEntityFieldSettings,
  getEntityFieldMap,
} from '../../src/features/fieldSettings/catalog';
import { useEntityFieldSettings } from '../../src/features/fieldSettings/queries';
import { joinFilterSummary, summarizeFilterPart } from '../../src/shared/filters/summary';
import {
  markFirstContent,
  markScreenMount,
  startFpsProbe,
  trackRender,
} from '../../src/shared/perf/devMetrics';
import { queryKeys } from '../../src/shared/query/queryKeys';
import { getPrefetchRegistry } from '../../src/shared/query/prefetchRegistry';
import { buildSearchIndex, matchesSearch } from '../../src/shared/search/matching';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme/ThemeProvider';
import DeferredScreen from '../../src/shared/perf/DeferredScreen';
import { getOfflineSnapshot } from '../../src/shared/offline/offlineStatus';

const PERM_CACHE = (globalThis.PERM_CACHE ||= { canViewAll: { value: null, ts: 0 } });
const PERM_TTL_MS = 10 * 60 * 1000;
const EMPTY_ARRAY = [];
const ORDER_FILTER_DEFAULTS = {
  workTypes: [],
  statuses: [],
  clientIds: [],
  executorId: null,
  departureDateFrom: null,
  departureDateTo: null,
  departureTimeFrom: null,
  departureTimeTo: null,
  sumMin: '',
  sumMax: '',
};

async function checkCanViewAll() {
  try {
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes?.user?.id;
    if (!uid) return false;

    const { data: me, error: profileError } = await supabase
      .from('profiles')
      .select('role, company_id')
      .eq('id', uid)
      .maybeSingle();
    if (profileError || !me?.role || !me?.company_id) return null;

    const { data: perm, error: permError } = await supabase
      .from('app_role_permissions')
      .select('value')
      .eq('company_id', me.company_id)
      .eq('role', me.role)
      .eq('key', 'canViewAllOrders')
      .maybeSingle();
    if (permError) return null;

    if (perm?.value === null || perm?.value === undefined) return true;
    if (typeof perm.value === 'boolean') return perm.value;
    if (typeof perm.value === 'number') return perm.value === 1;
    if (typeof perm.value === 'string') {
      return ['1', 'true', 't', 'yes', 'y'].includes(perm.value.trim().toLowerCase());
    }
    return null;
  } catch {
    return null;
  }
}

function AllOrdersContent() {
  trackRender('AllRequests', 30);

  const [allowed, setAllowed] = useState(() => {
    const rec = PERM_CACHE.canViewAll;
    return rec && Date.now() - (rec.ts || 0) < PERM_TTL_MS ? rec.value : null;
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const ok = await checkCanViewAll();
        if (!alive) return;
        setAllowed(ok);
        PERM_CACHE.canViewAll = { value: ok, ts: Date.now() };
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, []);

  const { theme } = useTheme();
  const { t } = useTranslation();
  const { has, loading: permLoading } = usePermissions();
  const queryClient = useQueryClient();
  const offlineMode = !getOfflineSnapshot().isOnline;
  const permissionByRole = !permLoading ? has('canViewAllOrders') : null;
  const isExplicitlyDeniedOnline =
    !offlineMode && allowed === false && permissionByRole === false;
  const effectiveAllowed = offlineMode
    ? true
    : allowed === true || permissionByRole === true
      ? true
      : isExplicitlyDeniedOnline
        ? false
        : null;

  useEffect(() => {
    markScreenMount('AllRequests');
  }, []);

  useEffect(() => startFpsProbe('AllRequests', 3500), []);

  const styles = useMemo(() => createStyles(theme), [theme]);

  const router = useRouter();
  const navigation = useNavigation();
  const handleBackPress = useCallback(() => {
    goBackSmart(navigation, router, null, '/orders');
  }, [navigation, router]);

  const {
    filter,
    executor,
    department,
    search,
    work_type,
    client_ids,
    relation_client_id,
    relation_object_ids,
    relation_label,
  } = useLocalSearchParams();

  const relationClientId = useMemo(
    () =>
      Array.isArray(relation_client_id)
        ? String(relation_client_id[0] || '')
        : String(relation_client_id || ''),
    [relation_client_id],
  );
  const relationObjectIds = useMemo(() => parseRelationIdsParam(relation_object_ids), [relation_object_ids]);
  const relationLabel = useMemo(
    () => (Array.isArray(relation_label) ? String(relation_label[0] || '') : String(relation_label || '')),
    [relation_label],
  );
  const hasLinkedRelationFilter = useMemo(
    () =>
      hasRelationFilters({
        clientId: relationClientId,
        objectIds: relationObjectIds,
      }),
    [relationClientId, relationObjectIds],
  );

  const [statusFilter, setStatusFilter] = useState(
    filter === 'completed'
      ? 'done'
      : filter === 'in_progress'
        ? 'in_progress'
        : filter === 'new'
          ? 'new'
          : filter || 'all',
  );
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [_hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [sortVisible, setSortVisible] = useState(false);
  const [sortKey, setSortKey] = useState('date_desc');
  const [departmentFilter] = useState(department ? Number(department) : null);
  const [orderFilters, setOrderFilters] = useState(() => ({
    ...ORDER_FILTER_DEFAULTS,
    workTypes: work_type
      ? String(work_type)
          .split(',')
          .map((value) => String(value).trim())
          .filter(Boolean)
      : [],
    clientIds: client_ids
      ? String(client_ids)
          .split(',')
          .map((value) => String(value).trim())
          .filter(Boolean)
      : [],
    executorId: executor ? String(executor) : null,
  }));
  const [searchQuery, setSearchQuery] = useState(String(search || '').trim());
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const detailNavLockRef = useRef({ id: '', ts: 0 });
  const viewabilityPrefetchRef = useRef({ key: '', ts: 0 });

  const executorFilter = orderFilters.executorId;
  const workTypeFilter = orderFilters.workTypes;
  const setOrderFilterValue = useCallback((key, value) => {
    setOrderFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const [useWorkTypes, setUseWorkTypesFlag] = useState(false);
  const [workTypes, setWorkTypes] = useState([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cid = await getMyCompanyId();
        if (!alive) return;
        if (!cid) {
          setUseWorkTypesFlag(false);
          setWorkTypes([]);
          return;
        }
        const { useWorkTypes: flag, types } = await fetchWorkTypes(cid);
        if (!alive) return;
        setUseWorkTypesFlag(!!flag);
        setWorkTypes(types || []);
      } catch {
        if (!alive) return;
        setUseWorkTypesFlag(false);
        setWorkTypes([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const { data: companyId } = useMyCompanyIdQuery();
  const { settings: companySettings } = useCompanySettings(companyId);
  const { data: orderFieldSettingsData } = useEntityFieldSettings(ENTITY_FIELD_TYPES.ORDER, {
    enabled: effectiveAllowed === true,
  });
  const orderFieldSettings = useMemo(
    () => orderFieldSettingsData || buildFallbackEntityFieldSettings(ENTITY_FIELD_TYPES.ORDER),
    [orderFieldSettingsData],
  );
  const orderFieldsByKey = useMemo(
    () => getEntityFieldMap(orderFieldSettings),
    [orderFieldSettings],
  );
  const departureTimeEnabled = orderFieldsByKey.get('departure_time')?.isEnabled !== false;
  const { data: companyClients = [] } = useClients(
    { companyId, search: '' },
    { enabled: !!companyId },
  );
  const clientOptions = useMemo(
    () =>
      (Array.isArray(companyClients) ? companyClients : [])
        .map((row) => {
          const id = String(row?.id || '').trim();
          if (!id) return null;
          const label =
            [row?.first_name, row?.middle_name, row?.last_name].filter(Boolean).join(' ').trim() ||
            String(row?.full_name || '').trim() ||
            String(row?.phone || '').trim() ||
            id;
          return { id, value: id, label };
        })
        .filter(Boolean),
    [companyClients],
  );
  const allRequestsParams = useMemo(() => {
    const next = {};
    if (statusFilter && statusFilter !== 'all') next.status = statusFilter;
    if (executorFilter) next.executorId = executorFilter;
    if (departmentFilter != null) next.departmentId = departmentFilter;
    if (useWorkTypes && Array.isArray(workTypeFilter) && workTypeFilter.length) {
      next.workTypeIds = workTypeFilter;
    }
    if (Array.isArray(orderFilters.clientIds) && orderFilters.clientIds.length) {
      next.clientIds = orderFilters.clientIds.map(String);
    }
    if (relationClientId) next.relationClientId = relationClientId;
    if (relationObjectIds.length) next.relationObjectIds = relationObjectIds;
    return next;
  }, [departmentFilter, executorFilter, orderFilters.clientIds, relationClientId, relationObjectIds, statusFilter, useWorkTypes, workTypeFilter]);

  const {
    items: requestItems = [],
    isLoading: requestsLoading,
    refetch: refetchRequests,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useAllRequests(allRequestsParams, { enabled: effectiveAllowed !== false });

  const { data: executorsData } = useRequestExecutors({ enabled: effectiveAllowed === true });
  const executors = useMemo(() => executorsData ?? EMPTY_ARRAY, [executorsData]);

  useRequestRealtimeSync({ enabled: effectiveAllowed === true, companyId });

  useEffect(() => {
    if (departmentFilter == null || !executorFilter) return;
    const selectedExecutor = executors.find((item) => String(item.id) === String(executorFilter));
    if (selectedExecutor && Number(selectedExecutor.department_id) !== Number(departmentFilter)) {
      setOrderFilterValue('executorId', null);
    }
  }, [departmentFilter, executorFilter, executors, setOrderFilterValue]);

  const lastItemsSignatureRef = useRef('');
  useEffect(() => {
    const signature = Array.isArray(requestItems)
      ? requestItems.map((item) => `${item?.id || ''}:${item?.updated_at || ''}`).join('|')
      : '';
    if (lastItemsSignatureRef.current !== signature) {
      lastItemsSignatureRef.current = signature;
      setOrders(requestItems);
    }
    setLoading(requestsLoading && requestItems.length === 0);
    setHasMore(!!hasNextPage);
    setLoadingMore(isFetchingNextPage);
  }, [hasNextPage, isFetchingNextPage, requestItems, requestsLoading]);

  const firstContentMarkedRef = useRef(false);
  useEffect(() => {
    if (firstContentMarkedRef.current || requestsLoading) return;
    firstContentMarkedRef.current = true;
    markFirstContent('AllRequests');
  }, [requestsLoading]);

  const refreshAll = useCallback(async () => {
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: ['requests'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.requests.executors(companyId) }),
      queryClient.invalidateQueries({ queryKey: ['requests', 'detail'] }),
    ]);
    await refetchRequests();
  }, [companyId, queryClient, refetchRequests]);
  const { refreshing, didSucceed, onRefresh } = useManagedRefresh(refreshAll);
  const { indicator: refreshIndicator } = usePullToRefreshFeedback(refreshing, { didSucceed });

  const getStatusLabel = useCallback(
    (key) => {
      switch (key) {
        case 'feed':
          return t('orders_feed_tab', 'Лента');
        case 'all':
          return t('common_all', 'Все');
        case 'new':
          return t('order_status_new');
        case 'in_progress':
          return t('order_status_in_progress');
        case 'done':
          return t('order_status_completed');
        default:
          return '';
      }
    },
    [t],
  );

  const executorOptions = useMemo(() => {
    let list = executors;
    if (departmentFilter != null) {
      list = list.filter((item) => Number(item.department_id) === Number(departmentFilter));
    }
    return list
      .map((item) => {
        const id = String(item?.id || '').trim();
        if (!id) return null;
        const label =
          String(item?.full_name || '').trim() ||
          [item?.first_name, item?.middle_name, item?.last_name].filter(Boolean).join(' ').trim() ||
          item?.email ||
          id;
        return {
          id,
          value: id,
          label,
          meta: item?.role ? t(`role_${item.role}`, item.role) : '',
        };
      })
      .filter(Boolean);
  }, [departmentFilter, executors, t]);

  const filterSummaryData = useMemo(() => {
    const fullParts = [];
    const compactParts = [];

    if (useWorkTypes && workTypeFilter.length) {
      const workTypeNames = workTypeFilter
        .map((id) => workTypes.find((item) => String(item.id) === String(id))?.name)
        .filter(Boolean);
      if (workTypeNames.length) {
        fullParts.push(
          summarizeFilterPart({
            label: t('order_field_work_type'),
            values: workTypeNames,
            countWhenMany: false,
          }),
        );
        compactParts.push(
          summarizeFilterPart({
            label: t('order_field_work_type'),
            values: workTypeNames,
            countWhenMany: true,
          }),
        );
      }
    }

    if (executorFilter) {
      const executorLabel = executorOptions.find((item) => item.id === executorFilter)?.label;
      if (executorLabel) {
        fullParts.push(`${t('orders_filter_executor', 'Исполнитель')}: ${executorLabel}`);
        compactParts.push(`${t('orders_filter_executor', 'Исполнитель')}: ${executorLabel}`);
      }
    }

    if (Array.isArray(orderFilters.clientIds) && orderFilters.clientIds.length) {
      const labels = orderFilters.clientIds
        .map((id) => clientOptions.find((item) => String(item.id) === String(id))?.label)
        .filter(Boolean);
      if (labels.length) {
        fullParts.push(
          summarizeFilterPart({
            label: t('common_client', 'Клиент'),
            values: labels,
            countWhenMany: false,
          }),
        );
        compactParts.push(
          summarizeFilterPart({
            label: t('common_client', 'Клиент'),
            values: labels,
            countWhenMany: true,
          }),
        );
      }
    }

    return {
      full: joinFilterSummary(fullParts, t('common_bullet')),
      compact: joinFilterSummary(compactParts, t('common_bullet')),
    };
  }, [clientOptions, executorFilter, executorOptions, orderFilters.clientIds, t, useWorkTypes, workTypeFilter, workTypes]);

  const filteredOrders = useMemo(() => {
    const q = deferredSearchQuery.trim().toLowerCase();
    return (orders || []).filter((order) => {
      if (!q) return true;
      return matchesSearch(
        buildSearchIndex({
          texts: [
            resolveRequestTitle(order, {
              fallbackDate: order?.time_window_start || order?.created_at,
              prefix: t('order_auto_title_prefix', 'Заявка от'),
            }),
            order?.fio,
            order?.region,
            order?.city,
            order?.street,
            order?.house,
            order?.status,
            order?.description,
            order?.comment,
            order?.object_name,
            order?.object_summary,
          ],
          phones: [
            order?.customer_phone_visible,
            order?.customer_phone,
            order?.phone,
          ],
        }),
        q,
      );
    });
  }, [deferredSearchQuery, orders, t]);

  const sortOptions = useMemo(
    () => [
      { id: 'date_desc', label: t('orders_sort_date_desc', 'Сначала новые') },
      { id: 'date_asc', label: t('orders_sort_date_asc', 'Сначала старые') },
      { id: 'amount_desc', label: t('orders_sort_amount_desc', 'Сумма: по убыванию') },
      { id: 'amount_asc', label: t('orders_sort_amount_asc', 'Сумма: по возрастанию') },
    ],
    [t],
  );

  const sortedFilteredOrders = useMemo(() => {
    const parseOrderDate = (item) => {
      const ts = item?.time_window_start ? new Date(item.time_window_start).getTime() : NaN;
      return Number.isFinite(ts) ? ts : 0;
    };
    const parseAmount = (item) => {
      const value = Number(item?.start_price ?? item?.sum ?? 0);
      return Number.isFinite(value) ? value : 0;
    };
    const arr = Array.isArray(filteredOrders) ? [...filteredOrders] : [];
    arr.sort((a, b) => {
      switch (sortKey) {
        case 'date_asc':
          return parseOrderDate(a) - parseOrderDate(b);
        case 'amount_desc':
          return parseAmount(b) - parseAmount(a);
        case 'amount_asc':
          return parseAmount(a) - parseAmount(b);
        case 'date_desc':
        default:
          return parseOrderDate(b) - parseOrderDate(a);
      }
    });
    return arr;
  }, [filteredOrders, sortKey]);

  const loadMore = useCallback(async () => {
    if (isFetchingNextPage || !hasNextPage || loading) return;
    await fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, loading]);

  const returnParamsRef = useRef({
    filter: statusFilter,
    executor: executorFilter,
    department: departmentFilter,
    search: searchQuery,
    client_ids: Array.isArray(orderFilters.clientIds) ? orderFilters.clientIds.join(',') : '',
    relation_client_id: relationClientId,
    relation_object_ids: relationObjectIds.join(','),
    relation_label: relationLabel,
  });
  useEffect(() => {
    returnParamsRef.current = {
      filter: statusFilter,
      executor: executorFilter,
      department: departmentFilter,
      search: searchQuery,
      ...(Array.isArray(orderFilters.clientIds) && orderFilters.clientIds.length
        ? { client_ids: orderFilters.clientIds.join(',') }
        : {}),
      ...(relationClientId ? { relation_client_id: relationClientId } : {}),
      ...(relationObjectIds.length ? { relation_object_ids: relationObjectIds.join(',') } : {}),
      ...(relationLabel ? { relation_label: relationLabel } : {}),
    };
  }, [departmentFilter, executorFilter, orderFilters.clientIds, relationClientId, relationLabel, relationObjectIds, searchQuery, statusFilter]);

  const openOrderDetails = useCallback(
    (orderIdRaw) => {
      const orderId = String(orderIdRaw || '').trim();
      if (!orderId) return;
      const now = Date.now();
      const prev = detailNavLockRef.current;
      if (prev.id === orderId && now - prev.ts < 1200) return;
      detailNavLockRef.current = { id: orderId, ts: now };
      router.push({
        pathname: `/orders/${orderId}`,
        params: {
          returnTo: '/orders/all-orders',
          returnParams: JSON.stringify(returnParamsRef.current),
        },
      });
      InteractionManager.runAfterInteractions(() => {
        const registry = getPrefetchRegistry();
        registry
          .run(`request-detail:${orderId}`, () => ensureRequestPrefetch(queryClient, orderId))
          .catch(() => {});
      });
    },
    [queryClient, router],
  );

  const renderItem = useCallback(
    ({ item: order }) => (
      <DynamicOrderCard
        order={order}
        context="all_orders"
        onPress={openOrderDetails}
        departureTimeEnabled={departureTimeEnabled}
        orderFieldsByKey={orderFieldsByKey}
        companyCurrency={companySettings?.currency || null}
      />
    ),
    [companySettings?.currency, departureTimeEnabled, openOrderDetails, orderFieldsByKey],
  );

  const renderFooter = useCallback(() => {
    if (!loadingMore) return null;
    return (
      <View style={{ paddingVertical: 20 }}>
        <ActivityIndicator size="small" color={theme.colors.primary} />
      </View>
    );
  }, [loadingMore, theme.colors.primary]);

  const keyExtractor = useCallback((item) => String(item.id), []);
  const onViewableItemsChanged = useMemo(
    () => ({ viewableItems }) => {
      const ids = viewableItems
        .map((item) => item?.item?.id)
        .filter(Boolean)
        .slice(0, 6)
        .map(String);
      if (!ids.length) return;
      const key = ids.join('|');
      const now = Date.now();
      if (viewabilityPrefetchRef.current.key === key && now - viewabilityPrefetchRef.current.ts < 2500) {
        return;
      }
      viewabilityPrefetchRef.current = { key, ts: now };
      const registry = getPrefetchRegistry();
      ids.forEach((id) => {
        registry.run(`request-detail:${id}`, () => ensureRequestPrefetch(queryClient, id)).catch(() => {});
      });
    },
    [queryClient],
  );

  useFocusEffect(
    useCallback(
      () => () => {
        queryClient.cancelQueries({ queryKey: ['requests', 'all'] });
        queryClient.cancelQueries({ queryKey: ['requests', 'executors'] });
        queryClient.cancelQueries({ queryKey: ['requests', 'detail'] });
      },
      [queryClient],
    ),
  );

  const listHeader = useMemo(
    () => (
      <View style={styles.listHeader}>
        <Text style={styles.header}>Все заявки</Text>

        <View style={styles.filterContainer}>
          {['feed', 'all', 'new', 'in_progress', 'done'].map((key) => (
            <Pressable
              key={key}
              onPress={() => {
                setStatusFilter(key);
                setHasMore(true);
                router.setParams({ filter: key });
              }}
              style={[styles.chip, statusFilter === key && styles.chipActive]}
            >
              <Text style={[styles.chipText, statusFilter === key && styles.chipTextActive]}>
                {getStatusLabel(key)}
              </Text>
            </Pressable>
          ))}
        </View>

        <SearchFiltersBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          onClear={() => setSearchQuery('')}
          placeholder={t('common_search')}
          onOpenFilters={() => setFiltersVisible(true)}
          onOpenSort={() => setSortVisible(true)}
          style={{ marginHorizontal: -16 }}
          filterSummary={
            hasLinkedRelationFilter
              ? [
                  relationLabel
                    ? `${t('orders_related_filter')}: ${relationLabel}`
                    : t('orders_related_filter_hint'),
                  filterSummaryData.full,
                ]
                  .filter(Boolean)
                  .join(` ${t('common_bullet')} `)
              : filterSummaryData.full
          }
          filterSummaryCompact={
            hasLinkedRelationFilter
              ? [
                  relationLabel
                    ? `${t('orders_related_filter')}: ${relationLabel}`
                    : t('orders_related_filter_hint'),
                  filterSummaryData.compact,
                ]
                  .filter(Boolean)
                  .join(` ${t('common_bullet')} `)
              : filterSummaryData.compact
          }
          onResetFilters={() => {
            setOrderFilters({ ...ORDER_FILTER_DEFAULTS });
            router.setParams({ executor: undefined, work_type: undefined, client_ids: undefined });
          }}
          metaText={`${t('common_total')}: ${sortedFilteredOrders.length}`}
        />
      </View>
    ),
    [
      filterSummaryData.compact,
      filterSummaryData.full,
      getStatusLabel,
      hasLinkedRelationFilter,
      relationLabel,
      router,
      searchQuery,
      statusFilter,
      sortedFilteredOrders.length,
      styles.chip,
      styles.chipActive,
      styles.chipText,
      styles.chipTextActive,
      styles.filterContainer,
      styles.header,
      styles.listHeader,
      t,
    ],
  );

  if (loading || effectiveAllowed === null) {
    return (
      <Screen scroll={false} headerOptions={{ headerShown: false }}>
        <AppHeader
          back
          onBackPress={handleBackPress}
          options={{
            headerTitleAlign: 'left',
            title: t('routes.orders/all-orders'),
          }}
        />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </Screen>
    );
  }

  if (!effectiveAllowed) {
    return (
      <Screen scroll={false} headerOptions={{ headerShown: false }}>
        <AppHeader
          back
          onBackPress={handleBackPress}
          options={{
            headerTitleAlign: 'left',
            title: t('routes.orders/all-orders'),
          }}
        />
        <View style={styles.centered}>
          <Text style={styles.blockedText}>
            Админ вашей компании отключил доступ ко всем заявкам
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll={false} headerOptions={{ headerShown: false }}>
      <AppHeader
        back
        onBackPress={handleBackPress}
        options={{
          headerTitleAlign: 'left',
          title: t('routes.orders/all-orders'),
        }}
      />

      <View style={{ flex: 1 }}>
        {refreshIndicator}
        <FlatList
          data={sortedFilteredOrders}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          initialNumToRender={8}
          maxToRenderPerBatch={6}
          updateCellsBatchingPeriod={34}
          windowSize={9}
          removeClippedSubviews={Platform.OS === 'android'}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
          ListHeaderComponent={listHeader}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={
            loading ? (
              <View style={styles.emptyWrap}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
              </View>
            ) : (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>Заявок не найдено</Text>
              </View>
            )
          }
          contentContainerStyle={[styles.container, sortedFilteredOrders.length === 0 && { flex: 1 }]}
          style={{ flex: 1, backgroundColor: theme.colors.background }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      </View>

      <FiltersPanel
        visible={filtersVisible}
        onClose={() => setFiltersVisible(false)}
        mode="orders"
        showSearchCategory={false}
        inlineOptionSearch={{ categoryKeys: ['orders_workTypes', 'orders_executors', 'orders_clients'] }}
        ordersFilters={{
          statuses: [],
          workTypes: useWorkTypes ? workTypes : [],
          clients: clientOptions,
          executors: executorOptions,
          showDate: false,
          showTime: false,
          showAmount: false,
        }}
        values={orderFilters}
        setValue={setOrderFilterValue}
        defaults={ORDER_FILTER_DEFAULTS}
        onReset={() => {
          setOrderFilters({ ...ORDER_FILTER_DEFAULTS });
          router.setParams({ executor: undefined, work_type: undefined, client_ids: undefined });
        }}
        onApply={(nextValues) => {
          setOrderFilters(nextValues);
          router.setParams({
            executor: nextValues?.executorId || undefined,
            work_type:
              useWorkTypes && Array.isArray(nextValues?.workTypes) && nextValues.workTypes.length
                ? nextValues.workTypes.join(',')
                : undefined,
            client_ids:
              Array.isArray(nextValues?.clientIds) && nextValues.clientIds.length
                ? nextValues.clientIds.join(',')
                : undefined,
          });
        }}
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
    </Screen>
  );
}

export default function AllOrdersScreen() {
  return (
    <DeferredScreen>
      <AllOrdersContent />
    </DeferredScreen>
  );
}

function createStyles(theme) {
  const mutedColor = theme.colors.textSecondary ?? theme.colors.muted ?? '#8E8E93';
  return StyleSheet.create({
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
    },
    blockedText: {
      fontSize: 16,
      color: theme.colors.textSecondary,
      textAlign: 'center',
    },
    container: {
      padding: 16,
      paddingBottom: 40,
      backgroundColor: theme.colors.background,
    },
    listHeader: {
      paddingBottom: 16,
    },
    header: {
      fontSize: 22,
      fontWeight: '700',
      marginBottom: 16,
      color: theme.colors.text,
    },
    filterContainer: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 8,
      flexWrap: 'wrap',
    },
    chip: {
      paddingVertical: 8,
      paddingHorizontal: 14,
      backgroundColor: theme.colors.inputBg,
      borderRadius: 20,
    },
    chipActive: {
      backgroundColor: theme.colors.primary,
    },
    chipText: {
      fontSize: 14,
      color: theme.colors.text,
    },
    chipTextActive: {
      color: theme.colors.onPrimary,
      fontWeight: '600',
    },
    emptyWrap: {
      paddingVertical: 40,
      alignItems: 'center',
    },
    emptyText: {
      textAlign: 'center',
      marginTop: 32,
      fontSize: 16,
      color: mutedColor,
    },
  });
}
