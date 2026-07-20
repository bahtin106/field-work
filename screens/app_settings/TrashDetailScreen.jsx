import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Screen from '../../components/layout/Screen';
import Card from '../../components/ui/Card';
import LabelValueRow from '../../components/ui/LabelValueRow';
import SectionHeader from '../../components/ui/SectionHeader';
import { useToast } from '../../components/ui/ToastProvider';
import { usePermissions } from '../../lib/permissions';
import { getCachedSupabaseAccessToken } from '../../lib/supabaseSessionCache';
import { getEntityFieldCatalog } from '../../src/features/fieldSettings/catalog';
import {
  buildTrashMediaUrl,
  getTrashItem,
  getTrashMediaOrigin,
  purgeTrashItem,
  restoreTrashItem,
} from '../../src/features/trash/api';
import { useTranslation } from '../../src/i18n/useTranslation';
import { queryKeys } from '../../src/shared/query/queryKeys';
import { useTheme } from '../../theme';

const COPY_FIELDS = new Set(['phone', 'additional_phone_1', 'additional_phone_2', 'additional_phone_3', 'email']);
const HIDDEN_FIELDS = new Set([
  'id', 'company_id', 'created_by', 'updated_by', 'created_by_user_id', 'deleted_by',
  'owner_type', 'owner_id', 'parent_order_id', 'source_url', 'category', 'map', 'asset',
  'finance_entry', 'assigned_to', 'client_id', 'object_id', 'work_type_id', 'department_id',
  'created_at', 'updated_at', 'deleted_at', 'purge_at', 'avatar_url', 'photo_url',
  'address_mode', 'creation_source', 'finance_calculated_at',
]);
const ADDRESS_FIELDS = new Set(['country', 'region', 'district', 'city', 'street', 'house', 'postal_code', 'office', 'floor', 'entrance', 'apartment', 'geo_lat', 'geo_lng', 'entrance_info', 'parking_notes']);
const CONTACT_FIELDS = new Set(['phone', 'email', 'contact_email', 'secondary_phone', 'additional_phone_1', 'additional_phone_2', 'additional_phone_3']);
const SCHEDULING_FIELDS = new Set(['time_window_start', 'time_window_end', 'departure_at', 'departure_time', 'arrival_at', 'completed_at', 'duration_min', 'feed_entered_at']);
const FINANCE_FIELDS = new Set(['start_price', 'payment_status', 'payment_method', 'currency', 'finance_income_total', 'finance_expense_total', 'finance_discount_total', 'finance_gross_total', 'finance_net_total']);
const SECTION_LABELS = {
  general: 'section_general',
  personal: 'section_personal',
  relations: 'trash_section_relations',
  contact: 'clients_contacts_section',
  scheduling: 'trash_section_scheduling',
  finance: 'order_section_finances',
  address: 'order_section_address',
  additional: 'trash_section_additional',
  other: 'trash_section_other',
};
const EXPLICIT_LABELS = {
  status: 'trash_field_status',
  urgent: 'create_order_label_urgent',
  payment_status: 'order_field_payment_status',
  payment_method: 'order_field_payment_method',
  first_name: 'label_first_name',
  last_name: 'label_last_name',
  middle_name: 'label_middle_name',
  tags: 'tags_field_label',
};

const formatMessage = (t, key, values = {}) => {
  let message = String(t(key, key));
  Object.entries(values).forEach(([name, value]) => {
    message = message.split(`{${name}}`).join(String(value ?? ''));
  });
  return message;
};

const normalizeParam = (value) => String(Array.isArray(value) ? value[0] || '' : value || '').trim();

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

const displayTitle = (item) => decodeTrashText(item?.title, { filename: item?.entity_type === 'media' });

function timeLeft(value, t) {
  const ms = new Date(value).getTime() - Date.now();
  if (ms <= 0) return t('trash_due_now');
  const days = Math.floor(ms / 86400000);
  return days > 0
    ? formatMessage(t, 'trash_days_left', { count: days })
    : formatMessage(t, 'trash_hours_left', { count: Math.max(1, Math.ceil(ms / 3600000)) });
}

