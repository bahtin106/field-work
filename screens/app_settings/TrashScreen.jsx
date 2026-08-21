import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import SearchFiltersBar from '../../components/filters/SearchFiltersBar';
import SortSelectModal from '../../components/filters/SortSelectModal';
import TrashFiltersPanel from '../../components/filters/TrashFiltersPanel';
import { useFilters } from '../../components/hooks/useFilters';
import Screen from '../../components/layout/Screen';
import SelectionToolbar from '../../components/ui/SelectionToolbar';
import { useToast } from '../../components/ui/ToastProvider';
import { ConfirmModal } from '../../components/ui/modals';
import { usePermissions } from '../../lib/permissions';
import { getCachedSupabaseAccessToken } from '../../lib/supabaseSessionCache';
import {
  buildTrashMediaUrl,
  getTrashFilterOptions,
  listTrashItemIds,
  listTrashItems,
  purgeAllTrashItems,
  purgeTrashItems,
  restoreTrashItems,
} from '../../src/features/trash/api';
import { joinFilterSummary, summarizeFilterPart } from '../../src/shared/filters/summary';
import { useTranslation } from '../../src/i18n/useTranslation';
import {
  canRunDeferredNetworkWork,
  useOfflineSnapshot,
} from '../../src/shared/offline/offlineStatus';
import { withReadDeadline } from '../../src/shared/network/readDeadline';
import { queryKeys } from '../../src/shared/query/queryKeys';
import {
  attachMutationAuthCarrier,
  clearMutationAuthCarrier,
  getMutationAuthCarrier,
  isActiveMutationAuthCarrier,
  requireMutationAuthCarrier,
} from '../../src/shared/security/mutationAuthCarrier';
import { useTheme } from '../../theme';

