import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  InteractionManager,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import DynamicOrderCard from '../../components/DynamicOrderCard';
import OrdersFiltersPanel from '../../components/filters/OrdersFiltersPanel';
import SearchFiltersBar from '../../components/filters/SearchFiltersBar';
import SortSelectModal from '../../components/filters/SortSelectModal';
import StatusSelectModal from '../../components/filters/StatusSelectModal';
import Screen from '../../components/layout/Screen';
import AppHeader from '../../components/navigation/AppHeader';
import EmptyListState from '../../components/ui/EmptyListState';
import {
  ThemedRefreshControl,
  useManagedRefresh,
  usePullToRefreshFeedback,
} from '../../components/ui/PullToRefreshFeedback';
import { useCompanySettings } from '../../hooks/useCompanySettings';
import { getStatusDbAliases } from '../../lib/orderFilters';
import { usePersistedOrderStatusUsage } from '../../lib/orderStatusUsage';
import { getOrderStatusLabel, useCompanyOrderStatuses } from '../../lib/orderStatuses';
import goBackSmart from '../../lib/navigation/goBackSmart';
import { usePermissions } from '../../lib/permissions';
import { shouldShowOrderPhoneForRole } from '../../lib/phoneVisibilityRules';
import { formatPersonName } from '../../lib/personName';
import { supabase } from '../../lib/supabase';
import { fetchWorkTypes, getMyCompanyId } from '../../lib/workTypes';
import { useAuthContext } from '../../providers/SimpleAuthProvider';
import {
  ensureRequestPrefetch,
  useAllRequests,
  markRequestDetailSeed,
  useRequestExecutors,
  useRequestRealtimeSync,
} from '../../src/features/requests/queries';
import { enrichOrdersWithKnownExecutorRows } from '../../src/features/requests/executorNameCache';
import { listRequests } from '../../src/features/requests/api';
import { preloadOrderDetailsScreen } from '../../src/features/requests/orderDetailsPreload';
import { resolveRequestTitle } from '../../src/features/requests/title';
import { useClients } from '../../src/features/clients/queries';
import {
  ORDER_DEFAULT_SORT_KEY,
  getOrderSortOptions,
  normalizeOrderSortKey,
  sortOrders,
} from '../../src/features/orders/orderSort';
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
import { withAlpha } from '../../theme/colors';
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
const ALL_ORDERS_FEED_PREVIEW_SIZE = 20;
const ALL_ORDERS_FEED_PREFETCH_DELAY_MS = 2200;
const ALL_ORDERS_FEED_PULSE_DURATION_MS = 1200;
const ALL_ORDERS_FEED_INDICATOR_FRESH_MS = 30 * 1000;
const ALL_ORDERS_FEED_SEEN_STORAGE_PREFIX = 'myorders.feedSeen.v2';
const ALL_ORDERS_FEED_LAST_FP_STORAGE_PREFIX = 'myorders.feedLastFp.v2';
const ALL_ORDERS_PRESSED_OPACITY = 0.9;
const ALL_ORDERS_LIST_HORIZONTAL_PADDING = 16;
const ALL_ORDERS_LIST_BOTTOM_PADDING = 40;
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
  'statuses',
  'work_type',
  'client_ids',
  'departure_date_from',
  'departure_date_to',
  'departure_time_from',
  'departure_time_to',
  'created_date_from',
  'created_date_to',
  'created_time_from',
  'created_time_to',
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
const ALL_ORDERS_STATUS_ALWAYS_VISIBLE = Object.freeze(['feed', 'all']);
const ALL_ORDERS_STATUS_BAR_PADDING = 3;
const ALL_ORDERS_STATUS_CHIP_GAP = 2;
const ALL_ORDERS_STATUS_CHIP_MIN_WIDTH = 38;
const ALL_ORDERS_STATUS_CHIP_MAX_WIDTH = 92;
const ALL_ORDERS_STATUS_CHIP_ACTIVE_MAX_WIDTH = 148;
const ALL_ORDERS_STATUS_CHIP_STRETCH_MAX_WIDTH = 168;
const ALL_ORDERS_STATUS_MORE_MIN_WIDTH = 70;
const ALL_ORDERS_STATUS_MORE_MAX_WIDTH = 84;
const ALL_ORDERS_STATUS_USAGE_STORAGE_PREFIX = 'orders.all.statusUsage.v1';
const ALL_ORDERS_STATUS_USAGE_MAX_ENTRIES = 32;
const MULTIPLE_STATUS_FILTER = '__multiple__';
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
  executorIds: [],
  departureDateFrom: null,
  departureDateTo: null,
  departureTimeFrom: null,
  departureTimeTo: null,
  createdDateFrom: null,
  createdDateTo: null,
  createdTimeFrom: null,
  createdTimeTo: null,
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

function normalizeAllOrdersStatusFilter(value) {
  const key = normalizeStatusFilterParam(value);
  return key === 'in_progress' ? 'progress' : key;
}

function resolveAllOrdersStatusSelection(values = [], fallback = 'all') {
  const statuses = Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map(normalizeAllOrdersStatusFilter)
        .filter((status) => status && status !== 'all'),
    ),
  );
  if (statuses.length > 1) return MULTIPLE_STATUS_FILTER;
  if (statuses.length === 1) return statuses[0];
  return normalizeAllOrdersStatusFilter(fallback);
}

function estimateAllOrdersStatusChipWidth(
  label,
  { hasLeadingDot = false, maxWidth = ALL_ORDERS_STATUS_CHIP_MAX_WIDTH } = {},
) {
  const text = String(label || '');
  const textWidth = Math.ceil(Array.from(text).length * 7.7);
  const leadWidth = hasLeadingDot ? 13 : 0;
  return Math.max(
    ALL_ORDERS_STATUS_CHIP_MIN_WIDTH,
    Math.min(maxWidth, textWidth + leadWidth + 22),
  );
}

function normalizeAllOrdersStatusUsagePayload(raw, allowedIds = []) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const source = parsed?.items && typeof parsed.items === 'object' ? parsed.items : parsed;
    if (!source || typeof source !== 'object') return {};
    const allowed = new Set((allowedIds || []).map(normalizeAllOrdersStatusFilter).filter(Boolean));
    const entries = Object.entries(source)
      .map(([rawKey, rawValue]) => {
        const key = normalizeAllOrdersStatusFilter(rawKey);
        if (!key || !allowed.has(key)) return null;
        const value = rawValue && typeof rawValue === 'object' ? rawValue : { count: rawValue };
        const count = Math.max(0, Math.floor(Number(value?.count || 0)));
        const lastUsedAt = Math.max(0, Math.floor(Number(value?.lastUsedAt || 0)));
        if (!count && !lastUsedAt) return null;
        return [key, { count, lastUsedAt }];
      })
      .filter(Boolean)
      .sort((a, b) => {
        const countDelta = (b[1]?.count || 0) - (a[1]?.count || 0);
        if (countDelta) return countDelta;
        return (b[1]?.lastUsedAt || 0) - (a[1]?.lastUsedAt || 0);
      })
      .slice(0, ALL_ORDERS_STATUS_USAGE_MAX_ENTRIES);
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

