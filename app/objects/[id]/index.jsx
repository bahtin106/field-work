import React from 'react';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image as ExpoImage } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AppHeader from '../../../components/navigation/AppHeader';
import Card from '../../../components/ui/Card';
import ExpandableTextRow from '../../../components/ui/ExpandableTextRow';
import IconButton from '../../../components/ui/IconButton';
import LabelValueRow from '../../../components/ui/LabelValueRow';
import SectionHeader from '../../../components/ui/SectionHeader';
import TagList from '../../../components/tags/TagList';
import { useCompanySettings } from '../../../hooks/useCompanySettings';
import { BaseModal } from '../../../components/ui/modals';
import { listItemStyles } from '../../../components/ui/listItemStyles';
import { useToast } from '../../../components/ui/ToastProvider';
import { usePermissions } from '../../../lib/permissions';
import { useClientObject, useUpdateClientObjectMutation } from '../../../src/features/objects/queries';
import { useClient } from '../../../src/features/clients/queries';
import { uploadObjectMediaPhoto, deleteObjectMediaPhotoByUrl } from '../../../src/features/objects/media';
import { useEntityFieldSettings } from '../../../src/features/fieldSettings/queries';
import {
  ENTITY_FIELD_TYPES,
  buildFallbackEntityFieldSettings,
  getEntityFieldMap,
} from '../../../src/features/fieldSettings/catalog';
import {
  buildAdditionalPhoneDisplayLabel,
} from '../../../src/features/clients/additionalPhones';
import { getObjectAdditionalPhones } from '../../../src/features/objects/additionalPhones';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { hasDisplayValue } from '../../../src/shared/display/value';
import { useTheme } from '../../../theme/ThemeProvider';
import { buildAddressForNavigator, openAddressInYandex, openCoordinatesInYandex } from '../../../components/ui/map';
import {
  buildOrderAddressDisplay,
  buildOrderAddressShort,
  extractOrderAddressFromObject,
  filterOrderAddressByObjectFieldSettings,
} from '../../../src/features/requests/addressing';
import { formatRuMask, normalizeRu, toE164 } from '../../../components/ui/phone';
import OrderPhotosModal from '../../orders/components/OrderPhotosModal';
import FullscreenImageViewer from '../../orders/components/FullscreenImageViewer';

const DEFAULT_OBJECT_INITIALS = 'OB';
const SAFE_AREA_EDGES = ['left', 'right'];
const OBJECT_MEDIA_FIELD_KEYS = ['media_file_1', 'media_file_2', 'media_file_3'];
const PHOTO_MAX_WIDTH = 1280;
const PHOTO_COMPRESS_QUALITY = 0.8;
const PHOTO_MIME_TYPE = 'image/jpeg';