const SORTS = ['purge_at', 'deleted_desc', 'title'];
const TRASH_FILTER_DEFAULTS = Object.freeze({
  entityTypes: [],
  deletedByIds: [],
  deletedDateFrom: null,
  deletedDateTo: null,
  statuses: [],
  workTypes: [],
  clientIds: [],
  executorIds: [],
  clientTags: [],
  objectTags: [],
  cities: [],
  streets: [],
  mediaOwnerTypes: [],
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

const formatMessage = (t, key, values = {}) => {
  let message = String(t(key, key));
  Object.entries(values).forEach(([name, value]) => {
    message = message.split(`{${name}}`).join(String(value ?? ''));
  });
  return message;
};

const decodeTrashText = (value, { filename = false } = {}) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw.replace(/^yadisk:\/\//i, ''));
  } catch {}
  if (filename && /[\\/]/.test(decoded)) decoded = decoded.split(/[\\/]/).filter(Boolean).pop() || decoded;
  return decoded.trim();
};

const isBrokenText = (value) => {
  const text = String(value || '').trim();
  return !text || /^[?\s]+$/.test(text) || text.includes('\uFFFD');
};

const displayTitle = (item) => decodeTrashText(item?.title, { filename: item?.entity_type === 'media' });
const displaySubtitle = (item, t) => {
  const value = decodeTrashText(item?.subtitle);
  return isBrokenText(value) && item?.entity_type === 'media' ? t('trash_media_photo') : value;
};

const toDateBoundaryIso = (value, endOfDay = false) => {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const date = new Date(`${normalized}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const buildApiFilters = (values) => ({
  ...values,
  deletedDateFrom: toDateBoundaryIso(values.deletedDateFrom),
  deletedDateTo: toDateBoundaryIso(values.deletedDateTo, true),
  departureDateFrom: toDateBoundaryIso(values.departureDateFrom),
  departureDateTo: toDateBoundaryIso(values.departureDateTo, true),
  createdDateFrom: toDateBoundaryIso(values.createdDateFrom),
  createdDateTo: toDateBoundaryIso(values.createdDateTo, true),
});

function timeLeft(value, t) {
  const ms = new Date(value).getTime() - Date.now();
  if (ms <= 0) return t('trash_due_now');
  const days = Math.floor(ms / 86400000);
  return days > 0
    ? formatMessage(t, 'trash_days_left', { count: days })
    : formatMessage(t, 'trash_hours_left', { count: Math.max(1, Math.ceil(ms / 3600000)) });
}

export default function TrashScreen() {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { t } = useTranslation();
  const { has } = usePermissions();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const offlineSnapshot = useOfflineSnapshot();
  const canUseTrashNetwork = canRunDeferredNetworkWork(offlineSnapshot);
  const filters = useFilters({ screenKey: 'trash', defaults: TRASH_FILTER_DEFAULTS });
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState('purge_at');
  const [sortVisible, setSortVisible] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [failedThumbIds, setFailedThumbIds] = useState(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [selectingAll, setSelectingAll] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const lastLongPressRef = useRef({ id: '', at: 0 });
  const canViewTrash = has('canViewTrash');
  const canRestoreTrash = has('canRestoreTrash');
  const canPurgeTrash = has('canPurgeTrash');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;
    getCachedSupabaseAccessToken().then((token) => {
      if (active) setAccessToken(String(token || ''));
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const apiFilters = useMemo(() => buildApiFilters(filters.values), [filters.values]);
  const params = useMemo(
    () => ({ search: debouncedSearch, filters: apiFilters, sort }),
    [apiFilters, debouncedSearch, sort],
  );
  const optionsQuery = useQuery({
    queryKey: queryKeys.trash.filterOptions(),
    queryFn: ({ signal }) => withReadDeadline(
      (readSignal) => getTrashFilterOptions(readSignal),
      { label: 'Trash filter options', signal },
    ),
    enabled: canViewTrash && canUseTrashNetwork,
    staleTime: 30 * 1000,
  });
  const listQuery = useInfiniteQuery({
    queryKey: queryKeys.trash.list(params),
    queryFn: ({ pageParam, signal }) => withReadDeadline(
      (readSignal) => listTrashItems(
        { ...params, limit: 50, offset: pageParam },
        readSignal,
      ),
      { label: 'Trash list', signal },
    ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => lastPage.length === 50 ? pages.length * 50 : undefined,
    enabled: canViewTrash && canUseTrashNetwork,
  });

  const invalidate = async () => {
    await Promise.all(['trash', 'requests', 'clients', 'objects'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
  };
  const finishSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };
  const restoreMutation = useMutation({
    mutationFn: (variables) => restoreTrashItems(
      variables.ids,
      requireMutationAuthCarrier(variables, { requireOfflineOwner: true }),
    ),
    onMutate: async (variables) => {
      await attachMutationAuthCarrier(variables, { requireOfflineOwner: true });
    },
    onSuccess: async (result, variables) => {
      const authCarrier = getMutationAuthCarrier(variables);
      if (!isActiveMutationAuthCarrier(authCarrier, { requireOfflineOwner: true })) return;
      await invalidate();
      if (!isActiveMutationAuthCarrier(authCarrier, { requireOfflineOwner: true })) return;
      finishSelection();
      toast.success(t(result?.queued ? 'trash_restore_queued' : 'trash_bulk_restored'));
    },
    onError: (_error, variables) => {
      if (isActiveMutationAuthCarrier(getMutationAuthCarrier(variables), { requireOfflineOwner: true })) {
        toast.error(t('trash_action_error'));
      }
    },
    onSettled: (_data, _error, variables) => clearMutationAuthCarrier(variables),
  });
  const purgeMutation = useMutation({
    mutationFn: (variables) => purgeTrashItems(
      variables.ids,
      requireMutationAuthCarrier(variables, { requireOfflineOwner: true }),
    ),
    onMutate: async (variables) => {
      await attachMutationAuthCarrier(variables, { requireOfflineOwner: true });
    },
    onSuccess: async (_result, variables) => {
      const authCarrier = getMutationAuthCarrier(variables);
      if (!isActiveMutationAuthCarrier(authCarrier, { requireOfflineOwner: true })) return;
      await invalidate();
      if (!isActiveMutationAuthCarrier(authCarrier, { requireOfflineOwner: true })) return;
      finishSelection();
      toast.success(t('trash_bulk_purged'));
    },
    onError: (error, variables) => {
      if (!isActiveMutationAuthCarrier(getMutationAuthCarrier(variables), { requireOfflineOwner: true })) return;
      toast.error(t(String(error?.message || '') === 'TRASH_PURGE_REQUIRES_ONLINE' ? 'trash_purge_online_only' : 'trash_action_error'));
    },
    onSettled: (_data, _error, variables) => clearMutationAuthCarrier(variables),
  });
  const clearMutation = useMutation({
    mutationFn: (variables) => purgeAllTrashItems(
      requireMutationAuthCarrier(variables, { requireOfflineOwner: true }),
    ),
    onMutate: async (variables) => {
      await attachMutationAuthCarrier(variables, { requireOfflineOwner: true });
    },
    onSuccess: async (count, variables) => {
      const authCarrier = getMutationAuthCarrier(variables);
      if (!isActiveMutationAuthCarrier(authCarrier, { requireOfflineOwner: true })) return;
      await invalidate();
      if (!isActiveMutationAuthCarrier(authCarrier, { requireOfflineOwner: true })) return;
      toast.success(formatMessage(t, 'trash_cleared', { count }));
    },
    onError: (error, variables) => {
      if (!isActiveMutationAuthCarrier(getMutationAuthCarrier(variables), { requireOfflineOwner: true })) return;
      toast.error(t(String(error?.message || '') === 'TRASH_PURGE_REQUIRES_ONLINE' ? 'trash_purge_online_only' : 'trash_action_error'));
    },
    onSettled: (_data, _error, variables) => clearMutationAuthCarrier(variables),
  });

  const listItems = listQuery.data?.pages?.flatMap((page) => page) || [];
  const totalCount = Number(listItems[0]?.total_count || 0);
  const allTrashCount = (optionsQuery.data?.entityTypes || []).reduce((sum, item) => sum + Number(item?.count || 0), 0);
  const trashKnownEmpty = optionsQuery.isSuccess && allTrashCount === 0;
  const allSelected = totalCount > 0 && selectedIds.size === totalCount;
  const busy = selectingAll || restoreMutation.isPending || purgeMutation.isPending || clearMutation.isPending;

  const optionLabels = useMemo(() => {
    const result = {};
    Object.entries(optionsQuery.data || {}).forEach(([key, items]) => {
      result[key] = new Map((Array.isArray(items) ? items : []).map((item) => [String(item?.id || ''), String(item?.label || item?.id || '')]));
    });
    return result;
  }, [optionsQuery.data]);
  const filterSummaryData = useMemo(() => {
    const parts = [];
    const add = (label, values, optionKey, resolver) => {
      if (!Array.isArray(values) || !values.length) return;
      const labels = values.map((id) => resolver?.(id) || optionLabels[optionKey]?.get(String(id)) || String(id));
      parts.push(summarizeFilterPart({ label, values: labels, countWhenMany: true }));
    };
    add(t('trash_filter_entity'), filters.values.entityTypes, 'entityTypes', (id) => t(`trash_entity_${id}`));
    add(t('trash_filter_deleted_by'), filters.values.deletedByIds, 'deletedBy');
    add(t('orders_filter_status'), filters.values.statuses, 'statuses');
    add(t('order_field_work_type'), filters.values.workTypes, 'workTypes');
    add(t('common_client'), filters.values.clientIds, 'clients');
    add(t('orders_filter_executor'), filters.values.executorIds, 'executors');
    add(t('common_city'), filters.values.cities, 'cities');
    add(t('common_street'), filters.values.streets, 'streets');
    add(t('tags_clients_label'), filters.values.clientTags, 'clientTags');
    add(t('tags_objects_label'), filters.values.objectTags, 'objectTags');
    add(t('trash_filter_media_source'), filters.values.mediaOwnerTypes, 'mediaOwnerTypes', (id) => t(`trash_media_owner_${id}`));
    if (filters.values.deletedDateFrom || filters.values.deletedDateTo) {
      parts.push(summarizeFilterPart({ label: t('trash_filter_deleted_date'), value: `${filters.values.deletedDateFrom || '—'}–${filters.values.deletedDateTo || '—'}` }));
    }
    if (filters.values.departureDateFrom || filters.values.departureDateTo) {
      parts.push(summarizeFilterPart({ label: t('order_field_departure_date'), value: `${filters.values.departureDateFrom || '—'}–${filters.values.departureDateTo || '—'}` }));
    }
    if (filters.values.departureTimeFrom || filters.values.departureTimeTo) {
      parts.push(summarizeFilterPart({ label: t('order_field_departure_time'), value: `${filters.values.departureTimeFrom || '—'}–${filters.values.departureTimeTo || '—'}` }));
    }
    if (filters.values.createdDateFrom || filters.values.createdDateTo) {
      parts.push(summarizeFilterPart({ label: t('orders_filter_created_date'), value: `${filters.values.createdDateFrom || '—'}–${filters.values.createdDateTo || '—'}` }));
    }
    if (filters.values.createdTimeFrom || filters.values.createdTimeTo) {
      parts.push(summarizeFilterPart({ label: t('orders_filter_created_time'), value: `${filters.values.createdTimeFrom || '—'}–${filters.values.createdTimeTo || '—'}` }));
    }
    if (filters.values.sumMin || filters.values.sumMax) {
      parts.push(summarizeFilterPart({ label: t('order_details_amount'), value: `${filters.values.sumMin || '—'}–${filters.values.sumMax || '—'}` }));
    }
    return joinFilterSummary(parts, t('common_bullet'));
  }, [filters.values, optionLabels, t]);

  if (!canViewTrash) {
    return <Screen scroll={false} headerOptions={{ title: t('trash_title') }}><View style={styles.empty}><Feather name="lock" size={28} color={theme.colors.textSecondary} /><Text style={styles.emptyTitle}>{t('trash_no_access')}</Text></View></Screen>;
  }

  const openItem = (item) => {
    if (item?.entity_type === 'order') {
      router.push({ pathname: `/orders/${item.entity_id}`, params: { trashId: item.id, returnTo: '/app_settings/trash' } });
    } else if (item?.entity_type === 'client') {
      router.push({ pathname: `/clients/${item.entity_id}`, params: { trashId: item.id, returnTo: '/app_settings/trash' } });
    } else if (item?.entity_type === 'client_object') {
      router.push({ pathname: `/objects/${item.entity_id}`, params: { trashId: item.id, returnTo: '/app_settings/trash' } });
    } else {
      router.push(`/app_settings/trash/${item.id}`);
    }
  };
  const toggleSelection = (id) => {
    const normalizedId = String(id || '');
    if (!normalizedId) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(normalizedId)) next.delete(normalizedId);
      else next.add(normalizedId);
      return next;
    });
  };
  const enterSelection = (item) => {
    const id = String(item?.id || '');
    if (!id) return;
    lastLongPressRef.current = { id, at: Date.now() };
    setSelectionMode(true);
    setSelectedIds((current) => new Set(current).add(id));
  };
  const handleCardPress = (item) => {
    const id = String(item?.id || '');
    const lastLongPress = lastLongPressRef.current;
    if (lastLongPress.id === id && Date.now() - lastLongPress.at < 1200) {
      lastLongPressRef.current = { id: '', at: 0 };
      return;
    }
    if (selectionMode) toggleSelection(id);
    else openItem(item);
  };
  const toggleAll = async () => {
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }
    if (!canUseTrashNetwork) {
      toast.error(t('trash_action_error'));
      return;
    }
    setSelectingAll(true);
    try {
      const ids = await withReadDeadline(
        (signal) => listTrashItemIds(
          { search: debouncedSearch, filters: apiFilters },
          signal,
        ),
        { label: 'Trash select all', timeoutMs: 6_000 },
      );
      setSelectedIds(new Set(ids));
    } catch {
      toast.error(t('trash_action_error'));
    } finally {
      setSelectingAll(false);
    }
  };

  const renderItem = ({ item }) => {
    const id = String(item.id || '');
    const selected = selectedIds.has(id);
    const thumbnailUri = buildTrashMediaUrl(item) || String(item.thumbnail_url || '');
    const canLoadThumbnail = Boolean(thumbnailUri) && (item.entity_type !== 'media' || Boolean(accessToken)) && !failedThumbIds.has(id);
    const thumbnailSource = canLoadThumbnail ? {
      uri: thumbnailUri,
      ...(item.entity_type === 'media' ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
    } : null;
    return (
      <View style={[styles.card, selected && styles.cardSelected]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected }}
          delayLongPress={450}
          onLongPress={() => enterSelection(item)}
          onPress={() => handleCardPress(item)}
          style={({ pressed }) => [styles.cardContent, pressed && styles.cardPressed]}
        >
          {thumbnailSource ? (
            <Image source={thumbnailSource} onError={() => setFailedThumbIds((current) => new Set(current).add(id))} style={styles.thumb} contentFit="cover" />
          ) : (
            <View style={styles.thumbEmpty}><Feather name="trash-2" size={22} color={theme.colors.danger} /></View>
          )}
          <View style={styles.grow}>
            <Text style={styles.type}>{t(`trash_entity_${item.entity_type}`)}</Text>
            <Text numberOfLines={1} style={styles.title}>{displayTitle(item)}</Text>
            {displaySubtitle(item, t) ? <Text numberOfLines={2} style={styles.muted}>{displaySubtitle(item, t)}</Text> : null}
            <Text style={styles.countdown}>{timeLeft(item.purge_at, t)}</Text>
            <Text style={styles.small}>{formatMessage(t, 'trash_purge_at', { date: new Date(item.purge_at).toLocaleString() })}</Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={selectionMode ? t('trash_toggle_selection') : t('trash_purge')}
          disabled={!selectionMode && !canPurgeTrash}
          hitSlop={8}
          onPress={() => {
            if (selectionMode) toggleSelection(id);
            else setConfirmation({ action: 'purge', ids: [id], title: displayTitle(item) });
          }}
          style={({ pressed }) => [styles.cardAction, pressed && styles.cardPressed]}
        >
          {selectionMode ? (
            <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
              {selected ? <Feather name="check" size={15} color={theme.colors.onPrimary} /> : null}
            </View>
          ) : (
            <Feather name="trash-2" size={18} color={canPurgeTrash ? theme.colors.danger : theme.colors.textSecondary} />
          )}
        </Pressable>
      </View>
    );
  };

  return (
    <Screen
      scroll={false}
      headerOptions={{
        title: t('trash_title'),
        rightTextLabel: canPurgeTrash && !selectionMode ? t('trash_clear_action') : undefined,
        rightDisabled: busy || trashKnownEmpty,
        onRightPress: canPurgeTrash && !selectionMode
          ? () => setConfirmation({ action: 'purgeAll' })
          : undefined,
      }}
    >
      <View style={styles.container}>
        {selectionMode ? (
          <SelectionToolbar
            selectedCount={selectedIds.size}
            totalCount={totalCount}
            allSelected={allSelected}
            selectedLabel={t('trash_selected')}
            selectAllLabel={t('trash_select_all')}
            clearAllLabel={t('trash_clear_all')}
            onToggleAll={toggleAll}
            onClose={finishSelection}
            busy={busy}
            actions={[
              ...(canRestoreTrash ? [{ id: 'restore', label: t('trash_restore'), icon: 'rotate-ccw', loading: restoreMutation.isPending, onPress: () => setConfirmation({ action: 'restore', ids: [...selectedIds] }) }] : []),
              ...(canPurgeTrash ? [{ id: 'purge', label: t('trash_delete_short'), icon: 'trash-2', variant: 'destructive', loading: purgeMutation.isPending, onPress: () => setConfirmation({ action: 'purge', ids: [...selectedIds] }) }] : []),
            ]}
          />
        ) : (
          <SearchFiltersBar
            value={search}
            onChangeText={setSearch}
            onClear={() => setSearch('')}
            placeholder={t('trash_search')}
            onOpenFilters={filters.open}
            onOpenSort={() => setSortVisible(true)}
            filtersActive={Boolean(filterSummaryData)}
            filterSummary={filterSummaryData}
            onResetFilters={async () => {
              const reset = filters.reset();
              await filters.apply(reset);
            }}
            metaText={`${t('common_total')}: ${totalCount}`}
            style={styles.searchBar}
          />
        )}
        {listQuery.isLoading ? (
          <ActivityIndicator style={styles.loader} color={theme.colors.primary} />
        ) : (
          <FlatList
            data={listItems}
            renderItem={renderItem}
            extraData={{ selectionMode, selectedIds }}
            keyExtractor={(item) => item.id}
            style={styles.flatList}
            contentContainerStyle={[styles.list, listItems.length === 0 && styles.listEmpty]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshing={listQuery.isRefetching}
            onRefresh={() => {
              if (!canUseTrashNetwork) return;
              void Promise.all([listQuery.refetch(), optionsQuery.refetch()]);
            }}
            onEndReached={() => {
              if (
                canUseTrashNetwork &&
                listQuery.hasNextPage &&
                !listQuery.isFetchingNextPage
              ) {
                void listQuery.fetchNextPage();
              }
            }}
            onEndReachedThreshold={0.4}
            ListFooterComponent={listQuery.isFetchingNextPage ? <ActivityIndicator color={theme.colors.primary} /> : null}
            ListEmptyComponent={<View style={styles.empty}><Feather name="trash-2" size={32} color={theme.colors.textSecondary} /><Text style={styles.emptyTitle}>{t('trash_empty')}</Text><Text style={styles.muted}>{t('trash_empty_hint')}</Text></View>}
          />
        )}
      </View>
      <TrashFiltersPanel
        visible={filters.visible}
        onClose={filters.close}
        options={optionsQuery.data || {}}
        values={filters.values}
        defaults={TRASH_FILTER_DEFAULTS}
        setValue={filters.setValue}
        onApply={(nextValues) => filters.apply(nextValues)}
        onReset={() => filters.reset()}
      />
      <SortSelectModal visible={sortVisible} onClose={() => setSortVisible(false)} options={SORTS.map((value) => ({ id: value, label: t(`trash_sort_${value}`) }))} value={sort} onChange={(value) => { if (value) setSort(value); }} title={t('common_sort')} />
      <ConfirmModal
        visible={Boolean(confirmation)}
        title={t(confirmation?.action === 'restore'
          ? 'trash_bulk_restore_title'
          : confirmation?.action === 'purgeAll'
            ? 'trash_clear_title'
            : 'trash_bulk_purge_title')}
        message={confirmation?.action === 'purgeAll'
          ? formatMessage(t, 'trash_clear_message', { count: allTrashCount })
          : confirmation?.ids?.length === 1 && confirmation?.title
            ? formatMessage(t, 'trash_purge_message', { title: confirmation.title })
            : formatMessage(t, confirmation?.action === 'restore' ? 'trash_bulk_restore_message' : 'trash_bulk_purge_message', { count: confirmation?.ids?.length || 0 })}
        confirmLabel={t(confirmation?.action === 'restore'
          ? 'trash_restore'
          : confirmation?.action === 'purgeAll'
            ? 'trash_clear_confirm'
            : 'trash_purge')}
        cancelLabel={t('common_cancel')}
        confirmVariant={confirmation?.action === 'restore' ? 'primary' : 'destructive'}
        loading={restoreMutation.isPending || purgeMutation.isPending || clearMutation.isPending}
        onClose={() => setConfirmation(null)}
        onConfirm={() => {
          const ids = confirmation?.ids || [];
          if (confirmation?.action === 'restore') restoreMutation.mutate({ ids });
          else if (confirmation?.action === 'purgeAll') clearMutation.mutate({});
          else purgeMutation.mutate({ ids });
        }}
      />
    </Screen>
  );
}

const createStyles = (theme) => StyleSheet.create({
  container: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  flatList: { flex: 1 },
  list: { gap: 10, paddingHorizontal: theme.spacing.lg, paddingBottom: 32 },
  listEmpty: { flexGrow: 1 },
  loader: { marginTop: 40 },
  searchBar: { paddingTop: theme.spacing.sm },
  card: { flexDirection: 'row', alignItems: 'stretch', borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card, borderRadius: 16, overflow: 'hidden' },
  cardSelected: { borderColor: theme.colors.primary, backgroundColor: theme.colors.surface },
  cardContent: { flex: 1, minWidth: 0, flexDirection: 'row', gap: 12, padding: 12, paddingRight: 4 },
  cardAction: { width: 48, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 16, paddingRight: 8 },
  cardPressed: { opacity: 0.82 },
  thumb: { width: 84, height: 84, borderRadius: 12 },
  thumbEmpty: { width: 84, height: 84, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background },
  type: { color: theme.colors.danger, fontSize: 12, fontWeight: '700' },
  title: { color: theme.colors.text, fontSize: 17, fontWeight: '700', marginTop: 3 },
  muted: { color: theme.colors.textSecondary, marginTop: 3 },
  countdown: { color: theme.colors.danger, fontWeight: '700', marginTop: 7 },
  small: { color: theme.colors.textSecondary, fontSize: 12 },
  checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center' },
  checkboxSelected: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 8 },
  emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
});