function normalizeValue(value, key, t) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? t('common_yes', 'Да') : t('common_no', 'Нет');
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (Array.isArray(value)) {
    if (value.some((entry) => entry && typeof entry === 'object')) return '';
    return value.filter((entry) => entry !== null && entry !== undefined && entry !== '').join(', ');
  }
  if (typeof value === 'object') return '';
  const text = decodeTrashText(value);
  if (!text) return '';
  if (key === 'status') return t(`order_status_${text}`, text);
  if (key === 'payment_status') return t(`order_payment_status_${text}`, text);
  if (key === 'payment_method') return t(`order_payment_method_${text}`, text);
  if (/(_at|_date|time_window_start|time_window_end)$/.test(key)) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) return date.toLocaleString();
  }
  return text;
}

function humanizeKey(key) {
  const value = String(key || '').replace(/_/g, ' ').trim();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
}

function getSnapshotSections(detail, t) {
  const data = detail?.data && typeof detail.data === 'object' ? detail.data : {};
  const catalogType = detail?.entity_type === 'client_object' ? 'object' : detail?.entity_type;
  const catalog = getEntityFieldCatalog(catalogType);
  const catalogByKey = new Map(catalog.map((field) => [field.fieldKey, field]));
  const catalogOrder = new Map(catalog.map((field, index) => [field.fieldKey, index]));
  const rows = Object.entries(data).flatMap(([key, rawValue]) => {
    if (HIDDEN_FIELDS.has(key) || key.endsWith('_id') || /^media_file_\d+$/.test(key) || /(?:url|token|hash)$/i.test(key)) return [];
    const value = normalizeValue(rawValue, key, t);
    if (!value) return [];
    const field = catalogByKey.get(key);
    const labelCandidates = [field?.labelKey, EXPLICIT_LABELS[key], `order_field_${key}`, `trash_field_${key}`].filter(Boolean);
    let label = '';
    for (const labelKey of labelCandidates) {
      const translated = String(t(labelKey, labelKey));
      if (translated !== labelKey) {
        label = translated;
        break;
      }
    }
    if (!label) label = humanizeKey(key);
    let section = field?.sectionKey || 'other';
    if (key === 'status' || key === 'urgent') section = 'general';
    if (ADDRESS_FIELDS.has(key)) section = 'address';
    if (CONTACT_FIELDS.has(key)) section = 'contact';
    if (SCHEDULING_FIELDS.has(key)) section = 'scheduling';
    if (FINANCE_FIELDS.has(key)) section = 'finance';
    return [{ key, label, value, section, order: catalogOrder.get(key) ?? 1000 }];
  });
  const sectionOrder = ['general', 'personal', 'relations', 'contact', 'scheduling', 'finance', 'address', 'additional', 'other'];
  return sectionOrder.map((section) => ({
    id: section,
    title: t(SECTION_LABELS[section], humanizeKey(section)),
    rows: rows.filter((row) => row.section === section).sort((left, right) => left.order - right.order),
  })).filter((section) => section.rows.length > 0);
}

function DeletedBanner({ detail, styles, theme, t }) {
  const bannerTitle = t(`trash_deleted_${detail?.entity_type}_banner`, t('trash_deleted_banner'));
  return (
    <View style={styles.banner}>
      <Feather name="trash-2" size={30} color={theme.colors.danger} />
      <View style={styles.grow}>
        <Text style={styles.bannerTitle}>{bannerTitle}</Text>
        <Text style={styles.bannerText}>{t('trash_read_only')}</Text>
      </View>
    </View>
  );
}

