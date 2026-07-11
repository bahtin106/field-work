import { useFocusEffect, useNavigation, useIsFocused } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
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
  View,
  useWindowDimensions,
} from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import DynamicOrderCard from '../../components/DynamicOrderCard';
import OrdersFiltersPanel from '../../components/filters/OrdersFiltersPanel';
import SearchFiltersBar from '../../components/filters/SearchFiltersBar';
import StatusSelectModal from '../../components/filters/StatusSelectModal';
import { useAuth } from '../../components/hooks/useAuth';
import { useFilters } from '../../components/hooks/useFilters';
import Screen from '../../components/layout/Screen';
import AppHeader from '../../components/navigation/AppHeader';
import Button from '../../components/ui/Button';
import EmptyListState from '../../components/ui/EmptyListState';
import {
  ThemedRefreshControl,
  useManagedRefresh,
  usePullToRefreshFeedback,
} from '../../components/ui/PullToRefreshFeedback';
import { useCompanySettings } from '../../hooks/useCompanySettings';
import { resolveAppLocale } from '../../lib/localeFormatting';
import { useMyCompanyId } from '../../hooks/useMyCompanyId';
import { usePersistedOrderStatusUsage } from '../../lib/orderStatusUsage';
import { getOrderStatusLabel, useCompanyOrderStatuses } from '../../lib/orderStatuses';
import goBackSmart from '../../lib/navigation/goBackSmart';
import { formatPersonName } from '../../lib/personName';
import { shouldShowOrderPhoneForRole } from '../../lib/phoneVisibilityRules';
import {
  getOrderIdsByWorkTypes,
  getStatusDbAliases,
  normalizeOrderStatusFilterKey,
} from '../../lib/orderFilters';
import { supabase } from '../../lib/supabase';
import { fetchWorkTypes } from '../../lib/workTypes';
import { useClients } from '../../src/features/clients/queries';
import {
  ENTITY_FIELD_TYPES,
  buildFallbackEntityFieldSettings,
  getEntityFieldMap,
} from '../../src/features/fieldSettings/catalog';
import { useEntityFieldSettings } from '../../src/features/fieldSettings/queries';
import {
  ORDER_DEFAULT_SORT_KEY,
  applyOrderSortToQuery,
  getOrderSortOptions,
  normalizeOrderSortKey,
  sortOrders,
} from '../../src/features/orders/orderSort';
import {
  fetchAccessibleFeedCount,
  useOrderFacetCounts,
} from '../../src/features/orders/facetCounts';
import {
  ensureRequestPrefetch,
  markRequestDetailSeed,
  useRequestExecutors,
} from '../../src/features/requests/queries';
import {
  enrichOrdersWithExecutorNames,
  enrichOrdersWithKnownExecutorRows,
  hydrateExecutorNameCache,
  prefetchExecutorNames,
  seedExecutorNames,
} from '../../src/features/requests/executorNameCache';
import { listRequests } from '../../src/features/requests/api';
import { preloadOrderDetailsScreen } from '../../src/features/requests/orderDetailsPreload';
import {
  applyOrderRelationFilters,
  hasRelationFilters,
  parseRelationIdsParam,
} from '../../src/features/requests/relationFilters';
import { resolveRequestTitle } from '../../src/features/requests/title';
import { joinFilterSummary, summarizeFilterPart } from '../../src/shared/filters/summary';
import {
  markFirstContent,
  markScreenMount,
  measureNetwork,
  startFpsProbe,
  trackRender,
} from '../../src/shared/perf/devMetrics';
import { buildSearchIndex, matchesSearch } from '../../src/shared/search/matching';
import { getPrefetchRegistry } from '../../src/shared/query/prefetchRegistry';
import { queryKeys } from '../../src/shared/query/queryKeys';
import { useScreenRefreshRegistration } from '../../src/shared/query/screenRefreshRegistry';
import { useTranslation } from '../../src/i18n/useTranslation';
import { withAlpha } from '../../theme/colors';
import { useTheme } from '../../theme/ThemeProvider';

const LIST_CACHE_MAX_ENTRIES = 24;
const DEFAULT_MY_ORDERS_PAGE_SIZE = 30;
const MY_ORDERS_LIST_CACHE_STORAGE_PREFIX = 'orders.my.listCache.v4';
const MY_ORDERS_CACHE_PERSIST_DEBOUNCE_MS = 350;
const MY_ORDERS_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MY_ORDERS_LIST_CACHE_FRESH_MS = 45 * 1000;
const FEED_SEEN_STORAGE_PREFIX = 'myorders.feedSeen.v2';
const FEED_LAST_FP_STORAGE_PREFIX = 'myorders.feedLastFp.v2';
const MY_ORDERS_SCREEN_KEY = 'MyOrders';
const MY_ORDERS_RENDER_WARN_THRESHOLD = 30;
const MY_ORDERS_FPS_PROBE_MS = 3500;
const MY_ORDERS_NAV_LOCK_MS = 1200;
const MY_ORDERS_REFRESH_WAIT_TIMEOUT_MS = 12000;
const MY_ORDERS_BACKGROUND_REFRESH_DELAY_MS = 1200;
const MY_ORDERS_FEED_PREVIEW_SIZE = 20;
const MY_ORDERS_FEED_PREFETCH_DELAY_MS = 350;
const MY_ORDERS_FEED_PULSE_DURATION_MS = 1200;
const MY_ORDERS_FEED_INDICATOR_CACHE_KEY = 'feed.indicator.v1';
const MY_ORDERS_EXECUTOR_PREFETCH_LIMIT = 80;
const MY_ORDERS_VIEWABILITY_PREFETCH_LIMIT = 2;
const MY_ORDERS_VIEWABILITY_PREFETCH_TTL_MS = 2500;
const MY_ORDERS_STATUS_ALWAYS_VISIBLE = Object.freeze(['feed', 'all']);
const MY_ORDERS_STATUS_BAR_PADDING = 3;
const MY_ORDERS_STATUS_CHIP_GAP = 2;
const MY_ORDERS_STATUS_CHIP_MIN_WIDTH = 38;
const MY_ORDERS_STATUS_CHIP_MAX_WIDTH = 92;
const MY_ORDERS_STATUS_CHIP_ACTIVE_MAX_WIDTH = 148;
const MY_ORDERS_STATUS_CHIP_STRETCH_MAX_WIDTH = 168;
const MY_ORDERS_STATUS_MORE_MIN_WIDTH = 70;
const MY_ORDERS_STATUS_MORE_MAX_WIDTH = 84;
const MY_ORDERS_STATUS_USAGE_STORAGE_PREFIX = 'orders.my.statusUsage.v1';
const MY_ORDERS_STATUS_USAGE_MAX_ENTRIES = 32;
const MULTIPLE_STATUS_FILTER = '__multiple__';
const ORDER_FILTER_DEFAULTS = Object.freeze({
  workTypes: [],
  statuses: [],
  clientIds: [],
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
});
const MY_ORDERS_LIST = Object.freeze({
  initialNumToRender: 8,
  maxToRenderPerBatch: 6,
  updateCellsBatchingPeriod: 34,
  windowSize: 9,
  itemVisiblePercentThreshold: 45,
  onEndReachedThreshold: 0.65,
});

function normalizeMyOrdersStatusFilter(value) {
  const key = String(value || '').trim();
  if (!key) return 'all';
  if (key === 'in_progress') return 'progress';
  return key;
}

function resolveMyOrdersStatusSelection(values = [], fallback = 'all') {
  const statuses = Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map(normalizeMyOrdersStatusFilter)
        .filter((status) => status && status !== 'all'),
    ),
  );
  if (statuses.length > 1) return MULTIPLE_STATUS_FILTER;
  if (statuses.length === 1) return statuses[0];
  return normalizeMyOrdersStatusFilter(fallback);
}

function estimateStatusChipWidth(label, { hasLeadingDot = false, maxWidth = MY_ORDERS_STATUS_CHIP_MAX_WIDTH } = {}) {
  const text = String(label || '');
  const textWidth = Math.ceil(Array.from(text).length * 7.7);
  const leadWidth = hasLeadingDot ? 13 : 0;
  return Math.max(
    MY_ORDERS_STATUS_CHIP_MIN_WIDTH,
    Math.min(maxWidth, textWidth + leadWidth + 22),
  );
}

