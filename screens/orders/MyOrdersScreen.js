import { useFocusEffect, useNavigation, useIsFocused } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
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
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import DynamicOrderCard from '../../components/DynamicOrderCard';
import SearchFiltersBar from '../../components/filters/SearchFiltersBar';
import { useAuth } from '../../components/hooks/useAuth';
import { useFilters } from '../../components/hooks/useFilters';
import Screen from '../../components/layout/Screen';
import AppHeader from '../../components/navigation/AppHeader';
import {
  ThemedRefreshControl,
  useManagedRefresh,
  usePullToRefreshFeedback,
} from '../../components/ui/PullToRefreshFeedback';
import { useCompanySettings } from '../../hooks/useCompanySettings';
import { useMyCompanyId } from '../../hooks/useMyCompanyId';
import goBackSmart from '../../lib/navigation/goBackSmart';
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
import { useTheme } from '../../theme/ThemeProvider';

const LIST_CACHE_MAX_ENTRIES = 24;
const DEFAULT_MY_ORDERS_PAGE_SIZE = 30;
const MY_ORDERS_LIST_CACHE_STORAGE_PREFIX = 'orders.my.listCache.v3';
const MY_ORDERS_CACHE_PERSIST_DEBOUNCE_MS = 350;
const MY_ORDERS_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const FEED_SEEN_STORAGE_PREFIX = 'myorders.feedSeen.v2';
const FEED_LAST_FP_STORAGE_PREFIX = 'myorders.feedLastFp.v2';
const MY_ORDERS_SCREEN_KEY = 'MyOrders';
const MY_ORDERS_RENDER_WARN_THRESHOLD = 30;
const MY_ORDERS_FPS_PROBE_MS = 3500;
const MY_ORDERS_NAV_LOCK_MS = 1200;
const MY_ORDERS_REFRESH_WAIT_TIMEOUT_MS = 12000;
const MY_ORDERS_BACKGROUND_REFRESH_DELAY_MS = 1200;
const MY_ORDERS_FEED_PREVIEW_SIZE = 20;
const MY_ORDERS_FEED_PREFETCH_DELAY_MS = 2200;
const MY_ORDERS_FEED_PULSE_DURATION_MS = 700;
const MY_ORDERS_EXECUTOR_PREFETCH_LIMIT = 80;
const MY_ORDERS_DETAIL_PREFETCH_LIMIT = 5;
const MY_ORDERS_DETAIL_PREFETCH_TTL_MS = 4000;
const MY_ORDERS_VIEWABILITY_PREFETCH_LIMIT = 6;
const MY_ORDERS_VIEWABILITY_PREFETCH_TTL_MS = 2500;
const MY_ORDERS_LIST = Object.freeze({
  initialNumToRender: 8,
  maxToRenderPerBatch: 6,
  updateCellsBatchingPeriod: 34,
  windowSize: 9,
  itemVisiblePercentThreshold: 45,
  onEndReachedThreshold: 0.65,
});
const FiltersPanel = lazy(() => import('../../components/filters/FiltersPanel'));
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
    return entries;
  } catch {
    return null;
  }
}

function excludeFeedStatuses(query) {
  const feedStatusAliases = getStatusDbAliases('feed').filter(Boolean);
  if (!feedStatusAliases.length) return query;
  if (feedStatusAliases.length === 1) {
    return query.neq('status', feedStatusAliases[0]);
  }
  const encoded = feedStatusAliases
    .map((value) => `'${String(value).replace(/'/g, "''")}'`)
    .join(',');
  return query.not('status', 'in', `(${encoded})`);
}