export default function TrashDetailScreen() {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { t } = useTranslation();
  const { has } = usePermissions();
  const toast = useToast();
  const router = useRouter();
  const params = useLocalSearchParams();
  const queryClient = useQueryClient();
  const id = normalizeParam(params?.id);
  const [accessToken, setAccessToken] = useState('');
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let active = true;
    getCachedSupabaseAccessToken().then((token) => {
      if (active) setAccessToken(String(token || ''));
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const detailQuery = useQuery({
    queryKey: [...queryKeys.trash.detail(id), 'read-only-screen'],
    queryFn: async () => {
      const detail = await getTrashItem(id);
      let origin = null;
      if (detail?.entity_type === 'media') {
        try {
          origin = await getTrashMediaOrigin(id);
        } catch {}
      }
      return { ...detail, origin };
    },
    enabled: Boolean(id) && has('canViewTrash'),
  });
  const detail = detailQuery.data;
  const sections = useMemo(() => getSnapshotSections(detail, t), [detail, t]);

  const invalidate = async () => {
    await Promise.all(['trash', 'requests', 'clients', 'objects'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
  };
  const restoreMutation = useMutation({
    mutationFn: restoreTrashItem,
    onSuccess: async (result) => {
      await invalidate();
      toast.success(t(result?.queued ? 'trash_restore_queued' : 'trash_restored'));
      router.back();
    },
    onError: () => toast.error(t('trash_action_error')),
  });
  const purgeMutation = useMutation({
    mutationFn: purgeTrashItem,
    onSuccess: async () => {
      await invalidate();
      toast.success(t('trash_purged'));
      router.back();
    },
    onError: (error) => toast.error(t(String(error?.message || '') === 'TRASH_PURGE_REQUIRES_ONLINE' ? 'trash_purge_online_only' : 'trash_action_error')),
  });

  const confirmRestore = () => Alert.alert(
    t('trash_restore_title'),
    formatMessage(t, 'trash_restore_message', { title: displayTitle(detail) }),
    [
      { text: t('common_cancel'), style: 'cancel' },
      { text: t('trash_restore'), onPress: () => restoreMutation.mutate(id) },
    ],
  );
  const confirmPurge = () => Alert.alert(
    t('trash_purge_title'),
    formatMessage(t, 'trash_purge_message', { title: displayTitle(detail) }),
    [
      { text: t('common_cancel'), style: 'cancel' },
      { text: t('trash_purge'), style: 'destructive', onPress: () => purgeMutation.mutate(id) },
    ],
  );

  const downloadPhoto = async () => {
    if (!detail || downloading) return;
    setDownloading(true);
    try {
      const [fileSystemModule, mediaLibrary] = await Promise.all([
        import('expo-file-system/legacy'),
        import('expo-media-library'),
      ]);
      const fileSystem = fileSystemModule?.default?.downloadAsync ? fileSystemModule.default : fileSystemModule;
      const permission = await mediaLibrary.requestPermissionsAsync();
      if (!permission?.granted) throw new Error('MEDIA_LIBRARY_PERMISSION_DENIED');
      if (!fileSystem?.cacheDirectory) throw new Error('DOWNLOAD_FAILED');
      const token = accessToken || await getCachedSupabaseAccessToken();
      const downloadUrl = buildTrashMediaUrl(detail, { raw: true, width: 2048, height: 2048 });
      if (!downloadUrl || !token) throw new Error('DOWNLOAD_FAILED');
      const extension = displayTitle(detail).match(/\.([a-z0-9]{2,5})$/i)?.[1] || 'jpg';
      const localUri = `${fileSystem.cacheDirectory}trash_${detail.id}_${Date.now()}.${extension}`;
      const downloaded = await fileSystem.downloadAsync(downloadUrl, localUri, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (Number(downloaded?.status || 200) >= 400 || !downloaded?.uri) throw new Error('DOWNLOAD_FAILED');
      await mediaLibrary.saveToLibraryAsync(downloaded.uri);
      toast.success(t('trash_photo_saved'));
    } catch (error) {
      toast.error(t(String(error?.message || '') === 'MEDIA_LIBRARY_PERMISSION_DENIED' ? 'trash_photo_permission_denied' : 'trash_photo_download_error'));
    } finally {
      setDownloading(false);
    }
  };

  const openOrigin = () => {
    const origin = detail?.origin;
    if (!origin) return;
    if (origin.status === 'trash' && origin.trash_entry_id) {
      router.push(`/app_settings/trash/${origin.trash_entry_id}`);
      return;
    }
    if (origin.status !== 'active' || !origin.route_entity_id) return;
    if (origin.owner_type === 'object') {
      router.push(`/objects/${origin.route_entity_id}`);
      return;
    }
    if (origin.owner_type === 'finance_entry' && origin.finance_entry_id) {
      router.push({ pathname: `/orders/${origin.route_entity_id}`, params: { financeEntryId: origin.finance_entry_id } });
      return;
    }
    router.push(`/orders/${origin.route_entity_id}`);
  };

  if (!has('canViewTrash')) {
    return <Screen headerOptions={{ title: t('trash_title') }}><View style={styles.center}><Feather name="lock" size={30} color={theme.colors.textSecondary} /><Text style={styles.emptyTitle}>{t('trash_no_access')}</Text></View></Screen>;
  }

  if (detailQuery.isLoading) {
    return <Screen headerOptions={{ title: t('trash_title') }}><View style={styles.center}><ActivityIndicator color={theme.colors.primary} /></View></Screen>;
  }

  if (!detail) {
    return <Screen headerOptions={{ title: t('trash_title') }}><View style={styles.center}><Feather name="alert-circle" size={30} color={theme.colors.textSecondary} /><Text style={styles.emptyTitle}>{t('trash_item_unavailable')}</Text></View></Screen>;
  }

  const mediaUri = buildTrashMediaUrl(detail, { width: 1280, height: 960 });
  const mediaSource = detail.entity_type === 'media' && mediaUri && accessToken && !thumbnailFailed
    ? { uri: mediaUri, headers: { Authorization: `Bearer ${accessToken}` } }
    : null;
  const origin = detail.origin;
  const originCanOpen = Boolean(origin && (
    (origin.status === 'trash' && origin.trash_entry_id)
    || (origin.status === 'active' && origin.route_entity_id)
  ));
  const originText = !origin
    ? t('trash_origin_unavailable')
    : origin.status === 'missing'
      ? t('trash_origin_missing')
      : origin.status === 'trash'
        ? formatMessage(t, 'trash_origin_in_trash', { title: origin.title })
        : origin.title;

  return (
    <Screen
      headerOptions={{ title: t(`trash_entity_${detail.entity_type}`, t('trash_title')) }}
      contentContainerStyle={styles.content}
    >
      <DeletedBanner detail={detail} styles={styles} theme={theme} t={t} />

      {mediaSource ? (
        <Image source={mediaSource} onError={() => setThumbnailFailed(true)} style={styles.hero} contentFit="cover" />
      ) : detail.entity_type === 'media' ? (
        <View style={styles.heroFallback}><Feather name="image" size={42} color={theme.colors.textSecondary} /></View>
      ) : null}

      <Text selectable style={styles.title}>{displayTitle(detail)}</Text>
      <View style={styles.retention}>
        <Text style={styles.countdown}>{timeLeft(detail.purge_at, t)}</Text>
        <Text style={styles.purgeAt}>{formatMessage(t, 'trash_purge_at', { date: new Date(detail.purge_at).toLocaleString() })}</Text>
      </View>

      {detail.entity_type === 'media' ? (
        <>
          <SectionHeader>{t('trash_section_origin')}</SectionHeader>
          <Card separated paddedXOnly>
            <LabelValueRow
              label={t('trash_removed_from')}
              hideWhenEmpty={false}
              valueComponent={(
                <Pressable accessibilityRole={originCanOpen ? 'link' : undefined} disabled={!originCanOpen} onPress={openOrigin} style={styles.originLink}>
                  <Text style={[styles.originText, !originCanOpen && styles.originTextDisabled]}>{originText}</Text>
                  {originCanOpen ? <Feather name="chevron-right" size={18} color={theme.colors.primary} /> : null}
                </Pressable>
              )}
            />
          </Card>
          <Pressable disabled={downloading} onPress={downloadPhoto} style={styles.outlineButton}>
            {downloading ? <ActivityIndicator color={theme.colors.primary} /> : <Feather name="download" size={18} color={theme.colors.primary} />}
            <Text style={styles.outlineText}>{t('trash_download_photo')}</Text>
          </Pressable>
        </>
      ) : sections.length ? sections.map((section) => (
        <View key={section.id}>
          <SectionHeader>{section.title}</SectionHeader>
          <Card separated paddedXOnly>
            {section.rows.map((row) => (
              <LabelValueRow
                key={row.key}
                label={row.label}
                value={row.value}
                fullRow={row.key === 'comment' || row.key === 'description'}
                rightActions={COPY_FIELDS.has(row.key) ? (
                  <Pressable accessibilityLabel={t('common_copy')} onPress={() => Clipboard.setStringAsync(row.value)} style={styles.copyButton}>
                    <Feather name="copy" size={17} color={theme.colors.primary} />
                  </Pressable>
                ) : null}
              />
            ))}
          </Card>
        </View>
      )) : <Text style={styles.emptyText}>{t('trash_no_details')}</Text>}

      <View style={styles.actions}>
        {has('canRestoreTrash') ? (
          <Pressable disabled={restoreMutation.isPending || purgeMutation.isPending} onPress={confirmRestore} style={styles.primaryButton}>
            {restoreMutation.isPending ? <ActivityIndicator color="#fff" /> : <Feather name="rotate-ccw" size={18} color="#fff" />}
            <Text style={styles.buttonText}>{t('trash_restore')}</Text>
          </Pressable>
        ) : null}
        {has('canPurgeTrash') ? (
          <Pressable disabled={purgeMutation.isPending || restoreMutation.isPending} onPress={confirmPurge} style={styles.dangerButton}>
            {purgeMutation.isPending ? <ActivityIndicator color="#fff" /> : <Feather name="trash-2" size={18} color="#fff" />}
            <Text style={styles.buttonText}>{t('trash_purge')}</Text>
          </Pressable>
        ) : null}
      </View>
    </Screen>
  );
}

const createStyles = (theme) => StyleSheet.create({
  content: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: 44 },
  grow: { flex: 1, minWidth: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 10 },
  emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  emptyText: { color: theme.colors.textSecondary, textAlign: 'center', marginTop: 18 },
  banner: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.danger, backgroundColor: theme.colors.card, marginBottom: 18 },
  bannerTitle: { color: theme.colors.danger, fontSize: 19, fontWeight: '800' },
  bannerText: { color: theme.colors.textSecondary, marginTop: 3 },
  hero: { width: '100%', aspectRatio: 1.45, borderRadius: 18, backgroundColor: theme.colors.card },
  heroFallback: { width: '100%', aspectRatio: 1.45, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.card },
  title: { color: theme.colors.text, fontSize: 26, fontWeight: '800', marginTop: 18 },
  retention: { marginTop: 13, padding: 14, borderRadius: 14, backgroundColor: theme.colors.card },
  countdown: { color: theme.colors.danger, fontWeight: '800', fontSize: 16 },
  purgeAt: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 4 },
  originLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, maxWidth: '100%' },
  originText: { color: theme.colors.primary, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  originTextDisabled: { color: theme.colors.textSecondary },
  copyButton: { padding: 8, marginVertical: -8, marginRight: -6 },
  actions: { gap: 10, marginTop: 24 },
  primaryButton: { minHeight: 48, borderRadius: 14, backgroundColor: theme.colors.primary, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  dangerButton: { minHeight: 48, borderRadius: 14, backgroundColor: theme.colors.danger, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  outlineButton: { minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.primary, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  outlineText: { color: theme.colors.primary, fontWeight: '700' },
});
