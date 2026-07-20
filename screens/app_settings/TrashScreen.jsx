import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import SearchFiltersBar from '../../components/filters/SearchFiltersBar';
import SortSelectModal from '../../components/filters/SortSelectModal';
import StatusSelectModal from '../../components/filters/StatusSelectModal';
import Screen from '../../components/layout/Screen';
import { usePermissions } from '../../lib/permissions';
import { getCachedSupabaseAccessToken } from '../../lib/supabaseSessionCache';
import { buildTrashMediaUrl, listTrashItems } from '../../src/features/trash/api';
import { useTranslation } from '../../src/i18n/useTranslation';
import { queryKeys } from '../../src/shared/query/queryKeys';
import { useTheme } from '../../theme';

const TYPES = ['', 'order', 'client', 'client_object', 'media'];
const SORTS = ['purge_at', 'deleted_desc', 'title'];

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
  if (filename && /[\\/]/.test(decoded)) {
    decoded = decoded.split(/[\\/]/).filter(Boolean).pop() || decoded;
  }
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
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [entityType, setEntityType] = useState('');
  const [sort, setSort] = useState('purge_at');
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [sortVisible, setSortVisible] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [failedThumbIds, setFailedThumbIds] = useState(() => new Set());

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

  const params = useMemo(() => ({ search: debouncedSearch, entityType, sort }), [debouncedSearch, entityType, sort]);
  const typeOptions = useMemo(() => TYPES.map((value) => ({
    id: value,
    label: value ? t(`trash_entity_${value}`) : t('trash_all'),
  })), [t]);
  const sortOptions = useMemo(() => SORTS.map((value) => ({
    id: value,
    label: t(`trash_sort_${value}`),
  })), [t]);
  const listQuery = useInfiniteQuery({
    queryKey: queryKeys.trash.list(params),
    queryFn: ({ pageParam }) => listTrashItems({ ...params, limit: 50, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => lastPage.length === 50 ? pages.length * 50 : undefined,
    enabled: has('canViewTrash'),
  });
  if (!has('canViewTrash')) return <Screen scroll={false}><View style={styles.empty}><Feather name="lock" size={28} color={theme.colors.textSecondary} /><Text style={styles.emptyTitle}>{t('trash_no_access')}</Text></View></Screen>;

  const renderItem = ({ item }) => {
    const thumbnailUri = buildTrashMediaUrl(item) || String(item.thumbnail_url || '');
    const canLoadThumbnail = Boolean(thumbnailUri) && (item.entity_type !== 'media' || Boolean(accessToken)) && !failedThumbIds.has(item.id);
    const thumbnailSource = canLoadThumbnail ? {
      uri: thumbnailUri,
      ...(item.entity_type === 'media' ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
    } : null;
    return <Pressable accessibilityRole="button" onPress={() => router.push(`/app_settings/trash/${item.id}`)} style={styles.card}>
      {thumbnailSource ? <Image source={thumbnailSource} onError={() => setFailedThumbIds((current) => new Set(current).add(item.id))} style={styles.thumb} contentFit="cover" /> : <View style={styles.thumbEmpty}><Feather name="trash-2" size={22} color={theme.colors.danger} /></View>}
      <View style={styles.grow}>
        <View style={styles.between}><Text style={styles.type}>{t(`trash_entity_${item.entity_type}`)}</Text><Feather name="trash-2" size={14} color={theme.colors.danger} /></View>
        <Text numberOfLines={1} style={styles.title}>{displayTitle(item)}</Text>
        {displaySubtitle(item, t) ? <Text numberOfLines={2} style={styles.muted}>{displaySubtitle(item, t)}</Text> : null}
        <Text style={styles.countdown}>{timeLeft(item.purge_at, t)}</Text>
        <Text style={styles.small}>{formatMessage(t, 'trash_purge_at', { date: new Date(item.purge_at).toLocaleString() })}</Text>
      </View>
    </Pressable>
  };

  const listItems = listQuery.data?.pages?.flatMap((page) => page) || [];
  const filterSummary = entityType ? `${t('trash_filter_entity')}: ${t(`trash_entity_${entityType}`)}` : '';

  return <Screen scroll={false}>
    <View style={styles.container}>
      <SearchFiltersBar
        value={search}
        onChangeText={setSearch}
        onClear={() => setSearch('')}
        placeholder={t('trash_search')}
        onOpenFilters={() => setFiltersVisible(true)}
        onOpenSort={() => setSortVisible(true)}
        filtersActive={Boolean(entityType)}
        filterSummary={filterSummary}
        onResetFilters={() => setEntityType('')}
        metaText={`${t('common_shown')} ${listItems.length}`}
        style={styles.searchBar}
      />
      {listQuery.isLoading ? <ActivityIndicator style={styles.loader} color={theme.colors.primary} /> : <FlatList data={listItems} renderItem={renderItem} keyExtractor={(item) => item.id} style={styles.flatList} contentContainerStyle={[styles.list, listItems.length === 0 && styles.listEmpty]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" refreshing={listQuery.isRefetching} onRefresh={listQuery.refetch} onEndReached={() => { if (listQuery.hasNextPage && !listQuery.isFetchingNextPage) listQuery.fetchNextPage(); }} onEndReachedThreshold={0.4} ListFooterComponent={listQuery.isFetchingNextPage ? <ActivityIndicator color={theme.colors.primary} /> : null} ListEmptyComponent={<View style={styles.empty}><Feather name="trash-2" size={32} color={theme.colors.textSecondary} /><Text style={styles.emptyTitle}>{t('trash_empty')}</Text><Text style={styles.muted}>{t('trash_empty_hint')}</Text></View>} />}
    </View>
    <StatusSelectModal visible={filtersVisible} onClose={() => setFiltersVisible(false)} options={typeOptions} value={entityType} onChange={(value) => setEntityType(value || '')} title={t('trash_filter_title')} />
    <SortSelectModal visible={sortVisible} onClose={() => setSortVisible(false)} options={sortOptions} value={sort} onChange={(value) => { if (value) setSort(value); }} title={t('common_sort')} />
  </Screen>;
}

const createStyles = (theme) => StyleSheet.create({
  container: { flex: 1 }, grow: { flex: 1, minWidth: 0 }, between: { flexDirection: 'row', justifyContent: 'space-between' }, flatList: { flex: 1 }, list: { gap: 10, paddingHorizontal: theme.spacing.lg, paddingBottom: 32 }, listEmpty: { flexGrow: 1 }, loader: { marginTop: 40 }, searchBar: { paddingTop: theme.spacing.sm },
  card: { flexDirection: 'row', gap: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card, borderRadius: 16, padding: 12 }, thumb: { width: 84, height: 84, borderRadius: 12 }, thumbEmpty: { width: 84, height: 84, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background }, type: { color: theme.colors.danger, fontSize: 12, fontWeight: '700' }, title: { color: theme.colors.text, fontSize: 17, fontWeight: '700', marginTop: 3 }, muted: { color: theme.colors.textSecondary, marginTop: 3 }, countdown: { color: theme.colors.danger, fontWeight: '700', marginTop: 7 }, small: { color: theme.colors.textSecondary, fontSize: 12 }, empty: { alignItems: 'center', justifyContent: 'center', padding: 40, gap: 8 }, emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
});