function MyOrdersContent() {
  const { theme } = useTheme();
  const { t } = useTranslation();
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
          marginBottom: 16,
        },
        filterScrollContent: {
          flexDirection: 'row',
          gap: 8,
          paddingRight: 4,
        },
        chip: {
          paddingVertical: 8,
          paddingHorizontal: 14,
          backgroundColor: theme.colors.inputBg || theme.colors.surface,
          borderRadius: 20,
        },
        chipActive: { backgroundColor: theme.colors.primary },
        chipText: { fontSize: 14, color: theme.colors.text },
        chipTextActive: {
          color: theme.colors.onPrimary || theme.colors.primaryTextOn,
          fontWeight: '600',
        },
        chipContent: {
          flexDirection: 'row',
          alignItems: 'center',
        },
        feedDotBase: {
          width: 6,
          height: 6,
          borderRadius: 3,
          marginRight: 6,
        },
        feedDotNew: {
          backgroundColor: '#FF3B30',
        },
        feedDotSeen: {
          backgroundColor: 'rgba(255,59,48,0.22)',
          borderWidth: 1,
          borderColor: 'rgba(255,59,48,0.55)',
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
          color: theme.colors.onPrimary || theme.colors.primaryTextOn || '#FFFFFF',
          fontSize: theme.typography.sizes.sm,
          fontWeight: theme.typography.weight.semibold,
        },
      }),
    [theme, mutedColor],
  );

  const ORDER_FILTER_DEFAULTS = {
    workTypes: [],
    statuses: [],
    clientIds: [],
    departureDateFrom: null,
    departureDateTo: null,
    departureTimeFrom: null,
    departureTimeTo: null,
    sumMin: '',
    sumMax: '',
  };

  function normalizeForFingerprint(values = {}) {
    const keys = Object.keys(values).sort();
    const normalized = {};
    keys.forEach((key) => {
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

  const setFilterValue = filters.setValue;
  const selectedStatusFilters = filters.values?.statuses;
  const revalidateFilters = filters.revalidate;

  const router = useRouter();
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const auth = useAuth();
  const authAccountType = String(auth.user?.user_metadata?.account_type || '').toLowerCase();
  const isSoloAdmin = String(auth.profile?.role || '').toLowerCase() === 'admin' && authAccountType === 'solo';

  useFocusEffect(
    useCallback(() => {
      revalidateFilters({ extend: true });
    }, [revalidateFilters]),
  );

  const filtersFingerprint = useMemo(
    () => JSON.stringify(normalizeForFingerprint(filters.values)),
    [filters.values],
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
      isSoloAdmin
        ? [
            { id: 'new', label: t('order_status_new') },
            { id: 'in_progress', label: t('order_status_in_progress') },
            { id: 'done', label: t('order_status_completed') },
          ]
        : [
            { id: 'new', label: t('order_status_new') },
            { id: 'in_progress', label: t('order_status_in_progress') },
            { id: 'done', label: t('order_status_completed') },
          ],
    [isSoloAdmin, t],
  );
  const statusAliasToFilterKey = useMemo(() => {
    const aliasMap = new Map();
    orderStatusOptions.forEach((opt) => {
      const key = String(opt?.id || '').trim();
      if (!key) return;
      aliasMap.set(key, key);
      getStatusDbAliases(key).forEach((alias) => {
        const aliasKey = String(alias || '').trim();
        if (aliasKey) aliasMap.set(aliasKey, key);
      });
    });
    return aliasMap;
  }, [orderStatusOptions]);

  const handleBackPress = useCallback(() => {
    goBackSmart(navigation, router, null, '/orders');
  }, [navigation, router]);


  const { companyId } = useMyCompanyId();
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
            [row?.first_name, row?.middle_name, row?.last_name].filter(Boolean).join(' ').trim() ||
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
  const [sortVisible, setSortVisible] = useState(false);
  const [sortKey, setSortKey] = useState('date_desc');
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

    if (statuses?.length) {
      const labels = statuses
        .map((code) => orderStatusOptions.find((opt) => opt.id === code)?.label || code)
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
      return parsed.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    if (departureDateFrom || departureDateTo) {
      const fromLabel = formatDate(departureDateFrom) || '-';
      const toLabel = formatDate(departureDateTo) || '-';
      const part = t('order_field_departure_date') + ': ' + fromLabel + ' - ' + toLabel;
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
      return base.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    };

    if (departureTimeFrom || departureTimeTo) {
      const fromLabel = formatTime(departureTimeFrom) || '-';
      const toLabel = formatTime(departureTimeTo) || '-';
      const part = t('order_field_departure_time') + ': ' + fromLabel + ' - ' + toLabel;
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
  }, [clientOptions, filters.values, orderStatusOptions, workTypeOptions, t]);

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
          }),
        ).catch(() => {});
      } catch {}
    }, MY_ORDERS_CACHE_PERSIST_DEBOUNCE_MS);
  }, [listCacheMy, listCacheStorageKey]);
  const setListCacheEntry = useCallback(
    (cacheKey, value) => {
      if (!cacheKey) return;
      listCacheMy[cacheKey] = value;
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
    () => makeCacheKey('all', filtersFingerprint, relationFingerprint),
    [filtersFingerprint, makeCacheKey, relationFingerprint],
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
  const [filter, setFilter] = useState('all');
  const isFeedFeatureEnabled = !isSoloAdmin;
  const effectiveFilter = isSoloAdmin ? 'all' : filter;
  const [loading, setLoading] = useState(() => {
    const prefetchData = queryClient.getQueryData(recentOrdersQueryKey);
    if (Array.isArray(prefetchData)) {
      return false;
    }
    return !Array.isArray(listCacheMy[defaultListCacheKey]);
  });
  const [loadError, setLoadError] = useState('');
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
  useEffect(() => {
    if (firstContentMarkedRef.current) return;
    if (loading && !hydratedRef.current) return;
    firstContentMarkedRef.current = true;
    markFirstContent(MY_ORDERS_SCREEN_KEY);
  }, [loading]);
  useEffect(() => {
    if (!isFocused || !Array.isArray(orders) || orders.length === 0) return undefined;
    let cancelled = false;
    seedExecutorNames(executorsForCards);
    const knownEnriched = enrichOrdersWithKnownExecutorRows(orders, executorsForCards);
    if (knownEnriched.some((row, index) => row !== orders[index])) {
      const cacheKey = makeCacheKey(effectiveFilter || 'all', filtersFingerprint, relationFingerprint);
      setOrders(knownEnriched);
      setListCacheEntry(cacheKey, knownEnriched);
      if ((effectiveFilter || 'all') === 'all') {
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
      const cacheKey = makeCacheKey(effectiveFilter || 'all', filtersFingerprint, relationFingerprint);
      setOrders(enriched);
      setListCacheEntry(cacheKey, enriched);
      if ((effectiveFilter || 'all') === 'all') {
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
    filtersFingerprint,
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
        Object.assign(listCacheMy, persisted);
        pruneObjectCache(listCacheMy, LIST_CACHE_MAX_ENTRIES);

        const currentKey = makeCacheKey(effectiveFilter || 'all', filtersFingerprint, relationFingerprint);
        const cachedCurrent = listCacheMy[currentKey];
        const cachedDefault = listCacheMy[defaultListCacheKey];
        const best = Array.isArray(cachedCurrent)
          ? cachedCurrent
          : Array.isArray(cachedDefault)
            ? cachedDefault
            : null;
        if (!best) return;

        queryClient.setQueryData(recentOrdersQueryKey, best.slice(0, PAGE_SIZE));
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
    filtersFingerprint,
    listCacheMy,
    listCacheStorageKey,
    makeCacheKey,
    PAGE_SIZE,
    queryClient,
    recentOrdersQueryKey,
    relationFingerprint,
  ]);
  useEffect(() => {
    if (!isSoloAdmin) return;
    const currentStatuses = Array.isArray(selectedStatusFilters) ? selectedStatusFilters : [];
    const allowedStatuses = currentStatuses.filter((statusKey) =>
      statusKey === 'new' || statusKey === 'in_progress' || statusKey === 'done');
    if (allowedStatuses.length !== currentStatuses.length) {
      setFilterValue('statuses', allowedStatuses);
    }
  }, [isSoloAdmin, selectedStatusFilters, setFilterValue]);
  useEffect(() => {
    if (!isSoloAdmin) return;
    if (filter !== 'all') {
      setFilter('all');
    }
  }, [filter, isSoloAdmin]);

  // Full dataset loading (batch streaming)
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreOrders, setHasMoreOrders] = useState(false);
  const [totalOrdersCount, setTotalOrdersCount] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  // Feed indicator state (cached preview of feed), scoped with the same account cache key.
  const feedStateCache = (globalThis.__MYORDERS_FEED_STATE ||= {});
  feedStateCache[cacheScopeKey] ||= {};
  const scopedFeedState = feedStateCache[cacheScopeKey];
  const [feedFingerprint, setFeedFingerprint] = useState(() => scopedFeedState.fp || '');
  const [feedSeenFingerprint, setFeedSeenFingerprint] = useState(() => scopedFeedState.seenFp || '');
  const [feedHasAny, setFeedHasAny] = useState(() => Boolean(scopedFeedState.hasAny));
  const feedPulse = useRef(new Animated.Value(0)).current;
  const detailNavLockRef = useRef({ id: '', ts: 0 });
  const listPrefetchRef = useRef({ key: '', ts: 0 });
  const fetchNextOrdersPageRef = useRef(null);
  const viewabilityPrefetchRef = useRef({ key: '', ts: 0 });
  const activeCacheScopeRef = useRef(cacheScopeKey);
  const refreshWaitersRef = useRef([]);
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
    const cacheKey = makeCacheKey(effectiveFilter || 'all', filtersFingerprint, relationFingerprint);
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
  }, [cacheScopeKey, effectiveFilter, filtersFingerprint, listCacheMy, makeCacheKey, relationFingerprint, scopedFeedState]);

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
          setFeedFingerprint(lastFp);
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

  const updateFeedMeta = useCallback((arr) => {
    if (!isFeedFeatureEnabled) {
      scopedFeedState.fp = '';
      scopedFeedState.hasAny = false;
      setFeedFingerprint('');
      setFeedHasAny(false);
      return;
    }
    const fp = Array.isArray(arr)
      ? arr
          .map((o) => o?.id)
          .filter(Boolean)
          .join(',')
      : '';
    const hasAny = Boolean(arr && arr.length);

    scopedFeedState.fp = fp;
    scopedFeedState.hasAny = hasAny;

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
      const cached = listCacheMy.feed;
      if (Array.isArray(cached) && cached.length) {
        updateFeedMeta(cached);
        return;
      }

      let uid = String(auth.user?.id || auth.profile?.id || '').trim();
      if (!uid) {
        const { data: sessionData } = await supabase.auth.getSession();
        uid = String(sessionData?.session?.user?.id || '').trim();
      }
      if (!uid) return;

      try {
        const data = await listRequests({
          scope: 'all',
          status: 'feed',
          userId: uid,
          page: 1,
          pageSize: MY_ORDERS_FEED_PREVIEW_SIZE,
        });
        setListCacheEntry('feed', data);
        updateFeedMeta(data);
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
    if (filter !== 'feed') return;
    if (!feedHasAny || !feedFingerprint) return;
    if (feedSeenFingerprint === feedFingerprint) return;

    setFeedSeenFingerprint(feedFingerprint);
    scopedFeedState.seenFp = feedFingerprint;

    try {
      AsyncStorage.setItem(feedSeenStorageKey, feedFingerprint);
    } catch {}
  }, [feedSeenStorageKey, filter, feedHasAny, feedFingerprint, feedSeenFingerprint, isFeedFeatureEnabled, scopedFeedState]);
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
    const k = isSoloAdmin
      ? 'all'
      : typeof seedFilter === 'string' && seedFilter.length
        ? seedFilter
        : filter || 'all';
    const listKey = makeCacheKey(k, filtersFingerprint, relationFingerprint);
    if (listCacheMy[listKey]) {
      setOrders(listCacheMy[listKey]);
      hydratedRef.current = true;
    }
    if (!isSoloAdmin && typeof seedFilter === 'string' && seedFilter.length) setFilter(seedFilter);
    if (typeof seedSearch === 'string') setSearchQuery(seedSearch);
  }, [seedFilter, seedSearch, filter, filtersFingerprint, isSoloAdmin, listCacheMy, makeCacheKey, relationFingerprint]);

  useEffect(() => {
    if (!isFocused) return;
    let alive = true;
    let backgroundTimer = null;

    const fetchUserAndOrders = async (isBackground = false) => {
      const key = (typeof effectiveFilter === 'string' ? effectiveFilter : 'all') || 'all';
      const cacheKey = makeCacheKey(key, filtersFingerprint, relationFingerprint);
      const cached = listCacheMy[cacheKey];
      if (Array.isArray(cached)) {
        setOrders(cached);
        setTotalOrdersCount(cached.length);
        hydratedRef.current = true;
        seenFilterRef.current.add(cacheKey);
        if (!isBackground) setLoading(false);
      } else if (!seenFilterRef.current.has(cacheKey) && !isBackground) {
        setLoading(true);
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
      const statusFilters = Array.isArray(filterValues.statuses)
        ? filterValues.statuses.flatMap((code) => getStatusDbAliases(code)).filter(Boolean)
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
          setListCacheEntry(cacheKey, emptyResult);
          queryClient.setQueryData(recentOrdersQueryKey, emptyResult);
          if (key === 'feed') updateFeedMeta(emptyResult);
          setLoadingMore(false);
          setLoadError('');
          setLoading(false);
          resolveRefreshWaiters();
          return;
        }
      }

      const buildOrdersQuery = (selectOptions = undefined) => {
        let query = supabase.from('orders_secure_v2').select('*', selectOptions);
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
        if (key === 'all') query = excludeFeedStatuses(query);
        if (statusFilters.length) query = query.in('status', statusFilters);
        if (clientIds.length) query = query.in('client_id', clientIds);
        if (!Number.isNaN(sumMin)) query = query.gte('start_price', sumMin);
        if (!Number.isNaN(sumMax)) query = query.lte('start_price', sumMax);
        if (dateFrom) query = query.gte('time_window_start', dateFrom);
        if (dateTo) query = query.lte('time_window_start', dateTo);
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
            clientIds,
            orderIds: Array.isArray(workTypeOrderIds) ? workTypeOrderIds : [],
            relationClientId,
            relationObjectIds,
            dateFrom,
            dateTo,
            sumMin: Number.isNaN(sumMin) ? null : sumMin,
            sumMax: Number.isNaN(sumMax) ? null : sumMax,
          });
        }

        const from = Math.max(0, (Number(pageNumber) - 1) * PAGE_SIZE);
        const to = from + PAGE_SIZE - 1;
        const { data: rows, error: pageError } = await buildOrdersQuery()
          .order('time_window_start', { ascending: false })
          .range(from, to);
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
      setListCacheEntry(cacheKey, aggregated);
      seenFilterRef.current.add(cacheKey);
      if (key === 'feed') updateFeedMeta(aggregated);
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
          setListCacheEntry(cacheKey, aggregated);
          setTotalOrdersCount(total);
          setHasMoreOrders(chunk.length >= PAGE_SIZE);
          if (key === 'feed') updateFeedMeta(aggregated);
          if (key === 'all') queryClient.setQueryData(recentOrdersQueryKey, aggregated.slice(0, PAGE_SIZE));
        } finally {
          nextPageInFlight = false;
          if (alive) setLoadingMore(false);
        }
      };

      setListCacheEntry(cacheKey, aggregated);
      setTotalOrdersCount(total);
      setHasMoreOrders(aggregated.length >= PAGE_SIZE);
      if (key === 'feed') updateFeedMeta(aggregated);
      if (key === 'all') queryClient.setQueryData(recentOrdersQueryKey, aggregated.slice(0, PAGE_SIZE));
      setLoadError('');
      setLoadingMore(false);
      resolveRefreshWaiters();
    };

    if (
      effectiveFilter === 'all' &&
      hydratedRef.current &&
      ordersCountRef.current > 0 &&
      Array.isArray(queryClient.getQueryData(recentOrdersQueryKey))
    ) {
      backgroundTimer = setTimeout(() => {
        fetchUserAndOrders(true);
      }, MY_ORDERS_BACKGROUND_REFRESH_DELAY_MS);
    } else {
      fetchUserAndOrders();
    }

    return () => {
      alive = false;
      fetchNextOrdersPageRef.current = null;
      if (backgroundTimer) clearTimeout(backgroundTimer);
    };
  }, [auth.profile?.id, auth.user?.id, effectiveFilter, filters.values, filtersFingerprint, hasLinkedRelationFilter, isFocused, listCacheMy, makeCacheKey, PAGE_SIZE, queryClient, recentOrdersQueryKey, refreshNonce, relationClientId, relationFingerprint, relationObjectIds, resolveRefreshWaiters, setListCacheEntry, t, updateFeedMeta, useWorkTypesFlag]);

  const filteredOrders = useMemo(() => {
    const q = deferredSearchQuery.trim().toLowerCase();
    const timeFrom = parseTimeToMinutes(filters.values.departureTimeFrom);
    const timeTo = parseTimeToMinutes(filters.values.departureTimeTo);
    return (orders || []).filter((o) => {
      if (timeFrom != null || timeTo != null) {
        const dt = o?.time_window_start ? new Date(o.time_window_start) : null;
        if (dt && !Number.isNaN(dt.getTime())) {
          const minutes = dt.getHours() * 60 + dt.getMinutes();
          if (timeFrom != null && minutes < timeFrom) return false;
          if (timeTo != null && minutes > timeTo) return false;
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
  }, [auth.profile?.role, companySettings, orders, deferredSearchQuery, filters.values.departureTimeFrom, filters.values.departureTimeTo, t]);

  const sortOptions = useMemo(
    () => [
      { id: 'date_desc', label: t('orders_sort_date_desc') },
      { id: 'date_asc', label: t('orders_sort_date_asc') },
      { id: 'amount_desc', label: t('orders_sort_amount_desc') },
      { id: 'amount_asc', label: t('orders_sort_amount_asc') },
    ],
    [t],
  );

  const sortedFilteredOrders = useMemo(() => {
    if (sortKey === 'date_desc') {
      return Array.isArray(filteredOrders) ? filteredOrders : [];
    }
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

  const ordersFacetCounts = useMemo(() => {
    const source = Array.isArray(orders) ? orders : [];
    const counts = {
      total: source.length,
      statuses: {},
      workTypes: {},
      clients: {},
    };
    source.forEach((order) => {
      const rawStatus = String(order?.status || '').trim();
      const statusKey = statusAliasToFilterKey.get(rawStatus) || null;
      if (statusKey) {
        counts.statuses[statusKey] = (counts.statuses[statusKey] || 0) + 1;
      }
      const workTypeId = String(order?.work_type_id || '').trim();
      if (workTypeId) {
        counts.workTypes[workTypeId] = (counts.workTypes[workTypeId] || 0) + 1;
      }
      const clientId = String(order?.client_id || '').trim();
      if (clientId) {
        counts.clients[clientId] = (counts.clients[clientId] || 0) + 1;
      }
    });
    return counts;
  }, [orders, statusAliasToFilterKey]);

  useEffect(() => {
    if (!isFocused || !Array.isArray(filteredOrders) || filteredOrders.length === 0) return;
    const idsKey = filteredOrders
      .slice(0, MY_ORDERS_DETAIL_PREFETCH_LIMIT)
      .map((o) => String(o?.id || ''))
      .join('|');
    const now = Date.now();
    if (
      listPrefetchRef.current.key === idsKey &&
      now - listPrefetchRef.current.ts < MY_ORDERS_DETAIL_PREFETCH_TTL_MS
    ) return;
    listPrefetchRef.current = { key: idsKey, ts: now };
    const task = InteractionManager.runAfterInteractions(() => {
      const registry = getPrefetchRegistry();
      filteredOrders.slice(0, MY_ORDERS_DETAIL_PREFETCH_LIMIT).forEach((order) => {
        registry
          .run(`request-detail:${order?.id}`, () => ensureRequestPrefetch(queryClient, order?.id))
          .catch(() => {});
      });
    });
    return () => {
      try {
        task.cancel?.();
      } catch {}
    };
  }, [filteredOrders, isFocused, queryClient]);
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
        {!isSoloAdmin ? (
          <View style={styles.filterBar}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterScrollContent}
            >
              {['feed', 'all', 'new', 'progress', 'done'].map((key) => (
                <Pressable
                  key={key}
                  onPress={() => setFilter(key)}
                  style={({ pressed }) => [
                    styles.chip,
                    filter === key && styles.chipActive,
                    pressed && { opacity: 0.9 },
                  ]}
                  accessibilityRole="button"
                >
                  <View style={styles.chipContent}>
                    {key === 'feed' &&
                      feedState !== 'none' &&
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
                                    outputRange: [1, 1.7],
                                  }),
                                },
                              ],
                              opacity: feedPulse.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0.55, 1],
                              }),
                            },
                          ]}
                        />
                      ) : (
                        <View style={[styles.feedDotBase, styles.feedDotSeen]} />
                      ))}
                    <Text style={[styles.chipText, filter === key && styles.chipTextActive]}>
                      {{
                        feed: t('order_status_in_feed'),
                        all: t('common_all'),
                        new: t('order_status_new'),
                        progress: t('order_status_in_progress'),
                        done: t('order_status_completed'),
                      }[key]}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
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
          }}
          metaText={`${t('common_shown')} ${sortedFilteredOrders.length} ${t('common_of')} ${Math.max(totalOrdersCount, orders.length)}`}
        />
      </View>
    ),
    [
      filter,
      searchQuery,
      styles,
      feedState,
      feedPulse,
      filters,
      filterSummaryData,
      orders.length,
      sortedFilteredOrders.length,
      totalOrdersCount,
      hasLinkedRelationFilter,
      isSoloAdmin,
      relationLabel,
      t,
    ],
  );

  const hasSearchQuery = Boolean(deferredSearchQuery.trim());
  const hasActiveFilters = Boolean(filterSummaryData.full || hasLinkedRelationFilter);
  const hasActiveTabFilter = !isSoloAdmin && filter !== 'all';

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
            <Pressable
              onPress={retryLoad}
              style={({ pressed }) => [styles.retryButton, pressed && { opacity: 0.88 }]}
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
    },
    [
      hasActiveFilters,
      hasActiveTabFilter,
      hasSearchQuery,
      loadError,
      loading,
      retryLoad,
      styles.emptyText,
      styles.emptyTitle,
      styles.emptyWrap,
      styles.retryButton,
      styles.retryText,
      t,
      theme.colors.primary,
    ],
  );

  const keyExtractor = useCallback((item) => String(item.id), []);

  const refreshCurrentList = useCallback(async (context = {}) => {
    const reason = String(context?.reason || '').trim();
    const softRefresh = reason === 'route-focus' || reason === 'app-resume';
    const key = (typeof effectiveFilter === 'string' ? effectiveFilter : 'all') || 'all';
    const cacheKey = makeCacheKey(key, filtersFingerprint, relationFingerprint);
    setLoadError('');
    if (!softRefresh) {
      delete listCacheMy[cacheKey];
      seenFilterRef.current.delete(cacheKey);
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
  }, [effectiveFilter, filtersFingerprint, listCacheMy, makeCacheKey, queryClient, relationFingerprint]);

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
      {filters.visible ? (
        <Suspense fallback={null}>
          <FiltersPanel
            visible={filters.visible}
            onClose={filters.close}
            mode="orders"
            showSearchCategory={false}
            inlineOptionSearch={{ categoryKeys: ['orders_workTypes', 'orders_executors', 'orders_clients'] }}
            ordersFilters={{
              statuses: orderStatusOptions,
              workTypes: useWorkTypesFlag ? workTypeOptions : [],
              clients: clientOptions,
              executors: [],
              facetCounts: ordersFacetCounts,
              showDate: true,
              showTime: true,
              showAmount: true,
            }}
            values={filters.values}
            setValue={filters.setValue}
            defaults={ORDER_FILTER_DEFAULTS}
            onReset={() => filters.reset()}
            onApply={(nextValues) => filters.apply(nextValues)}
          />
        </Suspense>
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
