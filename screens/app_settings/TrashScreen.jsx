import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Screen from '../../components/layout/Screen';
import { useToast } from '../../components/ui/ToastProvider';
import { usePermissions } from '../../lib/permissions';
import { getTrashItem, listTrashItems, purgeTrashItem, restoreTrashItem } from '../../src/features/trash/api';
import { useTranslation } from '../../src/i18n/useTranslation';
import { queryKeys } from '../../src/shared/query/queryKeys';
import { useTheme } from '../../theme';

const TYPES = ['', 'order', 'client', 'client_object'];
const SORTS = ['purge_at', 'deleted_desc', 'title'];
const COPY_FIELDS = new Set(['phone', 'additional_phone_1', 'additional_phone_2', 'additional_phone_3']);
const HIDDEN_FIELDS = new Set(['id', 'company_id', 'created_by', 'updated_by', 'created_by_user_id']);

const textValue = (value) => {
  if (value == null || value === '') return null;
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  if (typeof value === 'object') return null;
  return String(value);
};

function timeLeft(value, t) {
  const ms = new Date(value).getTime() - Date.now();
  if (ms <= 0) return t('trash_due_now');
  const days = Math.floor(ms / 86400000);
  return days > 0
    ? t('trash_days_left', { count: days })
    : t('trash_hours_left', { count: Math.max(1, Math.ceil(ms / 3600000)) });
}

