import { useFocusEffect, useNavigation, useIsFocused } from '@react-navigation/native';
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
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import DynamicOrderCard from '../../components/DynamicOrderCard';
import FiltersPanel from '../../components/filters/FiltersPanel';
import SearchFiltersBar from '../../components/filters/SearchFiltersBar';
import SortSelectModal from '../../components/filters/SortSelectModal';
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
import { ensureRequestPrefetch } from '../../src/features/requests/queries';
import {
  applyOrderRelationFilters,
  hasRelationFilters,
  parseRelationIdsParam,
} from '../../src/features/requests/relationFilters';
import { resolveRequestTitle } from '../../src/features/requests/title';
import { joinFilterSummary, summarizeFilterPart } from '../../src/shared/filters/summary';
import { startFpsProbe, trackRender } from '../../src/shared/perf/devMetrics';
import { buildSearchIndex, matchesSearch } from '../../src/shared/search/matching';
import { getPrefetchRegistry } from '../../src/shared/query/prefetchRegistry';
import { queryKeys } from '../../src/shared/query/queryKeys';
import { useScreenRefreshRegistration } from '../../src/shared/query/screenRefreshRegistry';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme/ThemeProvider';

const LIST_CACHE_MAX_ENTRIES = 24;
const DEFAULT_MY_ORDERS_PAGE_SIZE = 80;
const MY_ORDERS_LIST_CACHE_STORAGE_PREFIX = 'orders.my.listCache.v3';
const MY_ORDERS_CACHE_PERSIST_DEBOUNCE_MS = 350;
const MY_ORDERS_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const FEED_SEEN_STORAGE_PREFIX = 'myorders.feedSeen.v2';
const FEED_LAST_FP_STORAGE_PREFIX = 'myorders.feedLastFp.v2';

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
  trackRender('MyOrders', 30);

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
        centered: {
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: theme.spacing.lg,
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
  const [useWorkTypesFlag, setUseWorkTypesFlag] = useState(false);
  const [workTypeOptions, setWorkTypeOptions] = useState([]);
  const [sortVisible, setSortVisible] = useState(false);
  const [sortKey, setSortKey] = useState('date_desc');
  useEffect(() => {
    let alive = true;
    if (!companyId) {
      setUseWorkTypesFlag(false);
      setWorkTypeOptions([]);
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
  }, [companyId]);

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
          summarizeFilterPart({ label: t('common_client', 'Клиент'), values: labels, countWhenMany: false }),
        );
        compactParts.push(
          summarizeFilterPart({ label: t('common_client', 'Клиент'), values: labels, countWhenMany: true }),
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
    if (prefetchData && Array.isArray(prefetchData) && prefetchData.length > 0) {
      return prefetchData;
    }
    return [];
  });
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(() => {
    const prefetchData = queryClient.getQueryData(recentOrdersQueryKey);
    if (prefetchData && Array.isArray(prefetchData) && prefetchData.length > 0) {
      return false;
    }
    const key = 'feed';
    const cacheKey = makeCacheKey(key, filtersFingerprint, relationFingerprint);
    return listCacheMy[cacheKey] ? false : true;
  });
  const [loadError, setLoadError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const hydratedRef = useRef(false);
  const ordersCountRef = useRef(Array.isArray(orders) ? orders.length : 0);
  useEffect(() => {
    ordersCountRef.current = Array.isArray(orders) ? orders.length : 0;
  }, [orders]);
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(listCacheStorageKey)
      .then((raw) => {
        if (!alive) return;
        const persisted = readPersistedListCachePayload(raw);
        if (!persisted) return;
        Object.assign(listCacheMy, persisted);
        pruneObjectCache(listCacheMy, LIST_CACHE_MAX_ENTRIES);

        const currentKey = makeCacheKey(filter || 'all', filtersFingerprint, relationFingerprint);
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
    filter,
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
  const FEED_PREVIEW_SIZE = 20;

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
    const cacheKey = makeCacheKey(filter || 'all', filtersFingerprint, relationFingerprint);
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
  }, [cacheScopeKey, filter, filtersFingerprint, listCacheMy, makeCacheKey, relationFingerprint, scopedFeedState]);

  useEffect(() => {
    return startFpsProbe('MyOrders', 3500);
  }, []);

  const feedState = !feedHasAny
    ? 'none'
    : feedFingerprint && feedFingerprint === feedSeenFingerprint
      ? 'seen'
      : 'new';

  // Load persisted feed seen state (keeps "seen/new" across app restarts)
  useEffect(() => {
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
  }, [feedLastFpStorageKey, feedSeenStorageKey, scopedFeedState]);

  useEffect(() => {
    if (feedState !== 'new') {
      feedPulse.stopAnimation();
      feedPulse.setValue(0);
      return undefined;
    }

    // Pulse for "new in feed" state
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(feedPulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(feedPulse, {
          toValue: 0,
          duration: 700,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => {
      anim.stop();
    };
  }, [feedPulse, feedState]);

  const updateFeedMeta = useCallback((arr) => {
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
  }, [feedLastFpStorageKey, scopedFeedState]);

  // Prefetch feed metadata from the first page when the screen is focused
  useEffect(() => {
    if (!isFocused) return;
    const prefetchFeed = async () => {
      const cached = listCacheMy.feed;
      if (Array.isArray(cached) && cached.length) {
        updateFeedMeta(cached);
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData?.session?.user?.id;
      if (!uid) return;

      const feedStatusAliases = getStatusDbAliases('feed');
      let prefetchQuery = supabase
        .from('orders_secure_v2')
        .select('*');
      if (feedStatusAliases.length === 1) {
        prefetchQuery = prefetchQuery.eq('status', feedStatusAliases[0]);
      } else if (feedStatusAliases.length > 1) {
        prefetchQuery = prefetchQuery.in('status', feedStatusAliases);
      }
      const { data, error } = await prefetchQuery
        .order('time_window_start', { ascending: false })
        .range(0, FEED_PREVIEW_SIZE - 1);

      if (!error && Array.isArray(data)) {
        setListCacheEntry('feed', data);
        updateFeedMeta(data);
      }
    };

    prefetchFeed();
  }, [isFocused, setListCacheEntry, updateFeedMeta, listCacheMy, FEED_PREVIEW_SIZE]);

  // Mark feed as seen after opening the feed tab
  useEffect(() => {
    if (filter !== 'feed') return;
    if (!feedHasAny || !feedFingerprint) return;
    if (feedSeenFingerprint === feedFingerprint) return;

    setFeedSeenFingerprint(feedFingerprint);
    scopedFeedState.seenFp = feedFingerprint;

    try {
      AsyncStorage.setItem(feedSeenStorageKey, feedFingerprint);
    } catch {}
  }, [feedSeenStorageKey, filter, feedHasAny, feedFingerprint, feedSeenFingerprint, scopedFeedState]);
  // Hydrate the all-orders tab from prefetch cache once
  useEffect(() => {
    if (filter === 'all' && !hydratedRef.current) {
      const prefetchData = queryClient.getQueryData(recentOrdersQueryKey);
      if (prefetchData && prefetchData.length) {
        hydratedRef.current = true;
        if (orders.length === 0) setOrders(prefetchData);
        setLoading(false);
      }
    }
  }, [filter, orders.length, queryClient, recentOrdersQueryKey]);

  const seedOnceRef = useRef(false);
  useEffect(() => {
    if (seedOnceRef.current) return;
    seedOnceRef.current = true;
    /* seed from cache */
    const k = typeof seedFilter === 'string' && seedFilter.length ? seedFilter : filter || 'all';
    const listKey = makeCacheKey(k, filtersFingerprint, relationFingerprint);
    if (listCacheMy[listKey]) {
      setOrders(listCacheMy[listKey]);
      hydratedRef.current = true;
    }
    if (typeof seedFilter === 'string' && seedFilter.length) setFilter(seedFilter);
    if (typeof seedSearch === 'string') setSearchQuery(seedSearch);
  }, [seedFilter, seedSearch, filter, filtersFingerprint, listCacheMy, makeCacheKey, relationFingerprint]);

  useEffect(() => {
    if (!isFocused) return;
    let alive = true;
    let backgroundTimer = null;

    const fetchUserAndOrders = async (isBackground = false) => {
      const key = (typeof filter === 'string' ? filter : 'all') || 'all';
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

      const { data: sessionData } = await supabase.auth.getSession();
      if (!alive) return;
      const uid = sessionData?.session?.user?.id;
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

      const { data, error, count } = await buildOrdersQuery({ count: 'exact' })
        .order('time_window_start', { ascending: false })
        .range(0, PAGE_SIZE - 1);
      if (!alive) return;
      if (error || !Array.isArray(data)) {
        setLoadError(t('refresh_failed', 'Не удалось обновить данные'));
        setLoadingMore(false);
        setLoading(false);
        resolveRefreshWaiters();
        return;
      }

      let aggregated = data.map((o) => ({ ...o, time_window_start: o.time_window_start ?? null }));
      const total = Number.isFinite(count) ? Number(count) : aggregated.length;
      let nextPageInFlight = false;

      setOrders(aggregated);
      setTotalOrdersCount(total);
      setHasMoreOrders(total > aggregated.length);
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
          const from = aggregated.length;
          const to = from + PAGE_SIZE - 1;
          const { data: chunkData, error: chunkError } = await buildOrdersQuery()
            .order('time_window_start', { ascending: false })
            .range(from, to);
          if (!alive) return;
          if (chunkError || !Array.isArray(chunkData) || chunkData.length === 0) {
            setHasMoreOrders(false);
            return;
          }
          const chunk = chunkData.map((o) => ({ ...o, time_window_start: o.time_window_start ?? null }));
          aggregated = [...aggregated, ...chunk];
          setOrders(aggregated);
          setListCacheEntry(cacheKey, aggregated);
          setTotalOrdersCount(Math.max(total, aggregated.length));
          setHasMoreOrders(total > aggregated.length);
          if (key === 'feed') updateFeedMeta(aggregated);
          if (key === 'all') queryClient.setQueryData(recentOrdersQueryKey, aggregated.slice(0, PAGE_SIZE));
        } finally {
          nextPageInFlight = false;
          if (alive) setLoadingMore(false);
        }
      };

      setListCacheEntry(cacheKey, aggregated);
      setTotalOrdersCount(Math.max(total, aggregated.length));
      setHasMoreOrders(total > aggregated.length);
      if (key === 'feed') updateFeedMeta(aggregated);
      if (key === 'all') queryClient.setQueryData(recentOrdersQueryKey, aggregated.slice(0, PAGE_SIZE));
      setLoadError('');
      setLoadingMore(false);
      resolveRefreshWaiters();
    };

    if (
      filter === 'all' &&
      hydratedRef.current &&
      ordersCountRef.current > 0 &&
      Array.isArray(queryClient.getQueryData(recentOrdersQueryKey))
    ) {
      backgroundTimer = setTimeout(() => {
        fetchUserAndOrders(true);
      }, 1200);
    } else {
      fetchUserAndOrders();
    }

    return () => {
      alive = false;
      fetchNextOrdersPageRef.current = null;
      if (backgroundTimer) clearTimeout(backgroundTimer);
    };
  }, [filter, filters.values, filtersFingerprint, hasLinkedRelationFilter, isFocused, listCacheMy, makeCacheKey, PAGE_SIZE, queryClient, recentOrdersQueryKey, refreshNonce, relationClientId, relationFingerprint, relationObjectIds, resolveRefreshWaiters, setListCacheEntry, t, updateFeedMeta, useWorkTypesFlag]);

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
              prefix: t('order_auto_title_prefix', 'Заявка от'),
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
      .slice(0, 5)
      .map((o) => String(o?.id || ''))
      .join('|');
    const now = Date.now();
    if (listPrefetchRef.current.key === idsKey && now - listPrefetchRef.current.ts < 4000) return;
    listPrefetchRef.current = { key: idsKey, ts: now };
    const task = InteractionManager.runAfterInteractions(() => {
      const registry = getPrefetchRegistry();
      filteredOrders.slice(0, 5).forEach((order) => {
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
    seedFilter: filter,
    seedSearch: searchQuery,
    relation_client_id: relationClientId,
    relation_object_ids: relationObjectIds.join(','),
    relation_label: relationLabel,
  });
  useEffect(() => {
    returnParamsRef.current = {
      seedFilter: filter,
      seedSearch: searchQuery,
      relation_client_id: relationClientId,
      relation_object_ids: relationObjectIds.join(','),
      relation_label: relationLabel,
    };
  }, [filter, relationClientId, relationLabel, relationObjectIds, searchQuery]);
  const openOrderDetails = useCallback(
    (orderIdRaw, orderSeed = null) => {
      const orderId = String(orderIdRaw || '').trim();
      if (!orderId) return;
      const now = Date.now();
      const prev = detailNavLockRef.current;
      if (prev.id === orderId && now - prev.ts < 1200) return;
      detailNavLockRef.current = { id: orderId, ts: now };
      if (orderSeed && typeof orderSeed === 'object') {
        const seedWorkTypeId = String(orderSeed?.work_type_id || '').trim();
        const seedWorkTypeName = seedWorkTypeId
          ? workTypeOptions.find((item) => String(item?.id || '') === seedWorkTypeId)?.name
          : '';
        queryClient.setQueryData(queryKeys.requests.detail(orderId), (prevOrder) => ({
          ...(prevOrder || {}),
          ...orderSeed,
          ...(seedWorkTypeName ? { work_type_name: seedWorkTypeName } : {}),
          id: orderId,
        }));
      }
      const registry = getPrefetchRegistry();
      registry
        .run(`request-detail:${orderId}`, () => ensureRequestPrefetch(queryClient, orderId))
        .catch(() => {});
      router.push({
        pathname: `/orders/${orderId}`,
        params: {
          returnTo: '/orders/my-orders',
          returnParams: JSON.stringify(returnParamsRef.current),
        },
      });
    },
    [queryClient, router, workTypeOptions],
  );
  const renderItem = useCallback(
    ({ item: order }) => (
      <DynamicOrderCard
        order={order}
        context="my_orders"
        hideExecutor={isSoloAdmin}
        onPress={openOrderDetails}
        departureTimeEnabled={departureTimeEnabled}
        orderFieldsByKey={orderFieldsByKey}
        companyCurrency={companySettings?.currency || null}
      />
    ),
    [companySettings?.currency, departureTimeEnabled, isSoloAdmin, openOrderDetails, orderFieldsByKey],
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
          metaText={`${t('common_shown', 'Показано')} ${sortedFilteredOrders.length} ${t('common_of', 'из')} ${Math.max(totalOrdersCount, orders.length)}`}
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
            <Text style={styles.emptyTitle}>{t('refresh_failed', 'Не удалось обновить данные')}</Text>
            <Text style={styles.emptyText}>{loadError}</Text>
            <Pressable
              onPress={retryLoad}
              style={({ pressed }) => [styles.retryButton, pressed && { opacity: 0.88 }]}
              accessibilityRole="button"
            >
              <Text style={styles.retryText}>{t('btn_retry', 'Повторить')}</Text>
            </Pressable>
          </View>
        );
      }

      const title = hasSearchQuery
        ? t('orders_empty_search_title', 'Ничего не найдено')
        : hasActiveFilters || hasActiveTabFilter
          ? t('orders_empty_filtered_title', 'Заявок по этим условиям нет')
          : t('orders_empty_title', 'Заявок пока нет');
      const subtitle = hasSearchQuery
        ? t('orders_empty_search_subtitle', 'Проверьте текст поиска или очистите строку.')
        : hasActiveFilters || hasActiveTabFilter
          ? t('orders_empty_filtered_subtitle', 'Измените фильтры или выберите другой статус.')
          : t('orders_empty', 'Заявок пока нет');

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

  const refreshCurrentList = useCallback(async () => {
    const key = (typeof filter === 'string' ? filter : 'all') || 'all';
    const cacheKey = makeCacheKey(key, filtersFingerprint, relationFingerprint);
    delete listCacheMy[cacheKey];
    seenFilterRef.current.delete(cacheKey);
    setLoadError('');
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: ['requests'] }),
      queryClient.invalidateQueries({ queryKey: ['requests', 'detail'] }),
    ]);
    setLoading(true);
    setLoadingMore(false);
    setRefreshNonce((n) => n + 1);
    await new Promise((resolve) => {
      const timeoutId = setTimeout(resolve, 12000);
      refreshWaitersRef.current.push(() => {
        clearTimeout(timeoutId);
        resolve();
      });
    });
  }, [filter, filtersFingerprint, listCacheMy, makeCacheKey, queryClient, relationFingerprint]);

  const refreshWithIndicator = useCallback(async () => {
    await refreshCurrentList();
  }, [refreshCurrentList]);
  const { refreshing: bgRefreshing, didSucceed, onRefresh } = useManagedRefresh(refreshWithIndicator);
  const { indicator: refreshIndicator } = usePullToRefreshFeedback(bgRefreshing, { didSucceed });

  useScreenRefreshRegistration(
    'orders.my',
      () => refreshCurrentList(),
      true,
  );

  if (loading && orders.length === 0) {
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
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
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
          title: t('routes.orders/my-orders'),
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
          onEndReachedThreshold={0.65}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={{ itemVisiblePercentThreshold: 45 }}
          refreshControl={<ThemedRefreshControl refreshing={bgRefreshing} onRefresh={onRefresh} />}
        />
      </View>
      {filters.visible ? (
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

export default function MyOrdersScreen() {
  return <MyOrdersContent />;
}
