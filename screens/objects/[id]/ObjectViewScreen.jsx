// Heavy implementation lives outside the route wrapper so navigation can
// paint the destination before this module is evaluated.
import React from 'react';
import Feather from '@expo/vector-icons/Feather';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AppHeader from '../../../components/navigation/AppHeader';
import Card from '../../../components/ui/Card';
import ExpandableTextRow from '../../../components/ui/ExpandableTextRow';
import IconButton from '../../../components/ui/IconButton';
import LabelValueRow from '../../../components/ui/LabelValueRow';
import EntityPhotoPreview from '../../../components/media/EntityPhotoPreview';
import MediaUploadRow from '../../../components/media/MediaUploadRow';
import SectionHeader from '../../../components/ui/SectionHeader';
import TagList from '../../../components/tags/TagList';
import TrashReadOnlyNotice from '../../../components/trash/TrashReadOnlyNotice';
import { useCompanySettings } from '../../../hooks/useCompanySettings';
import { listItemStyles } from '../../../components/ui/listItemStyles';
import { useToast } from '../../../components/ui/ToastProvider';
import { usePermissions } from '../../../lib/permissions';
import { useClientObject } from '../../../src/features/objects/queries';
import { useClient } from '../../../src/features/clients/queries';
import { normalizeClientObject } from '../../../src/features/objects/addressing';
import { getTrashItem } from '../../../src/features/trash/api';
import { queryKeys } from '../../../src/shared/query/queryKeys';
import {
  isRenderableObjectMediaUrl,
  mergeObjectMediaUrlMapPreservingLocal,
  resolveObjectMediaUrls,
} from '../../../src/features/objects/media';
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
import {
  buildAddressForNavigator,
  openAddressInPreferredMap,
  openCoordinatesInPreferredMap,
} from '../../../components/ui/map';
import {
  buildOrderAddressDisplay,
  buildOrderAddressShort,
  extractOrderAddressFromObject,
  filterOrderAddressByObjectFieldSettings,
} from '../../../src/features/requests/addressing';
import { formatRuMask, normalizeRu, toE164 } from '../../../components/ui/phone';
import MediaUploadModal from '../../../components/media/MediaUploadModal';
import FullscreenImageViewer from '../../../app/orders/components/FullscreenImageViewer';