export default function TrashScreen() {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { t } = useTranslation();
  const { has } = usePermissions();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [entityType, setEntityType] = useState('');
  const [sort, setSort] = useState('purge_at');
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const params = useMemo(() => ({ search: debouncedSearch, entityType, sort }), [debouncedSearch, entityType, sort]);
  const listQuery = useQuery({ queryKey: queryKeys.trash.list(params), queryFn: () => listTrashItems(params), enabled: has('canViewTrash') });
  const detailQuery = useQuery({ queryKey: queryKeys.trash.detail(selectedId), queryFn: () => getTrashItem(selectedId), enabled: Boolean(selectedId) });

  const invalidate = async () => {
    setSelectedId(null);
    await Promise.all(['trash', 'requests', 'clients', 'objects'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
  };
  const restoreMutation = useMutation({ mutationFn: restoreTrashItem, onSuccess: async () => { await invalidate(); toast.success(t('trash_restored')); }, onError: () => toast.error(t('trash_action_error')) });
  const purgeMutation = useMutation({ mutationFn: purgeTrashItem, onSuccess: async () => { await invalidate(); toast.success(t('trash_purged')); }, onError: () => toast.error(t('trash_action_error')) });

  const restore = (item) => Alert.alert(t('trash_restore_title'), t('trash_restore_message', { title: item.title }), [
    { text: t('common_cancel'), style: 'cancel' },
    { text: t('trash_restore'), onPress: () => restoreMutation.mutate(item.id) },
  ]);
  const purge = (item) => Alert.alert(t('trash_purge_title'), t('trash_purge_message', { title: item.title }), [
    { text: t('common_cancel'), style: 'cancel' },
    { text: t('trash_purge'), style: 'destructive', onPress: () => purgeMutation.mutate(item.id) },
  ]);

  if (!has('canViewTrash')) return <Screen><View style={styles.empty}><Feather name="lock" size={28} color={theme.colors.textSecondary} /><Text style={styles.emptyTitle}>{t('trash_no_access')}</Text></View></Screen>;

  const renderItem = ({ item }) => (
    <Pressable accessibilityRole="button" onPress={() => setSelectedId(item.id)} style={styles.card}>
      {item.thumbnail_url ? <Image source={item.thumbnail_url} style={styles.thumb} contentFit="cover" /> : <View style={styles.thumbEmpty}><Feather name="trash-2" size={22} color={theme.colors.danger} /></View>}
      <View style={styles.grow}>
        <View style={styles.between}><Text style={styles.type}>{t(`trash_entity_${item.entity_type}`)}</Text><Feather name="trash-2" size={14} color={theme.colors.danger} /></View>
        <Text numberOfLines={1} style={styles.title}>{item.title}</Text>
        {item.subtitle ? <Text numberOfLines={2} style={styles.muted}>{item.subtitle}</Text> : null}
        <Text style={styles.countdown}>{timeLeft(item.purge_at, t)}</Text>
        <Text style={styles.small}>{t('trash_purge_at', { date: new Date(item.purge_at).toLocaleString() })}</Text>
      </View>
    </Pressable>
  );

  const detail = detailQuery.data;
  const rows = detail?.data ? Object.entries(detail.data).filter(([key, value]) => !HIDDEN_FIELDS.has(key) && textValue(value)) : [];

  return <Screen>
    <View style={styles.container}>
      <View style={styles.searchBox}><Feather name="search" size={18} color={theme.colors.textSecondary} /><TextInput style={styles.search} value={search} onChangeText={setSearch} placeholder={t('trash_search')} placeholderTextColor={theme.colors.textSecondary} /></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{TYPES.map((value) => <Pressable key={value || 'all'} onPress={() => setEntityType(value)} style={[styles.chip, entityType === value && styles.chipActive]}><Text style={[styles.chipText, entityType === value && styles.chipTextActive]}>{value ? t(`trash_entity_${value}`) : t('trash_all')}</Text></Pressable>)}</ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{SORTS.map((value) => <Pressable key={value} onPress={() => setSort(value)} style={[styles.sort, sort === value && styles.sortActive]}><Text style={styles.small}>{t(`trash_sort_${value}`)}</Text></Pressable>)}</ScrollView>
      {listQuery.isLoading ? <ActivityIndicator style={styles.loader} color={theme.colors.primary} /> : <FlatList data={listQuery.data || []} renderItem={renderItem} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} refreshing={listQuery.isFetching} onRefresh={listQuery.refetch} ListEmptyComponent={<View style={styles.empty}><Feather name="trash-2" size={32} color={theme.colors.textSecondary} /><Text style={styles.emptyTitle}>{t('trash_empty')}</Text><Text style={styles.muted}>{t('trash_empty_hint')}</Text></View>} />}
    </View>
    <Modal visible={Boolean(selectedId)} animationType="slide" onRequestClose={() => setSelectedId(null)}>
      <Screen><ScrollView contentContainerStyle={styles.detail}>
        <Pressable accessibilityLabel={t('common_close')} onPress={() => setSelectedId(null)} style={styles.close}><Feather name="x" size={24} color={theme.colors.text} /></Pressable>
        {detailQuery.isLoading ? <ActivityIndicator color={theme.colors.primary} /> : detail ? <>
          <View style={styles.banner}><Feather name="trash-2" size={28} color={theme.colors.danger} /><View style={styles.grow}><Text style={styles.bannerTitle}>{t('trash_deleted_banner')}</Text><Text style={styles.muted}>{t('trash_read_only')}</Text></View></View>
          {detail.thumbnail_url ? <Image source={detail.thumbnail_url} style={styles.hero} contentFit="cover" /> : null}
          <Text style={styles.detailTitle}>{detail.title}</Text><Text style={styles.countdown}>{timeLeft(detail.purge_at, t)}</Text>
          {rows.map(([key, value]) => <View key={key} style={styles.field}><View style={styles.grow}><Text style={styles.label}>{t(`trash_field_${key}`, { defaultValue: key })}</Text><Text selectable style={styles.value}>{textValue(value)}</Text></View>{COPY_FIELDS.has(key) ? <Pressable onPress={() => Clipboard.setStringAsync(textValue(value))} style={styles.iconButton}><Feather name="copy" size={18} color={theme.colors.primary} /></Pressable> : null}</View>)}
          {detail.thumbnail_url ? <Pressable onPress={() => Linking.openURL(detail.thumbnail_url)} style={styles.outlineButton}><Feather name="download" size={18} color={theme.colors.primary} /><Text style={styles.outlineText}>{t('trash_download_photo')}</Text></Pressable> : null}
          {has('canRestoreTrash') ? <Pressable disabled={restoreMutation.isPending} onPress={() => restore(detail)} style={styles.primaryButton}><Feather name="rotate-ccw" size={18} color="#fff" /><Text style={styles.buttonText}>{t('trash_restore')}</Text></Pressable> : null}
          {has('canPurgeTrash') ? <Pressable disabled={purgeMutation.isPending} onPress={() => purge(detail)} style={styles.dangerButton}><Feather name="trash-2" size={18} color="#fff" /><Text style={styles.buttonText}>{t('trash_purge')}</Text></Pressable> : null}
        </> : null}
      </ScrollView></Screen>
    </Modal>
  </Screen>;
}

const createStyles = (theme) => StyleSheet.create({
  container: { flex: 1, gap: 10 }, grow: { flex: 1, minWidth: 0 }, between: { flexDirection: 'row', justifyContent: 'space-between' }, list: { gap: 10, paddingBottom: 32 }, loader: { marginTop: 40 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card, borderRadius: 14, paddingHorizontal: 12 }, search: { flex: 1, minHeight: 46, color: theme.colors.text, fontSize: 16 }, chips: { gap: 8 }, chip: { borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 8 }, chipActive: { backgroundColor: theme.colors.primary }, chipText: { color: theme.colors.text, fontWeight: '600' }, chipTextActive: { color: '#fff' }, sort: { padding: 7 }, sortActive: { borderBottomWidth: 2, borderBottomColor: theme.colors.primary },
  card: { flexDirection: 'row', gap: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card, borderRadius: 16, padding: 12 }, thumb: { width: 84, height: 84, borderRadius: 12 }, thumbEmpty: { width: 84, height: 84, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background }, type: { color: theme.colors.danger, fontSize: 12, fontWeight: '700' }, title: { color: theme.colors.text, fontSize: 17, fontWeight: '700', marginTop: 3 }, muted: { color: theme.colors.textSecondary, marginTop: 3 }, countdown: { color: theme.colors.danger, fontWeight: '700', marginTop: 7 }, small: { color: theme.colors.textSecondary, fontSize: 12 }, empty: { alignItems: 'center', justifyContent: 'center', padding: 40, gap: 8 }, emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  detail: { padding: 18, paddingBottom: 44, gap: 14 }, close: { alignSelf: 'flex-end', padding: 8 }, banner: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.danger, backgroundColor: theme.colors.card }, bannerTitle: { color: theme.colors.danger, fontSize: 19, fontWeight: '800' }, hero: { width: '100%', aspectRatio: 1.6, borderRadius: 16 }, detailTitle: { color: theme.colors.text, fontSize: 26, fontWeight: '800' }, field: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border, paddingVertical: 10 }, label: { color: theme.colors.textSecondary, fontSize: 12 }, value: { color: theme.colors.text, fontSize: 16, marginTop: 2 }, iconButton: { padding: 10 },
  primaryButton: { minHeight: 48, borderRadius: 14, backgroundColor: theme.colors.primary, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' }, dangerButton: { minHeight: 48, borderRadius: 14, backgroundColor: theme.colors.danger, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' }, buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 }, outlineButton: { minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.primary, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' }, outlineText: { color: theme.colors.primary, fontWeight: '700' },
});