function withAlpha(color, alpha) {
  if (typeof color === 'string') {
    const hex = color.match(/^#([0-9a-fA-F]{6})$/);
    if (hex) {
      const hexAlpha = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
        .toString(16)
        .padStart(2, '0');
      return color + hexAlpha;
    }
    const rgb = color.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
    if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${alpha})`;
  }
  return `rgba(0,0,0,${alpha})`;
}

function getObjectInitials(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1))
    .join('')
    .toUpperCase() || DEFAULT_OBJECT_INITIALS;
}

function normalizeCoordinateValue(input) {
  const raw = String(input || '').trim().replace(',', '.');
  if (!raw) return '';
  const value = Number(raw);
  if (!Number.isFinite(value)) return '';
  return String(Math.round(value * 1_000_000) / 1_000_000);
}

export default function ObjectViewScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { has } = usePermissions();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams();
  const id = params?.id;
  const rawReturnTo = params?.returnTo;
  const rawReturnParams = params?.returnParams;
  const objectId = Array.isArray(id) ? id[0] : id;
  const returnTo = React.useMemo(() => {
    const value = Array.isArray(rawReturnTo) ? rawReturnTo[0] : rawReturnTo;
    return value ? String(value) : '/objects';
  }, [rawReturnTo]);
  const returnParams = React.useMemo(() => {
    const value = Array.isArray(rawReturnParams) ? rawReturnParams[0] : rawReturnParams;
    if (!value) return {};
    try {
      const parsed = JSON.parse(String(value));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }, [rawReturnParams]);

  const canViewObjects = has('canViewObjects');
  const canViewClients = has('canViewClients');
  const canEditObjects = has('canEditObjects');
  const { data: objectItem } = useClientObject(objectId, {
    enabled: !!objectId && canViewObjects,
  });
  const { data: objectFieldSettingsData } = useEntityFieldSettings(ENTITY_FIELD_TYPES.OBJECT, {
    enabled: !!objectId,
  });
  const { settings } = useCompanySettings();
  const objectFieldSettings = React.useMemo(
    () => objectFieldSettingsData || buildFallbackEntityFieldSettings(ENTITY_FIELD_TYPES.OBJECT),
    [objectFieldSettingsData],
  );
  const objectFieldsByKey = React.useMemo(() => getEntityFieldMap(objectFieldSettings), [objectFieldSettings]);

  const clientId = objectItem?.client_id;
  const { data: clientData } = useClient(clientId, { enabled: !!clientId && canViewClients });
  const updateObjectMutation = useUpdateClientObjectMutation();

  const [photoPreviewVisible, setPhotoPreviewVisible] = React.useState(false);
  const [objectPhotosModal, setObjectPhotosModal] = React.useState({ visible: false, category: null });
  const [localPendingMap, setLocalPendingMap] = React.useState({});
  const [viewerVisible, setViewerVisible] = React.useState(false);
  const [viewerPhotos, setViewerPhotos] = React.useState([]);
  const [viewerIndex, setViewerIndex] = React.useState(0);
  const [viewerCategoryLabel, setViewerCategoryLabel] = React.useState('');
  const viewerRawPhotosRef = React.useRef([]);
  const viewerCategoryRef = React.useRef(null);
  const objectMediaRef = React.useRef({});
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const base = React.useMemo(() => listItemStyles(theme), [theme]);

  React.useEffect(() => {
    const next = {};
    OBJECT_MEDIA_FIELD_KEYS.forEach((fieldKey) => {
      next[fieldKey] = Array.isArray(objectItem?.[fieldKey]) ? objectItem[fieldKey] : [];
    });
    objectMediaRef.current = next;
  }, [objectItem]);

  // Allow viewing object even if user cannot view clients. Client details (name/link)
  // will be shown only when `canViewClients` is true and `clientData` is available.

  const visibleAddressDraft = React.useMemo(
    () =>
      filterOrderAddressByObjectFieldSettings(
        extractOrderAddressFromObject(objectItem),
        objectFieldsByKey,
      ),
    [objectFieldsByKey, objectItem],
  );
  const addressItems = [
    [t('order_field_country'), visibleAddressDraft.country],
    [t('order_field_region'), visibleAddressDraft.region],
    [t('order_field_district'), visibleAddressDraft.district],
    [t('order_field_city'), visibleAddressDraft.city],
    [t('order_field_street'), visibleAddressDraft.street],
    [t('order_field_house'), visibleAddressDraft.house],
    [t('order_field_floor'), visibleAddressDraft.floor],
    [t('order_field_entrance'), visibleAddressDraft.entrance],
    [t('order_field_apartment'), visibleAddressDraft.apartment],
    [t('order_field_postal_code'), visibleAddressDraft.postal_code],
  ]
    .filter(([, value]) => String(value || '').trim().length > 0)
    .map(([label, value]) => ({ label, value: String(value || '').trim() }));
  const additionalInfoItems = [
    [t('order_field_comment'), objectItem?.comment || objectItem?.entrance_info],
  ]
    .filter(([label]) => {
      const keyMap = {
        [t('order_field_comment')]: 'comment',
      };
      const fieldKey = keyMap[label];
      return fieldKey ? objectFieldsByKey.get(fieldKey)?.isEnabled === true : true;
    })
    .filter(([, value]) => String(value || '').trim().length > 0)
    .map(([label, value]) => ({ label, value: String(value || '').trim() }));
  const additionalPhones = React.useMemo(() => getObjectAdditionalPhones(objectItem), [objectItem]);
  const visibleAdditionalPhones = React.useMemo(
    () =>
      additionalPhones.filter((item, index) =>
        objectFieldsByKey.get(`additional_phone_${index + 1}`)?.isEnabled === true && !!item?.phone,
      ),
    [additionalPhones, objectFieldsByKey],
  );

  const navigatorAddress = buildAddressForNavigator(visibleAddressDraft);
  const shortAddress = buildOrderAddressShort(visibleAddressDraft);
  const fullAddress = buildOrderAddressDisplay(visibleAddressDraft);
  const mapLat = normalizeCoordinateValue(objectItem?.geo_lat);
  const mapLng = normalizeCoordinateValue(objectItem?.geo_lng);
  const hasMapPoint = !!mapLat && !!mapLng;
  const isCoordinatesMode =
    String(objectItem?.location_mode || '').trim().toLowerCase() === 'map' ||
    (!String(objectItem?.location_mode || '').trim() && hasMapPoint);
  const clientDisplayName = String(clientData?.full_name || objectItem?.client_id || '').trim();
  const showObjectName = objectFieldsByKey.get('name')?.isEnabled === true;
  const showClientRow = hasDisplayValue(clientDisplayName);
  const canShowContactSection = visibleAdditionalPhones.length > 0;
  const onCopyPhone = React.useCallback(async (rawPhone) => {
    const phone = String(rawPhone || '').trim();
    if (!phone) return false;
    const text = toE164(phone) || '+' + normalizeRu(phone);
    try {
      await Clipboard.setStringAsync(text);
      toast.success(t('toast_copied'));
      return true;
    } catch {
      toast.error(t('toast_copy_phone_fail'));
      return false;
    }
  }, [t, toast]);
  const copyCoordinates = React.useCallback(async () => {
    if (!hasMapPoint) return false;
    try {
      await Clipboard.setStringAsync(`${mapLat}, ${mapLng}`);
      toast.success(t('toast_copied'));
      return true;
    } catch {
      toast.error(t('toast_copy_phone_fail'));
      return false;
    }
  }, [hasMapPoint, mapLat, mapLng, t, toast]);
  const copyShortAddress = React.useCallback(async () => {
    const value = String(shortAddress || fullAddress || '').trim();
    if (!value) return false;
    try {
      await Clipboard.setStringAsync(value);
      toast.success(t('toast_copied'));
      return true;
    } catch {
      toast.error(t('toast_copy_phone_fail'));
      return false;
    }
  }, [fullAddress, shortAddress, t, toast]);

  const getObjectFieldLabel = React.useCallback(
    (fieldKey, fallbackLabel) => {
      const field = objectFieldsByKey.get(fieldKey);
      const customLabel = String(field?.customLabel || '').trim();
      if (customLabel) return customLabel;
      if (field?.labelKey) {
        return t(field.labelKey, field?.fallbackLabel || fallbackLabel || String(fieldKey || ''));
      }
      return fallbackLabel || String(fieldKey || '');
    },
    [objectFieldsByKey, t],
  );

  const visibleMediaFields = React.useMemo(
    () => OBJECT_MEDIA_FIELD_KEYS.filter((fieldKey) => objectFieldsByKey.get(fieldKey)?.isEnabled === true),
    [objectFieldsByKey],
  );

  const uploadLocalUri = React.useCallback(
    async (category, uri) => {
      if (!objectId || !canEditObjects) return false;
      const manipulated = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: PHOTO_MAX_WIDTH } }],
        { compress: PHOTO_COMPRESS_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
      );
      const { publicUrl } = await uploadObjectMediaPhoto(objectId, category, manipulated.uri, PHOTO_MIME_TYPE);

      const current = Array.isArray(objectMediaRef.current?.[category]) ? objectMediaRef.current[category] : [];
      const next = [publicUrl, ...current.filter((value) => String(value || '') !== publicUrl)];
      const updated = await updateObjectMutation.mutateAsync({
        id: objectId,
        patch: {
          [category]: next,
        },
      });
      objectMediaRef.current = {
        ...objectMediaRef.current,
        [category]: Array.isArray(updated?.[category]) ? updated[category] : next,
      };
      return true;
    },
    [objectId, canEditObjects, updateObjectMutation],
  );

  const handleUploadUri = React.useCallback(
    async (category, uri) => {
      const pendingId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setLocalPendingMap((prev) => ({
        ...prev,
        [category]: [...(prev?.[category] || []), { id: pendingId, uri }],
      }));
      try {
        await uploadLocalUri(category, uri);
        toast.success(t('order_toast_photo_uploaded'));
      } catch (error) {
        toast.error(String(error?.message || t('order_toast_upload_error')));
      } finally {
        setLocalPendingMap((prev) => ({
          ...prev,
          [category]: (prev?.[category] || []).filter((item) => item.id !== pendingId),
        }));
      }
    },
    [toast, t, uploadLocalUri],
  );

  const handleUploadMultiple = React.useCallback(
    async (category, uris = []) => {
      const queue = Array.isArray(uris) ? uris.filter(Boolean) : [];
      if (!queue.length) return;
      const ids = queue.map((uri, index) => ({
        id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        uri,
      }));
      setLocalPendingMap((prev) => ({
        ...prev,
        [category]: [...(prev?.[category] || []), ...ids],
      }));

      let uploadedCount = 0;
      for (const item of ids) {
        try {
          await uploadLocalUri(category, item.uri);
          uploadedCount += 1;
        } catch {
        } finally {
          setLocalPendingMap((prev) => ({
            ...prev,
            [category]: (prev?.[category] || []).filter((pending) => pending.id !== item.id),
          }));
        }
      }

      if (uploadedCount > 0) {
        if (uploadedCount === 1) {
          toast.success(t('order_toast_photo_uploaded'));
        } else {
          toast.success(t('order_toast_photos_uploaded', 'Загружено {count} фото').replace('{count}', String(uploadedCount)));
        }
      } else {
        toast.error(t('order_toast_upload_error'));
      }
    },
    [toast, t, uploadLocalUri],
  );

  const removePhoto = React.useCallback(
    async (category, index) => {
      if (!objectId || !canEditObjects) return;
      const photos = Array.isArray(objectMediaRef.current?.[category]) ? objectMediaRef.current[category] : [];
      const removedUrl = String(photos[index] || '').trim();
      if (!removedUrl) return;

      const next = photos.filter((_, photoIndex) => photoIndex !== index);
      const updated = await updateObjectMutation.mutateAsync({
        id: objectId,
        patch: {
          [category]: next,
        },
      });
      objectMediaRef.current = {
        ...objectMediaRef.current,
        [category]: Array.isArray(updated?.[category]) ? updated[category] : next,
      };
      try {
        await deleteObjectMediaPhotoByUrl(objectId, category, removedUrl);
      } catch {
      }
    },
    [objectId, canEditObjects, updateObjectMutation],
  );

  const removePhotosBatch = React.useCallback(
    async (category, urls = []) => {
      if (!objectId || !canEditObjects) return;
      const selected = new Set((urls || []).map((value) => String(value || '').trim()).filter(Boolean));
      if (!selected.size) return;

      const photos = Array.isArray(objectMediaRef.current?.[category]) ? objectMediaRef.current[category] : [];
      const next = photos.filter((value) => !selected.has(String(value || '').trim()));
      const removed = photos.filter((value) => selected.has(String(value || '').trim()));

      const updated = await updateObjectMutation.mutateAsync({
        id: objectId,
        patch: {
          [category]: next,
        },
      });
      objectMediaRef.current = {
        ...objectMediaRef.current,
        [category]: Array.isArray(updated?.[category]) ? updated[category] : next,
      };
      for (const url of removed) {
        try {
          await deleteObjectMediaPhotoByUrl(objectId, category, url);
        } catch {
        }
      }
    },
    [objectId, canEditObjects, updateObjectMutation],
  );

  const openViewer = React.useCallback((photos, index, category, label) => {
    if (!Array.isArray(photos) || !photos.length) return;
    const prepared = photos.map((raw) => String(raw || '').trim()).filter(Boolean);
    if (!prepared.length) return;
    viewerRawPhotosRef.current = prepared;
    viewerCategoryRef.current = category || null;
    setViewerCategoryLabel(label || '');
    setViewerPhotos(prepared);
    setViewerIndex(Math.min(index, prepared.length - 1));
    setViewerVisible(true);
  }, []);

  const closeViewer = React.useCallback(() => {
    setViewerVisible(false);
  }, []);

  const handleViewerDelete = React.useCallback(
    async (viewerIdx) => {
      const category = viewerCategoryRef.current;
      const photos = viewerRawPhotosRef.current || [];
      const rawUrl = String(photos[viewerIdx] || '').trim();
      if (!category || !rawUrl) return;
      const objectPhotos = Array.isArray(objectMediaRef.current?.[category]) ? objectMediaRef.current[category] : [];
      const realIndex = objectPhotos.findIndex((value) => String(value || '').trim() === rawUrl);
      if (realIndex < 0) return;
      await removePhoto(category, realIndex);
      viewerRawPhotosRef.current = photos.filter((_, index) => index !== viewerIdx);
    },
    [removePhoto],
  );

  if (!canViewObjects) {
    return (
      <SafeAreaView edges={SAFE_AREA_EDGES} style={styles.safeArea}>
        <AppHeader back options={{ title: t('routes_objects_object') }} />
        <View style={styles.centered}>
          <Text style={styles.mutedText}>{t('objects_no_view_permission')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={SAFE_AREA_EDGES} style={styles.safeArea}>
      <AppHeader
        back
        options={{
          title: t('routes_objects_object'),
          rightTextLabel: canEditObjects ? t('btn_edit') : undefined,
          onRightPress: canEditObjects
            ? () =>
                router.push({
                  pathname: `/objects/${objectId}/edit`,
                  params: {
                    returnTo,
                    returnParams: JSON.stringify(returnParams),
                  },
                })
            : undefined,
        }}
      />

      <ScrollView contentContainerStyle={styles.contentWrap}>
        <View style={styles.avatarWrap}>
          <Pressable
            style={styles.avatarBox}
            onPress={() => {
              if (!objectItem?.photoUrl) return;
              setPhotoPreviewVisible(true);
            }}
            disabled={!objectItem?.photoUrl}
          >
            {objectItem?.photoDisplayUrl || objectItem?.photoUrl ? (
              <ExpoImage
                source={{ uri: objectItem?.photoDisplayUrl || objectItem?.photoUrl }}
                style={styles.avatarImg}
                contentFit="cover"
                cachePolicy="none"
              />
            ) : (
              <Text style={styles.avatarText}>{getObjectInitials(objectItem?.name)}</Text>
            )}
          </Pressable>
        </View>

        {/* Верхнее поле под фото удалено по запросу — оставляем только аватар и остальные секции */}

        {settings?.enable_object_tags && objectItem?.tags?.length ? (
          <>
            <SectionHeader topSpacing="xs">{t('tags_field_label')}</SectionHeader>
            <Card style={{ paddingVertical: theme.spacing.md }}>
              <TagList
                tags={objectItem.tags}
                align="start"
                compact
                onPressTag={(tag) => {
                  const value = String(tag?.value || '').trim();
                  if (!value) return;
                  router.push({ pathname: '/objects', params: { tag: value } });
                }}
              />
            </Card>
          </>
        ) : null}

        <SectionHeader>{t('section_general')}</SectionHeader>
        <Card paddedXOnly>
          {showObjectName ? (
            <LabelValueRow label={t('objects_field_name')} value={objectItem?.name || ''} />
          ) : null}
          {showObjectName && showClientRow ? <View style={base.sep} /> : null}
          {showClientRow ? (
            <LabelValueRow
              label={t('routes_clients_client')}
              valueComponent={
                canViewClients && clientData?.id ? (
                  <Pressable
                    onPress={() => {
                      router.push({
                        pathname: `/clients/${clientData.id}`,
                        params: {
                          returnTo: `/objects/${objectId}`,
                          returnParams: JSON.stringify({ returnTo, returnParams: JSON.stringify(returnParams) }),
                        },
                      });
                    }}
                  >
                    <Text style={styles.clientLink}>{clientDisplayName}</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.clientText}>{clientDisplayName}</Text>
                )
              }
            />
          ) : null}
          {showObjectName || showClientRow ? <View style={base.sep} /> : null}
          {isCoordinatesMode ? (
            <LabelValueRow
              label={t('objects_location_coordinates')}
              valueComponent={(
                <Pressable
                  style={({ pressed }) => [styles.linkPressable, pressed ? styles.linkPressablePressed : null]}
                  accessibilityRole={hasMapPoint ? 'link' : undefined}
                  onLongPress={copyCoordinates}
                  onPress={() => {
                    if (!hasMapPoint) {
                      toast.warning(t('objects_location_empty'));
                      return;
                    }
                    openCoordinatesInYandex(mapLat, mapLng);
                  }}
                >
                  <Text style={[base.value, hasMapPoint ? styles.clientLink : null]}>
                    {hasMapPoint ? `${mapLat}, ${mapLng}` : t('objects_location_empty')}
                  </Text>
                </Pressable>
              )}
            />
          ) : (
            <ExpandableTextRow
              label={t('order_details_address')}
              value={fullAddress || t('order_details_address_not_specified', 'Без адреса')}
              collapsedValue={shortAddress || fullAddress || t('order_details_address_not_specified', 'Без адреса')}
              expandedKeyValueItems={addressItems}
              expandedLabelBold
              onValuePress={() => {
                if (!navigatorAddress) {
                  toast.warning(t('order_details_address_not_specified'));
                  return;
                }
                openAddressInYandex(navigatorAddress);
              }}
              onCollapsedLongPress={copyShortAddress}
              collapsedValueStyle={navigatorAddress ? styles.clientLink : null}
            />
          )}
          {/* tags moved to separate section below */}
        </Card>

        {canShowContactSection ? (
          <>
            <SectionHeader>{t('clients_contacts_section')}</SectionHeader>
            <Card paddedXOnly>
              {visibleAdditionalPhones.map((item, index) => {
                const rowLabel = buildAdditionalPhoneDisplayLabel(t, item?.label);
                const isLast = index === visibleAdditionalPhones.length - 1;
                return (
                  <React.Fragment key={`object-additional-phone-${index + 1}`}>
                    <LabelValueRow
                      label={rowLabel}
                      valueComponent={
                        <Pressable
                          style={({ pressed }) => [styles.linkPressable, pressed ? styles.linkPressablePressed : null]}
                          accessibilityRole="link"
                          onLongPress={() => onCopyPhone(item.phone)}
                          onPress={async () => {
                            const url = `tel:${toE164(item.phone) || '+' + normalizeRu(item.phone)}`;
                            try {
                              await Linking.openURL(url);
                            } catch {
                              try {
                                const ok = await Linking.canOpenURL(url);
                                if (ok) await Linking.openURL(url);
                                else toast.error(t('errors_callsUnavailable'));
                              } catch {
                                toast.error(t('errors_callsUnavailable'));
                              }
                            }
                          }}
                        >
                          <Text style={[base.value, styles.clientLink]}>{formatRuMask(item.phone)}</Text>
                        </Pressable>
                      }
                      rightActions={
                        <IconButton
                          style={styles.copyIconHidden}
                          onPress={() => onCopyPhone(item.phone)}
                          accessibilityLabel={t('a11y_copy_phone')}
                        >
                          <Feather name="copy" size={Number(theme?.typography?.sizes?.md ?? 16)} />
                        </IconButton>
                      }
                    />
                    {!isLast ? <View style={base.sep} /> : null}
                  </React.Fragment>
                );
              })}
            </Card>
          </>
        ) : null}

        {visibleMediaFields.length > 0 ? (
          <>
            <SectionHeader topSpacing="xs" bottomSpacing="xs">
              {t('order_details_photos_section', 'Фото')}
            </SectionHeader>
            <Card paddedXOnly>
              {visibleMediaFields
                .map((fieldKey) => ({
                  key: fieldKey,
                  label: getObjectFieldLabel(
                    fieldKey,
                    t(`object_media_field_${OBJECT_MEDIA_FIELD_KEYS.indexOf(fieldKey) + 1}`, `Медиа объекта ${OBJECT_MEDIA_FIELD_KEYS.indexOf(fieldKey) + 1}`),
                  ),
                }))
                .map((row, idx) => {
                  const count =
                    (Array.isArray(objectItem?.[row.key]) ? objectItem[row.key].length : 0) +
                    ((localPendingMap?.[row.key] || []).length || 0);
                  return (
                    <View key={row.key}>
                      {idx > 0 ? <View style={base.sep} /> : null}
                      <Pressable
                        style={({ pressed }) => [base.row, pressed && { opacity: 0.7 }]}
                        onPress={() => setObjectPhotosModal({ visible: true, category: row.key })}
                        disabled={!canEditObjects && count === 0}
                      >
                        <Text style={base.label}>{row.label}</Text>
                        <View style={base.rightWrap}>
                          <Text style={base.value}>
                            {t('order_photos_count', '{count} фото').replace('{count}', String(count))}
                          </Text>
                          <Feather
                            name="chevron-right"
                            size={theme.icons?.sm ?? 18}
                            color={theme.colors.textSecondary}
                            style={{ marginLeft: theme.spacing.xs }}
                          />
                        </View>
                      </Pressable>
                    </View>
                  );
                })}
            </Card>
          </>
        ) : null}

        {additionalInfoItems.length ? (
          <>
            <SectionHeader>{t('objects_additional_info_section')}</SectionHeader>
            <Card paddedXOnly>
              {additionalInfoItems.map((item, index) => (
                <React.Fragment key={`${item.label}-${index}`}>
                  {index > 0 ? <View style={base.sep} /> : null}
                  <LabelValueRow label={item.label} value={item.value} />
                </React.Fragment>
              ))}
            </Card>
          </>
        ) : null}
      </ScrollView>

      <BaseModal
        visible={photoPreviewVisible}
        onClose={() => setPhotoPreviewVisible(false)}
        title={t('objects_photo_title')}
        maxHeightRatio={0.9}
      >
        <View style={styles.previewWrap}>
          {objectItem?.photoDisplayUrl || objectItem?.photoUrl ? (
            <ExpoImage
              source={{ uri: objectItem?.photoDisplayUrl || objectItem?.photoUrl }}
              style={styles.previewImg}
              contentFit="contain"
              cachePolicy="none"
            />
          ) : (
            <Text style={styles.previewEmpty}>{t('placeholder_no_photo')}</Text>
          )}
        </View>
      </BaseModal>

      <OrderPhotosModal
        visible={objectPhotosModal.visible}
        onClose={() => setObjectPhotosModal({ visible: false, category: null })}
        category={objectPhotosModal.category}
        photos={Array.isArray(objectItem?.[objectPhotosModal.category]) ? objectItem[objectPhotosModal.category] : []}
        pending={localPendingMap?.[objectPhotosModal.category] || []}
        getDisplayUrl={(url) => String(url || '')}
        getIssue={() => ''}
        onUploadUri={handleUploadUri}
        onUploadMultiple={handleUploadMultiple}
        onRemove={removePhoto}
        onRemoveMany={removePhotosBatch}
        onOpenViewer={(photos, idx) => {
          const catLabels = {
            media_file_1: getObjectFieldLabel('media_file_1', t('object_media_field_1', 'Медиа объекта 1')),
            media_file_2: getObjectFieldLabel('media_file_2', t('object_media_field_2', 'Медиа объекта 2')),
            media_file_3: getObjectFieldLabel('media_file_3', t('object_media_field_3', 'Медиа объекта 3')),
          };
          openViewer(photos, idx, objectPhotosModal.category, catLabels[objectPhotosModal.category] || '');
        }}
      />

      <FullscreenImageViewer
        visible={viewerVisible}
        images={viewerPhotos}
        initialIndex={viewerIndex}
        onClose={closeViewer}
        onDelete={canEditObjects ? handleViewerDelete : undefined}
        categoryLabel={viewerCategoryLabel}
      />
    </SafeAreaView>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    contentWrap: {
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.components?.scrollView?.paddingBottom ?? theme.spacing.xl,
    },
    mutedText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
    avatarWrap: {
      alignItems: 'center',
      marginBottom: theme.spacing.md,
    },
    avatarBox: {
      width: theme.components?.avatar?.xl ?? 96,
      height: theme.components?.avatar?.xl ?? 96,
      borderRadius: (theme.components?.avatar?.xl ?? 96) / 2,
      backgroundColor: withAlpha(theme.colors.primary, 0.12),
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      borderWidth: theme.components.card.borderWidth,
      borderColor: withAlpha(theme.colors.primary, 0.24),
    },
    avatarImg: {
      width: '100%',
      height: '100%',
    },
    avatarText: {
      color: theme.colors.primary,
      fontSize: theme.typography.sizes.xl ?? 24,
      fontWeight: theme.typography.weight.bold ?? '700',
    },
    /* headerCard, headerRow, badge, badgeText, nameTitle removed — not used after UI simplification */
    clientLink: {
      color: theme.colors.primary,
      fontSize: theme.typography.sizes.sm,
      marginTop: theme.spacing.xs,
    },
    linkPressable: {
      borderRadius: theme.radii.xs,
    },
    linkPressablePressed: {
      opacity: 0.6,
      transform: [{ scale: 0.99 }],
    },
    clientText: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      marginTop: theme.spacing.xs,
    },
    copyIconHidden: {
      display: 'none',
    },
    previewWrap: {
      alignItems: 'center',
      padding: theme.spacing.md,
    },
    previewImg: {
      width: '100%',
      height: undefined,
      aspectRatio: 1,
      borderRadius: theme.radii.lg,
    },
    previewEmpty: {
      color: theme.colors.textSecondary,
    },
  });
}