const DEFAULT_OBJECT_INITIALS = 'OB';
const SAFE_AREA_EDGES = ['left', 'right'];
const OBJECT_MEDIA_FIELD_KEYS = ['media_file_1', 'media_file_2', 'media_file_3'];

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
  const trashId = String(Array.isArray(params?.trashId) ? params.trashId[0] || '' : params?.trashId || '').trim();
  const isTrashMode = Boolean(trashId);
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

  const canViewObjects = isTrashMode ? has('canViewTrash') : has('canViewObjects');
  const canViewClients = has('canViewClients');
  const canEditObjects = !isTrashMode && has('canEditObjects');
  const canViewObjectPhones = has('canViewObjectPhones');
  const activeObjectQuery = useClientObject(objectId, {
    enabled: !!objectId && canViewObjects && !isTrashMode,
  });
  const trashQuery = useQuery({
    queryKey: [...queryKeys.trash.detail(trashId), 'object-screen'],
    queryFn: () => getTrashItem(trashId),
    enabled: isTrashMode && canViewObjects,
  });
  const trashItem = trashQuery.data;
  const objectItem = React.useMemo(
    () => isTrashMode ? normalizeClientObject(trashItem?.data) : activeObjectQuery.data,
    [activeObjectQuery.data, isTrashMode, trashItem?.data],
  );
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

  const [objectPhotosModal, setObjectPhotosModal] = React.useState({ visible: false, category: null });
  const [viewerVisible, setViewerVisible] = React.useState(false);
  const [viewerPhotos, setViewerPhotos] = React.useState([]);
  const [viewerPhotoMetadata, setViewerPhotoMetadata] = React.useState([]);
  const [resolvedObjectMediaUrls, setResolvedObjectMediaUrls] = React.useState({});
  const [objectMediaThumbUrls, setObjectMediaThumbUrls] = React.useState({});
  const [objectMediaInfoBySource, setObjectMediaInfoBySource] = React.useState({});
  const [viewerIndex, setViewerIndex] = React.useState(0);
  const [viewerCategoryLabel, setViewerCategoryLabel] = React.useState('');
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const base = React.useMemo(() => listItemStyles(theme), [theme]);

  const objectMediaByCategory = React.useMemo(() => {
    const next = {};
    OBJECT_MEDIA_FIELD_KEYS.forEach((fieldKey) => {
      next[fieldKey] = Array.isArray(objectItem?.[fieldKey]) ? objectItem[fieldKey] : [];
    });
    return next;
  }, [objectItem]);

  React.useEffect(() => {
    let cancelled = false;
    if (!objectId) {
      setResolvedObjectMediaUrls({});
      setObjectMediaThumbUrls({});
      setObjectMediaInfoBySource({});
      return () => {
        cancelled = true;
      };
    }

    const run = async () => {
      const { displayUrls, thumbnailUrls, mediaInfoBySource } = await resolveObjectMediaUrls({
        objectId,
        categories: OBJECT_MEDIA_FIELD_KEYS,
        mediaByCategory: objectMediaByCategory,
      });
      if (cancelled) return;
      if (Object.keys(displayUrls).length) {
        setResolvedObjectMediaUrls((prev) => mergeObjectMediaUrlMapPreservingLocal(prev, displayUrls));
      }
      if (Object.keys(thumbnailUrls).length) {
        setObjectMediaThumbUrls((prev) => mergeObjectMediaUrlMapPreservingLocal(prev, thumbnailUrls));
      }
      if (Object.keys(mediaInfoBySource).length) {
        setObjectMediaInfoBySource((prev) => ({ ...prev, ...mediaInfoBySource }));
      }
    };

    run().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [objectId, objectMediaByCategory]);

  const getObjectMediaDisplayUrl = React.useCallback(
    (url) => {
      const source = String(url || '').trim();
      if (!source) return '';
      return resolvedObjectMediaUrls[source] || (isRenderableObjectMediaUrl(source) ? source : '');
    },
    [resolvedObjectMediaUrls],
  );

  const getObjectMediaThumbnailUrl = React.useCallback(
    (url) => {
      const source = String(url || '').trim();
      if (!source) return '';
      return objectMediaThumbUrls[source] || getObjectMediaDisplayUrl(source);
    },
    [getObjectMediaDisplayUrl, objectMediaThumbUrls],
  );

  // Allow viewing object even if user cannot view clients. Client details (name/link)
  // will be shown only when `canViewClients` is true and `clientData` is available.

  const visibleAddressDraft = React.useMemo(
    () =>
      filterOrderAddressByObjectFieldSettings(
        extractOrderAddressFromObject(objectItem),
        objectFieldsByKey,
        { preserveFilledDisabled: true },
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
    {
      fieldKey: 'comment',
      label: t('order_field_comment'),
      value: objectItem?.comment || '',
    },
  ]
    .filter((item) => {
      const value = String(item?.value || '').trim();
      return !!value;
    })
    .map((item) => ({ label: item.label, value: String(item.value || '').trim() }));
  const additionalPhones = React.useMemo(() => getObjectAdditionalPhones(objectItem), [objectItem]);
  const visibleAdditionalPhones = React.useMemo(
    () =>
      additionalPhones.filter((item, index) =>
        canViewObjectPhones &&
        (objectFieldsByKey.get(`additional_phone_${index + 1}`)?.isEnabled === true ||
          String(item?.phone || '').trim().length > 0) &&
        !!item?.phone,
      ),
    [additionalPhones, canViewObjectPhones, objectFieldsByKey],
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
  const clientDisplayName = String(clientData?.fullName || clientData?.full_name || objectItem?.client_id || '').trim();
  const showObjectName =
    objectFieldsByKey.get('name')?.isEnabled === true || String(objectItem?.name || '').trim().length > 0;
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
  const openNavigatorAddress = React.useCallback(() => {
    if (!navigatorAddress) {
      toast.warning(t('order_details_address_not_specified'));
      return;
    }
    void openAddressInPreferredMap(navigatorAddress).then((result) => {
      if (!result.opened) toast.error(t('map_app_open_error'));
    });
  }, [navigatorAddress, t, toast]);

  const getObjectFieldLabel = React.useCallback(
    (fieldKey, fallbackLabel) => {
      const objectLabel = String(objectItem?.[`${fieldKey}_label`] || '').trim();
      if (objectLabel) return objectLabel;
      const field = objectFieldsByKey.get(fieldKey);
      const customLabel = String(field?.customLabel || '').trim();
      if (customLabel) return customLabel;
      if (field?.labelKey) {
        return t(field.labelKey);
      }
      return fallbackLabel || String(fieldKey || '');
    },
    [objectFieldsByKey, objectItem, t],
  );

  const visibleMediaFields = React.useMemo(
    () => {
      const explicitMediaSections = Array.isArray(objectItem?.mediaSections) ? objectItem.mediaSections : null;
      return OBJECT_MEDIA_FIELD_KEYS.filter((fieldKey) => {
        const hasValues = Array.isArray(objectItem?.[fieldKey]) && objectItem[fieldKey].length > 0;
        if (explicitMediaSections) return explicitMediaSections.includes(fieldKey) || hasValues;
        const isEnabled = objectFieldsByKey.get(fieldKey)?.isEnabled === true;
        return isEnabled || hasValues;
      });
    },
    [objectFieldsByKey, objectItem],
  );

  const openViewer = React.useCallback(async (photos, index, category, label) => {
    if (!Array.isArray(photos) || !photos.length) return;
    const rawPhotos = photos.map((raw) => String(raw || '').trim()).filter(Boolean);
    if (!rawPhotos.length) return;

    let displayMap = resolvedObjectMediaUrls;
    let mediaInfoMap = objectMediaInfoBySource;
    const hasMissingDisplay = rawPhotos.some((raw) => !getObjectMediaDisplayUrl(raw));
    const hasMissingInfo = rawPhotos.some((raw) => !mediaInfoMap[raw]);
    if ((hasMissingDisplay || hasMissingInfo) && objectId && category) {
      const { displayUrls, thumbnailUrls, mediaInfoBySource } = await resolveObjectMediaUrls({
        objectId,
        categories: [category],
        mediaByCategory: { [category]: rawPhotos },
      });
      if (Object.keys(displayUrls).length) {
        displayMap = mergeObjectMediaUrlMapPreservingLocal(displayMap, displayUrls);
        setResolvedObjectMediaUrls((prev) => mergeObjectMediaUrlMapPreservingLocal(prev, displayUrls));
      }
      if (Object.keys(thumbnailUrls).length) {
        setObjectMediaThumbUrls((prev) => mergeObjectMediaUrlMapPreservingLocal(prev, thumbnailUrls));
      }
      if (Object.keys(mediaInfoBySource).length) {
        mediaInfoMap = { ...mediaInfoMap, ...mediaInfoBySource };
        setObjectMediaInfoBySource((prev) => ({ ...prev, ...mediaInfoBySource }));
      }
    }

    const pairs = photos
      .map((raw, originalIndex) => ({
        raw: String(raw || '').trim(),
        originalIndex,
        display: String(
          displayMap[String(raw || '').trim()] ||
            (isRenderableObjectMediaUrl(raw) ? String(raw || '').trim() : ''),
        ).trim(),
        metadata: mediaInfoMap[String(raw || '').trim()] || null,
      }))
      .filter((item) => item.raw && item.display);
    if (!pairs.length) return;
    const nextIndex = pairs.findIndex((item) => item.originalIndex === index);
    setViewerCategoryLabel(label || '');
    setViewerPhotos(pairs.map((item) => item.display));
    setViewerPhotoMetadata(pairs.map((item) => item.metadata));
    setViewerIndex(nextIndex >= 0 ? nextIndex : Math.min(index, pairs.length - 1));
    setViewerVisible(true);
  }, [getObjectMediaDisplayUrl, objectId, objectMediaInfoBySource, resolvedObjectMediaUrls]);

  const closeViewer = React.useCallback(() => {
    setViewerVisible(false);
  }, []);

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

  if (isTrashMode && (trashQuery.isLoading || !objectItem)) {
    return (
      <SafeAreaView edges={SAFE_AREA_EDGES} style={styles.safeArea}>
        <AppHeader back options={{ title: t('routes_objects_object') }} />
        <View style={styles.centered}>
          {trashQuery.isError ? <Text style={styles.mutedText}>{t('trash_item_unavailable')}</Text> : <ActivityIndicator color={theme.colors.primary} />}
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
        {isTrashMode ? <TrashReadOnlyNotice item={trashItem} /> : null}
        <EntityPhotoPreview
          imageUrl={objectItem?.photoThumbUrl || objectItem?.photoDisplayUrl || objectItem?.photoUrl || null}
          previewUrl={objectItem?.photoDisplayUrl || objectItem?.photoUrl || null}
          title={t('objects_photo_title')}
          fallback={getObjectInitials(objectItem?.name)}
          emptyLabel={t('placeholder_no_photo')}
          containerStyle={styles.avatarWrap}
          frameStyle={styles.avatarBox}
          imageStyle={styles.avatarImg}
          fallbackTextStyle={styles.avatarText}
          previewWrapStyle={styles.previewWrap}
          previewImageStyle={styles.previewImg}
          previewEmptyStyle={styles.previewEmpty}
          accessibilityLabel={t('objects_photo_title')}
        />

        {/* Верхнее поле под фото удалено по запросу — оставляем только аватар и остальные секции */}

        {settings?.enable_object_tags && objectItem?.tags?.length ? (
          <>
            <SectionHeader>{t('tags_field_label')}</SectionHeader>
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
        <Card paddedXOnly separated>
          {showObjectName ? (
            <LabelValueRow label={t('objects_field_name')} value={objectItem?.name || ''} />
          ) : null}
          {showObjectName && objectItem?.is_primary ? (
            <LabelValueRow
              label={t('objects_primary_client_flag')}
              value=""
              hideWhenEmpty={false}
            />
          ) : null}
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
                    void openCoordinatesInPreferredMap(mapLat, mapLng).then((result) => {
                      if (!result.opened) toast.error(t('map_app_open_error'));
                    });
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
              value={fullAddress || t('order_details_address_not_specified')}
              collapsedValue={shortAddress || fullAddress || t('order_details_address_not_specified')}
              expandedKeyValueItems={addressItems}
              expandedActionText={navigatorAddress ? t('order_address_map') : null}
              expandedLabelBold
              onValuePress={openNavigatorAddress}
              onCollapsedPress={openNavigatorAddress}
              onCollapsedLongPress={copyShortAddress}
              collapsedValueStyle={navigatorAddress ? styles.clientLink : null}
            />
          )}
          {/* tags moved to separate section below */}
        </Card>

        {canShowContactSection ? (
          <>
            <SectionHeader>{t('clients_contacts_section')}</SectionHeader>
            <Card paddedXOnly separated>
              {visibleAdditionalPhones.map((item, index) => {
                const rowLabel = buildAdditionalPhoneDisplayLabel(t, item?.label);
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
                  </React.Fragment>
                );
              })}
            </Card>
          </>
        ) : null}

        {visibleMediaFields.length > 0 ? (
          <>
            <SectionHeader>
              {t('order_details_photos_section')}
            </SectionHeader>
            <Card paddedXOnly>
              {visibleMediaFields
                .map((fieldKey) => ({
                  key: fieldKey,
                  label: getObjectFieldLabel(
                    fieldKey,
                    t(`object_media_field_${OBJECT_MEDIA_FIELD_KEYS.indexOf(fieldKey) + 1}`),
                  ),
                }))
                .map((row, idx) => {
                  const count = Array.isArray(objectItem?.[row.key]) ? objectItem[row.key].length : 0;
                  return (
                    <View key={row.key}>
                      {idx > 0 ? <View style={base.sep} /> : null}
                      <MediaUploadRow
                        label={row.label}
                        countLabel={t('order_photos_count').replace('{count}', String(count))}
                        onPress={() => setObjectPhotosModal({ visible: true, category: row.key })}
                        disabled={count === 0}
                      />
                    </View>
                  );
                })}
            </Card>
          </>
        ) : null}

        {additionalInfoItems.length ? (
          <>
            <SectionHeader>{t('objects_additional_info_section')}</SectionHeader>
            <Card paddedXOnly separated>
              {additionalInfoItems.map((item, index) => (
                <React.Fragment key={`${item.label}-${index}`}>
                  <LabelValueRow label={item.label} value={item.value} />
                </React.Fragment>
              ))}
            </Card>
          </>
        ) : null}
      </ScrollView>

      <MediaUploadModal
        visible={objectPhotosModal.visible}
        onClose={() => setObjectPhotosModal({ visible: false, category: null })}
        category={objectPhotosModal.category}
        photos={Array.isArray(objectItem?.[objectPhotosModal.category]) ? objectItem[objectPhotosModal.category] : []}
        getDisplayUrl={getObjectMediaDisplayUrl}
        getThumbnailUrl={getObjectMediaThumbnailUrl}
        getIssue={() => ''}
        canAddFromCamera={false}
        canAddFromGallery={false}
        canRemovePhotos={false}
        onOpenViewer={(photos, idx) => {
          const catLabels = {
            media_file_1: getObjectFieldLabel('media_file_1', t('object_media_field_1')),
            media_file_2: getObjectFieldLabel('media_file_2', t('object_media_field_2')),
            media_file_3: getObjectFieldLabel('media_file_3', t('object_media_field_3')),
          };
          openViewer(photos, idx, objectPhotosModal.category, catLabels[objectPhotosModal.category] || '');
        }}
      />

      <FullscreenImageViewer
        visible={viewerVisible}
        images={viewerPhotos}
        imageMetadata={viewerPhotoMetadata}
        initialIndex={viewerIndex}
        onClose={closeViewer}
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