function normalizeStatusUsagePayload(raw, allowedIds = []) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const source = parsed?.items && typeof parsed.items === 'object' ? parsed.items : parsed;
    if (!source || typeof source !== 'object') return {};
    const allowed = new Set((allowedIds || []).map(normalizeMyOrdersStatusFilter).filter(Boolean));
    const entries = Object.entries(source)
      .map(([rawKey, rawValue]) => {
        const key = normalizeMyOrdersStatusFilter(rawKey);
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
      .slice(0, MY_ORDERS_STATUS_USAGE_MAX_ENTRIES);
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

function rankStatusFilterOptions(options = [], usage = {}) {
  return options
    .map((option, index) => ({ option, index }))
    .sort((a, b) => {
      const aKey = normalizeMyOrdersStatusFilter(a.option?.id);
      const bKey = normalizeMyOrdersStatusFilter(b.option?.id);
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

const SortSelectModal = lazy(() => import('../../components/filters/SortSelectModal'));

function buildScopedStorageKey(prefix, scopeKey) {
  return `${prefix}:${String(scopeKey || 'anonymous')}`;
}

function buildOrdersRecentQueryKey(scopeKey) {
  return ['orders', 'my', 'recent', String(scopeKey || 'anonymous')];
}

function pruneObjectCache(cacheObj, maxEntries = LIST_CACHE_MAX_ENTRIES) {
  const keys = Object.keys(cacheObj || {});
  if (keys.length <= maxEntries) return;
  const overflow = keys.length - maxEntries;
  keys.slice(0, overflow).forEach((key) => {
    delete cacheObj[key];
  });
}

function readPersistedListCachePayload(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return null;
    const savedAt = Number(parsed.savedAt || 0);
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > MY_ORDERS_CACHE_MAX_AGE_MS) return null;
    const entries = parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : null;
    if (!entries) return null;
    const fetchedAt = parsed.fetchedAt && typeof parsed.fetchedAt === 'object' ? parsed.fetchedAt : {};
    return { entries, fetchedAt, savedAt };
  } catch {
    return null;
  }
}

function excludeFeedStatuses(query) {
  const feedStatusAliases = getStatusDbAliases('feed').filter(Boolean);
  if (!feedStatusAliases.length) return query;
  const encoded = feedStatusAliases
    .map((value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',');
  return query.or(`status.is.null,status.not.in.(${encoded})`);
}

function MyOrdersContent() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const queryClient = useQueryClient();
  trackRender(MY_ORDERS_SCREEN_KEY, MY_ORDERS_RENDER_WARN_THRESHOLD);

  useEffect(() => {
    markScreenMount(MY_ORDERS_SCREEN_KEY);
  }, []);

  const mutedColor =
    theme?.text?.muted?.color ??
    theme?.colors?.muted ??
    theme?.colors?.textSecondary ??
    theme?.colors?.text;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        filterBar: {
          marginBottom: 14,
        },
        statusFilterRow: {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'stretch',
          width: '100%',
          gap: MY_ORDERS_STATUS_CHIP_GAP,
          padding: MY_ORDERS_STATUS_BAR_PADDING,
          borderRadius: theme.radii?.lg ?? 12,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.inputBg || theme.colors.surface,
        },
        chip: {
          minHeight: 30,
          paddingVertical: 5,
          paddingHorizontal: 7,
          backgroundColor:
            theme.components?.segmented?.inactiveBg ??
            theme.colors.button?.secondaryBg ??
            theme.colors.surface,
          borderRadius: theme.radii?.md ?? 10,
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 1,
          overflow: 'hidden',
        },
        chipActive: {
          backgroundColor: theme.components?.segmented?.activeBg ?? theme.colors.primary,
        },
        chipText: {
          flexShrink: 1,
          fontSize: Math.max(theme.typography.sizes.xs ?? 12, (theme.typography.sizes.sm ?? 14) - 1),
          color: theme.components?.segmented?.inactiveFg ?? theme.colors.text,
          textAlign: 'center',
          includeFontPadding: false,
        },
        chipTextActive: {
          color:
            theme.components?.segmented?.activeFg ??
            theme.colors.onPrimary ??
            theme.colors.primaryTextOn,
          fontWeight: '600',
        },
        chipContent: {
          flexDirection: 'row',
          alignItems: 'center',
          minWidth: 0,
        },
        statusMoreChip: {
          width: MY_ORDERS_STATUS_MORE_MIN_WIDTH,
          flexShrink: 0,
        },
        statusMoreText: {
          flexShrink: 0,
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
        container: {
          padding: 16,
          paddingBottom: 40,
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
        retryButtonContainer: {
          marginTop: theme.spacing.sm,
        },
      }),
    [theme, mutedColor],
  );

  function normalizeForFingerprint(values = {}) {
    const keys = Object.keys(values).sort();
    const normalized = {};
    keys.forEach((key) => {
      if (key === 'executorId' || key === 'executorIds') return;
      const value = values[key];
      normalized[key] = Array.isArray(value) ? [...value].sort() : value;
    });
    return normalized;
  }

  const parseTimeToMinutes = (value) => {
    if (!value) return null;
    const [hours, minutes] = value.split(':');
    const h = Number(hours);
    const m = Number(minutes);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  };

  const filters = useFilters({
    screenKey: 'orders-my',
    defaults: ORDER_FILTER_DEFAULTS,
  });
  const filterPanelValues = useMemo(
    () => ({ ...filters.values, executorId: null, executorIds: [] }),
    [filters.values],
  );

  const setFilterValue = filters.setValue;
  const selectedStatusFilters = filters.values?.statuses;
  const revalidateFilters = filters.revalidate;

  const router = useRouter();
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const auth = useAuth();
  const authAccountType = String(auth.user?.user_metadata?.account_type || '').toLowerCase();
  const isSoloAdmin = String(auth.profile?.role || '').toLowerCase() === 'admin' && authAccountType === 'solo';
  const { companyId } = useMyCompanyId();
  const statusSystem = useCompanyOrderStatuses(companyId);

  useFocusEffect(
    useCallback(() => {
      revalidateFilters({ extend: true });
    }, [revalidateFilters]),
  );

  const {
    seedFilter,
    seedSearch,
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
  const relationFingerprint = useMemo(
    () => JSON.stringify({ clientId: relationClientId, objectIds: relationObjectIds }),
    [relationClientId, relationObjectIds],
  );

  const orderStatusOptions = useMemo(
    () =>
      statusSystem.isEnabled
        ? statusSystem.regularStatuses.map((status) => ({
            id: normalizeMyOrdersStatusFilter(status.status_key),
            label: getOrderStatusLabel(status.status_key, statusSystem.statuses, t),
          }))
        : [],
    [statusSystem.isEnabled, statusSystem.regularStatuses, statusSystem.statuses, t],
  );
  const statusFilterLabels = useMemo(() => {
    const labels = {
      feed: t('order_status_in_feed'),
      all: t('common_all'),
    };
    orderStatusOptions.forEach((option) => {
      const key = normalizeMyOrdersStatusFilter(option?.id);
      if (key) labels[key] = option?.label || key;
    });
    labels.progress = labels.progress || t('order_status_in_progress');
    return labels;
  }, [orderStatusOptions, t]);
  const statusFilterOptions = useMemo(() => {
    const seen = new Set();
    const addOption = (id, label) => {
      const key = normalizeMyOrdersStatusFilter(id);
      if (!key || seen.has(key)) return null;
      seen.add(key);
      return { id: key, label: label || statusFilterLabels[key] || key };
    };
    if (!statusSystem.isEnabled) return [];
    const leadingOptions = [
      ...(statusSystem.feedEnabled && !isSoloAdmin ? [addOption('feed', statusFilterLabels.feed)] : []),
      addOption('all', statusFilterLabels.all),
    ];
    return [
      ...leadingOptions,
      ...orderStatusOptions.map((option) => addOption(option?.id, option?.label)),
    ].filter(Boolean);
  }, [isSoloAdmin, orderStatusOptions, statusFilterLabels, statusSystem.feedEnabled, statusSystem.isEnabled]);
  const panelStatusOptions = useMemo(
    () =>
      statusFilterOptions
        .filter((option) => option.id !== 'all')
        .map((option) => ({ ...option, exclusive: option.id === 'feed' })),
    [statusFilterOptions],
  );
  const statusChipLabels = useMemo(
    () => ({
      ...statusFilterLabels,
      feed: t('order_status_in_feed_short'),
    }),
    [statusFilterLabels, t],
  );
  const statusAliasToFilterKey = useMemo(() => {
    const aliasMap = new Map();
    orderStatusOptions.forEach((opt) => {
      const key = normalizeMyOrdersStatusFilter(opt?.id);
      if (!key) return;
      aliasMap.set(key, key);
      getStatusDbAliases(normalizeOrderStatusFilterKey(key)).forEach((alias) => {
        const aliasKey = String(alias || '').trim();
        if (aliasKey) aliasMap.set(aliasKey, key);
      });
    });
    if (statusSystem.feedEnabled && !isSoloAdmin) {
      getStatusDbAliases('feed').forEach((alias) => {
        const aliasKey = String(alias || '').trim();
        if (aliasKey) aliasMap.set(aliasKey, 'feed');
      });
    }
    return aliasMap;
  }, [isSoloAdmin, orderStatusOptions, statusSystem.feedEnabled]);

  const handleBackPress = useCallback(() => {
    goBackSmart(navigation, router, null, '/orders');
  }, [navigation, router]);

  const { settings: companySettings } = useCompanySettings(companyId);
  const { data: orderFieldSettingsData } = useEntityFieldSettings(ENTITY_FIELD_TYPES.ORDER, {
    enabled: !!companyId,
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
  const hasSelectedClientFilters =
    Array.isArray(filters.values?.clientIds) && filters.values.clientIds.length > 0;
  const shouldLoadClientOptions = !!companyId && (filters.visible || hasSelectedClientFilters);
  const { data: companyClients = [] } = useClients(
    { companyId, search: '' },
    { enabled: shouldLoadClientOptions },
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
  const [useWorkTypesFlag, setUseWorkTypesFlag] = useState(false);
  const [workTypeOptions, setWorkTypeOptions] = useState([]);
  const [statusSelectVisible, setStatusSelectVisible] = useState(false);
  const [sortVisible, setSortVisible] = useState(false);
  const [sortKey, setSortKey] = useState(ORDER_DEFAULT_SORT_KEY);
  const normalizedSortKey = normalizeOrderSortKey(sortKey);
  const listFingerprint = useMemo(
    () =>
      JSON.stringify({
        filters: normalizeForFingerprint(filters.values),
        sort: normalizedSortKey,
      }),
    [filters.values, normalizedSortKey],
  );
  const hasSelectedWorkTypeFilters =
    Array.isArray(filters.values?.workTypes) && filters.values.workTypes.length > 0;
  const shouldLoadWorkTypeOptions =
    !!companyId && (filters.visible || hasSelectedWorkTypeFilters);
  useEffect(() => {
    let alive = true;
    if (!companyId) {
      setUseWorkTypesFlag(false);
      setWorkTypeOptions([]);
      return undefined;
    }
    if (!shouldLoadWorkTypeOptions) {
      return undefined;
    }
    (async () => {
      try {
        const { useWorkTypes, types } = await fetchWorkTypes(companyId);
        if (!alive) return;
        setUseWorkTypesFlag(!!useWorkTypes);
        setWorkTypeOptions(types || []);
      } catch {
        if (!alive) return;
        setUseWorkTypesFlag(false);
        setWorkTypeOptions([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [companyId, shouldLoadWorkTypeOptions]);

  const filterSummaryData = useMemo(() => {
    const fullParts = [];
    const compactParts = [];
    const {
      workTypes: selectedWorkTypes,
      statuses,
      clientIds,
      departureDateFrom,
      departureDateTo,
      departureTimeFrom,
      departureTimeTo,
      createdDateFrom,
      createdDateTo,
      createdTimeFrom,
      createdTimeTo,
      sumMin,
      sumMax,
    } = filters.values;

    if (selectedWorkTypes?.length) {
      const names = selectedWorkTypes
        .map((id) => workTypeOptions.find((wt) => String(wt.id) === String(id))?.name)
        .filter(Boolean);
      if (names.length) {
        fullParts.push(
          summarizeFilterPart({ label: t('order_field_work_type'), values: names, countWhenMany: false }),
        );
        compactParts.push(
          summarizeFilterPart({ label: t('order_field_work_type'), values: names, countWhenMany: true }),
        );
      }
    }

    if (statusSystem.isEnabled && statuses?.length) {
      const labels = statuses
        .map((code) => {
          const normalized = normalizeMyOrdersStatusFilter(code);
          return statusFilterLabels[normalized] || code;
        })
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
    if (clientIds?.length) {
      const labels = clientIds
        .map((id) => clientOptions.find((item) => String(item.id) === String(id))?.label)
        .filter(Boolean);
      if (labels.length) {
        fullParts.push(
          summarizeFilterPart({ label: t('common_client'), values: labels, countWhenMany: false }),
        );
        compactParts.push(
          summarizeFilterPart({ label: t('common_client'), values: labels, countWhenMany: true }),
        );
      }
    }
    const formatDate = (value) => {
      if (!value) return null;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return null;
      return parsed.toLocaleDateString(resolveAppLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    if (departureDateFrom || departureDateTo) {
      const fromLabel = formatDate(departureDateFrom) || '-';
      const toLabel = formatDate(departureDateTo) || '-';
      const part = t('order_field_departure_date') + ': ' + fromLabel + ' - ' + toLabel;
      fullParts.push(part);
      compactParts.push(part);
    }

    if (createdDateFrom || createdDateTo) {
      const fromLabel = formatDate(createdDateFrom) || '-';
      const toLabel = formatDate(createdDateTo) || '-';
      const part = t('orders_filter_created_date') + ': ' + fromLabel + ' - ' + toLabel;
      fullParts.push(part);
      compactParts.push(part);
    }

    const formatTime = (value) => {
      if (!value) return null;
      const [hours, minutes] = value.split(':');
      const h = Number(hours);
      const m = Number(minutes);
      if (Number.isNaN(h) || Number.isNaN(m)) return null;
      const base = new Date();
      base.setHours(h, m, 0, 0);
      return base.toLocaleTimeString(resolveAppLocale(), { hour: '2-digit', minute: '2-digit' });
    };

    if (departureTimeFrom || departureTimeTo) {
      const fromLabel = formatTime(departureTimeFrom) || '-';
      const toLabel = formatTime(departureTimeTo) || '-';
      const part = t('order_field_departure_time') + ': ' + fromLabel + ' - ' + toLabel;
      fullParts.push(part);
      compactParts.push(part);
    }

    if (createdTimeFrom || createdTimeTo) {
      const fromLabel = formatTime(createdTimeFrom) || '-';
      const toLabel = formatTime(createdTimeTo) || '-';
      const part = t('orders_filter_created_time') + ': ' + fromLabel + ' - ' + toLabel;
      fullParts.push(part);
      compactParts.push(part);
    }

    const formatRange = (min, max) => {
      if (min && max) return String(min) + ' - ' + String(max);
      if (min) return 'From ' + String(min);
      if (max) return 'Up to ' + String(max);
      return null;
    };

    const amountRange = formatRange(sumMin, sumMax);
    if (amountRange) {
      const part = `${t('order_details_amount')}: ${amountRange}`;
      fullParts.push(part);
      compactParts.push(part);
    }

    return {
      full: joinFilterSummary(fullParts, t('common_bullet')),
      compact: joinFilterSummary(compactParts, t('common_bullet')),
    };
  }, [clientOptions, filters.values, statusFilterLabels, statusSystem.isEnabled, workTypeOptions, t]);

  const cacheScopeKey = useMemo(() => {
    const scopedUserId = String(auth.user?.id || auth.profile?.id || '').trim();
    const scopedCompanyId = String(companyId || auth.profile?.company_id || '').trim();
    return scopedUserId ? `${scopedUserId}:${scopedCompanyId || 'no-company'}` : 'anonymous';
  }, [auth.profile?.company_id, auth.profile?.id, auth.user?.id, companyId]);
  const listCacheStorageKey = useMemo(
    () => buildScopedStorageKey(MY_ORDERS_LIST_CACHE_STORAGE_PREFIX, cacheScopeKey),
    [cacheScopeKey],
  );
  const feedSeenStorageKey = useMemo(
    () => buildScopedStorageKey(FEED_SEEN_STORAGE_PREFIX, cacheScopeKey),
    [cacheScopeKey],
  );
  const feedLastFpStorageKey = useMemo(
    () => buildScopedStorageKey(FEED_LAST_FP_STORAGE_PREFIX, cacheScopeKey),
    [cacheScopeKey],
  );
  const statusUsageStorageKey = useMemo(
    () => buildScopedStorageKey(MY_ORDERS_STATUS_USAGE_STORAGE_PREFIX, cacheScopeKey),
    [cacheScopeKey],
  );
  const statusUsageAllowedIds = useMemo(
    () => statusFilterOptions.map((option) => normalizeMyOrdersStatusFilter(option?.id)).filter(Boolean),
    [statusFilterOptions],
  );
  const statusAlwaysVisibleKeys = useMemo(
    () => MY_ORDERS_STATUS_ALWAYS_VISIBLE.filter((key) => statusUsageAllowedIds.includes(key)),
    [statusUsageAllowedIds],
  );
  const hasStatusNavigation =
    statusSystem.isEnabled &&
    (orderStatusOptions.length > 0 || (statusSystem.feedEnabled && !isSoloAdmin));
  const {
    usage: statusUsage,
    usageRef: statusUsageRef,
    isReady: statusUsageReady,
    persistUsage: persistStatusUsage,
    refreshUsage: refreshStatusUsage,
  } = usePersistedOrderStatusUsage(
    statusUsageStorageKey,
    statusUsageAllowedIds,
    normalizeStatusUsagePayload,
  );
  const statusNavigationReady = hasStatusNavigation && statusUsageReady;
  useFocusEffect(
    useCallback(() => {
      refreshStatusUsage();
    }, [refreshStatusUsage]),
  );
  const recentOrdersQueryKey = useMemo(
    () => buildOrdersRecentQueryKey(cacheScopeKey),
    [cacheScopeKey],
  );

  // Shared caches are scoped by auth user/company so instant paint never crosses accounts.
  const LIST_CACHE = (globalThis.LIST_CACHE ||= {});
  LIST_CACHE.myByScope ||= {};
  LIST_CACHE.myByScope[cacheScopeKey] ||= {};
  const listCacheMy = LIST_CACHE.myByScope[cacheScopeKey];
  const PAGE_SIZE = DEFAULT_MY_ORDERS_PAGE_SIZE;
  const persistListCacheTimerRef = useRef(null);
  const listCacheFetchedAtRef = useRef({});
  const recentOrdersCacheKeyRef = useRef('');
  const persistListCache = useCallback(() => {
    if (persistListCacheTimerRef.current) {
      clearTimeout(persistListCacheTimerRef.current);
    }
    persistListCacheTimerRef.current = setTimeout(() => {
      persistListCacheTimerRef.current = null;
      try {
        AsyncStorage.setItem(
          listCacheStorageKey,
          JSON.stringify({
            savedAt: Date.now(),
            entries: listCacheMy,
            fetchedAt: listCacheFetchedAtRef.current,
          }),
        ).catch(() => {});
      } catch {}
    }, MY_ORDERS_CACHE_PERSIST_DEBOUNCE_MS);
  }, [listCacheMy, listCacheStorageKey]);
  const setListCacheEntry = useCallback(
    (cacheKey, value, options = {}) => {
      if (!cacheKey) return;
      listCacheMy[cacheKey] = value;
      if (options?.fetchedAt) {
        listCacheFetchedAtRef.current[cacheKey] = Number(options.fetchedAt) || Date.now();
      }
      pruneObjectCache(listCacheMy, LIST_CACHE_MAX_ENTRIES);
      persistListCache();
    },
    [listCacheMy, persistListCache],
  );
  const seenFilterRef = useRef(new Set());
  const makeCacheKey = useCallback(
    (key, fp, relationFp = '') =>
      `${(typeof key === 'string' ? key : 'all') || 'all'}:${fp || ''}:${relationFp || ''}`,
    [],
  );
  const defaultListCacheKey = useMemo(
    () => makeCacheKey('all', listFingerprint, relationFingerprint),
    [listFingerprint, makeCacheKey, relationFingerprint],
  );

  const [orders, setOrders] = useState(() => {
    const prefetchData = queryClient.getQueryData(recentOrdersQueryKey);
    if (Array.isArray(prefetchData)) {
      return prefetchData;
    }
    const cachedDefault = listCacheMy[defaultListCacheKey];
    if (Array.isArray(cachedDefault) && cachedDefault.length > 0) {
      return cachedDefault;
    }
    return [];
  });
  const [filter, setFilter] = useState(() =>
    resolveMyOrdersStatusSelection(filters.values?.statuses, 'all'),
  );
  const rawStatusFilter = normalizeMyOrdersStatusFilter(filter);
  const activeStatusFilter =
    hasStatusNavigation &&
    (rawStatusFilter === MULTIPLE_STATUS_FILTER || statusUsageAllowedIds.includes(rawStatusFilter))
      ? rawStatusFilter
      : 'all';
  const isFeedFeatureEnabled = statusSystem.isEnabled && statusSystem.feedEnabled && !isSoloAdmin;
  const effectiveFilter = activeStatusFilter;
  const recordStatusFilterUsage = useCallback(
    (nextFilter) => {
      const key = normalizeMyOrdersStatusFilter(nextFilter);
      if (!key || statusAlwaysVisibleKeys.includes(key)) return;
      if (!statusUsageAllowedIds.includes(key)) return;
      const now = Date.now();
      const currentUsage = statusUsageRef.current || {};
      const current = currentUsage[key] || {};
      const next = {
        ...currentUsage,
        [key]: {
          count: Math.min(999999, (Number(current.count) || 0) + 1),
          lastUsedAt: now,
        },
      };
      const normalized = normalizeStatusUsagePayload({ items: next }, statusUsageAllowedIds);
      statusUsageRef.current = normalized;
      persistStatusUsage(normalized, { savedAt: now });
    },
    [persistStatusUsage, statusAlwaysVisibleKeys, statusUsageAllowedIds, statusUsageRef],
  );
  const statusSelectOptions = useMemo(
    () => rankStatusFilterOptions(statusFilterOptions, statusUsage),
    [statusFilterOptions, statusUsage],
  );
  const orderedStatusQuickKeys = useMemo(() => {
    const rankedStatuses = rankStatusFilterOptions(
      statusFilterOptions.filter(
        (option) => !statusAlwaysVisibleKeys.includes(normalizeMyOrdersStatusFilter(option?.id)),
      ),
      statusUsage,
    ).map((option) => normalizeMyOrdersStatusFilter(option?.id));

    return [
      ...statusAlwaysVisibleKeys,
      ...rankedStatuses.filter(Boolean),
    ];
  }, [statusAlwaysVisibleKeys, statusFilterOptions, statusUsage]);
  const statusQuickLayout = useMemo(() => {
    const availableWidth = Math.max(0, Number(windowWidth || 0) - 32 - MY_ORDERS_STATUS_BAR_PADDING * 2);
    const reservedMoreWidth = MY_ORDERS_STATUS_MORE_MIN_WIDTH;
    const selected = [];
    const widths = {};
    let used = 0;

    const addChip = (key, { force = false, active = false } = {}) => {
      if (!key || selected.includes(key)) return false;
      const label = statusChipLabels[key] || statusFilterLabels[key] || key;
      const nextWidth = estimateStatusChipWidth(label, {
        hasLeadingDot: key === 'feed',
        maxWidth: active ? MY_ORDERS_STATUS_CHIP_ACTIVE_MAX_WIDTH : MY_ORDERS_STATUS_CHIP_MAX_WIDTH,
      });
      const nextGap = selected.length > 0 ? MY_ORDERS_STATUS_CHIP_GAP : 0;
      const projected = used + nextGap + nextWidth;
      const remainingGap = MY_ORDERS_STATUS_CHIP_GAP;
      const requiredWidth = projected + remainingGap + reservedMoreWidth;

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
        active: activeStatusFilter === key,
        force: statusAlwaysVisibleKeys.includes(key),
      });
    });

    let moreWidth = reservedMoreWidth;
    const totalWidth =
      selected.reduce((sum, key) => sum + (widths[key] || 0), 0) +
      moreWidth +
      MY_ORDERS_STATUS_CHIP_GAP * selected.length;
    let extra = Math.max(0, availableWidth - totalWidth);

    const getStretchMax = (key) => {
      const label = statusChipLabels[key] || statusFilterLabels[key] || key;
      const fullWidth = estimateStatusChipWidth(label, {
        hasLeadingDot: key === 'feed',
        maxWidth:
          activeStatusFilter === key
            ? MY_ORDERS_STATUS_CHIP_STRETCH_MAX_WIDTH
            : MY_ORDERS_STATUS_CHIP_ACTIVE_MAX_WIDTH,
      });
      if (statusAlwaysVisibleKeys.includes(key)) {
        return Math.max(widths[key] || 0, fullWidth);
      }
      return Math.max(widths[key] || 0, fullWidth + (activeStatusFilter === key ? 8 : 4));
    };

    const stretchOrder = [
      activeStatusFilter,
      ...selected.filter((key) => !statusAlwaysVisibleKeys.includes(key) && key !== activeStatusFilter),
      ...selected.filter((key) => statusAlwaysVisibleKeys.includes(key) && key !== activeStatusFilter),
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
      const addToMore = Math.min(MY_ORDERS_STATUS_MORE_MAX_WIDTH - moreWidth, extra);
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
    activeStatusFilter,
    orderedStatusQuickKeys,
    statusAlwaysVisibleKeys,
    statusChipLabels,
    statusFilterLabels,
    windowWidth,
  ]);
  const visibleQuickStatusKeys = statusQuickLayout.keys;
  const statusChipWidths = statusQuickLayout.widths;
  const statusMoreWidth = statusQuickLayout.moreWidth || MY_ORDERS_STATUS_MORE_MIN_WIDTH;
  const isOverflowStatusActive = !visibleQuickStatusKeys.includes(activeStatusFilter);
  const statusMoreLabel = t('viewer_more');
  const [loading, setLoading] = useState(() => {
    const prefetchData = queryClient.getQueryData(recentOrdersQueryKey);
    if (Array.isArray(prefetchData)) {
      return false;
    }
    return !Array.isArray(listCacheMy[defaultListCacheKey]);
  });
  const [loadError, setLoadError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreOrders, setHasMoreOrders] = useState(false);
  const [totalOrdersCount, setTotalOrdersCount] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const hydratedRef = useRef(Array.isArray(orders) && orders.length > 0);
  const ordersCountRef = useRef(Array.isArray(orders) ? orders.length : 0);
  const firstContentMarkedRef = useRef(false);
  const hasAssignedOrders = useMemo(
    () => Array.isArray(orders) && orders.some((order) => String(order?.assigned_to || '').trim()),
    [orders],
  );
  const { data: executorsForCards = [] } = useRequestExecutors({
    companyId,
    enabled: !!companyId && hasAssignedOrders,
    placeholderData: (prev) => prev ?? [],
  });
  useEffect(() => {
    ordersCountRef.current = Array.isArray(orders) ? orders.length : 0;
  }, [orders]);
  const getCachedOrdersSnapshot = useCallback(
    (nextFilter) => {
      const key = normalizeMyOrdersStatusFilter(nextFilter || 'all');
      const cacheKey = makeCacheKey(key, listFingerprint, relationFingerprint);
      const exactRows = listCacheMy[cacheKey];
      if (Array.isArray(exactRows)) {
        return {
          cacheKey,
          fetchedAt: Number(listCacheFetchedAtRef.current[cacheKey] || 0),
          exact: true,
          rows: exactRows,
        };
      }

      if (key === 'all') {
        const recentRows = queryClient.getQueryData(recentOrdersQueryKey);
        if (Array.isArray(recentRows) && recentOrdersCacheKeyRef.current === cacheKey) {
          return {
            cacheKey,
            fetchedAt: Number(listCacheFetchedAtRef.current[cacheKey] || 0),
            exact: true,
            rows: recentRows,
          };
        }
      }

      if (key && key !== 'all' && key !== 'feed') {
        const allCacheKey = makeCacheKey('all', listFingerprint, relationFingerprint);
        const allRows = Array.isArray(listCacheMy[allCacheKey])
          ? listCacheMy[allCacheKey]
          : recentOrdersCacheKeyRef.current === allCacheKey
            ? queryClient.getQueryData(recentOrdersQueryKey)
            : null;
        if (Array.isArray(allRows)) {
          const normalizedStatusKey = normalizeOrderStatusFilterKey(key);
          const rows = allRows.filter((order) => {
            const rawStatus = String(order?.status || '').trim();
            const mappedStatus = statusAliasToFilterKey.get(rawStatus) || normalizeOrderStatusFilterKey(rawStatus);
            return mappedStatus === normalizedStatusKey;
          });
          return {
            cacheKey,
            fetchedAt: Number(listCacheFetchedAtRef.current[allCacheKey] || 0),
            exact: false,
            rows,
          };
        }
      }

      return null;
    },
    [
      listFingerprint,
      listCacheMy,
      makeCacheKey,
      queryClient,
      recentOrdersQueryKey,
      relationFingerprint,
      statusAliasToFilterKey,
    ],
  );
  const applyOrdersSnapshot = useCallback(
    (snapshot) => {
      if (!snapshot || !Array.isArray(snapshot.rows)) return false;
      setOrders(snapshot.rows);
      setTotalOrdersCount(snapshot.rows.length);
      setHasMoreOrders(Boolean(snapshot.exact && snapshot.rows.length >= PAGE_SIZE));
      setLoadingMore(false);
      setLoadError('');
      setLoading(false);
      hydratedRef.current = true;
      if (snapshot.cacheKey) {
        seenFilterRef.current.add(snapshot.cacheKey);
      }
      return true;
    },
    [PAGE_SIZE],
  );
  const primeOrdersFromCache = useCallback(
    (nextFilter) => {
      const snapshot = getCachedOrdersSnapshot(nextFilter);
      if (snapshot && (snapshot.exact || snapshot.rows.length > 0)) {
        applyOrdersSnapshot(snapshot);
        return snapshot;
      }

      setOrders([]);
      setTotalOrdersCount(0);
      setHasMoreOrders(false);
      setLoadingMore(false);
      setLoadError('');
      setLoading(true);
      return null;
    },
    [applyOrdersSnapshot, getCachedOrdersSnapshot],
  );
  const selectStatusFilter = useCallback(
    (nextFilter, options = {}) => {
      const normalized = normalizeMyOrdersStatusFilter(nextFilter);
      const nextStatus =
        normalized === MULTIPLE_STATUS_FILTER || statusUsageAllowedIds.includes(normalized)
          ? normalized
          : 'all';
      if (nextStatus !== activeStatusFilter) {
        forceNetworkRefreshRef.current = true;
        setRefreshNonce((value) => value + 1);
      }
      setFilter(nextStatus);
      if (options?.syncFilter !== false) {
        setFilterValue('statuses', nextStatus === 'all' ? [] : [nextStatus]);
      }
      primeOrdersFromCache(nextStatus);
      setStatusSelectVisible(false);
      if (options?.recordUsage !== false) {
        recordStatusFilterUsage(nextStatus);
      }
    },
    [
      activeStatusFilter,
      primeOrdersFromCache,
      recordStatusFilterUsage,
      setFilterValue,
      statusUsageAllowedIds,
    ],
  );
  useEffect(() => {
    if (firstContentMarkedRef.current) return;
    if (loading && !hydratedRef.current) return;
    firstContentMarkedRef.current = true;
    markFirstContent(MY_ORDERS_SCREEN_KEY);
  }, [loading]);
  useEffect(() => {
    if (statusSystem.isLoading) return;
    if (activeStatusFilter === MULTIPLE_STATUS_FILTER) return;
    const expectedStatuses = activeStatusFilter === 'all' ? [] : [activeStatusFilter];
    const currentStatuses = Array.isArray(selectedStatusFilters)
      ? selectedStatusFilters.map(normalizeMyOrdersStatusFilter).slice(0, 1)
      : [];
    if (
      currentStatuses.length !== expectedStatuses.length ||
      currentStatuses[0] !== expectedStatuses[0]
    ) {
      setFilterValue('statuses', expectedStatuses);
    }
  }, [activeStatusFilter, selectedStatusFilters, setFilterValue, statusSystem.isLoading]);
  useEffect(() => {
    if (!isFocused || !Array.isArray(orders) || orders.length === 0) return undefined;
    let cancelled = false;
    seedExecutorNames(executorsForCards);
    const knownEnriched = enrichOrdersWithKnownExecutorRows(orders, executorsForCards);
    if (knownEnriched.some((row, index) => row !== orders[index])) {
      const cacheKey = makeCacheKey(effectiveFilter || 'all', listFingerprint, relationFingerprint);
      setOrders(knownEnriched);
      setListCacheEntry(cacheKey, knownEnriched);
      if ((effectiveFilter || 'all') === 'all') {
        recentOrdersCacheKeyRef.current = cacheKey;
        queryClient.setQueryData(recentOrdersQueryKey, knownEnriched.slice(0, PAGE_SIZE));
      }
      return () => {
        cancelled = true;
      };
    }
    seedExecutorNames(orders);
    const executorIds = Array.from(
      new Set(
        orders
          .map((order) => String(order?.assigned_to || '').trim())
          .filter(Boolean),
      ),
    ).slice(0, MY_ORDERS_EXECUTOR_PREFETCH_LIMIT);
    if (!executorIds.length) return undefined;
    (async () => {
      await hydrateExecutorNameCache();
      if (cancelled) return;
      const enriched = await enrichOrdersWithExecutorNames(orders);
      if (cancelled || !Array.isArray(enriched)) return;
      const changed = enriched.some((row, index) => row !== orders[index]);
      if (!changed) return;
      const cacheKey = makeCacheKey(effectiveFilter || 'all', listFingerprint, relationFingerprint);
      setOrders(enriched);
      setListCacheEntry(cacheKey, enriched);
      if ((effectiveFilter || 'all') === 'all') {
        recentOrdersCacheKeyRef.current = cacheKey;
        queryClient.setQueryData(recentOrdersQueryKey, enriched.slice(0, PAGE_SIZE));
      }
    })().catch(() => {
      prefetchExecutorNames(executorIds).catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [
    effectiveFilter,
    executorsForCards,
    listFingerprint,
    isFocused,
    listCacheMy,
    makeCacheKey,
    orders,
    PAGE_SIZE,
    queryClient,
    recentOrdersQueryKey,
    relationFingerprint,
    setListCacheEntry,
  ]);
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(listCacheStorageKey)
      .then((raw) => {
        if (!alive) return;
        const persisted = readPersistedListCachePayload(raw);
        if (!persisted) return;
        Object.assign(listCacheMy, persisted.entries);
        pruneObjectCache(listCacheMy, LIST_CACHE_MAX_ENTRIES);
        Object.keys(persisted.entries || {}).forEach((key) => {
          listCacheFetchedAtRef.current[key] =
            Number(persisted.fetchedAt?.[key] || 0) || persisted.savedAt;
        });

        const currentKey = makeCacheKey(effectiveFilter || 'all', listFingerprint, relationFingerprint);
        const cachedCurrent = listCacheMy[currentKey];
        const cachedDefault = listCacheMy[defaultListCacheKey];
        const best = Array.isArray(cachedCurrent)
          ? cachedCurrent
          : Array.isArray(cachedDefault)
            ? cachedDefault
            : null;
        if (!best) return;

        if (Array.isArray(cachedDefault)) {
          recentOrdersCacheKeyRef.current = defaultListCacheKey;
          queryClient.setQueryData(recentOrdersQueryKey, cachedDefault.slice(0, PAGE_SIZE));
        }
        if (ordersCountRef.current === 0) {
          setOrders(best);
          setTotalOrdersCount(best.length);
          hydratedRef.current = true;
          setLoading(false);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (persistListCacheTimerRef.current) {
        clearTimeout(persistListCacheTimerRef.current);
        persistListCacheTimerRef.current = null;
      }
    };
  }, [
    defaultListCacheKey,
    effectiveFilter,
    listFingerprint,
    listCacheMy,
    listCacheStorageKey,
    makeCacheKey,
    PAGE_SIZE,
    queryClient,
    recentOrdersQueryKey,
    relationFingerprint,
  ]);
  useEffect(() => {
    if (statusSystem.isLoading) return;
    if (rawStatusFilter !== activeStatusFilter) {
      setFilter(activeStatusFilter);
    }
  }, [activeStatusFilter, rawStatusFilter, statusSystem.isLoading]);

  // Full dataset loading (batch streaming)
  // Feed indicator state (cached preview of feed), scoped with the same account cache key.
  const feedStateCache = (globalThis.__MYORDERS_FEED_STATE ||= {});
  feedStateCache[cacheScopeKey] ||= {};
  const scopedFeedState = feedStateCache[cacheScopeKey];
  const [feedFingerprint, setFeedFingerprint] = useState(() => scopedFeedState.fp || '');
  const [feedSeenFingerprint, setFeedSeenFingerprint] = useState(() => scopedFeedState.seenFp || '');
  const [feedHasAny, setFeedHasAny] = useState(() => Boolean(scopedFeedState.hasAny));
  const [feedTotalCount, setFeedTotalCount] = useState(() => {
    const cachedCount = Number(scopedFeedState.totalCount);
    return Number.isFinite(cachedCount) ? cachedCount : null;
  });
  const feedPulse = useRef(new Animated.Value(0)).current;
  const detailNavLockRef = useRef({ id: '', ts: 0 });
  const fetchNextOrdersPageRef = useRef(null);
  const viewabilityPrefetchRef = useRef({ key: '', ts: 0 });
  const feedMetaRequestSeqRef = useRef(0);
  const activeCacheScopeRef = useRef(cacheScopeKey);
  const refreshWaitersRef = useRef([]);
  const forceNetworkRefreshRef = useRef(false);
  const resolveRefreshWaiters = useCallback(() => {
    const waiters = refreshWaitersRef.current.splice(0);
    waiters.forEach((resolve) => {
      try {
        resolve();
      } catch {}
    });
  }, []);
  useEffect(() => () => resolveRefreshWaiters(), [resolveRefreshWaiters]);

  useEffect(() => {
    if (activeCacheScopeRef.current === cacheScopeKey) return;
    activeCacheScopeRef.current = cacheScopeKey;
    feedMetaRequestSeqRef.current += 1;
    const cacheKey = makeCacheKey(effectiveFilter || 'all', listFingerprint, relationFingerprint);
    const scopedCachedList = listCacheMy[cacheKey];

    seenFilterRef.current.clear();
    hydratedRef.current = false;
    fetchNextOrdersPageRef.current = null;
    setOrders(Array.isArray(scopedCachedList) ? scopedCachedList : []);
    setTotalOrdersCount(Array.isArray(scopedCachedList) ? scopedCachedList.length : 0);
    setLoading(!Array.isArray(scopedCachedList));
    setLoadingMore(false);
    setHasMoreOrders(false);
    setLoadError('');
    setFeedFingerprint(scopedFeedState.fp || '');
    setFeedSeenFingerprint(scopedFeedState.seenFp || '');
    setFeedHasAny(Boolean(scopedFeedState.hasAny));
  }, [cacheScopeKey, effectiveFilter, listCacheMy, listFingerprint, makeCacheKey, relationFingerprint, scopedFeedState]);

  useEffect(() => {
    return startFpsProbe(MY_ORDERS_SCREEN_KEY, MY_ORDERS_FPS_PROBE_MS);
  }, []);

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

  const feedState = !feedHasAny
    ? 'none'
    : feedFingerprint && feedFingerprint === feedSeenFingerprint
      ? 'seen'
      : 'new';

  // Load persisted feed seen state (keeps "seen/new" across app restarts)
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
    const run = async () => {
      try {
        const [seenFp, lastFp] = await Promise.all([
          AsyncStorage.getItem(feedSeenStorageKey),
          AsyncStorage.getItem(feedLastFpStorageKey),
        ]);

        if (typeof seenFp === 'string' && seenFp.length) {
          setFeedSeenFingerprint(seenFp);
          scopedFeedState.seenFp = seenFp;
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
  }, [feedLastFpStorageKey, feedSeenStorageKey, isFeedFeatureEnabled, scopedFeedState]);

  useEffect(() => {
    if (!isFeedFeatureEnabled || feedState !== 'new') {
      feedPulse.stopAnimation();
      feedPulse.setValue(0);
      return undefined;
    }

    // Pulse for "new in feed" state
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(feedPulse, {
          toValue: 1,
          duration: MY_ORDERS_FEED_PULSE_DURATION_MS,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(feedPulse, {
          toValue: 0,
          duration: MY_ORDERS_FEED_PULSE_DURATION_MS,
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

  const updateFeedMeta = useCallback((arr, totalCount = null) => {
    if (!isFeedFeatureEnabled) {
      scopedFeedState.fp = '';
      scopedFeedState.hasAny = false;
      scopedFeedState.totalCount = 0;
      setFeedFingerprint('');
      setFeedHasAny(false);
      setFeedTotalCount(0);
      return;
    }
    const fp = Array.isArray(arr)
      ? arr
          .slice(0, MY_ORDERS_FEED_PREVIEW_SIZE)
          .map((o) => o?.id)
          .filter(Boolean)
          .join(',')
      : '';
    const hasAny = Boolean(arr && arr.length);

    scopedFeedState.fp = fp;
    scopedFeedState.hasAny = hasAny;
    const normalizedTotalCount = Number(totalCount);
    if (Number.isFinite(normalizedTotalCount)) {
      scopedFeedState.totalCount = normalizedTotalCount;
      setFeedTotalCount(normalizedTotalCount);
    }

    setFeedFingerprint(fp);
    setFeedHasAny(hasAny);

    // Persist last known feed fingerprint (no UI spinners, best-effort)
    try {
      if (fp) AsyncStorage.setItem(feedLastFpStorageKey, fp);
      else AsyncStorage.removeItem(feedLastFpStorageKey);
    } catch {}
  }, [feedLastFpStorageKey, isFeedFeatureEnabled, scopedFeedState]);

  // Prefetch feed metadata from the first page when the screen is focused
  useEffect(() => {
    if (!isFeedFeatureEnabled) return undefined;
    if (!isFocused) return;
    if (loading && orders.length === 0) return;
    const prefetchFeed = async () => {
      const cached = listCacheMy[MY_ORDERS_FEED_INDICATOR_CACHE_KEY];
      if (Array.isArray(cached)) {
        updateFeedMeta(cached, cached.length);
      }

      let uid = String(auth.user?.id || auth.profile?.id || '').trim();
      if (!uid) {
        const { data: sessionData } = await supabase.auth.getSession();
        uid = String(sessionData?.session?.user?.id || '').trim();
      }
      if (!uid) return;

      const requestSeq = feedMetaRequestSeqRef.current + 1;
      feedMetaRequestSeqRef.current = requestSeq;
      try {
        const [data, countResult] = await Promise.all([
          listRequests({
            scope: 'all',
            status: 'feed',
            userId: uid,
            page: 1,
            pageSize: MY_ORDERS_FEED_PREVIEW_SIZE,
          }),
          fetchAccessibleFeedCount().catch(() => null),
        ]);
        if (feedMetaRequestSeqRef.current !== requestSeq) return;
        setListCacheEntry(MY_ORDERS_FEED_INDICATOR_CACHE_KEY, data, { fetchedAt: Date.now() });
        const exactCount = countResult == null ? null : Number(countResult);
        updateFeedMeta(
          data,
          Number.isFinite(exactCount) ? Math.max(exactCount, data.length) : data.length,
        );
      } catch {}
    };

    let task = null;
    const timer = setTimeout(() => {
      task = InteractionManager.runAfterInteractions(() => {
        prefetchFeed().catch(() => {});
      });
    }, MY_ORDERS_FEED_PREFETCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      try {
        task?.cancel?.();
      } catch {}
    };
  }, [auth.profile?.id, auth.user?.id, isFeedFeatureEnabled, isFocused, loading, orders.length, setListCacheEntry, updateFeedMeta, listCacheMy]);

  // Mark feed as seen after opening the feed tab
  useEffect(() => {
    if (!isFeedFeatureEnabled) return;
    if (activeStatusFilter !== 'feed') return;
    if (!feedHasAny || !feedFingerprint) return;
    if (feedSeenFingerprint === feedFingerprint) return;

    setFeedSeenFingerprint(feedFingerprint);
    scopedFeedState.seenFp = feedFingerprint;

    try {
      AsyncStorage.setItem(feedSeenStorageKey, feedFingerprint);
    } catch {}
  }, [activeStatusFilter, feedSeenStorageKey, feedHasAny, feedFingerprint, feedSeenFingerprint, isFeedFeatureEnabled, scopedFeedState]);
  // Hydrate the all-orders tab from prefetch cache once
  useEffect(() => {
    if (effectiveFilter === 'all' && !hydratedRef.current) {
      const prefetchData = queryClient.getQueryData(recentOrdersQueryKey);
      if (Array.isArray(prefetchData)) {
        hydratedRef.current = true;
        if (orders.length === 0 || prefetchData.length === 0) setOrders(prefetchData);
        setLoading(false);
      }
    }
  }, [effectiveFilter, orders.length, queryClient, recentOrdersQueryKey]);

  const seedOnceRef = useRef(false);
  useEffect(() => {
    if (seedOnceRef.current) return;
    seedOnceRef.current = true;
    /* seed from cache */
    const seedStatus = typeof seedFilter === 'string' && seedFilter.length
      ? normalizeMyOrdersStatusFilter(seedFilter)
      : activeStatusFilter || 'all';
    const k = statusUsageAllowedIds.includes(seedStatus) ? seedStatus : 'all';
    const listKey = makeCacheKey(k, listFingerprint, relationFingerprint);
    if (listCacheMy[listKey]) {
      setOrders(listCacheMy[listKey]);
      hydratedRef.current = true;
    }
    if (typeof seedFilter === 'string' && seedFilter.length) {
      selectStatusFilter(seedFilter, { recordUsage: false });
    }
    if (typeof seedSearch === 'string') setSearchQuery(seedSearch);
  }, [
    seedFilter,
    seedSearch,
    activeStatusFilter,
    listCacheMy,
    listFingerprint,
    makeCacheKey,
    relationFingerprint,
    selectStatusFilter,
    statusUsageAllowedIds,
  ]);

  useEffect(() => {
    if (!isFocused) return;
    let alive = true;
    let backgroundTimer = null;

    const fetchUserAndOrders = async (isBackground = false, options = {}) => {
      const forceNetwork = !!options?.forceNetwork;
      const key = (typeof effectiveFilter === 'string' ? effectiveFilter : 'all') || 'all';
      const cacheKey = makeCacheKey(key, listFingerprint, relationFingerprint);
      const cachedSnapshot = getCachedOrdersSnapshot(key);
      const hasVisibleSnapshot =
        cachedSnapshot && (cachedSnapshot.exact || cachedSnapshot.rows.length > 0);

      if (hasVisibleSnapshot) {
        applyOrdersSnapshot(cachedSnapshot);
      } else if (!seenFilterRef.current.has(cacheKey) && !isBackground) {
        setOrders([]);
        setTotalOrdersCount(0);
        setHasMoreOrders(false);
        setLoadingMore(false);
        setLoading(true);
      }

      const cacheFresh =
        cachedSnapshot?.exact &&
        cachedSnapshot.fetchedAt > 0 &&
        Date.now() - cachedSnapshot.fetchedAt < MY_ORDERS_LIST_CACHE_FRESH_MS;
      if (!forceNetwork && !isBackground && cacheFresh) {
        resolveRefreshWaiters();
        return;
      }

      let uid = String(auth.user?.id || auth.profile?.id || '').trim();
      if (!uid) {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!alive) return;
        uid = String(sessionData?.session?.user?.id || '').trim();
      }
      if (!uid) {
        setOrders([]);
        setTotalOrdersCount(0);
        setHasMoreOrders(false);
        setLoadingMore(false);
        setLoadError('');
        setLoading(false);
        resolveRefreshWaiters();
        return;
      }

      const filterValues = filters.values;
      const selectedStatusKeys = statusSystem.isEnabled && Array.isArray(filterValues.statuses)
        ? filterValues.statuses
            .map((code) => normalizeOrderStatusFilterKey(code))
            .filter((code) => code && code !== 'all')
        : [];
      const statusFilters = selectedStatusKeys.length
        ? selectedStatusKeys.flatMap((code) => getStatusDbAliases(code)).filter(Boolean)
        : [];
      const clientIds = Array.isArray(filterValues.clientIds)
        ? filterValues.clientIds.map(String).filter(Boolean)
        : [];
      const sumMin = parseFloat(filterValues.sumMin);
      const sumMax = parseFloat(filterValues.sumMax);
      const toIsoDate = (value, startVal) => {
        if (!value) return null;
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return null;
        if (startVal) d.setHours(0, 0, 0, 0);
        else d.setHours(23, 59, 59, 999);
        return d.toISOString();
      };
      const dateFrom = toIsoDate(filterValues.departureDateFrom, true);
      const dateTo = toIsoDate(filterValues.departureDateTo, false);
      const createdFrom = toIsoDate(filterValues.createdDateFrom, true);
      const createdTo = toIsoDate(filterValues.createdDateTo, false);

      const selectedWorkTypes = Array.isArray(filterValues.workTypes) ? filterValues.workTypes : [];
      let workTypeOrderIds = null;
      if (useWorkTypesFlag && selectedWorkTypes.length) {
        workTypeOrderIds = await getOrderIdsByWorkTypes(selectedWorkTypes);
        if (!alive) return;
        if (!workTypeOrderIds.length) {
          const emptyResult = [];
          setOrders(emptyResult);
          setTotalOrdersCount(0);
          setHasMoreOrders(false);
          setListCacheEntry(cacheKey, emptyResult, { fetchedAt: Date.now() });
          if (key === 'all') {
            recentOrdersCacheKeyRef.current = cacheKey;
            queryClient.setQueryData(recentOrdersQueryKey, emptyResult);
          }
          if (key === 'feed') updateFeedMeta(emptyResult);
          setLoadingMore(false);
          setLoadError('');
          setLoading(false);
          resolveRefreshWaiters();
          return;
        }
      }

      const buildOrdersQuery = (selectOptions = undefined) => {
        let query = supabase.from('orders_accessible').select('*', selectOptions);
        if (key === 'all' && hasLinkedRelationFilter) {
          query = query.or(`assigned_to.eq.${uid},assigned_to.is.null`);
        } else if (key === 'feed') {
          const feedStatusAliases = getStatusDbAliases('feed');
          if (feedStatusAliases.length === 1) query = query.eq('status', feedStatusAliases[0]);
          else if (feedStatusAliases.length > 1) query = query.in('status', feedStatusAliases);
        } else {
          query = query.eq('assigned_to', uid);
          if (key !== 'all') {
            const statusAliases = getStatusDbAliases(normalizeOrderStatusFilterKey(key));
            if (statusAliases.length === 1) query = query.eq('status', statusAliases[0]);
            else if (statusAliases.length > 1) query = query.in('status', statusAliases);
          }
        }
        if (key === 'all' && isFeedFeatureEnabled) query = excludeFeedStatuses(query);
        if (statusFilters.length) query = query.in('status', statusFilters);
        if (clientIds.length) query = query.in('client_id', clientIds);
        if (!Number.isNaN(sumMin)) query = query.gte('start_price', sumMin);
        if (!Number.isNaN(sumMax)) query = query.lte('start_price', sumMax);
        if (dateFrom) query = query.gte('time_window_start', dateFrom);
        if (dateTo) query = query.lte('time_window_start', dateTo);
        if (createdFrom) query = query.gte('created_at', createdFrom);
        if (createdTo) query = query.lte('created_at', createdTo);
        if (Array.isArray(workTypeOrderIds) && workTypeOrderIds.length) query = query.in('id', workTypeOrderIds);
        return applyOrderRelationFilters(query, {
          clientId: relationClientId,
          objectIds: relationObjectIds,
        });
      };
      const canUseRequestsApi = !(key === 'all' && hasLinkedRelationFilter);
      const fetchOrdersPage = async (pageNumber) => {
        if (canUseRequestsApi) {
          return listRequests({
            scope: key === 'feed' ? 'all' : 'my',
            status: key === 'feed' ? 'feed' : key === 'all' ? 'all' : normalizeOrderStatusFilterKey(key),
            page: pageNumber,
            pageSize: PAGE_SIZE,
            userId: uid,
            sortKey: normalizedSortKey,
            statuses: selectedStatusKeys,
            clientIds,
            orderIds: Array.isArray(workTypeOrderIds) ? workTypeOrderIds : [],
            relationClientId,
            relationObjectIds,
            dateFrom,
            dateTo,
            createdFrom,
            createdTo,
            sumMin: Number.isNaN(sumMin) ? null : sumMin,
            sumMax: Number.isNaN(sumMax) ? null : sumMax,
            excludeFeedWhenAll: isFeedFeatureEnabled,
          });
        }

        const from = Math.max(0, (Number(pageNumber) - 1) * PAGE_SIZE);
        const to = from + PAGE_SIZE - 1;
        const { data: rows, error: pageError } = await applyOrderSortToQuery(
          buildOrdersQuery(),
          normalizedSortKey,
        ).range(from, to);
        if (pageError) throw pageError;
        return enrichOrdersWithExecutorNames(Array.isArray(rows) ? rows : []);
      };

      let data = null;
      let error = null;
      try {
        data = await measureNetwork(`myOrders.${key}.firstPage`, () => fetchOrdersPage(1));
      } catch (nextError) {
        error = nextError;
      }
      if (!alive) return;
      if (error || !Array.isArray(data)) {
        setLoadError(t('refresh_failed'));
        setLoadingMore(false);
        setLoading(false);
        resolveRefreshWaiters();
        return;
      }

      let aggregated = data.map((o) => ({ ...o, time_window_start: o.time_window_start ?? null }));
      let total = aggregated.length >= PAGE_SIZE ? aggregated.length + 1 : aggregated.length;
      let nextPageInFlight = false;

      setOrders(aggregated);
      setTotalOrdersCount(total);
      setHasMoreOrders(aggregated.length >= PAGE_SIZE);
      setListCacheEntry(cacheKey, aggregated, { fetchedAt: Date.now() });
      seenFilterRef.current.add(cacheKey);
      if (key === 'feed') updateFeedMeta(aggregated);
      if (key === 'all') {
        recentOrdersCacheKeyRef.current = cacheKey;
        queryClient.setQueryData(recentOrdersQueryKey, aggregated.slice(0, PAGE_SIZE));
      }
      hydratedRef.current = true;
      setLoadError('');
      setLoading(false);

      fetchNextOrdersPageRef.current = async () => {
        if (!alive || nextPageInFlight || total <= aggregated.length) return;
        nextPageInFlight = true;
        setLoadingMore(true);
        try {
          let chunkData = null;
          let chunkError = null;
          try {
            chunkData = await measureNetwork(`myOrders.${key}.nextPage`, () =>
              fetchOrdersPage(Math.floor(aggregated.length / PAGE_SIZE) + 1),
            );
          } catch (nextError) {
            chunkError = nextError;
          }
          if (!alive) return;
          if (chunkError || !Array.isArray(chunkData) || chunkData.length === 0) {
            total = aggregated.length;
            setTotalOrdersCount(total);
            setHasMoreOrders(false);
            return;
          }
          const chunk = chunkData.map((o) => ({ ...o, time_window_start: o.time_window_start ?? null }));
          aggregated = [...aggregated, ...chunk];
          total = chunk.length >= PAGE_SIZE ? Math.max(total, aggregated.length + 1) : aggregated.length;
          setOrders(aggregated);
          setListCacheEntry(cacheKey, aggregated, { fetchedAt: Date.now() });
          setTotalOrdersCount(total);
          setHasMoreOrders(chunk.length >= PAGE_SIZE);
          if (key === 'feed') updateFeedMeta(aggregated);
          if (key === 'all') {
            recentOrdersCacheKeyRef.current = cacheKey;
            queryClient.setQueryData(recentOrdersQueryKey, aggregated.slice(0, PAGE_SIZE));
          }
        } finally {
          nextPageInFlight = false;
          if (alive) setLoadingMore(false);
        }
      };

      setLoadingMore(false);
      resolveRefreshWaiters();
    };

    const forceNetwork = forceNetworkRefreshRef.current;
    forceNetworkRefreshRef.current = false;

    const initialSnapshot = getCachedOrdersSnapshot(effectiveFilter);
    const hasInitialSnapshot = initialSnapshot && (initialSnapshot.exact || initialSnapshot.rows.length > 0);
    const initialCacheFresh =
      initialSnapshot?.exact &&
      initialSnapshot.fetchedAt > 0 &&
      Date.now() - initialSnapshot.fetchedAt < MY_ORDERS_LIST_CACHE_FRESH_MS;

    if (hasInitialSnapshot) {
      applyOrdersSnapshot(initialSnapshot);
    }

    if (!forceNetwork && initialCacheFresh) {
      resolveRefreshWaiters();
    } else if (!forceNetwork && hasInitialSnapshot) {
      backgroundTimer = setTimeout(() => {
        fetchUserAndOrders(true);
      }, MY_ORDERS_BACKGROUND_REFRESH_DELAY_MS);
    } else {
      fetchUserAndOrders(false, { forceNetwork });
    }

    return () => {
      alive = false;
      fetchNextOrdersPageRef.current = null;
      if (backgroundTimer) clearTimeout(backgroundTimer);
    };
  }, [
    applyOrdersSnapshot,
    auth.profile?.id,
    auth.user?.id,
    effectiveFilter,
    filters.values,
    listFingerprint,
    getCachedOrdersSnapshot,
    hasLinkedRelationFilter,
    isFocused,
    makeCacheKey,
    normalizedSortKey,
    PAGE_SIZE,
    queryClient,
    recentOrdersQueryKey,
    refreshNonce,
    relationClientId,
    relationFingerprint,
    relationObjectIds,
    resolveRefreshWaiters,
    setListCacheEntry,
    t,
    updateFeedMeta,
    useWorkTypesFlag,
    isFeedFeatureEnabled,
    statusSystem.isEnabled,
  ]);

  const filteredOrders = useMemo(() => {
    const q = deferredSearchQuery.trim().toLowerCase();
    const timeFrom = parseTimeToMinutes(filters.values.departureTimeFrom);
    const timeTo = parseTimeToMinutes(filters.values.departureTimeTo);
    const createdTimeFrom = parseTimeToMinutes(filters.values.createdTimeFrom);
    const createdTimeTo = parseTimeToMinutes(filters.values.createdTimeTo);
    return (orders || []).filter((o) => {
      if (timeFrom != null || timeTo != null) {
        const dt = o?.time_window_start ? new Date(o.time_window_start) : null;
        if (dt && !Number.isNaN(dt.getTime())) {
          const minutes = dt.getHours() * 60 + dt.getMinutes();
          if (timeFrom != null && minutes < timeFrom) return false;
          if (timeTo != null && minutes > timeTo) return false;
        }
      }
      if (createdTimeFrom != null || createdTimeTo != null) {
        const createdAt = o?.created_at ? new Date(o.created_at) : null;
        if (createdAt && !Number.isNaN(createdAt.getTime())) {
          const minutes = createdAt.getHours() * 60 + createdAt.getMinutes();
          if (createdTimeFrom != null && minutes < createdTimeFrom) return false;
          if (createdTimeTo != null && minutes > createdTimeTo) return false;
        }
      }
      if (!q) return true;
      return matchesSearch(
        buildSearchIndex({
          texts: [
            resolveRequestTitle(o, {
              fallbackDate: o?.time_window_start || o?.created_at,
              prefix: t('order_auto_title_prefix'),
            }),
            o?.fio,
            o?.region,
            o?.city,
            o?.street,
            o?.house,
            o?.status,
            o?.description,
            o?.comment,
          ],
          phones: shouldShowOrderPhoneForRole(o, companySettings, auth.profile?.role)
            ? [o?.customer_phone_visible, o?.customer_phone, o?.phone]
            : [],
        }),
        q,
      );
    });
  }, [
    auth.profile?.role,
    companySettings,
    orders,
    deferredSearchQuery,
    filters.values.departureTimeFrom,
    filters.values.departureTimeTo,
    filters.values.createdTimeFrom,
    filters.values.createdTimeTo,
    t,
  ]);

  const sortOptions = useMemo(() => getOrderSortOptions(t), [t]);

  const sortedFilteredOrders = useMemo(() => {
    return sortOrders(filteredOrders, normalizedSortKey);
  }, [filteredOrders, normalizedSortKey]);

  const feedFacetOverride = useMemo(
    () => (Number.isFinite(feedTotalCount) ? { feed: feedTotalCount } : null),
    [feedTotalCount],
  );
  const ordersFacetCounts = useOrderFacetCounts(filteredOrders, panelStatusOptions, {
    isStatusNarrowed: normalizeMyOrdersStatusFilter(effectiveFilter || 'all') !== 'all',
    scopeKey: cacheScopeKey,
    statusOverrides: feedFacetOverride,
  });

  // List item renderer helpers
  const returnParamsRef = useRef({
    seedFilter: effectiveFilter,
    seedSearch: searchQuery,
    relation_client_id: relationClientId,
    relation_object_ids: relationObjectIds.join(','),
    relation_label: relationLabel,
  });
  useEffect(() => {
    returnParamsRef.current = {
      seedFilter: effectiveFilter,
      seedSearch: searchQuery,
      relation_client_id: relationClientId,
      relation_object_ids: relationObjectIds.join(','),
      relation_label: relationLabel,
    };
  }, [effectiveFilter, relationClientId, relationLabel, relationObjectIds, searchQuery]);
  const openOrderDetails = useCallback(
    (orderIdRaw, orderSeed = null) => {
      const orderId = String(orderIdRaw || '').trim();
      if (!orderId) return;
      const now = Date.now();
      const prev = detailNavLockRef.current;
      if (prev.id === orderId && now - prev.ts < MY_ORDERS_NAV_LOCK_MS) return;
      detailNavLockRef.current = { id: orderId, ts: now };
      if (orderSeed && typeof orderSeed === 'object') {
        const seedWorkTypeId = String(orderSeed?.work_type_id || '').trim();
        const seedWorkTypeName = seedWorkTypeId
          ? workTypeOptions.find((item) => String(item?.id || '') === seedWorkTypeId)?.name
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
          returnTo: '/orders/my-orders',
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
    [queryClient, router, workTypeOptions],
  );
  const renderItem = useCallback(
    ({ item: order }) => (
      <DynamicOrderCard
        order={order}
        context="my_orders"
        onPress={openOrderDetails}
        departureTimeEnabled={departureTimeEnabled}
        orderFieldsByKey={orderFieldsByKey}
        companyCurrency={companySettings?.currency || null}
        companySettingsOverride={companySettings || null}
      />
    ),
    [companySettings, departureTimeEnabled, openOrderDetails, orderFieldsByKey],
  );

  const loadMoreOrders = useCallback(() => {
    if (!hasMoreOrders || loading || loadingMore) return;
    fetchNextOrdersPageRef.current?.();
  }, [hasMoreOrders, loading, loadingMore]);

  const retryLoad = useCallback(() => {
    setLoadError('');
    setLoading(true);
    setLoadingMore(false);
    setRefreshNonce((n) => n + 1);
  }, []);

  const onViewableItemsChanged = useMemo(
    () => ({ viewableItems }) => {
      const ids = viewableItems
        .map((item) => item?.item?.id)
        .filter(Boolean)
        .slice(0, MY_ORDERS_VIEWABILITY_PREFETCH_LIMIT)
        .map(String);
      if (!ids.length) return;
      const key = ids.join('|');
      const now = Date.now();
      if (
        viewabilityPrefetchRef.current.key === key &&
        now - viewabilityPrefetchRef.current.ts < MY_ORDERS_VIEWABILITY_PREFETCH_TTL_MS
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
        queryClient.cancelQueries({ queryKey: ['requests', 'detail'] });
      },
      [queryClient],
    ),
  );

  // Footer spinner for pagination
  const renderFooter = useCallback(() => {
    if (!loadingMore) return null;
    return (
      <View style={{ paddingVertical: 20 }}>
        <ActivityIndicator size="small" color={theme.colors.primary} />
      </View>
    );
  }, [loadingMore, theme.colors.primary]);

  const listHeader = useMemo(
    () => (
      <View>
        {statusNavigationReady && visibleQuickStatusKeys.length > 0 ? (
          <View style={styles.filterBar}>
            <View style={styles.statusFilterRow}>
              {visibleQuickStatusKeys.map((key) => (
                <Pressable
                  key={key}
                  onPress={() => selectStatusFilter(key)}
                  style={({ pressed }) => [
                    styles.chip,
                    statusChipWidths[key] ? { width: statusChipWidths[key] } : null,
                    activeStatusFilter === key && styles.chipActive,
                    pressed && { opacity: 0.9 },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: activeStatusFilter === key }}
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
                      style={[styles.chipText, activeStatusFilter === key && styles.chipTextActive]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {statusChipLabels[key] || statusFilterLabels[key] || key}
                    </Text>
                  </View>
                </Pressable>
              ))}
              <Pressable
                onPress={() => setStatusSelectVisible(true)}
                style={({ pressed }) => [
                  styles.chip,
                  styles.statusMoreChip,
                  { width: statusMoreWidth },
                  isOverflowStatusActive && styles.chipActive,
                  pressed && { opacity: 0.9 },
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
                    color={
                      isOverflowStatusActive
                        ? theme.colors.onPrimary || theme.colors.primaryTextOn
                        : theme.colors.textSecondary
                    }
                    style={{ marginLeft: 3 }}
                  />
                </View>
              </Pressable>
            </View>
          </View>
        ) : null}

        <SearchFiltersBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          onClear={() => setSearchQuery('')}
          placeholder={t('common_search')}
          onOpenFilters={filters.open}
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
          onResetFilters={async () => {
            const resetValues = filters.reset();
            await filters.apply(resetValues);
            selectStatusFilter('all');
          }}
          metaText={`${t('common_shown')} ${sortedFilteredOrders.length} ${t('common_of')} ${Math.max(totalOrdersCount, orders.length)}`}
        />
      </View>
    ),
    [
      activeStatusFilter,
      statusNavigationReady,
      searchQuery,
      styles,
      feedState,
      feedPulse,
      filters,
      filterSummaryData,
      isOverflowStatusActive,
      orders.length,
      selectStatusFilter,
      sortedFilteredOrders.length,
      statusChipWidths,
      statusChipLabels,
      statusFilterLabels,
      statusMoreWidth,
      statusMoreLabel,
      theme.colors.onPrimary,
      theme.colors.primaryTextOn,
      theme.colors.textSecondary,
      totalOrdersCount,
      hasLinkedRelationFilter,
      relationLabel,
      t,
      visibleQuickStatusKeys,
    ],
  );

  // Empty state
  const ListEmptyComponent = useCallback(
    () => {
      if (loading && !hydratedRef.current) {
        return (
          <View style={styles.emptyWrap}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        );
      }

      if (loadError) {
        return (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>{t('refresh_failed')}</Text>
            <Text style={styles.emptyText}>{loadError}</Text>
            <Button
              title={t('btn_retry')}
              size="sm"
              onPress={retryLoad}
              containerStyle={styles.retryButtonContainer}
            />
          </View>
        );
      }

      return <EmptyListState />;
    },
    [
      loadError,
      loading,
      retryLoad,
      styles.emptyText,
      styles.emptyTitle,
      styles.emptyWrap,
      styles.retryButtonContainer,
      t,
      theme.colors.primary,
    ],
  );

  const keyExtractor = useCallback((item) => String(item.id), []);

  const refreshCurrentList = useCallback(async (context = {}) => {
    const reason = String(context?.reason || '').trim();
    const softRefresh = reason === 'route-focus' || reason === 'app-resume';
    const key = (typeof effectiveFilter === 'string' ? effectiveFilter : 'all') || 'all';
    const cacheKey = makeCacheKey(key, listFingerprint, relationFingerprint);
    setLoadError('');
    if (!softRefresh) {
      delete listCacheMy[cacheKey];
      delete listCacheFetchedAtRef.current[cacheKey];
      seenFilterRef.current.delete(cacheKey);
      forceNetworkRefreshRef.current = true;
      if (key === 'all') {
        recentOrdersCacheKeyRef.current = '';
        queryClient.setQueryData(recentOrdersQueryKey, undefined);
      }
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ['requests'] }),
        queryClient.invalidateQueries({ queryKey: ['requests', 'detail'] }),
      ]);
    }
    const hasVisibleRows = ordersCountRef.current > 0 || hydratedRef.current;
    setLoading(!softRefresh || !hasVisibleRows);
    setLoadingMore(false);
    setRefreshNonce((n) => n + 1);
    await new Promise((resolve) => {
      const timeoutId = setTimeout(resolve, MY_ORDERS_REFRESH_WAIT_TIMEOUT_MS);
      refreshWaitersRef.current.push(() => {
        clearTimeout(timeoutId);
        resolve();
      });
    });
  }, [
    effectiveFilter,
    listFingerprint,
    listCacheMy,
    makeCacheKey,
    queryClient,
    recentOrdersQueryKey,
    relationFingerprint,
  ]);

  const refreshWithIndicator = useCallback(async () => {
    await refreshCurrentList({ reason: 'user-refresh' });
  }, [refreshCurrentList]);
  const { refreshing: bgRefreshing, didSucceed, onRefresh } = useManagedRefresh(refreshWithIndicator);
  const { indicator: refreshIndicator } = usePullToRefreshFeedback(bgRefreshing, { didSucceed });

  useScreenRefreshRegistration(
    'orders.my',
      (context) => refreshCurrentList(context),
      true,
  );

  return (
    <Screen scroll={false} headerOptions={{ headerShown: false }}>
      <AppHeader
        back
        onBackPress={handleBackPress}
        options={{
          headerTitleAlign: 'left',
          title: t('routes.orders/my-orders'),
        }}
      />
      <View style={{ flex: 1 }}>
        {refreshIndicator}
        <FlatList
          data={sortedFilteredOrders}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          initialNumToRender={MY_ORDERS_LIST.initialNumToRender}
          maxToRenderPerBatch={MY_ORDERS_LIST.maxToRenderPerBatch}
          updateCellsBatchingPeriod={MY_ORDERS_LIST.updateCellsBatchingPeriod}
          windowSize={MY_ORDERS_LIST.windowSize}
          removeClippedSubviews={Platform.OS === 'android'}
          ListHeaderComponent={listHeader}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={ListEmptyComponent}
          contentContainerStyle={[
            styles.container,
            sortedFilteredOrders.length === 0 && { flexGrow: 1 },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onEndReached={loadMoreOrders}
          onEndReachedThreshold={MY_ORDERS_LIST.onEndReachedThreshold}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={{ itemVisiblePercentThreshold: MY_ORDERS_LIST.itemVisiblePercentThreshold }}
          refreshControl={<ThemedRefreshControl refreshing={bgRefreshing} onRefresh={onRefresh} />}
        />
      </View>
      <OrdersFiltersPanel
            visible={filters.visible}
            onClose={filters.close}
            statusOptions={statusSystem.isEnabled ? panelStatusOptions : []}
            workTypeOptions={useWorkTypesFlag ? workTypeOptions : []}
            clientOptions={clientOptions}
            facetCounts={ordersFacetCounts}
            values={filterPanelValues}
            setValue={filters.setValue}
            defaults={ORDER_FILTER_DEFAULTS}
            onReset={() => {
              filters.reset();
              selectStatusFilter('all');
            }}
            onApply={async (nextValues) => {
              const nextStatuses = Array.from(
                new Set(
                  (Array.isArray(nextValues?.statuses) ? nextValues.statuses : [])
                    .map(normalizeMyOrdersStatusFilter)
                    .filter((status) => statusUsageAllowedIds.includes(status) && status !== 'all'),
                ),
              );
              const nextStatus = resolveMyOrdersStatusSelection(nextStatuses, 'all');
              const normalizedNextValues = {
                ...nextValues,
                statuses: nextStatuses,
              };
              await filters.apply(normalizedNextValues);
              selectStatusFilter(nextStatus, { syncFilter: false });
            }}
      />
      {hasStatusNavigation ? (
        <StatusSelectModal
          visible={statusSelectVisible}
          onClose={() => setStatusSelectVisible(false)}
          options={statusSelectOptions}
          value={activeStatusFilter}
          onChange={selectStatusFilter}
          title={t('orders_filter_status')}
        />
      ) : null}
      {sortVisible ? (
        <Suspense fallback={null}>
          <SortSelectModal
            visible={sortVisible}
            onClose={() => setSortVisible(false)}
            options={sortOptions}
            value={sortKey}
            onChange={(nextSort) => {
              if (nextSort) setSortKey(nextSort);
            }}
          />
        </Suspense>
      ) : null}
    </Screen>
  );
}

export default function MyOrdersScreen() {
  return <MyOrdersContent />;
}