function rankAllOrdersStatusFilterOptions(options = [], usage = {}) {
  return options
    .map((option, index) => ({ option, index }))
    .sort((a, b) => {
      const aKey = normalizeAllOrdersStatusFilter(a.option?.id);
      const bKey = normalizeAllOrdersStatusFilter(b.option?.id);
      const aUsage = usage?.[aKey] || {};
      const bUsage = usage?.[bKey] || {};
      const countDelta = (Number(bUsage.count) || 0) - (Number(aUsage.count) || 0);
      if (countDelta) return countDelta;
      const recencyDelta = (Number(bUsage.lastUsedAt) || 0) - (Number(aUsage.lastUsedAt) || 0);
      if (recencyDelta) return recencyDelta;
      return a.index - b.index;
    })
    .map(({ option }) => option);
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

function toDateBoundaryIso(value, startOfDay) {
  const parsed = parseDateFilterValue(value);
  if (!parsed) return null;
  const date = new Date(parsed);
  if (startOfDay) {
    date.setHours(0, 0, 0, 0);
  } else {
    date.setHours(23, 59, 59, 999);
  }
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildRouteFilterParams(values = {}) {
  const executorIds = Array.isArray(values.executorIds)
    ? values.executorIds.map(String).filter(Boolean)
    : values.executorId
      ? [String(values.executorId)]
      : [];
  return {
    executor: executorIds.length ? executorIds.join(',') : undefined,
    statuses:
      Array.isArray(values.statuses) && values.statuses.length
        ? values.statuses.join(',')
        : undefined,
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
    created_date_from: values.createdDateFrom || undefined,
    created_date_to: values.createdDateTo || undefined,
    created_time_from: values.createdTimeFrom || undefined,
    created_time_to: values.createdTimeTo || undefined,
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

function buildScopedStorageKey(prefix, scopeKey) {
  return `${prefix}:${String(scopeKey || 'anonymous')}`;
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
  const { width: windowWidth } = useWindowDimensions();
  const { t, locale } = useTranslation();
  const { has, loading: permLoading } = usePermissions();
  const { profile, user } = useAuthContext();
  const queryClient = useQueryClient();
  const offlineMode = !getOfflineSnapshot().isOnline;
  const authAccountType = String(user?.user_metadata?.account_type || '').trim().toLowerCase();
  const isSoloAdmin =
    String(profile?.role || '').toLowerCase() === 'admin' && authAccountType === 'solo';
  const { data: companyId } = useMyCompanyIdQuery();
  const statusSystem = useCompanyOrderStatuses(companyId);
  const isFeedFeatureEnabled = statusSystem.isEnabled && statusSystem.feedEnabled && !isSoloAdmin;
  const feedStatusValues = useMemo(
    () => new Set(getStatusDbAliases('feed').map((value) => String(value).trim())),
    [],
  );
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
  const isFocused = useIsFocused();
  const handleBackPress = useCallback(() => {
    goBackSmart(navigation, router, null, ORDERS_HOME_ROUTE);
  }, [navigation, router]);

  const {
    filter,
    executor,
    statuses,
    department,
    search,
    work_type,
    client_ids,
    departure_date_from,
    departure_date_to,
    departure_time_from,
    departure_time_to,
    created_date_from,
    created_date_to,
    created_time_from,
    created_time_to,
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

  useEffect(() => {
    if (!isSoloAdmin) return;
    router.replace({
      pathname: '/orders/my-orders',
      params: {
        seedFilter: 'all',
        ...(readRouteParam(search) ? { seedSearch: readRouteParam(search) } : {}),
        ...(relationClientId ? { relation_client_id: relationClientId } : {}),
        ...(relationObjectIds.length ? { relation_object_ids: relationObjectIds.join(',') } : {}),
        ...(relationLabel ? { relation_label: relationLabel } : {}),
      },
    });
  }, [isSoloAdmin, relationClientId, relationLabel, relationObjectIds, router, search]);

  const [statusFilter, setStatusFilter] = useState(
    resolveAllOrdersStatusSelection(readRouteListParam(statuses), readRouteParam(filter)),
  );
  const statusTabs = useMemo(
    () => {
      if (!statusSystem.isEnabled) return ['all'];
      return [
        ...(statusSystem.feedEnabled && !isSoloAdmin ? ['feed'] : []),
        'all',
        ...statusSystem.regularStatuses
          .map((status) => normalizeAllOrdersStatusFilter(status?.status_key))
          .filter(Boolean),
      ];
    },
    [isSoloAdmin, statusSystem.feedEnabled, statusSystem.isEnabled, statusSystem.regularStatuses],
  );
  const effectiveStatusFilter = useMemo(
    () =>
      statusFilter === MULTIPLE_STATUS_FILTER || statusTabs.includes(statusFilter)
        ? statusFilter
        : 'all',
    [statusFilter, statusTabs],
  );
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [_hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [statusSelectVisible, setStatusSelectVisible] = useState(false);
  const [sortVisible, setSortVisible] = useState(false);
  const [sortKey, setSortKey] = useState(ORDER_DEFAULT_SORT_KEY);
  const normalizedSortKey = normalizeOrderSortKey(sortKey);
  const [departmentFilter] = useState(() => {
    const normalizedDepartment = readRouteParam(department);
    if (EMPTY_DEPARTMENT_ROUTE_VALUES.has(normalizedDepartment)) return null;
    return normalizedDepartment || null;
  });
  const [orderFilters, setOrderFilters] = useState(() => ({
    ...createOrderFilterDefaults(),
    workTypes: readRouteListParam(work_type),
    statuses: readRouteListParam(statuses).map(normalizeAllOrdersStatusFilter).filter(Boolean),
    clientIds: readRouteListParam(client_ids),
    executorId: readRouteListParam(executor)[0] || null,
    executorIds: readRouteListParam(executor),
    departureDateFrom: readRouteParam(departure_date_from) || null,
    departureDateTo: readRouteParam(departure_date_to) || null,
    departureTimeFrom: readRouteParam(departure_time_from) || null,
    departureTimeTo: readRouteParam(departure_time_to) || null,
    createdDateFrom: readRouteParam(created_date_from) || null,
    createdDateTo: readRouteParam(created_date_to) || null,
    createdTimeFrom: readRouteParam(created_time_from) || null,
    createdTimeTo: readRouteParam(created_time_to) || null,
    sumMin: readRouteParam(sum_min),
    sumMax: readRouteParam(sum_max),
  }));
  const [searchQuery, setSearchQuery] = useState(readRouteParam(search));
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const detailNavLockRef = useRef({ id: '', ts: 0 });
  const viewabilityPrefetchRef = useRef({ key: '', ts: 0 });

  useEffect(() => {
    if (statusSystem.isLoading) return;
    if (statusFilter === effectiveStatusFilter) return;
    setStatusFilter(effectiveStatusFilter);
    router.setParams({ filter: effectiveStatusFilter });
  }, [effectiveStatusFilter, router, statusFilter, statusSystem.isLoading]);

  const executorFilters = useMemo(() => {
    if (Array.isArray(orderFilters.executorIds) && orderFilters.executorIds.length) {
      return orderFilters.executorIds.map(String).filter(Boolean);
    }
    return orderFilters.executorId ? [String(orderFilters.executorId)] : [];
  }, [orderFilters.executorId, orderFilters.executorIds]);
  const hasExecutorFilter = executorFilters.length > 0;
  const workTypeFilter = orderFilters.workTypes;
  const hasWorkTypeFilter = Array.isArray(workTypeFilter) && workTypeFilter.length > 0;
  const filterDataEnabled =
    !isSoloAdmin &&
    effectiveAllowed === true &&
    (filtersVisible ||
      orders.length > 0 ||
      !loading ||
      hasExecutorFilter ||
      hasWorkTypeFilter ||
      (Array.isArray(orderFilters.statuses) && orderFilters.statuses.length > 0) ||
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

  const { settings: companySettings } = useCompanySettings(companyId);
  const feedScopeKey = useMemo(() => {
    const scopedUserId = String(user?.id || profile?.id || '').trim();
    const scopedCompanyId = String(companyId || profile?.company_id || '').trim();
    return scopedUserId ? `${scopedUserId}:${scopedCompanyId || 'no-company'}` : 'anonymous';
  }, [companyId, profile?.company_id, profile?.id, user?.id]);
  const feedSeenStorageKey = useMemo(
    () => buildScopedStorageKey(ALL_ORDERS_FEED_SEEN_STORAGE_PREFIX, feedScopeKey),
    [feedScopeKey],
  );
  const feedLastFpStorageKey = useMemo(
    () => buildScopedStorageKey(ALL_ORDERS_FEED_LAST_FP_STORAGE_PREFIX, feedScopeKey),
    [feedScopeKey],
  );
  const { data: orderFieldSettingsData } = useEntityFieldSettings(ENTITY_FIELD_TYPES.ORDER, {
    enabled: !isSoloAdmin && effectiveAllowed === true,
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
            formatPersonName(row) ||
            String(row?.full_name || '').trim() ||
            String(row?.phone || '').trim() ||
            id;
          return { id, value: id, label };
        })
        .filter(Boolean),
    [companyClients],
  );
  const allRequestsParams = useMemo(() => {
    const next = { sortKey: normalizedSortKey };
    if (
      statusSystem.isEnabled &&
      effectiveStatusFilter &&
      effectiveStatusFilter !== 'all' &&
      effectiveStatusFilter !== MULTIPLE_STATUS_FILTER
    ) {
      next.status = effectiveStatusFilter;
    }
    const statusFilters = statusSystem.isEnabled && Array.isArray(orderFilters.statuses)
      ? orderFilters.statuses.map(normalizeAllOrdersStatusFilter).filter((key) => key && key !== 'all')
      : [];
    if (statusFilters.length) next.statuses = statusFilters;
    // The feed is a separate tab and must never leak into the aggregate list.
    next.excludeFeedWhenAll = true;
    if (executorFilters.length) next.executorIds = executorFilters;
    if (departmentFilter != null) next.departmentId = departmentFilter;
    if (useWorkTypes && Array.isArray(workTypeFilter) && workTypeFilter.length) {
      next.workTypeIds = workTypeFilter;
    }
    if (Array.isArray(orderFilters.clientIds) && orderFilters.clientIds.length) {
      next.clientIds = orderFilters.clientIds.map(String);
    }
    const dateFrom = toDateBoundaryIso(orderFilters.departureDateFrom, true);
    const dateTo = toDateBoundaryIso(orderFilters.departureDateTo, false);
    const createdFrom = toDateBoundaryIso(orderFilters.createdDateFrom, true);
    const createdTo = toDateBoundaryIso(orderFilters.createdDateTo, false);
    const sumMinValue = readRouteParam(orderFilters.sumMin);
    const sumMaxValue = readRouteParam(orderFilters.sumMax);
    if (dateFrom) next.dateFrom = dateFrom;
    if (dateTo) next.dateTo = dateTo;
    if (createdFrom) next.createdFrom = createdFrom;
    if (createdTo) next.createdTo = createdTo;
    if (sumMinValue) next.sumMin = sumMinValue;
    if (sumMaxValue) next.sumMax = sumMaxValue;
    if (relationClientId) next.relationClientId = relationClientId;
    if (relationObjectIds.length) next.relationObjectIds = relationObjectIds;
    return next;
  }, [
    departmentFilter,
    executorFilters,
    effectiveStatusFilter,
    normalizedSortKey,
    orderFilters.clientIds,
    orderFilters.createdDateFrom,
    orderFilters.createdDateTo,
    orderFilters.departureDateFrom,
    orderFilters.departureDateTo,
    orderFilters.sumMax,
    orderFilters.sumMin,
    orderFilters.statuses,
    relationClientId,
    relationObjectIds,
    statusSystem.isEnabled,
    useWorkTypes,
    workTypeFilter,
  ]);
  const allRequestsQueryKey = useMemo(
    () => queryKeys.requests.all(allRequestsParams),
    [allRequestsParams],
  );
  const requestsEnabled =
    !isSoloAdmin && effectiveAllowed !== false && (!hasWorkTypeFilter || workTypesResolved);

  const {
    items: requestItems = [],
    isLoading: requestsLoading,
    refetch: refetchRequests,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    isError: requestsError,
  } = useAllRequests(allRequestsParams, { enabled: requestsEnabled });

  const previousStatusFilterRef = useRef(effectiveStatusFilter);
  useEffect(() => {
    const previousStatusFilter = previousStatusFilterRef.current;
    previousStatusFilterRef.current = effectiveStatusFilter;
    if (!requestsEnabled || previousStatusFilter === effectiveStatusFilter) return;
    queryClient
      .invalidateQueries({ queryKey: allRequestsQueryKey, exact: true, refetchType: 'active' })
      .catch(() => {});
  }, [allRequestsQueryKey, effectiveStatusFilter, queryClient, requestsEnabled]);

  const shouldLoadExecutorsForCards =
    !isSoloAdmin &&
    effectiveAllowed === true &&
    (orders.length > 0 || requestItems.some((item) => String(item?.assigned_to || '').trim()));
  const { data: executorsData } = useRequestExecutors({ enabled: filterDataEnabled || shouldLoadExecutorsForCards });
  const executors = useMemo(() => executorsData ?? EMPTY_ARRAY, [executorsData]);

  useRequestRealtimeSync({ enabled: !isSoloAdmin && effectiveAllowed === true, companyId });
  const listLoading = loading || !requestsEnabled;

  useEffect(() => {
    if (departmentFilter == null || !executorFilters.length) return;
    if (!Array.isArray(executors) || executors.length === 0) return;
    const allowedIds = new Set(
      executors
        .filter((item) => String(item.department_id || '') === String(departmentFilter))
        .map((item) => String(item.id)),
    );
    const nextExecutorIds = executorFilters.filter((id) => allowedIds.has(String(id)));
    if (nextExecutorIds.length !== executorFilters.length) {
      setOrderFilterValue('executorId', nextExecutorIds[0] || null);
      setOrderFilterValue('executorIds', nextExecutorIds);
    }
  }, [departmentFilter, executorFilters, executors, setOrderFilterValue]);

  const lastItemsSignatureRef = useRef('');
  useEffect(() => {
    if (orders.length > 0 || effectiveAllowed === false) return;
    const cachedItems = readCachedRequestItems(queryClient.getQueryData(allRequestsQueryKey));
    if (!cachedItems.length) return;
    setOrders(enrichOrdersWithKnownExecutorRows(cachedItems, executors));
    setLoading(false);
  }, [allRequestsQueryKey, effectiveAllowed, executors, orders.length, queryClient]);

  useEffect(() => {
    const requestsSignature = Array.isArray(requestItems)
      ? requestItems.map((item) => `${item?.id || ''}:${item?.updated_at || ''}`).join('|')
      : '';
    const executorsSignature = Array.isArray(executors)
      ? executors.map((item) => `${item?.id || ''}:${item?.full_name || ''}:${item?.email || ''}`).join('|')
      : '';
    const signature = `${requestsSignature}::${executorsSignature}`;
    if (lastItemsSignatureRef.current !== signature) {
      lastItemsSignatureRef.current = signature;
      setOrders(enrichOrdersWithKnownExecutorRows(requestItems, executors));
    }
    setLoading(requestsLoading && requestItems.length === 0);
    setHasMore(!!hasNextPage);
    setLoadingMore(isFetchingNextPage);
  }, [executors, hasNextPage, isFetchingNextPage, requestItems, requestsLoading]);

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

  const feedStateCache = (globalThis.__MYORDERS_FEED_STATE ||= {});
  feedStateCache[feedScopeKey] ||= {};
  const scopedFeedState = feedStateCache[feedScopeKey];
  const feedIndicatorCache = (globalThis.__ALLORDERS_FEED_INDICATOR ||= {});
  feedIndicatorCache[feedScopeKey] ||= { rows: null, fetchedAt: 0 };
  const scopedFeedIndicatorCache = feedIndicatorCache[feedScopeKey];
  const [feedFingerprint, setFeedFingerprint] = useState(() => scopedFeedState.fp || '');
  const [feedSeenFingerprint, setFeedSeenFingerprint] = useState(() => scopedFeedState.seenFp || '');
  const [feedHasAny, setFeedHasAny] = useState(() => Boolean(scopedFeedState.hasAny));
  const feedPulse = useRef(new Animated.Value(0)).current;
  const feedMetaRequestSeqRef = useRef(0);
  const activeFeedScopeRef = useRef(feedScopeKey);
  const feedState = !feedHasAny
    ? 'none'
    : feedFingerprint && feedFingerprint === feedSeenFingerprint
      ? 'seen'
      : 'new';

  useEffect(() => {
    if (activeFeedScopeRef.current === feedScopeKey) return;
    activeFeedScopeRef.current = feedScopeKey;
    feedMetaRequestSeqRef.current += 1;
    setFeedFingerprint(scopedFeedState.fp || '');
    setFeedSeenFingerprint(scopedFeedState.seenFp || '');
    setFeedHasAny(Boolean(scopedFeedState.hasAny));
  }, [feedScopeKey, scopedFeedState]);

  useEffect(() => {
    if (!isFeedFeatureEnabled) {
      scopedFeedState.fp = '';
      scopedFeedState.seenFp = '';
      scopedFeedState.hasAny = false;
      setFeedFingerprint('');
      setFeedSeenFingerprint('');
      setFeedHasAny(false);
      return undefined;
    }
    if (!isFocused) return undefined;
    let alive = true;
    const run = async () => {
      try {
        const [seenFp, lastFp] = await Promise.all([
          AsyncStorage.getItem(feedSeenStorageKey),
          AsyncStorage.getItem(feedLastFpStorageKey),
        ]);
        if (!alive) return;
        if (typeof seenFp === 'string' && seenFp.length) {
          scopedFeedState.seenFp = seenFp;
          setFeedSeenFingerprint(seenFp);
        }
        if (typeof lastFp === 'string' && lastFp.length) {
          scopedFeedState.fp = lastFp;
          scopedFeedState.hasAny = true;
          setFeedFingerprint(lastFp);
          setFeedHasAny(true);
        }
      } catch {}
    };
    run();
    return () => {
      alive = false;
    };
  }, [
    feedLastFpStorageKey,
    feedSeenStorageKey,
    isFeedFeatureEnabled,
    isFocused,
    scopedFeedState,
  ]);

  useEffect(() => {
    if (!isFeedFeatureEnabled || feedState !== 'new') {
      feedPulse.stopAnimation();
      feedPulse.setValue(0);
      return undefined;
    }

    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(feedPulse, {
          toValue: 1,
          duration: ALL_ORDERS_FEED_PULSE_DURATION_MS,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(feedPulse, {
          toValue: 0,
          duration: ALL_ORDERS_FEED_PULSE_DURATION_MS,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => {
      anim.stop();
    };
  }, [feedPulse, feedState, isFeedFeatureEnabled]);

  const updateFeedMeta = useCallback(
    (arr) => {
      if (!isFeedFeatureEnabled) {
        scopedFeedState.fp = '';
        scopedFeedState.hasAny = false;
        setFeedFingerprint('');
        setFeedHasAny(false);
        return;
      }
      const fp = Array.isArray(arr)
        ? arr
            .slice(0, ALL_ORDERS_FEED_PREVIEW_SIZE)
            .map((item) => item?.id)
            .filter(Boolean)
            .join(',')
        : '';
      const hasAny = Boolean(arr && arr.length);

      scopedFeedState.fp = fp;
      scopedFeedState.hasAny = hasAny;
      setFeedFingerprint(fp);
      setFeedHasAny(hasAny);

      try {
        if (fp) AsyncStorage.setItem(feedLastFpStorageKey, fp).catch(() => {});
        else AsyncStorage.removeItem(feedLastFpStorageKey).catch(() => {});
      } catch {}
    },
    [feedLastFpStorageKey, isFeedFeatureEnabled, scopedFeedState],
  );

  useEffect(() => {
    if (!isFeedFeatureEnabled) return undefined;
    if (!isFocused) return undefined;
    if (effectiveAllowed !== true) return undefined;
    if (loading && orders.length === 0) return undefined;

    const prefetchFeed = async () => {
      const cachedRows = scopedFeedIndicatorCache.rows;
      const cachedFetchedAt = Number(scopedFeedIndicatorCache.fetchedAt || 0);
      if (Array.isArray(cachedRows)) {
        updateFeedMeta(cachedRows);
        if (cachedFetchedAt > 0 && Date.now() - cachedFetchedAt < ALL_ORDERS_FEED_INDICATOR_FRESH_MS) {
          return;
        }
      }

      let uid = String(user?.id || profile?.id || '').trim();
      if (!uid) {
        const { data: sessionData } = await supabase.auth.getSession();
        uid = String(sessionData?.session?.user?.id || '').trim();
      }
      if (!uid) return;

      const requestSeq = feedMetaRequestSeqRef.current + 1;
      feedMetaRequestSeqRef.current = requestSeq;
      try {
        const data = await listRequests({
          scope: 'all',
          status: 'feed',
          userId: uid,
          page: 1,
          pageSize: ALL_ORDERS_FEED_PREVIEW_SIZE,
        });
        if (feedMetaRequestSeqRef.current !== requestSeq) return;
        scopedFeedIndicatorCache.rows = data;
        scopedFeedIndicatorCache.fetchedAt = Date.now();
        updateFeedMeta(data);
      } catch {}
    };

    let task = null;
    const timer = setTimeout(() => {
      task = InteractionManager.runAfterInteractions(() => {
        prefetchFeed().catch(() => {});
      });
    }, ALL_ORDERS_FEED_PREFETCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      try {
        task?.cancel?.();
      } catch {}
    };
  }, [
    effectiveAllowed,
    isFeedFeatureEnabled,
    isFocused,
    loading,
    orders.length,
    profile?.id,
    scopedFeedIndicatorCache,
    updateFeedMeta,
    user?.id,
  ]);

  useEffect(() => {
    if (!isFeedFeatureEnabled) return;
    if (effectiveStatusFilter !== 'feed') return;
    if (!feedHasAny || !feedFingerprint) return;
    if (feedSeenFingerprint === feedFingerprint) return;

    setFeedSeenFingerprint(feedFingerprint);
    scopedFeedState.seenFp = feedFingerprint;

    try {
      AsyncStorage.setItem(feedSeenStorageKey, feedFingerprint).catch(() => {});
    } catch {}
  }, [
    effectiveStatusFilter,
    feedFingerprint,
    feedHasAny,
    feedSeenFingerprint,
    feedSeenStorageKey,
    isFeedFeatureEnabled,
    scopedFeedState,
  ]);

  useEffect(() => {
    if (!isFeedFeatureEnabled) return;
    if (effectiveStatusFilter !== 'feed') return;
    if (!Array.isArray(requestItems)) return;
    updateFeedMeta(requestItems);
  }, [effectiveStatusFilter, isFeedFeatureEnabled, requestItems, updateFeedMeta]);

  const getStatusLabel = useCallback(
    (key) => {
      const normalized = normalizeAllOrdersStatusFilter(key);
      if (normalized === 'all') return t('common_all');
      return getOrderStatusLabel(normalized, statusSystem.statuses, t);
    },
    [statusSystem.statuses, t],
  );
  const orderStatusOptions = useMemo(
    () =>
      statusSystem.isEnabled
        ? statusSystem.regularStatuses.map((status) => ({
            id: normalizeAllOrdersStatusFilter(status.status_key),
            label: getOrderStatusLabel(status.status_key, statusSystem.statuses, t),
          }))
        : [],
    [statusSystem.isEnabled, statusSystem.regularStatuses, statusSystem.statuses, t],
  );
  const hasStatusNavigation =
    statusSystem.isEnabled &&
    (orderStatusOptions.length > 0 || isFeedFeatureEnabled);
  const statusAlwaysVisibleKeys = useMemo(
    () => ALL_ORDERS_STATUS_ALWAYS_VISIBLE.filter((key) => statusTabs.includes(key)),
    [statusTabs],
  );
  const statusFilterOptions = useMemo(
    () =>
      hasStatusNavigation
        ? statusTabs.map((key) => ({
        id: key,
        label: getStatusLabel(key),
      }))
        : [],
    [getStatusLabel, hasStatusNavigation, statusTabs],
  );
  const panelStatusOptions = useMemo(
    () =>
      statusFilterOptions
        .filter((option) => option.id !== 'all')
        .map((option) => ({ ...option, exclusive: option.id === 'feed' })),
    [statusFilterOptions],
  );
  const statusChipLabels = useMemo(() => {
    const labels = {};
    statusFilterOptions.forEach((option) => {
      labels[option.id] = option.id === 'feed' ? t('order_status_in_feed_short') : option.label;
    });
    return labels;
  }, [statusFilterOptions, t]);
  useEffect(() => {
    if (statusSystem.isLoading) return;
    if (effectiveStatusFilter === MULTIPLE_STATUS_FILTER) return;
    const expectedStatuses =
      statusSystem.isEnabled && effectiveStatusFilter !== 'all' ? [effectiveStatusFilter] : [];
    setOrderFilters((previous) => {
      const current = Array.isArray(previous.statuses) ? previous.statuses : [];
      const normalizedCurrent = current.map(normalizeAllOrdersStatusFilter).slice(0, 1);
      if (
        normalizedCurrent.length === expectedStatuses.length &&
        normalizedCurrent[0] === expectedStatuses[0]
      ) {
        return previous;
      }
      return { ...previous, statuses: expectedStatuses };
    });
  }, [effectiveStatusFilter, statusSystem.isEnabled, statusSystem.isLoading]);
  const statusUsageStorageKey = useMemo(() => {
    const userId = String(user?.id || profile?.id || 'anonymous').trim() || 'anonymous';
    const companyScope = String(companyId || 'global').trim() || 'global';
    return `${ALL_ORDERS_STATUS_USAGE_STORAGE_PREFIX}:${userId}:${companyScope}`;
  }, [companyId, profile?.id, user?.id]);
  const statusUsageAllowedIds = useMemo(
    () => statusFilterOptions.map((option) => normalizeAllOrdersStatusFilter(option?.id)).filter(Boolean),
    [statusFilterOptions],
  );
  const {
    usage: statusUsage,
    usageRef: statusUsageRef,
    isReady: statusUsageReady,
    persistUsage: persistStatusUsage,
    refreshUsage: refreshStatusUsage,
  } = usePersistedOrderStatusUsage(
    statusUsageStorageKey,
    statusUsageAllowedIds,
    normalizeAllOrdersStatusUsagePayload,
  );
  const statusNavigationReady = hasStatusNavigation && statusUsageReady;
  useFocusEffect(
    useCallback(() => {
      refreshStatusUsage();
    }, [refreshStatusUsage]),
  );

  const recordStatusFilterUsage = useCallback(
    (value) => {
      const key = normalizeAllOrdersStatusFilter(value);
      if (!statusUsageAllowedIds.includes(key)) return;
      const currentUsage = statusUsageRef.current || {};
      const current = currentUsage[key] || {};
      const next = {
        ...currentUsage,
        [key]: {
          count: (Number(current.count) || 0) + 1,
          lastUsedAt: Date.now(),
        },
      };
      const normalized = normalizeAllOrdersStatusUsagePayload({ items: next }, statusUsageAllowedIds);
      statusUsageRef.current = normalized;
      persistStatusUsage(normalized);
    },
    [persistStatusUsage, statusUsageAllowedIds, statusUsageRef],
  );
  const selectStatusFilter = useCallback(
    (value) => {
      const key = normalizeAllOrdersStatusFilter(value);
      if (!statusTabs.includes(key)) return;
      setStatusFilter(key);
      const statuses = key === 'all' ? [] : [key];
      setOrderFilters((previous) => ({ ...previous, statuses }));
      router.setParams({
        filter: key,
        statuses: statuses.length ? statuses.join(',') : undefined,
      });
      recordStatusFilterUsage(key);
    },
    [recordStatusFilterUsage, router, statusTabs],
  );
  const statusSelectOptions = useMemo(
    () => rankAllOrdersStatusFilterOptions(statusFilterOptions, statusUsage),
    [statusFilterOptions, statusUsage],
  );
  const orderedStatusQuickKeys = useMemo(() => {
    const rankedStatuses = rankAllOrdersStatusFilterOptions(
      statusFilterOptions.filter(
        (option) => !statusAlwaysVisibleKeys.includes(normalizeAllOrdersStatusFilter(option?.id)),
      ),
      statusUsage,
    ).map((option) => normalizeAllOrdersStatusFilter(option?.id));

    return [
      ...statusAlwaysVisibleKeys,
      ...rankedStatuses.filter(Boolean),
    ];
  }, [statusAlwaysVisibleKeys, statusFilterOptions, statusUsage]);
  const statusQuickLayout = useMemo(() => {
    const availableWidth = Math.max(
      0,
      Number(windowWidth || 0) -
        ALL_ORDERS_LIST_HORIZONTAL_PADDING * 2 -
        ALL_ORDERS_STATUS_BAR_PADDING * 2,
    );
    const reservedMoreWidth = ALL_ORDERS_STATUS_MORE_MIN_WIDTH;
    const selected = [];
    const widths = {};
    let used = 0;

    const addChip = (key, { force = false, active = false } = {}) => {
      if (!key || selected.includes(key)) return false;
      const label = statusChipLabels[key] || getStatusLabel(key) || key;
      const nextWidth = estimateAllOrdersStatusChipWidth(label, {
        hasLeadingDot: key === 'feed',
        maxWidth: active ? ALL_ORDERS_STATUS_CHIP_ACTIVE_MAX_WIDTH : ALL_ORDERS_STATUS_CHIP_MAX_WIDTH,
      });
      const nextGap = selected.length > 0 ? ALL_ORDERS_STATUS_CHIP_GAP : 0;
      const projected = used + nextGap + nextWidth;
      const requiredWidth = projected + ALL_ORDERS_STATUS_CHIP_GAP + reservedMoreWidth;

      if (force || requiredWidth <= availableWidth) {
        selected.push(key);
        widths[key] = nextWidth;
        used = projected;
        return true;
      }
      return false;
    };

    orderedStatusQuickKeys.forEach((key) => {
      addChip(key, {
        active: effectiveStatusFilter === key,
        force: statusAlwaysVisibleKeys.includes(key),
      });
    });

    let moreWidth = reservedMoreWidth;
    const totalWidth =
      selected.reduce((sum, key) => sum + (widths[key] || 0), 0) +
      moreWidth +
      ALL_ORDERS_STATUS_CHIP_GAP * selected.length;
    let extra = Math.max(0, availableWidth - totalWidth);

    const getStretchMax = (key) => {
      const label = statusChipLabels[key] || getStatusLabel(key) || key;
      const fullWidth = estimateAllOrdersStatusChipWidth(label, {
        hasLeadingDot: key === 'feed',
        maxWidth:
          effectiveStatusFilter === key
            ? ALL_ORDERS_STATUS_CHIP_STRETCH_MAX_WIDTH
            : ALL_ORDERS_STATUS_CHIP_ACTIVE_MAX_WIDTH,
      });
      if (statusAlwaysVisibleKeys.includes(key)) {
        return Math.max(widths[key] || 0, fullWidth);
      }
      return Math.max(widths[key] || 0, fullWidth + (effectiveStatusFilter === key ? 8 : 4));
    };

    const stretchOrder = [
      effectiveStatusFilter,
      ...selected.filter((key) => !statusAlwaysVisibleKeys.includes(key) && key !== effectiveStatusFilter),
      ...selected.filter((key) => statusAlwaysVisibleKeys.includes(key) && key !== effectiveStatusFilter),
    ].filter((key, index, arr) => key && selected.includes(key) && arr.indexOf(key) === index);

    stretchOrder.forEach((key, index) => {
      if (extra <= 0) return;
      const remaining = stretchOrder.length - index;
      const currentWidth = widths[key] || 0;
      const maxWidth = getStretchMax(key);
      const add = Math.min(maxWidth - currentWidth, Math.ceil(extra / remaining));
      if (add > 0) {
        widths[key] = currentWidth + add;
        extra -= add;
      }
    });

    if (extra > 0) {
      const addToMore = Math.min(ALL_ORDERS_STATUS_MORE_MAX_WIDTH - moreWidth, extra);
      if (addToMore > 0) {
        moreWidth += addToMore;
        extra -= addToMore;
      }
    }

    if (extra > 0 && selected.length) {
      const perChip = Math.floor(extra / selected.length);
      let rest = extra - perChip * selected.length;
      selected.forEach((key) => {
        widths[key] += perChip + (rest > 0 ? 1 : 0);
        if (rest > 0) rest -= 1;
      });
    }

    return { keys: selected, moreWidth, widths };
  }, [
    effectiveStatusFilter,
    getStatusLabel,
    orderedStatusQuickKeys,
    statusAlwaysVisibleKeys,
    statusChipLabels,
    windowWidth,
  ]);
  const visibleQuickStatusKeys = statusQuickLayout.keys;
  const statusChipWidths = statusQuickLayout.widths;
  const statusMoreWidth = statusQuickLayout.moreWidth || ALL_ORDERS_STATUS_MORE_MIN_WIDTH;
  const isOverflowStatusActive = !visibleQuickStatusKeys.includes(effectiveStatusFilter);
  const statusMoreLabel = t('viewer_more');

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
          formatPersonName(item) ||
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

    if (statusSystem.isEnabled && Array.isArray(orderFilters.statuses) && orderFilters.statuses.length) {
      const labels = orderFilters.statuses
        .map((code) => normalizeAllOrdersStatusFilter(code))
        .map((code) => orderStatusOptions.find((opt) => opt.id === code)?.label || getStatusLabel(code))
        .filter(Boolean);
      if (labels.length) {
        fullParts.push(
          summarizeFilterPart({ label: t('orders_filter_status'), values: labels, countWhenMany: false }),
        );
        compactParts.push(
          summarizeFilterPart({ label: t('orders_filter_status'), values: labels, countWhenMany: true }),
        );
      }
    }

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

    if (executorFilters.length) {
      const executorLabels = executorFilters
        .map((id) => executorOptions.find((item) => String(item.id) === String(id))?.label)
        .filter(Boolean);
      if (executorLabels.length) {
        fullParts.push(
          summarizeFilterPart({
            label: t('orders_filter_executor'),
            values: executorLabels,
            countWhenMany: false,
          }),
        );
        compactParts.push(
          summarizeFilterPart({
            label: t('orders_filter_executor'),
            values: executorLabels,
            countWhenMany: true,
          }),
        );
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

    if (orderFilters.createdDateFrom || orderFilters.createdDateTo) {
      const fromLabel = formatDateFilterLabel(orderFilters.createdDateFrom, locale) || t('common_dash');
      const toLabel = formatDateFilterLabel(orderFilters.createdDateTo, locale) || t('common_dash');
      const part = `${t('orders_filter_created_date')}: ${fromLabel}${RANGE_SEPARATOR}${toLabel}`;
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

    if (orderFilters.createdTimeFrom || orderFilters.createdTimeTo) {
      const fromLabel = formatTimeFilterLabel(orderFilters.createdTimeFrom, locale) || t('common_dash');
      const toLabel = formatTimeFilterLabel(orderFilters.createdTimeTo, locale) || t('common_dash');
      const part = `${t('orders_filter_created_time')}: ${fromLabel}${RANGE_SEPARATOR}${toLabel}`;
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
    executorFilters,
    executorOptions,
    locale,
    getStatusLabel,
    orderFilters.clientIds,
    orderFilters.createdDateFrom,
    orderFilters.createdDateTo,
    orderFilters.createdTimeFrom,
    orderFilters.createdTimeTo,
    orderFilters.departureDateFrom,
    orderFilters.departureDateTo,
    orderFilters.departureTimeFrom,
    orderFilters.departureTimeTo,
    orderFilters.sumMax,
    orderFilters.sumMin,
    orderFilters.statuses,
    orderStatusOptions,
    statusSystem.isEnabled,
    t,
    useWorkTypes,
    workTypeFilter,
    workTypes,
  ]);

  const filteredOrders = useMemo(() => {
    const q = deferredSearchQuery.trim().toLowerCase();
    const timeFrom = parseTimeToMinutes(orderFilters.departureTimeFrom);
    const timeTo = parseTimeToMinutes(orderFilters.departureTimeTo);
    const createdTimeFrom = parseTimeToMinutes(orderFilters.createdTimeFrom);
    const createdTimeTo = parseTimeToMinutes(orderFilters.createdTimeTo);
    return (orders || []).filter((order) => {
      if (
        effectiveStatusFilter === 'all' &&
        isFeedFeatureEnabled &&
        feedStatusValues.has(String(order?.status || '').trim())
      ) {
        return false;
      }
      if (timeFrom != null || timeTo != null) {
        const dt = order?.time_window_start ? new Date(order.time_window_start) : null;
        if (dt && !Number.isNaN(dt.getTime())) {
          const minutes = dt.getHours() * MINUTES_PER_HOUR + dt.getMinutes();
          if (timeFrom != null && minutes < timeFrom) return false;
          if (timeTo != null && minutes > timeTo) return false;
        }
      }
      if (createdTimeFrom != null || createdTimeTo != null) {
        const createdAt = order?.created_at ? new Date(order.created_at) : null;
        if (createdAt && !Number.isNaN(createdAt.getTime())) {
          const minutes = createdAt.getHours() * MINUTES_PER_HOUR + createdAt.getMinutes();
          if (createdTimeFrom != null && minutes < createdTimeFrom) return false;
          if (createdTimeTo != null && minutes > createdTimeTo) return false;
        }
      }
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
          phones: shouldShowOrderPhoneForRole(order, companySettings, profile?.role)
            ? [
                order?.customer_phone_visible,
                order?.customer_phone,
                order?.phone,
              ]
            : [],
        }),
        q,
      );
    });
  }, [
    companySettings,
    deferredSearchQuery,
    effectiveStatusFilter,
    feedStatusValues,
    isFeedFeatureEnabled,
    orderFilters.createdTimeFrom,
    orderFilters.createdTimeTo,
    orderFilters.departureTimeFrom,
    orderFilters.departureTimeTo,
    orders,
    profile?.role,
    t,
  ]);

  const sortOptions = useMemo(() => getOrderSortOptions(t), [t]);

  const sortedFilteredOrders = useMemo(() => {
    return sortOrders(filteredOrders, normalizedSortKey);
  }, [filteredOrders, normalizedSortKey]);

  const loadMore = useCallback(async () => {
    if (isFetchingNextPage || !hasNextPage || listLoading) return;
    await fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, listLoading]);

  const returnParamsRef = useRef({
    filter: effectiveStatusFilter,
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
      filter: effectiveStatusFilter,
      search: searchQuery,
      ...(departmentFilter != null ? { department: String(departmentFilter) } : {}),
      ...buildRouteFilterParams(orderFilters),
      ...(relationClientId ? { relation_client_id: relationClientId } : {}),
      ...(relationObjectIds.length ? { relation_object_ids: relationObjectIds.join(',') } : {}),
      ...(relationLabel ? { relation_label: relationLabel } : {}),
    };
  }, [
    departmentFilter,
    effectiveStatusFilter,
    orderFilters,
    relationClientId,
    relationLabel,
    relationObjectIds,
    searchQuery,
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
        queryClient.setQueryData(queryKeys.requests.detail(orderId), (prevOrder) =>
          markRequestDetailSeed(
            {
              ...orderSeed,
              ...(seedWorkTypeName ? { work_type_name: seedWorkTypeName } : {}),
              id: orderId,
            },
            prevOrder,
          ),
        );
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
        companySettingsOverride={companySettings || null}
      />
    ),
    [companySettings, departureTimeEnabled, openOrderDetails, orderFieldsByKey],
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
        {statusNavigationReady ? <View style={styles.filterBar}>
          <View style={styles.statusFilterRow}>
            {visibleQuickStatusKeys.map((key) => {
              const active = effectiveStatusFilter === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => selectStatusFilter(key)}
                  style={({ pressed }) => [
                    styles.chip,
                    statusChipWidths[key] ? { width: statusChipWidths[key] } : null,
                    active && styles.chipActive,
                    pressed && { opacity: ALL_ORDERS_PRESSED_OPACITY },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  {key === 'feed' && feedState === 'new' ? (
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        StyleSheet.absoluteFillObject,
                        styles.feedChipPulseOverlay,
                        {
                          opacity: feedPulse.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.04, 0.13],
                          }),
                        },
                      ]}
                    />
                  ) : null}
                  <View style={styles.chipContent}>
                    {key === 'feed' &&
                      (feedState === 'new' ? (
                        <Animated.View
                          style={[
                            styles.feedDotBase,
                            styles.feedDotNew,
                            {
                              transform: [
                                {
                                  scale: feedPulse.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [1, 1.25],
                                  }),
                                },
                              ],
                              opacity: feedPulse.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0.75, 1],
                              }),
                            },
                          ]}
                        />
                      ) : feedState === 'seen' ? (
                        <View style={[styles.feedDotBase, styles.feedDotSeen]} />
                      ) : (
                        <View style={[styles.feedDotBase, styles.feedDotPlaceholder]} />
                      ))}
                    <Text
                      style={[styles.chipText, active && styles.chipTextActive]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {statusChipLabels[key] || getStatusLabel(key)}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => setStatusSelectVisible(true)}
              style={({ pressed }) => [
                styles.chip,
                styles.statusMoreChip,
                { width: statusMoreWidth },
                isOverflowStatusActive && styles.chipActive,
                pressed && { opacity: ALL_ORDERS_PRESSED_OPACITY },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: isOverflowStatusActive }}
            >
              <View style={styles.chipContent}>
                <Text
                  style={[
                    styles.chipText,
                    styles.statusMoreText,
                    isOverflowStatusActive && styles.chipTextActive,
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {statusMoreLabel}
                </Text>
                <Feather
                  name="chevron-down"
                  size={14}
                  color={isOverflowStatusActive ? theme.colors.onPrimary : theme.colors.textSecondary}
                  style={styles.statusMoreIcon}
                />
              </View>
            </Pressable>
          </View>
        </View> : null}

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
            setStatusFilter('all');
            router.setParams({ ...buildClearedRouteFilterParams(), filter: 'all' });
          }}
          metaText={`${t('common_shown')} ${sortedFilteredOrders.length} ${t('common_of')} ${orders.length}`}
        />
      </View>
    ),
    [
      filterSummaryData.compact,
      filterSummaryData.full,
      getStatusLabel,
      statusNavigationReady,
      hasLinkedRelationFilter,
      relationLabel,
      router,
      searchQuery,
      effectiveStatusFilter,
      orders.length,
      sortedFilteredOrders.length,
      styles.chip,
      styles.chipActive,
      styles.chipContent,
      styles.chipText,
      styles.chipTextActive,
      styles.feedChipPulseOverlay,
      styles.feedDotBase,
      styles.feedDotNew,
      styles.feedDotPlaceholder,
      styles.feedDotSeen,
      styles.filterBar,
      styles.listHeader,
      styles.searchBar,
      styles.statusFilterRow,
      styles.statusMoreChip,
      styles.statusMoreIcon,
      styles.statusMoreText,
      feedPulse,
      feedState,
      visibleQuickStatusKeys,
      statusChipLabels,
      statusChipWidths,
      statusMoreWidth,
      isOverflowStatusActive,
      selectStatusFilter,
      statusMoreLabel,
      t,
      theme.colors.onPrimary,
      theme.colors.textSecondary,
    ],
  );

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

    return <EmptyListState />;
  }, [
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

  if (isSoloAdmin) return null;

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

      <OrdersFiltersPanel
        visible={filtersVisible}
        onClose={() => setFiltersVisible(false)}
        statusOptions={statusSystem.isEnabled ? panelStatusOptions : []}
        workTypeOptions={useWorkTypes ? workTypes : []}
        clientOptions={clientOptions}
        executorOptions={executorOptions}
        showExecutors
        values={orderFilters}
        setValue={setOrderFilterValue}
        defaults={ORDER_FILTER_DEFAULTS}
        onReset={() => {
          setOrderFilters(createOrderFilterDefaults());
          setStatusFilter('all');
          router.setParams({ ...buildClearedRouteFilterParams(), filter: 'all' });
        }}
        onApply={(nextValues) => {
          const nextStatuses = Array.from(
            new Set(
              (statusSystem.isEnabled && Array.isArray(nextValues?.statuses)
                ? nextValues.statuses
                : []
              )
                .map(normalizeAllOrdersStatusFilter)
                .filter((status) => statusTabs.includes(status) && status !== 'all'),
            ),
          );
          const nextStatus = resolveAllOrdersStatusSelection(nextStatuses, 'all');
          const normalizedNextValues = {
            ...nextValues,
            statuses: nextStatuses,
            workTypes: useWorkTypes ? nextValues?.workTypes : [],
            executorIds: Array.isArray(nextValues?.executorIds)
              ? nextValues.executorIds.map(String).filter(Boolean)
              : nextValues?.executorId
                ? [String(nextValues.executorId)]
                : [],
          };
          normalizedNextValues.executorId = normalizedNextValues.executorIds[0] || null;
          setStatusFilter(nextStatus);
          recordStatusFilterUsage(nextStatus);
          setOrderFilters(normalizedNextValues);
          router.setParams({
            ...buildRouteFilterParams(normalizedNextValues),
            filter: nextStatus === MULTIPLE_STATUS_FILTER ? 'all' : nextStatus,
          });
        }}
      />
      {hasStatusNavigation ? (
        <StatusSelectModal
          visible={statusSelectVisible}
          onClose={() => setStatusSelectVisible(false)}
          options={statusSelectOptions}
          value={effectiveStatusFilter}
          onChange={selectStatusFilter}
          title={t('orders_filter_status')}
        />
      ) : null}
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
  const listHorizontalPadding = ALL_ORDERS_LIST_HORIZONTAL_PADDING;
  const listBottomPadding = ALL_ORDERS_LIST_BOTTOM_PADDING;
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
    listHeader: {},
    filterBar: {
      marginBottom: 14,
    },
    statusFilterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'stretch',
      width: '100%',
      gap: ALL_ORDERS_STATUS_CHIP_GAP,
      padding: ALL_ORDERS_STATUS_BAR_PADDING,
      borderRadius: theme.radii?.lg ?? 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.inputBg || theme.colors.surface,
    },
    chip: {
      minHeight: 30,
      paddingVertical: 5,
      paddingHorizontal: 7,
      backgroundColor: 'transparent',
      borderRadius: theme.radii?.md ?? 10,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 1,
      overflow: 'hidden',
    },
    chipActive: {
      backgroundColor: theme.colors.primary,
    },
    chipContent: {
      flexDirection: 'row',
      alignItems: 'center',
      minWidth: 0,
    },
    chipText: {
      flexShrink: 1,
      fontSize: Math.max(theme.typography.sizes.xs ?? 12, (theme.typography.sizes.sm ?? 14) - 1),
      color: theme.colors.text,
      textAlign: 'center',
      includeFontPadding: false,
    },
    chipTextActive: {
      color: theme.colors.onPrimary || theme.colors.primaryTextOn,
      fontWeight: theme.typography.weight.semibold || '600',
    },
    statusMoreChip: {
      width: ALL_ORDERS_STATUS_MORE_MIN_WIDTH,
      flexShrink: 0,
    },
    statusMoreText: {
      flexShrink: 0,
    },
    statusMoreIcon: {
      marginLeft: 3,
    },
    feedChipPulseOverlay: {
      backgroundColor: theme.colors.danger,
    },
    feedDotBase: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
      marginRight: 4,
    },
    feedDotNew: {
      backgroundColor: theme.colors.danger,
    },
    feedDotSeen: {
      backgroundColor: withAlpha(theme.colors.danger, 0.22),
      borderWidth: 1,
      borderColor: withAlpha(theme.colors.danger, 0.55),
    },
    feedDotPlaceholder: {
      opacity: 0,
    },
    searchBar: {
      marginHorizontal: searchBarOffset,
    },
    emptyWrap: {
      paddingVertical: Number(theme.spacing.xl ?? 24) * 1.5,
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
      minHeight: 40,
      paddingHorizontal: theme.spacing.lg,
      borderRadius: theme.radii?.pill ?? 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.primary,
    },
    retryText: {
      color: theme.colors.onPrimary || theme.colors.primaryTextOn,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.semibold,
    },
    paginationFooter: {
      paddingVertical: 20,
    },
  });
}
