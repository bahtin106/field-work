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
  ScrollView,
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
import { preloadOrderDetailsScreen } from '../../src/features/requests/orderDetailsPreload';
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
import { getOfflineSnapshot } from '../../src/shared/offline/offlineStatus';

const EMPTY_ARRAY = [];
const PERM_CACHE = (globalThis.PERM_CACHE ||= { canViewAll: { value: null, ts: 0 } });
const PERM_TTL_MS = 10 * 60 * 1000;
const ALL_ORDERS_PERMISSION_KEY = 'canViewAllOrders';
const ALL_ORDERS_ROUTE = '/orders/all-orders';
const ORDERS_HOME_ROUTE = '/orders';
const ALL_ORDERS_SCREEN_KEY = 'AllRequests';
const ALL_ORDERS_RENDER_WARN_THRESHOLD = 30;
const ALL_ORDERS_FPS_PROBE_MS = 3500;
const ALL_ORDERS_NAV_LOCK_MS = 1200;
const ALL_ORDERS_DETAIL_PREFETCH_LIMIT = 6;
const ALL_ORDERS_VIEWABILITY_PREFETCH_TTL_MS = 2500;
const ALL_ORDERS_SORT_FALLBACK = 0;
const ALL_ORDERS_PRESSED_OPACITY = 0.9;
const MINUTES_PER_HOUR = 60;
const TIME_BOUNDARY = Object.freeze({
  hourMin: 0,
  hourMax: 23,
  minuteMin: 0,
  minuteMax: 59,
});
const DATE_DISPLAY_OPTIONS = Object.freeze({
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const TIME_DISPLAY_OPTIONS = Object.freeze({
  hour: '2-digit',
  minute: '2-digit',
});
const RANGE_SEPARATOR = ' - ';
const ROUTE_FILTER_PARAM_KEYS = Object.freeze([
  'executor',
  'work_type',
  'client_ids',
  'departure_date_from',
  'departure_date_to',
  'departure_time_from',
  'departure_time_to',
  'sum_min',
  'sum_max',
]);
const ALL_ORDERS_LIST = Object.freeze({
  initialNumToRender: 8,
  maxToRenderPerBatch: 6,
  updateCellsBatchingPeriod: 34,
  windowSize: 9,
  itemVisiblePercentThreshold: 50,
  onEndReachedThreshold: 0.5,
});
const ALL_ORDER_STATUS_TABS = Object.freeze(['feed', 'all', 'new', 'progress', 'done']);
const ALL_ORDERS_SORT_KEYS = Object.freeze({
  dateDesc: 'date_desc',
  dateAsc: 'date_asc',
  amountDesc: 'amount_desc',
  amountAsc: 'amount_asc',
});
const ALL_ORDERS_DEFAULT_SORT = ALL_ORDERS_SORT_KEYS.dateDesc;
const LEGACY_STATUS_FILTER_MAP = Object.freeze({
  completed: 'done',
  in_progress: 'progress',
});
const EMPTY_DEPARTMENT_ROUTE_VALUES = new Set(['0', 'null', 'undefined']);
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
      .eq('key', ALL_ORDERS_PERMISSION_KEY)
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

function createOrderFilterDefaults() {
  return {
    ...ORDER_FILTER_DEFAULTS,
    workTypes: [],
    statuses: [],
    clientIds: [],
  };
}

function readRouteParam(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw || '').trim();
}

function readRouteListParam(value) {
  return readRouteParam(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeStatusFilterParam(value) {
  const raw = readRouteParam(value);
  return LEGACY_STATUS_FILTER_MAP[raw] || raw || 'all';
}

function parseDateFilterValue(value) {
  const raw = readRouteParam(value);
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const parsed = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const localizedMatch = raw.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
  if (localizedMatch) {
    const parsed = new Date(
      Number(localizedMatch[3]),
      Number(localizedMatch[2]) - 1,
      Number(localizedMatch[1]),
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseTimeToMinutes(value) {
  const raw = readRouteParam(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < TIME_BOUNDARY.hourMin || hours > TIME_BOUNDARY.hourMax) return null;
  if (minutes < TIME_BOUNDARY.minuteMin || minutes > TIME_BOUNDARY.minuteMax) return null;
  return hours * MINUTES_PER_HOUR + minutes;
}

function formatDateFilterLabel(value, locale) {
  const parsed = parseDateFilterValue(value);
  if (!parsed) return null;
  try {
    return new Intl.DateTimeFormat(locale || undefined, DATE_DISPLAY_OPTIONS).format(parsed);
  } catch {
    return parsed.toLocaleDateString(locale || undefined, DATE_DISPLAY_OPTIONS);
  }
}

function formatTimeFilterLabel(value, locale) {
  const minutes = parseTimeToMinutes(value);
  if (minutes == null) return null;
  const date = new Date();
  date.setHours(Math.floor(minutes / MINUTES_PER_HOUR), minutes % MINUTES_PER_HOUR, 0, 0);
  try {
    return new Intl.DateTimeFormat(locale || undefined, TIME_DISPLAY_OPTIONS).format(date);
  } catch {
    return date.toLocaleTimeString(locale || undefined, TIME_DISPLAY_OPTIONS);
  }
}

function formatRangeFilterLabel(min, max, t) {
  const minValue = readRouteParam(min);
  const maxValue = readRouteParam(max);
  if (minValue && maxValue) return `${minValue}${RANGE_SEPARATOR}${maxValue}`;
  if (minValue) return `${t('common_from')} ${minValue}`;
  if (maxValue) return `${t('common_to')} ${maxValue}`;
  return null;
}

function buildRouteFilterParams(values = {}) {
  return {
    executor: values.executorId || undefined,
    work_type:
      Array.isArray(values.workTypes) && values.workTypes.length
        ? values.workTypes.join(',')
        : undefined,
    client_ids:
      Array.isArray(values.clientIds) && values.clientIds.length
        ? values.clientIds.join(',')
        : undefined,
    departure_date_from: values.departureDateFrom || undefined,
    departure_date_to: values.departureDateTo || undefined,
    departure_time_from: values.departureTimeFrom || undefined,
    departure_time_to: values.departureTimeTo || undefined,
    sum_min: values.sumMin || undefined,
    sum_max: values.sumMax || undefined,
  };
}

function buildClearedRouteFilterParams() {
  return ROUTE_FILTER_PARAM_KEYS.reduce((acc, key) => {
    acc[key] = undefined;
    return acc;
  }, {});
}

function readCachedRequestItems(value) {
  const pages = Array.isArray(value?.pages) ? value.pages : [];
  return pages.flatMap((page) => (Array.isArray(page) ? page : []));
}

function AllOrdersContent() {
  trackRender(ALL_ORDERS_SCREEN_KEY, ALL_ORDERS_RENDER_WARN_THRESHOLD);

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
  const { t, locale } = useTranslation();
  const { has, loading: permLoading } = usePermissions();
  const queryClient = useQueryClient();
  const offlineMode = !getOfflineSnapshot().isOnline;
  const permissionByRole = !permLoading ? has(ALL_ORDERS_PERMISSION_KEY) : null;
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
    markScreenMount(ALL_ORDERS_SCREEN_KEY);
  }, []);

  useEffect(() => startFpsProbe(ALL_ORDERS_SCREEN_KEY, ALL_ORDERS_FPS_PROBE_MS), []);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      preloadOrderDetailsScreen().catch(() => {});
    });
    return () => {
      try {
        task.cancel?.();
      } catch {}
    };
  }, []);

  const styles = useMemo(() => createStyles(theme), [theme]);

  const router = useRouter();
  const navigation = useNavigation();
  const handleBackPress = useCallback(() => {
    goBackSmart(navigation, router, null, ORDERS_HOME_ROUTE);
  }, [navigation, router]);

  const {
    filter,
    executor,
    department,
    search,
    work_type,
    client_ids,
    departure_date_from,
    departure_date_to,
    departure_time_from,
    departure_time_to,
    sum_min,
    sum_max,
    relation_client_id,
    relation_object_ids,
    relation_label,
  } = useLocalSearchParams();

  const relationClientId = useMemo(
    () => readRouteParam(relation_client_id),
    [relation_client_id],
  );
  const relationObjectIds = useMemo(() => parseRelationIdsParam(relation_object_ids), [relation_object_ids]);
  const relationLabel = useMemo(
    () => readRouteParam(relation_label),
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
    normalizeStatusFilterParam(filter),
  );
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [_hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [sortVisible, setSortVisible] = useState(false);
  const [sortKey, setSortKey] = useState(ALL_ORDERS_DEFAULT_SORT);
  const [departmentFilter] = useState(() => {
    const normalizedDepartment = readRouteParam(department);
    if (EMPTY_DEPARTMENT_ROUTE_VALUES.has(normalizedDepartment)) return null;
    return normalizedDepartment || null;
  });
  const [orderFilters, setOrderFilters] = useState(() => ({
    ...createOrderFilterDefaults(),
    workTypes: readRouteListParam(work_type),
    clientIds: readRouteListParam(client_ids),
    executorId: readRouteParam(executor) || null,
    departureDateFrom: readRouteParam(departure_date_from) || null,
    departureDateTo: readRouteParam(departure_date_to) || null,
    departureTimeFrom: readRouteParam(departure_time_from) || null,
    departureTimeTo: readRouteParam(departure_time_to) || null,
    sumMin: readRouteParam(sum_min),
    sumMax: readRouteParam(sum_max),
  }));
  const [searchQuery, setSearchQuery] = useState(readRouteParam(search));
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const detailNavLockRef = useRef({ id: '', ts: 0 });
  const viewabilityPrefetchRef = useRef({ key: '', ts: 0 });

  const executorFilter = orderFilters.executorId;
  const workTypeFilter = orderFilters.workTypes;
  const hasWorkTypeFilter = Array.isArray(workTypeFilter) && workTypeFilter.length > 0;
  const filterDataEnabled =
    effectiveAllowed === true &&
    (filtersVisible ||
      orders.length > 0 ||
      !loading ||
      Boolean(executorFilter) ||
      hasWorkTypeFilter ||
      (Array.isArray(orderFilters.clientIds) && orderFilters.clientIds.length > 0));
  const setOrderFilterValue = useCallback((key, value) => {
    setOrderFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const [useWorkTypes, setUseWorkTypesFlag] = useState(false);
  const [workTypes, setWorkTypes] = useState([]);
  const [workTypesResolved, setWorkTypesResolved] = useState(false);
  useEffect(() => {
    if (!filterDataEnabled) return undefined;
    let alive = true;
    setWorkTypesResolved(false);
    (async () => {
      try {
        const cid = await getMyCompanyId();
        if (!alive) return;
        if (!cid) {
          setUseWorkTypesFlag(false);
          setWorkTypes([]);
          setWorkTypesResolved(true);
          return;
        }
        const { useWorkTypes: flag, types } = await fetchWorkTypes(cid);
        if (!alive) return;
        setUseWorkTypesFlag(!!flag);
        setWorkTypes(types || []);
        setWorkTypesResolved(true);
      } catch {
        if (!alive) return;
        setUseWorkTypesFlag(false);
        setWorkTypes([]);
        setWorkTypesResolved(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [filterDataEnabled]);

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
    { enabled: !!companyId && filterDataEnabled },
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
  }, [
    departmentFilter,
    executorFilter,
    orderFilters.clientIds,
    relationClientId,
    relationObjectIds,
    statusFilter,
    useWorkTypes,
    workTypeFilter,
  ]);
  const allRequestsQueryKey = useMemo(
    () => queryKeys.requests.all(allRequestsParams),
    [allRequestsParams],
  );
  const requestsEnabled = effectiveAllowed !== false && (!hasWorkTypeFilter || workTypesResolved);

  const {
    items: requestItems = [],
    isLoading: requestsLoading,
    refetch: refetchRequests,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    isError: requestsError,
  } = useAllRequests(allRequestsParams, { enabled: requestsEnabled });

  const { data: executorsData } = useRequestExecutors({ enabled: filterDataEnabled });
  const executors = useMemo(() => executorsData ?? EMPTY_ARRAY, [executorsData]);

  useRequestRealtimeSync({ enabled: effectiveAllowed === true, companyId });
  const listLoading = loading || !requestsEnabled;

  useEffect(() => {
    if (departmentFilter == null || !executorFilter) return;
    const selectedExecutor = executors.find((item) => String(item.id) === String(executorFilter));
    if (selectedExecutor && String(selectedExecutor.department_id || '') !== String(departmentFilter)) {
      setOrderFilterValue('executorId', null);
    }
  }, [departmentFilter, executorFilter, executors, setOrderFilterValue]);

  const lastItemsSignatureRef = useRef('');
  useEffect(() => {
    if (orders.length > 0 || effectiveAllowed === false) return;
    const cachedItems = readCachedRequestItems(queryClient.getQueryData(allRequestsQueryKey));
    if (!cachedItems.length) return;
    setOrders(cachedItems);
    setLoading(false);
  }, [allRequestsQueryKey, effectiveAllowed, orders.length, queryClient]);

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
    markFirstContent(ALL_ORDERS_SCREEN_KEY);
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
          return t('order_status_in_feed');
        case 'all':
          return t('common_all');
        case 'new':
          return t('order_status_new');
        case 'progress':
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
      list = list.filter((item) => String(item.department_id || '') === String(departmentFilter));
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
          meta: item?.role ? t(`role_${item.role}`) : '',
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
        fullParts.push(`${t('orders_filter_executor')}: ${executorLabel}`);
        compactParts.push(`${t('orders_filter_executor')}: ${executorLabel}`);
      }
    }

    if (Array.isArray(orderFilters.clientIds) && orderFilters.clientIds.length) {
      const labels = orderFilters.clientIds
        .map((id) => clientOptions.find((item) => String(item.id) === String(id))?.label)
        .filter(Boolean);
      if (labels.length) {
        fullParts.push(
          summarizeFilterPart({
            label: t('common_client'),
            values: labels,
            countWhenMany: false,
          }),
        );
        compactParts.push(
          summarizeFilterPart({
            label: t('common_client'),
            values: labels,
            countWhenMany: true,
          }),
        );
      }
    }

    if (orderFilters.departureDateFrom || orderFilters.departureDateTo) {
      const fromLabel = formatDateFilterLabel(orderFilters.departureDateFrom, locale) || t('common_dash');
      const toLabel = formatDateFilterLabel(orderFilters.departureDateTo, locale) || t('common_dash');
      const part = `${t('order_field_departure_date')}: ${fromLabel}${RANGE_SEPARATOR}${toLabel}`;
      fullParts.push(part);
      compactParts.push(part);
    }

    if (orderFilters.departureTimeFrom || orderFilters.departureTimeTo) {
      const fromLabel = formatTimeFilterLabel(orderFilters.departureTimeFrom, locale) || t('common_dash');
      const toLabel = formatTimeFilterLabel(orderFilters.departureTimeTo, locale) || t('common_dash');
      const part = `${t('order_field_departure_time')}: ${fromLabel}${RANGE_SEPARATOR}${toLabel}`;
      fullParts.push(part);
      compactParts.push(part);
    }

    const amountRange = formatRangeFilterLabel(orderFilters.sumMin, orderFilters.sumMax, t);
    if (amountRange) {
      const part = `${t('order_details_amount')}: ${amountRange}`;
      fullParts.push(part);
      compactParts.push(part);
    }

    return {
      full: joinFilterSummary(fullParts, t('common_bullet')),
      compact: joinFilterSummary(compactParts, t('common_bullet')),
    };
  }, [
    clientOptions,
    executorFilter,
    executorOptions,
    locale,
    orderFilters.clientIds,
    orderFilters.departureDateFrom,
    orderFilters.departureDateTo,
    orderFilters.departureTimeFrom,
    orderFilters.departureTimeTo,
    orderFilters.sumMax,
    orderFilters.sumMin,
    t,
    useWorkTypes,
    workTypeFilter,
    workTypes,
  ]);

  const filteredOrders = useMemo(() => {
    const q = deferredSearchQuery.trim().toLowerCase();
    return (orders || []).filter((order) => {
      if (!q) return true;
      return matchesSearch(
        buildSearchIndex({
          texts: [
            resolveRequestTitle(order, {
              fallbackDate: order?.time_window_start || order?.created_at,
              prefix: t('order_auto_title_prefix'),
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
      { id: ALL_ORDERS_SORT_KEYS.dateDesc, label: t('orders_sort_date_desc') },
      { id: ALL_ORDERS_SORT_KEYS.dateAsc, label: t('orders_sort_date_asc') },
      { id: ALL_ORDERS_SORT_KEYS.amountDesc, label: t('orders_sort_amount_desc') },
      { id: ALL_ORDERS_SORT_KEYS.amountAsc, label: t('orders_sort_amount_asc') },
    ],
    [t],
  );

  const sortedFilteredOrders = useMemo(() => {
    const parseOrderDate = (item) => {
      const ts = item?.time_window_start ? new Date(item.time_window_start).getTime() : NaN;
      return Number.isFinite(ts) ? ts : ALL_ORDERS_SORT_FALLBACK;
    };
    const parseAmount = (item) => {
      const value = Number(item?.start_price ?? item?.sum ?? ALL_ORDERS_SORT_FALLBACK);
      return Number.isFinite(value) ? value : ALL_ORDERS_SORT_FALLBACK;
    };
    const arr = Array.isArray(filteredOrders) ? [...filteredOrders] : [];
    arr.sort((a, b) => {
      switch (sortKey) {
        case ALL_ORDERS_SORT_KEYS.dateAsc:
          return parseOrderDate(a) - parseOrderDate(b);
        case ALL_ORDERS_SORT_KEYS.amountDesc:
          return parseAmount(b) - parseAmount(a);
        case ALL_ORDERS_SORT_KEYS.amountAsc:
          return parseAmount(a) - parseAmount(b);
        case ALL_ORDERS_SORT_KEYS.dateDesc:
        default:
          return parseOrderDate(b) - parseOrderDate(a);
      }
    });
    return arr;
  }, [filteredOrders, sortKey]);

  const loadMore = useCallback(async () => {
    if (isFetchingNextPage || !hasNextPage || listLoading) return;
    await fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, listLoading]);

  const returnParamsRef = useRef({
    filter: statusFilter,
    executor: executorFilter,
    search: searchQuery,
    ...(departmentFilter != null ? { department: String(departmentFilter) } : {}),
    client_ids: Array.isArray(orderFilters.clientIds) ? orderFilters.clientIds.join(',') : '',
    ...buildRouteFilterParams(orderFilters),
    relation_client_id: relationClientId,
    relation_object_ids: relationObjectIds.join(','),
    relation_label: relationLabel,
  });
  useEffect(() => {
    returnParamsRef.current = {
      filter: statusFilter,
      executor: executorFilter,
      search: searchQuery,
      ...(departmentFilter != null ? { department: String(departmentFilter) } : {}),
      ...buildRouteFilterParams(orderFilters),
      ...(relationClientId ? { relation_client_id: relationClientId } : {}),
      ...(relationObjectIds.length ? { relation_object_ids: relationObjectIds.join(',') } : {}),
      ...(relationLabel ? { relation_label: relationLabel } : {}),
    };
  }, [
    departmentFilter,
    executorFilter,
    orderFilters,
    relationClientId,
    relationLabel,
    relationObjectIds,
    searchQuery,
    statusFilter,
  ]);

  const openOrderDetails = useCallback(
    (orderIdRaw, orderSeed = null) => {
      const orderId = String(orderIdRaw || '').trim();
      if (!orderId) return;
      const now = Date.now();
      const prev = detailNavLockRef.current;
      if (prev.id === orderId && now - prev.ts < ALL_ORDERS_NAV_LOCK_MS) return;
      detailNavLockRef.current = { id: orderId, ts: now };
      if (orderSeed && typeof orderSeed === 'object') {
        const seedWorkTypeId = String(orderSeed?.work_type_id || '').trim();
        const seedWorkTypeName = seedWorkTypeId
          ? workTypes.find((item) => String(item?.id || '') === seedWorkTypeId)?.name
          : '';
        queryClient.setQueryData(queryKeys.requests.detail(orderId), (prevOrder) => ({
          ...(prevOrder || {}),
          ...orderSeed,
          ...(seedWorkTypeName ? { work_type_name: seedWorkTypeName } : {}),
          id: orderId,
        }));
      }
      router.push({
        pathname: `/orders/${orderId}`,
        params: {
          returnTo: ALL_ORDERS_ROUTE,
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
    [queryClient, router, workTypes],
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
      <View style={styles.paginationFooter}>
        <ActivityIndicator size="small" color={theme.colors.primary} />
      </View>
    );
  }, [loadingMore, styles.paginationFooter, theme.colors.primary]);

  const keyExtractor = useCallback((item) => String(item.id), []);
  const onViewableItemsChanged = useMemo(
    () => ({ viewableItems }) => {
      const ids = viewableItems
        .map((item) => item?.item?.id)
        .filter(Boolean)
        .slice(0, ALL_ORDERS_DETAIL_PREFETCH_LIMIT)
        .map(String);
      if (!ids.length) return;
      const key = ids.join('|');
      const now = Date.now();
      if (
        viewabilityPrefetchRef.current.key === key &&
        now - viewabilityPrefetchRef.current.ts < ALL_ORDERS_VIEWABILITY_PREFETCH_TTL_MS
      ) {
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
        <View style={styles.filterBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterScrollContent}
          >
            {ALL_ORDER_STATUS_TABS.map((key) => {
              const active = statusFilter === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => {
                    setStatusFilter(key);
                    router.setParams({ filter: key });
                  }}
                  style={({ pressed }) => [
                    styles.chip,
                    active && styles.chipActive,
                    pressed && { opacity: ALL_ORDERS_PRESSED_OPACITY },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <View style={styles.chipContent}>
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {getStatusLabel(key)}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <SearchFiltersBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          onClear={() => setSearchQuery('')}
          placeholder={t('common_search')}
          onOpenFilters={() => setFiltersVisible(true)}
          onOpenSort={() => setSortVisible(true)}
          style={styles.searchBar}
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
            setOrderFilters(createOrderFilterDefaults());
            router.setParams(buildClearedRouteFilterParams());
          }}
          metaText={`${t('common_shown')} ${sortedFilteredOrders.length} ${t('common_of')} ${orders.length}`}
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
      orders.length,
      sortedFilteredOrders.length,
      styles.chip,
      styles.chipActive,
      styles.chipContent,
      styles.chipText,
      styles.chipTextActive,
      styles.filterBar,
      styles.filterScrollContent,
      styles.listHeader,
      styles.searchBar,
      t,
    ],
  );

  const hasSearchQuery = Boolean(deferredSearchQuery.trim());
  const hasActiveFilters = Boolean(filterSummaryData.full || hasLinkedRelationFilter);
  const hasActiveTabFilter = statusFilter !== 'all';

  const retryLoad = useCallback(() => {
    refreshAll().catch(() => {});
  }, [refreshAll]);

  const ListEmptyComponent = useCallback(() => {
    if (listLoading) {
      return (
        <View style={styles.emptyWrap}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      );
    }

    if (requestsError) {
      return (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>{t('refresh_failed')}</Text>
          <Text style={styles.emptyText}>{t('orders_load_failed_subtitle')}</Text>
          <Pressable
            onPress={retryLoad}
            style={({ pressed }) => [styles.retryButton, pressed && { opacity: ALL_ORDERS_PRESSED_OPACITY }]}
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>{t('btn_retry')}</Text>
          </Pressable>
        </View>
      );
    }

    const title = hasSearchQuery
      ? t('orders_empty_search_title')
      : hasActiveFilters || hasActiveTabFilter
        ? t('orders_empty_filtered_title')
        : t('orders_empty_title');
    const subtitle = hasSearchQuery
      ? t('orders_empty_search_subtitle')
      : hasActiveFilters || hasActiveTabFilter
        ? t('orders_empty_filtered_subtitle')
        : t('orders_empty');

    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyTitle}>{title}</Text>
        <Text style={styles.emptyText}>{subtitle}</Text>
      </View>
    );
  }, [
    hasActiveFilters,
    hasActiveTabFilter,
    hasSearchQuery,
    listLoading,
    requestsError,
    retryLoad,
    styles.emptyText,
    styles.emptyTitle,
    styles.emptyWrap,
    styles.retryButton,
    styles.retryText,
    t,
    theme.colors.primary,
  ]);

  const viewabilityConfig = useMemo(
    () => ({ itemVisiblePercentThreshold: ALL_ORDERS_LIST.itemVisiblePercentThreshold }),
    [],
  );
  const listContentContainerStyle = useMemo(
    () => [
      styles.container,
      sortedFilteredOrders.length === 0 && styles.containerFill,
    ],
    [sortedFilteredOrders.length, styles.container, styles.containerFill],
  );

  if (effectiveAllowed === null) {
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
            {t('all_orders_disabled_by_admin')}
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

      <View style={styles.screenBody}>
        {refreshIndicator}
        <FlatList
          data={sortedFilteredOrders}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          initialNumToRender={ALL_ORDERS_LIST.initialNumToRender}
          maxToRenderPerBatch={ALL_ORDERS_LIST.maxToRenderPerBatch}
          updateCellsBatchingPeriod={ALL_ORDERS_LIST.updateCellsBatchingPeriod}
          windowSize={ALL_ORDERS_LIST.windowSize}
          removeClippedSubviews={Platform.OS === 'android'}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          ListHeaderComponent={listHeader}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={ListEmptyComponent}
          contentContainerStyle={listContentContainerStyle}
          style={styles.list}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onEndReached={loadMore}
          onEndReachedThreshold={ALL_ORDERS_LIST.onEndReachedThreshold}
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
          showDate: true,
          showTime: true,
          showAmount: true,
        }}
        values={orderFilters}
        setValue={setOrderFilterValue}
        defaults={ORDER_FILTER_DEFAULTS}
        onReset={() => {
          setOrderFilters(createOrderFilterDefaults());
          router.setParams(buildClearedRouteFilterParams());
        }}
        onApply={(nextValues) => {
          setOrderFilters(nextValues);
          router.setParams(buildRouteFilterParams({
            ...nextValues,
            workTypes: useWorkTypes ? nextValues?.workTypes : [],
          }));
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
  return <AllOrdersContent />;
}

function createStyles(theme) {
  const mutedColor = theme.colors.textSecondary ?? theme.colors.text;
  const listHorizontalPadding = theme.spacing.lg;
  const listBottomPadding =
    theme.components?.scrollView?.paddingBottom ?? theme.spacing.xxl;
  const searchBarOffset = -listHorizontalPadding;
  return StyleSheet.create({
    screenBody: {
      flex: 1,
    },
    list: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.lg,
    },
    blockedText: {
      fontSize: theme.typography.sizes.md,
      color: theme.colors.textSecondary,
      textAlign: 'center',
    },
    container: {
      padding: listHorizontalPadding,
      paddingBottom: listBottomPadding,
      backgroundColor: theme.colors.background,
    },
    containerFill: {
      flexGrow: 1,
    },
    listHeader: {
      paddingBottom: theme.spacing.lg,
    },
    filterBar: {
      marginBottom: theme.spacing.lg,
    },
    filterScrollContent: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      paddingRight: theme.spacing.xs,
    },
    chip: {
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.lg,
      backgroundColor: theme.colors.inputBg || theme.colors.surface,
      borderRadius: theme.radii.pill,
    },
    chipActive: {
      backgroundColor: theme.colors.primary,
    },
    chipContent: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    chipText: {
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.text,
    },
    chipTextActive: {
      color: theme.colors.onPrimary,
      fontWeight: theme.typography.weight.semibold,
    },
    searchBar: {
      marginHorizontal: searchBarOffset,
    },
    emptyWrap: {
      paddingVertical: theme.spacing.xxl + theme.spacing.lg,
      paddingHorizontal: theme.spacing.lg,
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    emptyTitle: {
      textAlign: 'center',
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
      color: theme.colors.text,
    },
    emptyText: {
      textAlign: 'center',
      fontSize: theme.typography.sizes.sm,
      lineHeight: Math.round(theme.typography.sizes.sm * 1.45),
      color: mutedColor,
    },
    retryButton: {
      marginTop: theme.spacing.sm,
      minHeight: theme.components?.button?.height ?? theme.components?.input?.height ?? theme.spacing.xxl,
      paddingHorizontal: theme.spacing.lg,
      borderRadius: theme.radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.primary,
    },
    retryText: {
      color: theme.colors.onPrimary,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.semibold,
    },
    paginationFooter: {
      paddingVertical: theme.spacing.xl,
    },
  });
}
