import React from 'react';
import { Image as ExpoImage } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useQueryClient } from '@tanstack/react-query';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AppHeader from '../../../components/navigation/AppHeader';
import Card from '../../../components/ui/Card';
import ExpandableTextRow from '../../../components/ui/ExpandableTextRow';
import IconButton from '../../../components/ui/IconButton';
import LabelValueRow from '../../../components/ui/LabelValueRow';
import MediaUploadRow from '../../../components/media/MediaUploadRow';
import SectionHeader from '../../../components/ui/SectionHeader';
import TagList from '../../../components/tags/TagList';
import { useCompanySettings } from '../../../hooks/useCompanySettings';
import { BaseModal } from '../../../components/ui/modals';
import { listItemStyles } from '../../../components/ui/listItemStyles';
import { useToast } from '../../../components/ui/ToastProvider';
import { usePermissions } from '../../../lib/permissions';
import { useClientObject, updateObjectQueryCaches } from '../../../src/features/objects/queries';
import { useClient } from '../../../src/features/clients/queries';
import {
  uploadObjectMediaPhoto,
  deleteObjectMediaPhotoByUrl,
  mergeObjectMediaUrls,
  mergeObjectMediaUrlMapPreservingLocal,
} from '../../../src/features/objects/media';
import { objectMediaStorage } from '../../../lib/objectMediaStorage';
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
import MediaUploadModal from '../../../components/media/MediaUploadModal';
import FullscreenImageViewer from '../../orders/components/FullscreenImageViewer';
import { buildMediaAssetDisplayMap, buildMediaAssetThumbMap, listMediaAssets } from '../../../src/shared/media/assets';
import { prepareImageForUpload, runMediaUploadQueue } from '../../../src/shared/media/imagePipeline';

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
  const queryClient = useQueryClient();
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
  const canViewObjectPhones = has('canViewObjectPhones');
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

  const [photoPreviewVisible, setPhotoPreviewVisible] = React.useState(false);
  const [objectPhotosModal, setObjectPhotosModal] = React.useState({ visible: false, category: null });
  const [localPendingMap, setLocalPendingMap] = React.useState({});
  const [viewerVisible, setViewerVisible] = React.useState(false);
  const [viewerPhotos, setViewerPhotos] = React.useState([]);
  const [resolvedObjectMediaUrls, setResolvedObjectMediaUrls] = React.useState({});
  const [objectMediaThumbUrls, setObjectMediaThumbUrls] = React.useState({});
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

  React.useEffect(() => {
    let cancelled = false;
    if (!objectId) {
      setResolvedObjectMediaUrls({});
      setObjectMediaThumbUrls({});
      return () => {
        cancelled = true;
      };
    }

    const run = async () => {
      const nextResolved = {};
      try {
        const assets = await listMediaAssets({
          entityType: 'object',
          entityId: objectId,
          categories: OBJECT_MEDIA_FIELD_KEYS,
        });
        Object.assign(nextResolved, buildMediaAssetDisplayMap(assets));
        const thumbMap = buildMediaAssetThumbMap(assets);
        if (!cancelled && Object.keys(thumbMap).length) {
          setObjectMediaThumbUrls((prev) => mergeObjectMediaUrlMapPreservingLocal(prev, thumbMap));
        }
      } catch {}
      for (const category of OBJECT_MEDIA_FIELD_KEYS) {
        const urls = Array.isArray(objectItem?.[category])
          ? objectItem[category].map((value) => String(value || '').trim()).filter(Boolean)
          : [];
        if (!urls.length) continue;
        try {
          const data = await objectMediaStorage('inspect_urls', {
            object_id: objectId,
            category,
            urls,
          });
          const resolved =
            data?.resolved_urls && typeof data.resolved_urls === 'object' ? data.resolved_urls : {};
          Object.assign(nextResolved, resolved);
        } catch {}
      }
      if (!cancelled && Object.keys(nextResolved).length) {
        setResolvedObjectMediaUrls((prev) => mergeObjectMediaUrlMapPreservingLocal(prev, nextResolved));
      }
    };

    run().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [objectId, objectItem]);

  const getObjectMediaDisplayUrl = React.useCallback(
    (url) => {
      const source = String(url || '').trim();
      if (!source) return '';
      return resolvedObjectMediaUrls[source] || objectMediaThumbUrls[source] || source;
    },
    [objectMediaThumbUrls, resolvedObjectMediaUrls],
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
  const clientDisplayName = String(clientData?.full_name || objectItem?.client_id || '').trim();
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

  const applyObjectMediaUrls = React.useCallback(
    (category, mediaUrls, objectUpdatedAt = null, options = {}) => {
      if (!category) return [];
      const nextMediaUrls = options?.merge
        ? mergeObjectMediaUrls(mediaUrls, objectMediaRef.current?.[category])
        : mergeObjectMediaUrls(mediaUrls);
      objectMediaRef.current = {
        ...objectMediaRef.current,
        [category]: nextMediaUrls,
      };
      updateObjectQueryCaches(queryClient, objectId, {
        [category]: nextMediaUrls,
        ...(objectUpdatedAt ? { updated_at: objectUpdatedAt } : {}),
      });
      return nextMediaUrls;
    },
    [objectId, queryClient],
  );

  const uploadObjectMediaFile = React.useCallback(
    async (category, uri) => {
      if (!objectId || !canEditObjects) return false;
      const prepared = await prepareImageForUpload(uri, {
        maxWidth: PHOTO_MAX_WIDTH,
        quality: PHOTO_COMPRESS_QUALITY,
      });
      const { publicUrl, displayUrl, mediaUrls, objectUpdatedAt } = await uploadObjectMediaPhoto(
        objectId,
        category,
        prepared.uri,
        PHOTO_MIME_TYPE,
      );
      const sourceUrl = String(publicUrl || '').trim();
      const resolvedUrl = String(displayUrl || '').trim();
      const optimisticDisplayUrl = String(prepared.uri || uri || '').trim();
      if (sourceUrl && (optimisticDisplayUrl || resolvedUrl)) {
        setResolvedObjectMediaUrls((prev) =>
          mergeObjectMediaUrlMapPreservingLocal(prev, { [sourceUrl]: optimisticDisplayUrl || resolvedUrl }),
        );
      }
      const nextMediaUrls = Array.isArray(mediaUrls)
        ? applyObjectMediaUrls(category, mediaUrls, objectUpdatedAt, { merge: true })
        : null;
      return { publicUrl: sourceUrl, mediaUrls: nextMediaUrls };
    },
    [objectId, canEditObjects, applyObjectMediaUrls],
  );

  const uploadLocalUri = React.useCallback(
    async (category, uri) => {
      const uploadResult = await uploadObjectMediaFile(category, uri);
      return !!uploadResult?.publicUrl;
    },
    [uploadObjectMediaFile],
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
      let uploadedUrls = [];
      try {
        const results = await runMediaUploadQueue(
          ids,
          async (item) => {
            const uploadResult = await uploadObjectMediaFile(category, item.uri);
            const publicUrl = String(uploadResult?.publicUrl || '').trim();
            if (!publicUrl) throw new Error(t('order_toast_upload_error'));
            return publicUrl;
          },
          { concurrency: 3 },
        );
        uploadedUrls = results
          .filter((result) => result.status === 'fulfilled' && result.value)
          .map((result) => String(result.value));
        if (uploadedUrls.length) {
          applyObjectMediaUrls(category, uploadedUrls, null, { merge: true });
        }
        uploadedCount = uploadedUrls.length;
      } catch (error) {
        await Promise.allSettled(uploadedUrls.map((url) => deleteObjectMediaPhotoByUrl(objectId, category, url)));
        console.warn('[object-media] batch commit failed', error);
      } finally {
        const pendingIds = new Set(ids.map((item) => item.id));
        setLocalPendingMap((prev) => ({
          ...prev,
          [category]: (prev?.[category] || []).filter((pending) => !pendingIds.has(pending.id)),
        }));
      }

      if (uploadedCount > 0) {
        if (uploadedCount === 1) {
          toast.success(t('order_toast_photo_uploaded'));
        } else {
          toast.success(t('order_toast_photos_uploaded').replace('{count}', String(uploadedCount)));
        }
      } else {
        toast.error(t('order_toast_upload_error'));
      }
    },
    [applyObjectMediaUrls, objectId, toast, t, uploadObjectMediaFile],
  );

  const removePhoto = React.useCallback(
    async (category, index) => {
      if (!objectId || !canEditObjects) return;
      const photos = Array.isArray(objectMediaRef.current?.[category]) ? objectMediaRef.current[category] : [];
      const removedUrl = String(photos[index] || '').trim();
      if (!removedUrl) return;

      const next = photos.filter((_, photoIndex) => photoIndex !== index);
      applyObjectMediaUrls(category, next);
      try {
        const result = await deleteObjectMediaPhotoByUrl(objectId, category, removedUrl);
        if (Array.isArray(result?.mediaUrls)) {
          applyObjectMediaUrls(category, result.mediaUrls, result.objectUpdatedAt);
        }
      } catch (error) {
        applyObjectMediaUrls(category, photos);
        throw error;
      }
    },
    [objectId, canEditObjects, applyObjectMediaUrls],
  );

  const removePhotosBatch = React.useCallback(
    async (category, urls = []) => {
      if (!objectId || !canEditObjects) return;
      const selected = new Set((urls || []).map((value) => String(value || '').trim()).filter(Boolean));
      if (!selected.size) return;

      const photos = Array.isArray(objectMediaRef.current?.[category]) ? objectMediaRef.current[category] : [];
      const next = photos.filter((value) => !selected.has(String(value || '').trim()));
      const removed = photos.filter((value) => selected.has(String(value || '').trim()));

      applyObjectMediaUrls(category, next);
      for (const url of removed) {
        try {
          const result = await deleteObjectMediaPhotoByUrl(objectId, category, url);
          if (Array.isArray(result?.mediaUrls)) {
            applyObjectMediaUrls(category, result.mediaUrls, result.objectUpdatedAt);
          }
        } catch (error) {
          console.warn('[object-media] delete failed', error);
        }
      }
    },
    [objectId, canEditObjects, applyObjectMediaUrls],
  );

  const openViewer = React.useCallback((photos, index, category, label) => {
    if (!Array.isArray(photos) || !photos.length) return;
    const pairs = photos
      .map((raw, originalIndex) => ({
        raw: String(raw || '').trim(),
        originalIndex,
        display: String(getObjectMediaDisplayUrl(raw) || '').trim(),
      }))
      .filter((item) => item.raw && item.display);
    if (!pairs.length) return;
    const nextIndex = pairs.findIndex((item) => item.originalIndex === index);
    viewerRawPhotosRef.current = pairs.map((item) => item.raw);
    viewerCategoryRef.current = category || null;
    setViewerCategoryLabel(label || '');
    setViewerPhotos(pairs.map((item) => item.display));
    setViewerIndex(nextIndex >= 0 ? nextIndex : Math.min(index, pairs.length - 1));
    setViewerVisible(true);
  }, [getObjectMediaDisplayUrl]);

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
            {objectItem?.photoThumbUrl || objectItem?.photoDisplayUrl || objectItem?.photoUrl ? (
              <ExpoImage
                source={{ uri: objectItem?.photoThumbUrl || objectItem?.photoDisplayUrl || objectItem?.photoUrl }}
                style={styles.avatarImg}
                contentFit="cover"
                cachePolicy="memory-disk"
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
          {showObjectName && objectItem?.is_primary ? <View style={base.sep} /> : null}
          {showObjectName && objectItem?.is_primary ? (
            <LabelValueRow
              label={t('objects_primary_client_flag')}
              value=""
              hideWhenEmpty={false}
            />
          ) : null}
          {(showObjectName || objectItem?.is_primary) && showClientRow ? <View style={base.sep} /> : null}
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
          {showObjectName || objectItem?.is_primary || showClientRow ? <View style={base.sep} /> : null}
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
              value={fullAddress || t('order_details_address_not_specified')}
              collapsedValue={shortAddress || fullAddress || t('order_details_address_not_specified')}
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
                  const count =
                    (Array.isArray(objectItem?.[row.key]) ? objectItem[row.key].length : 0) +
                    ((localPendingMap?.[row.key] || []).length || 0);
                  return (
                    <View key={row.key}>
                      {idx > 0 ? <View style={base.sep} /> : null}
                      <MediaUploadRow
                        label={row.label}
                        countLabel={t('order_photos_count').replace('{count}', String(count))}
                        onPress={() => setObjectPhotosModal({ visible: true, category: row.key })}
                        disabled={!canEditObjects && count === 0}
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
              cachePolicy="memory-disk"
            />
          ) : (
            <Text style={styles.previewEmpty}>{t('placeholder_no_photo')}</Text>
          )}
        </View>
      </BaseModal>

      <MediaUploadModal
        visible={objectPhotosModal.visible}
        onClose={() => setObjectPhotosModal({ visible: false, category: null })}
        category={objectPhotosModal.category}
        photos={Array.isArray(objectItem?.[objectPhotosModal.category]) ? objectItem[objectPhotosModal.category] : []}
        pending={localPendingMap?.[objectPhotosModal.category] || []}
        getDisplayUrl={getObjectMediaDisplayUrl}
        getThumbnailUrl={getObjectMediaThumbnailUrl}
        getIssue={() => ''}
        onUploadUri={handleUploadUri}
        onUploadMultiple={handleUploadMultiple}
        onRemove={removePhoto}
        onRemoveMany={removePhotosBatch}
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
