import { AntDesign, Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import React from 'react';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { BackHandler, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import AdditionalPhoneInputRow from '../../../components/clients/AdditionalPhoneInputRow';
import EditScreenTemplate, { useEditFormStyles } from '../../../components/layout/EditScreenTemplate';
import AvatarCropModal from '../../../components/ui/AvatarCropModal';
import UIButton from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import SectionHeader from '../../../components/ui/SectionHeader';
import TextField from '../../../components/ui/TextField';
import { BaseModal, ConfirmModal, SelectModal } from '../../../components/ui/modals';
import { useToast } from '../../../components/ui/ToastProvider';
import TagEditorField from '../../../components/tags/TagEditorField';
import { TAG_TYPE } from '../../../components/tags/tagConfig';
import { useCompanySettings } from '../../../hooks/useCompanySettings';
import { usePermissions } from '../../../lib/permissions';
import { FieldErrorText, FEEDBACK_CODES, getMessageByCode } from '../../../src/shared/feedback';
import {
  useClientObject,
  useDeleteClientObjectMutation,
  useUpdateClientObjectMutation,
} from '../../../src/features/objects/queries';
import { useClient } from '../../../src/features/clients/queries';
import { useEntityFieldSettings } from '../../../src/features/fieldSettings/queries';
import {
  ENTITY_FIELD_TYPES,
  buildFallbackEntityFieldSettings,
  getOrderedEntityFields,
  getEntityFieldMap,
} from '../../../src/features/fieldSettings/catalog';
import {
  CLIENT_OBJECT_ADDITIONAL_INFO_FIELDS,
  CLIENT_OBJECT_ADDRESS_FIELDS,
  CLIENT_OBJECT_PRIMARY_ADDRESS_FIELDS,
  createEmptyClientObjectDraft,
  sanitizeClientObjectPayload,
} from '../../../src/features/objects/addressing';
import {
  buildOrderAddressShort,
  extractOrderAddressFromObject,
  filterOrderAddressByObjectFieldSettings,
} from '../../../src/features/requests/addressing';
import {
  buildObjectAdditionalPhonesPatch,
  createEmptyAdditionalObjectPhones,
  getAddableAdditionalObjectPhoneSlotIds,
  getObjectAdditionalPhones,
  getVisibleAdditionalObjectPhoneSlotIds,
  OBJECT_ADDITIONAL_PHONE_SLOT_COUNT,
  resolveVisibleAdditionalObjectPhoneSlotIds,
} from '../../../src/features/objects/additionalPhones';
import { uploadClientObjectPhoto } from '../../../src/features/objects/photo';
import { uploadObjectMediaPhoto, deleteObjectMediaPhotoByUrl } from '../../../src/features/objects/media';
import { objectMediaStorage } from '../../../lib/objectMediaStorage';
import { cleanupProfileMediaEntity } from '../../../src/features/profileMedia/api';
import { useSetObjectTagsMutation } from '../../../src/features/tags/queries';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { getRequiredFieldLabel } from '../../../src/shared/forms/fieldValidation';
import { getRequiredTextFieldError } from '../../../src/shared/validation/fields';
import { hasMobilePhoneValue, isValidOptionalMobilePhone } from '../../../src/shared/validation/phone';
import { useTheme } from '../../../theme/ThemeProvider';
import { openCoordinatesInYandex } from '../../../components/ui/map';
import dismissToRoute from '../../../lib/navigation/dismissToRoute';
import OrderPhotosModal from '../../../app/orders/components/OrderPhotosModal';
import FullscreenImageViewer from '../../../app/orders/components/FullscreenImageViewer';
import { buildMediaAssetDisplayMap, buildMediaAssetThumbMap, listMediaAssets } from '../../../src/shared/media/assets';
import { getImagePickerMediaTypesImages, prepareImageForUpload, runMediaUploadQueue } from '../../../src/shared/media/imagePipeline';

const DEFAULT_OBJECT_INITIALS = 'OB';
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

function AvatarSheetModal({
  visible,
  hasPhoto,
  onTakePhoto,
  onPickFromLibrary,
  onDeletePhoto,
  onViewPhoto,
  onClose,
}) {
  const { t } = useTranslation();
  const { theme } = useTheme();

  const chevron = (color) => <Feather name="chevron-right" size={theme.icons?.sm ?? 18} color={color} />;
  const items = [
    { id: 'camera', label: t('profile_photo_take'), right: chevron(theme.colors.textSecondary) },
    { id: 'library', label: t('profile_photo_choose'), right: chevron(theme.colors.textSecondary) },
    ...(hasPhoto
      ? [
          { id: 'view', label: t('objects_photo_view'), right: chevron(theme.colors.textSecondary) },
          { id: 'delete', label: t('profile_photo_delete'), right: chevron(theme.colors.textSecondary) },
        ]
      : []),
  ];

  return (
    <SelectModal
      visible={visible}
      title={t('objects_photo_title')}
      items={items}
      searchable={false}
      onSelect={(item) => {
        try {
          if (item.id === 'camera') onTakePhoto?.();
          else if (item.id === 'library') onPickFromLibrary?.();
          else if (item.id === 'delete') onDeletePhoto?.();
          else if (item.id === 'view') onViewPhoto?.();
        } finally {
          onClose?.();
        }
      }}
      onClose={onClose}
    />
  );
}

function ObjectMediaEditRow({
  label,
  fallbackLabel,
  count,
  onChangeLabel,
  onOpen,
  onRemove,
  canRemove,
}) {
  const { theme } = useTheme();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(label || '');

  React.useEffect(() => {
    if (!editing) setValue(label || '');
  }, [editing, label]);

  const commit = React.useCallback(() => {
    const next = String(value || '').trim();
    onChangeLabel(next);
    setEditing(false);
  }, [onChangeLabel, value]);

  return (
    <View style={{ paddingVertical: theme.spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
        {editing ? (
          <TextInput
            value={value}
            onChangeText={(nextValue) => {
              setValue(nextValue);
              onChangeLabel(nextValue);
            }}
            onSubmitEditing={commit}
            returnKeyType="done"
            style={{
              flex: 1,
              minHeight: 36,
              color: theme.colors.text,
              fontSize: theme.typography.sizes.md,
              fontWeight: theme.typography.weight.medium,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.primary,
              paddingVertical: 0,
            }}
            placeholder={fallbackLabel}
            placeholderTextColor={theme.colors.textSecondary}
            autoFocus
          />
        ) : (
          <Pressable
            onPress={onOpen}
            style={{ flex: 1, minHeight: 36, justifyContent: 'center' }}
            accessibilityRole="button"
          >
            <Text
              style={{
                color: theme.colors.text,
                fontSize: theme.typography.sizes.md,
                fontWeight: theme.typography.weight.medium,
              }}
              numberOfLines={1}
            >
              {label || fallbackLabel}
            </Text>
          </Pressable>
        )}
        <Pressable
          onPress={editing ? commit : () => setEditing(true)}
          hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          style={{ minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' }}
          accessibilityRole="button"
        >
          <Feather
            name={editing ? 'check' : 'edit-2'}
            size={theme.icons?.sm ?? 18}
            color={theme.colors.textSecondary}
          />
        </Pressable>
        {canRemove ? (
          <Pressable
            onPress={onRemove}
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            style={{ minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' }}
            accessibilityRole="button"
          >
            <Feather name="trash-2" size={theme.icons?.sm ?? 18} color={theme.colors.danger || theme.colors.error} />
          </Pressable>
        ) : null}
      </View>
      <Pressable
        onPress={onOpen}
        style={{ minHeight: 28, justifyContent: 'center' }}
        accessibilityRole="button"
      >
        <Text style={{ color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm }}>
          {String(count)}
        </Text>
      </Pressable>
    </View>
  );
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

function snapshotObjectForm(obj = {}) {
  const additionalPhones = Array.isArray(obj.additionalPhones) ? obj.additionalPhones : [];
  const visibleSlots = Array.isArray(obj.additionalPhoneVisibleSlots)
    ? Array.from(
        new Set(
          obj.additionalPhoneVisibleSlots
            .map((slotId) => Number(slotId))
            .filter((slotId) => Number.isFinite(slotId))
            .map((slotId) => Math.trunc(slotId)),
        ),
      ).sort((a, b) => a - b)
    : getVisibleAdditionalObjectPhoneSlotIds(additionalPhones);
  return JSON.stringify({
    name: String(obj.name || '').trim() || '',
    photoUrl: String(obj.photoUrl || '').trim() || '',
    tags: Array.isArray(obj.tags) ? obj.tags.map((v) => String(v || '').trim().toLowerCase()) : [],
    additionalPhones,
    additionalPhoneVisibleSlots: visibleSlots,
    objectMediaSections: Array.isArray(obj.objectMediaSections)
      ? obj.objectMediaSections.map((field) => String(field || '').trim()).filter(Boolean).sort()
      : [],
    ...Object.fromEntries(
      OBJECT_MEDIA_FIELD_KEYS.map((field) => [`${field}_label`, String(obj[`${field}_label`] || '').trim() || '']),
    ),
    ...Object.fromEntries(
      CLIENT_OBJECT_ADDRESS_FIELDS.map((field) => [field, String(obj[field] || '').trim() || '']),
    ),
    geo_lat: String(obj.geo_lat || '').trim() || '',
    geo_lng: String(obj.geo_lng || '').trim() || '',
  });
}

function normalizeCoordinateValue(input) {
  const raw = String(input || '').trim().replace(',', '.');
  if (!raw) return '';
  const value = Number(raw);
  if (!Number.isFinite(value)) return '';
  return String(Math.round(value * 1_000_000) / 1_000_000);
}

function parseCoordinatesFromText(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const text = raw.replace(/,/g, '.');
  const matches = text.match(/-?\d+(?:\.\d+)?/g) || [];
  if (matches.length < 2) return null;
  const first = Number(matches[0]);
  const second = Number(matches[1]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;

  const inLatRange = (value) => value >= -90 && value <= 90;
  const inLngRange = (value) => value >= -180 && value <= 180;

  let lat = first;
  let lng = second;
  if (!inLatRange(lat) || !inLngRange(lng)) {
    lat = second;
    lng = first;
  }
  if (!inLatRange(lat) || !inLngRange(lng)) return null;
  return {
    lat: normalizeCoordinateValue(lat),
    lng: normalizeCoordinateValue(lng),
  };
}

function normalizeLocationMode(value, { fallback = 'address' } = {}) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'map') return 'map';
  if (mode === 'address') return 'address';
  return fallback === 'map' ? 'map' : 'address';
}

export default function EditObjectScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const router = useRouter();
  const navigation = useNavigation();
  const { has } = usePermissions();
  const params = useLocalSearchParams();
  const id = params?.id;
  const rawReturnTo = params?.returnTo;
  const rawReturnParams = params?.returnParams;
  const objectId = Array.isArray(id) ? id[0] : id;
  const returnTo = React.useMemo(() => {
    const value = Array.isArray(rawReturnTo) ? rawReturnTo[0] : rawReturnTo;
    return value ? String(value) : '';
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
  const canDeleteObjects = has('canDeleteObjects');
  const { data: objectItem } = useClientObject(objectId, { enabled: !!objectId && canViewObjects });
  const clientId = objectItem?.client_id;
  const { data: clientData } = useClient(clientId, { enabled: !!clientId && canViewClients });
  const updateMutation = useUpdateClientObjectMutation();
  const deleteMutation = useDeleteClientObjectMutation();
  const setObjectTagsMutation = useSetObjectTagsMutation();
  const { settings } = useCompanySettings();
  const { data: objectFieldSettingsData } = useEntityFieldSettings(ENTITY_FIELD_TYPES.OBJECT, {
    enabled: !!objectId,
  });

  const [draft, setDraft] = React.useState(createEmptyClientObjectDraft());
  const [additionalPhones, setAdditionalPhones] = React.useState(createEmptyAdditionalObjectPhones());
  const [visibleAdditionalPhoneSlots, setVisibleAdditionalPhoneSlots] = React.useState([]);
  const [tags, setTags] = React.useState([]);
  const [initialSnap, setInitialSnap] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [cancelVisible, setCancelVisible] = React.useState(false);
  const [deleteVisible, setDeleteVisible] = React.useState(false);
  const [avatarSheetVisible, setAvatarSheetVisible] = React.useState(false);
  const [cropVisible, setCropVisible] = React.useState(false);
  const [cropSrc, setCropSrc] = React.useState(null);
  const [photoPreviewVisible, setPhotoPreviewVisible] = React.useState(false);
  const [addressModalVisible, setAddressModalVisible] = React.useState(false);
  const [locationMode, setLocationMode] = React.useState('address');
  const [clipboardHasCoordinates, setClipboardHasCoordinates] = React.useState(false);
  const [avatarKey, setAvatarKey] = React.useState(0);
  const [fieldErrors, setFieldErrors] = React.useState({});
  const [objectMediaSections, setObjectMediaSections] = React.useState([]);
  const [objectPhotosModal, setObjectPhotosModal] = React.useState({ visible: false, category: null });
  const [localPendingMap, setLocalPendingMap] = React.useState({});
  const [resolvedObjectMediaUrls, setResolvedObjectMediaUrls] = React.useState({});
  const [objectMediaThumbUrls, setObjectMediaThumbUrls] = React.useState({});
  const [viewerVisible, setViewerVisible] = React.useState(false);
  const [viewerPhotos, setViewerPhotos] = React.useState([]);
  const [viewerIndex, setViewerIndex] = React.useState(0);
  const [viewerCategoryLabel, setViewerCategoryLabel] = React.useState('');
  const [removeMediaSection, setRemoveMediaSection] = React.useState(null);
  const allowLeaveRef = React.useRef(false);
  const objectMediaRef = React.useRef({});
  const initialObjectMediaSectionsRef = React.useRef([]);
  const viewerRawPhotosRef = React.useRef([]);
  const viewerCategoryRef = React.useRef(null);
  const formStyles = useEditFormStyles();
  const styles = React.useMemo(() => createStyles(theme, formStyles), [theme, formStyles]);
  const [addressLabelHeight, setAddressLabelHeight] = React.useState(0);
  const [addressValueHeight, setAddressValueHeight] = React.useState(0);
  const objectFieldSettings = React.useMemo(
    () => objectFieldSettingsData || buildFallbackEntityFieldSettings(ENTITY_FIELD_TYPES.OBJECT),
    [objectFieldSettingsData],
  );
  const objectFieldsByKey = React.useMemo(() => getEntityFieldMap(objectFieldSettings), [objectFieldSettings]);
  const hasPersistedObjectFieldValue = React.useCallback(
    (fieldKey) => String(objectItem?.[fieldKey] || '').trim().length > 0,
    [objectItem],
  );
  const visibleAddressFields = React.useMemo(
    () =>
      CLIENT_OBJECT_ADDRESS_FIELDS.filter(
        (field) =>
          objectFieldsByKey.get(field)?.isEnabled === true || hasPersistedObjectFieldValue(field),
      ),
    [hasPersistedObjectFieldValue, objectFieldsByKey],
  );
  const _visiblePrimaryAddressFields = React.useMemo(
    () =>
      CLIENT_OBJECT_PRIMARY_ADDRESS_FIELDS.filter(
        (field) => objectFieldsByKey.get(field)?.isEnabled === true,
      ),
    [objectFieldsByKey],
  );
  const visibleAdditionalInfoFields = React.useMemo(
    () =>
      CLIENT_OBJECT_ADDITIONAL_INFO_FIELDS.filter(
        (field) => objectFieldsByKey.get(field)?.isEnabled === true,
      ),
    [objectFieldsByKey],
  );
  const orderedPrimaryAddressFields = React.useMemo(
    () =>
      getOrderedEntityFields(objectFieldSettings, {
        visibleOnly: false,
        requiredFirst: true,
        fieldKeys: CLIENT_OBJECT_PRIMARY_ADDRESS_FIELDS,
      })
        .map((field) => field.fieldKey)
        .filter(
          (fieldKey) =>
            objectFieldsByKey.get(fieldKey)?.isEnabled === true ||
            hasPersistedObjectFieldValue(fieldKey),
        ),
    [hasPersistedObjectFieldValue, objectFieldSettings, objectFieldsByKey],
  );
  const orderedAdditionalInfoFields = React.useMemo(
    () =>
      getOrderedEntityFields(objectFieldSettings, {
        visibleOnly: true,
        requiredFirst: true,
        fieldKeys: CLIENT_OBJECT_ADDITIONAL_INFO_FIELDS,
      }).map((field) => field.fieldKey),
    [objectFieldSettings],
  );
  const enabledAdditionalPhoneSlots = React.useMemo(
    () => [1, 2, 3].filter((slotId) => objectFieldsByKey.get(`additional_phone_${slotId}`)?.isEnabled === true),
    [objectFieldsByKey],
  );
  const requiredAdditionalPhoneSlots = React.useMemo(
    () => [1, 2, 3].filter((slotId) => objectFieldsByKey.get(`additional_phone_${slotId}`)?.isRequired === true),
    [objectFieldsByKey],
  );
  const addableAdditionalPhoneSlots = React.useMemo(
    () => getAddableAdditionalObjectPhoneSlotIds(enabledAdditionalPhoneSlots, requiredAdditionalPhoneSlots),
    [enabledAdditionalPhoneSlots, requiredAdditionalPhoneSlots],
  );
  const orderedContactFieldKeys = React.useMemo(
    () =>
      getOrderedEntityFields(objectFieldSettings, {
        visibleOnly: true,
        requiredFirst: true,
        fieldKeys: ['additional_phone_1', 'additional_phone_2', 'additional_phone_3'],
      }).map((field) => field.fieldKey),
    [objectFieldSettings],
  );
  const enabledMediaFieldKeys = React.useMemo(
    () => OBJECT_MEDIA_FIELD_KEYS.filter((fieldKey) => objectFieldsByKey.get(fieldKey)?.isEnabled === true),
    [objectFieldsByKey],
  );
  const getObjectFieldLabel = React.useCallback(
    (fieldKey, fallbackLabel) => {
      const field = objectFieldsByKey.get(fieldKey);
      const customLabel = String(field?.customLabel || '').trim();
      if (customLabel) return customLabel;
      if (field?.labelKey) {
        return t(field.labelKey);
      }
      return fallbackLabel || String(fieldKey || '');
    },
    [objectFieldsByKey, t],
  );
  const canShowContactSection = orderedContactFieldKeys.length > 0;
  const withRequiredLabel = React.useCallback(
    (field, label) => getRequiredFieldLabel(label, objectFieldsByKey.get(field)?.isRequired === true),
    [objectFieldsByKey],
  );
  const chevronIconSize = theme.icons?.sm ?? 18;
  const chevronMarginTop = Math.max(0, Math.round(addressLabelHeight + (addressValueHeight - chevronIconSize) / 2));
  const photoDisplayUrl = React.useMemo(
    () =>
      /^https?:\/\//i.test(String(draft.photoUrl || ''))
        ? objectItem?.photoDisplayUrl || draft.photoUrl
        : draft.photoUrl,
    [draft.photoUrl, objectItem?.photoDisplayUrl],
  );
  const photoAvatarUrl = React.useMemo(
    () =>
      /^https?:\/\//i.test(String(draft.photoUrl || ''))
        ? objectItem?.photoThumbUrl || photoDisplayUrl
        : photoDisplayUrl,
    [draft.photoUrl, objectItem?.photoThumbUrl, photoDisplayUrl],
  );
  const mapLat = React.useMemo(
    () => normalizeCoordinateValue(draft?.geo_lat),
    [draft?.geo_lat],
  );
  const mapLng = React.useMemo(
    () => normalizeCoordinateValue(draft?.geo_lng),
    [draft?.geo_lng],
  );
  const hasMapPoint = React.useMemo(
    () => !!mapLat && !!mapLng,
    [mapLat, mapLng],
  );
  const isMapLocationMode = locationMode === 'map';
  const visibleAddressSummary = React.useMemo(
    () =>
      buildOrderAddressShort(
        filterOrderAddressByObjectFieldSettings(
          extractOrderAddressFromObject(draft),
          objectFieldsByKey,
          { preserveFilledDisabled: true },
        ),
      ),
    [draft, objectFieldsByKey],
  );

  const cameraIconSize = React.useMemo(() => {
    const iconSm = theme.icons?.sm ?? 18;
    return Math.max(theme.icons?.minCamera ?? 12, Math.round(iconSm * (theme.icons?.cameraRatio ?? 0.67)));
  }, [theme]);
  const mediaTypesOpt = React.useMemo(() => getImagePickerMediaTypesImages(), []);
  const mediaAspect = React.useMemo(
    () => (Array.isArray(theme.media?.aspect) ? theme.media.aspect : [1, 1]),
    [theme.media?.aspect],
  );
  const mediaQuality = React.useMemo(
    () => (typeof theme.media?.quality === 'number' ? theme.media.quality : 0.85),
    [theme.media?.quality],
  );

  React.useEffect(() => {
    if (!objectItem) return;
    const nextAdditionalPhones = getObjectAdditionalPhones(objectItem);
    const nextVisibleSlots = resolveVisibleAdditionalObjectPhoneSlotIds({
      enabledSlotIds: enabledAdditionalPhoneSlots,
      requiredSlotIds: requiredAdditionalPhoneSlots,
      valueVisibleSlotIds: getVisibleAdditionalObjectPhoneSlotIds(nextAdditionalPhones),
    });
    const next = createEmptyClientObjectDraft({
      name: objectItem.name || t('objects_new'),
      photoUrl: objectItem.photoUrl || '',
      ...Object.fromEntries(CLIENT_OBJECT_ADDRESS_FIELDS.map((field) => [field, objectItem[field] || ''])),
      ...Object.fromEntries(OBJECT_MEDIA_FIELD_KEYS.map((field) => [`${field}_label`, objectItem?.[`${field}_label`] || ''])),
      geo_lat: objectItem?.geo_lat || '',
      geo_lng: objectItem?.geo_lng || '',
    });
    const nextTags = Array.isArray(objectItem?.tags) ? objectItem.tags.map((tag) => String(tag?.value || '').trim()) : [];
    const nextMedia = {};
    OBJECT_MEDIA_FIELD_KEYS.forEach((fieldKey) => {
      nextMedia[fieldKey] = Array.isArray(objectItem?.[fieldKey]) ? objectItem[fieldKey] : [];
    });
    objectMediaRef.current = nextMedia;
    const explicitMediaSections = Array.isArray(objectItem?.mediaSections) ? objectItem.mediaSections : null;
    const nextMediaSections = explicitMediaSections
      ? OBJECT_MEDIA_FIELD_KEYS.filter(
          (fieldKey) => explicitMediaSections.includes(fieldKey) || nextMedia[fieldKey].length > 0,
        )
      : OBJECT_MEDIA_FIELD_KEYS.filter((fieldKey) => {
          const hasPhotos = nextMedia[fieldKey].length > 0;
          const isEnabled = enabledMediaFieldKeys.includes(fieldKey);
          return isEnabled || hasPhotos;
        });
    setDraft(next);
    setAdditionalPhones(nextAdditionalPhones);
    setVisibleAdditionalPhoneSlots(nextVisibleSlots);
    setObjectMediaSections(nextMediaSections);
    initialObjectMediaSectionsRef.current = nextMediaSections;
    setTags(nextTags);
    setLocationMode(
      normalizeLocationMode(objectItem?.location_mode, {
        fallback:
          String(next.geo_lat || '').trim() || String(next.geo_lng || '').trim() ? 'map' : 'address',
      }),
    );
    setInitialSnap(
      snapshotObjectForm({
        ...next,
        tags: nextTags,
        additionalPhones: nextAdditionalPhones,
        additionalPhoneVisibleSlots: nextVisibleSlots,
        objectMediaSections: nextMediaSections,
      }),
    );
  }, [enabledAdditionalPhoneSlots, enabledMediaFieldKeys, objectItem, requiredAdditionalPhoneSlots, t]);

  React.useEffect(() => {
    setVisibleAdditionalPhoneSlots((prev) =>
      resolveVisibleAdditionalObjectPhoneSlotIds({
        enabledSlotIds: enabledAdditionalPhoneSlots,
        requiredSlotIds: requiredAdditionalPhoneSlots,
        explicitVisibleSlotIds: prev,
        valueVisibleSlotIds: getVisibleAdditionalObjectPhoneSlotIds(additionalPhones),
      }),
    );
  }, [additionalPhones, enabledAdditionalPhoneSlots, requiredAdditionalPhoneSlots]);

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
        if (!cancelled) setObjectMediaThumbUrls(buildMediaAssetThumbMap(assets));
      } catch {}
      for (const category of OBJECT_MEDIA_FIELD_KEYS) {
        const urls = Array.isArray(objectMediaRef.current?.[category])
          ? objectMediaRef.current[category].map((value) => String(value || '').trim()).filter(Boolean)
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
      if (!cancelled) setResolvedObjectMediaUrls(nextResolved);
    };

    run().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [objectId, objectItem]);

  React.useEffect(() => {
    if (!addressModalVisible || locationMode !== 'map') {
      setClipboardHasCoordinates(false);
      return undefined;
    }

    let disposed = false;
    const checkClipboard = async () => {
      try {
        const value = await Clipboard.getStringAsync();
        if (disposed) return;
        setClipboardHasCoordinates(!!parseCoordinatesFromText(value));
      } catch {
        if (!disposed) setClipboardHasCoordinates(false);
      }
    };

    checkClipboard();
    const timer = setInterval(checkClipboard, theme.timing?.clipboardPollMs ?? 1200);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [addressModalVisible, locationMode, theme.timing?.clipboardPollMs]);

  const isDirty = React.useMemo(() => {
    if (!initialSnap) return false;
    return snapshotObjectForm({
      ...draft,
      tags,
      additionalPhones,
      additionalPhoneVisibleSlots: visibleAdditionalPhoneSlots,
      objectMediaSections,
    }) !== initialSnap;
  }, [additionalPhones, draft, initialSnap, objectMediaSections, tags, visibleAdditionalPhoneSlots]);

  const goBack = React.useCallback(() => {
    allowLeaveRef.current = true;
    if (
      navigation &&
      typeof navigation.canGoBack === 'function' &&
      navigation.canGoBack() &&
      typeof navigation.goBack === 'function'
    ) {
      navigation.goBack();
      return;
    }
    if (returnTo) {
      dismissToRoute(router, {
        pathname: returnTo,
        params: returnParams,
      });
      return;
    }
    if (objectId) {
      dismissToRoute(router, `/objects/${objectId}`);
      return;
    }
    router.back();
  }, [navigation, objectId, returnParams, returnTo, router]);
  const goAfterDelete = React.useCallback(() => {
    allowLeaveRef.current = true;
    if (returnTo) {
      dismissToRoute(router, {
        pathname: returnTo,
        params: returnParams,
      });
      return;
    }
    if (objectItem?.client_id) {
      dismissToRoute(router, `/clients/${objectItem.client_id}`);
      return;
    }
    dismissToRoute(router, '/objects');
  }, [objectItem?.client_id, returnParams, returnTo, router]);

  const openAddressModal = React.useCallback(() => {
    setAddressModalVisible(true);
  }, []);

  React.useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (event) => {
      if (allowLeaveRef.current || !isDirty) return;
      event.preventDefault();
      setCancelVisible(true);
    });
    return sub;
  }, [isDirty, navigation]);

  useFocusEffect(
    React.useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (allowLeaveRef.current || !isDirty) return false;
        setCancelVisible(true);
        return true;
      });
      return () => sub.remove();
    }, [isDirty]),
  );

  const ensureCameraPerms = React.useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    return status === 'granted';
  }, []);

  const ensureLibraryPerms = React.useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    return status === 'granted';
  }, []);

  const pickFromCamera = React.useCallback(async () => {
    const ok = await ensureCameraPerms();
    if (!ok) {
      toast.warning(t('error_camera_denied'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      aspect: mediaAspect,
      quality: mediaQuality,
      mediaTypes: mediaTypesOpt,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      setCropSrc(result.assets[0].uri);
      setCropVisible(true);
    }
  }, [ensureCameraPerms, mediaAspect, mediaQuality, mediaTypesOpt, t, toast]);

  const pickFromLibrary = React.useCallback(async () => {
    const ok = await ensureLibraryPerms();
    if (!ok) {
      toast.warning(t('error_library_denied'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      aspect: mediaAspect,
      quality: mediaQuality,
      selectionLimit: 1,
      mediaTypes: mediaTypesOpt,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      setCropSrc(result.assets[0].uri);
      setCropVisible(true);
    }
  }, [ensureLibraryPerms, mediaAspect, mediaQuality, mediaTypesOpt, t, toast]);

  const openMapForPoint = React.useCallback(async () => {
    try {
      if (hasMapPoint) {
        openCoordinatesInYandex(mapLat, mapLng);
      } else {
        await Linking.openURL('https://yandex.ru/maps/');
      }
    } catch {}
  }, [hasMapPoint, mapLat, mapLng]);

  const showClipboardEmptyFeedback = React.useCallback(() => {
    const message = t('objects_location_clipboard_empty');
    toast.warning(message);
  }, [t, toast]);

  const pasteCoordinatesFromClipboard = React.useCallback(async () => {
    if (!clipboardHasCoordinates) {
      showClipboardEmptyFeedback();
      return;
    }
    try {
      const value = await Clipboard.getStringAsync();
      const parsed = parseCoordinatesFromText(value);
      if (!parsed) {
        showClipboardEmptyFeedback();
        return;
      }
      setDraft((prev) => ({ ...prev, geo_lat: parsed.lat, geo_lng: parsed.lng }));
      setLocationMode('map');
      toast.success(t('objects_location_point_set'));
    } catch {
      toast.error(t('objects_location_clipboard_fail'));
    }
  }, [clipboardHasCoordinates, showClipboardEmptyFeedback, t, toast]);

  const clearMapPoint = React.useCallback(() => {
    setDraft((prev) => ({ ...prev, geo_lat: '', geo_lng: '' }));
  }, []);

  const onCropCancel = React.useCallback(() => {
    setCropVisible(false);
    setCropSrc(null);
  }, []);

  const onCropConfirm = React.useCallback((croppedUri) => {
    setCropVisible(false);
    setCropSrc(null);
    setDraft((prev) => ({ ...prev, photoUrl: croppedUri }));
  }, []);

  const saveObject = React.useCallback(async () => {
    if (!objectId || saving || !canEditObjects) return;
    const nextFieldErrors = ['name', ...visibleAddressFields, ...visibleAdditionalInfoFields].reduce((acc, field) => {
      const requiredByField = objectFieldsByKey.get(field)?.isRequired === true;
      const shouldRelaxAddressRequired =
        locationMode === 'map' && hasMapPoint && visibleAddressFields.includes(field);
      const message = getRequiredTextFieldError(draft?.[field], {
        required: shouldRelaxAddressRequired ? false : requiredByField,
        requiredMessage: getMessageByCode(FEEDBACK_CODES.REQUIRED_FIELD, t),
      });
      if (!message) return acc;
      return { ...acc, [field]: message };
    }, {});
    const firstInvalidAdditional = visibleAdditionalPhoneSlots.find((slotId) => {
      const slotIndex = Number(slotId) - 1;
      const value = additionalPhones?.[slotIndex]?.phone || '';
      if (requiredAdditionalPhoneSlots.includes(slotId) && !hasMobilePhoneValue(value)) return true;
      return hasMobilePhoneValue(value) && !isValidOptionalMobilePhone(value);
    });
    if (firstInvalidAdditional) {
      nextFieldErrors[`additional_phone_${firstInvalidAdditional}`] = t('err_phone');
    }
    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) {
      return;
    }
    setSaving(true);
    try {
      const cleanPatch = sanitizeClientObjectPayload(draft, { nameRequired: false });
      const visibleMediaSet = new Set(objectMediaSections);
      const mediaSectionsChanged =
        JSON.stringify([...objectMediaSections].sort()) !==
        JSON.stringify([...(initialObjectMediaSectionsRef.current || [])].sort());
      const mediaSectionPatch = {};
      const removedMediaUrlsByField = {};
      if (mediaSectionsChanged) {
        OBJECT_MEDIA_FIELD_KEYS.forEach((fieldKey) => {
          if (visibleMediaSet.has(fieldKey)) return;
          mediaSectionPatch[fieldKey] = [];
          mediaSectionPatch[`${fieldKey}_label`] = null;
          removedMediaUrlsByField[fieldKey] = Array.isArray(objectMediaRef.current?.[fieldKey])
            ? objectMediaRef.current[fieldKey].map((value) => String(value || '').trim()).filter(Boolean)
            : [];
        });
        mediaSectionPatch.media_sections = objectMediaSections;
      }
      const currentPhotoUrl = String(draft.photoUrl || '').trim();
      let persistedPhotoUrl = String(objectItem?.photoUrl || '').trim() || null;

      if (!currentPhotoUrl) {
        if (persistedPhotoUrl) {
          await cleanupProfileMediaEntity('object', String(objectId));
        }
        persistedPhotoUrl = null;
      } else if (/^https?:\/\//i.test(currentPhotoUrl)) {
        persistedPhotoUrl = currentPhotoUrl;
      } else {
        persistedPhotoUrl = await uploadClientObjectPhoto(String(objectId), currentPhotoUrl);
      }

      await updateMutation.mutateAsync({
        id: String(objectId),
        patch: {
          ...cleanPatch,
          geo_lat: mapLat || null,
          geo_lng: mapLng || null,
          location_mode: normalizeLocationMode(locationMode, { fallback: hasMapPoint ? 'map' : 'address' }),
          ...buildObjectAdditionalPhonesPatch(additionalPhones, {
            defaultLabel: t('order_field_secondary_phone'),
            visibleSlotIds: visibleAdditionalPhoneSlots,
            hiddenSource: getObjectAdditionalPhones(objectItem),
            preserveHidden: true,
          }),
          ...mediaSectionPatch,
          photo_url: persistedPhotoUrl,
        },
      });

      for (const [fieldKey, urls] of Object.entries(removedMediaUrlsByField)) {
        objectMediaRef.current = { ...objectMediaRef.current, [fieldKey]: [] };
        for (const url of urls) {
          try {
            await deleteObjectMediaPhotoByUrl(objectId, fieldKey, url);
          } catch {}
        }
      }

      if (settings?.enable_object_tags) {
        await setObjectTagsMutation.mutateAsync({
          objectId: String(objectId),
          tags,
        });
      }

      toast.success(t('objects_saved'));
      goBack();
    } catch (error) {
      toast.error(error?.message || t('clients_save_failed'));
    } finally {
      setSaving(false);
    }
  }, [additionalPhones, canEditObjects, draft, goBack, hasMapPoint, locationMode, mapLat, mapLng, objectFieldsByKey, objectId, objectItem, objectMediaSections, requiredAdditionalPhoneSlots, saving, setObjectTagsMutation, settings?.enable_object_tags, t, tags, toast, updateMutation, visibleAdditionalInfoFields, visibleAdditionalPhoneSlots, visibleAddressFields]);

  const hiddenEnabledAdditionalPhoneSlots = React.useMemo(
    () => addableAdditionalPhoneSlots.filter((slotId) => !visibleAdditionalPhoneSlots.includes(slotId)),
    [addableAdditionalPhoneSlots, visibleAdditionalPhoneSlots],
  );
  const canAddAdditionalPhone =
    hiddenEnabledAdditionalPhoneSlots.length > 0 &&
    visibleAdditionalPhoneSlots.length < OBJECT_ADDITIONAL_PHONE_SLOT_COUNT;
  const updateAdditionalPhoneBySlotId = React.useCallback((slotId, patch) => {
    const slotIndex = Number(slotId) - 1;
    if (!Number.isFinite(slotIndex) || slotIndex < 0) return;
    setAdditionalPhones((prev) =>
      prev.map((item, itemIndex) => (itemIndex === slotIndex ? { ...item, ...patch } : item)),
    );
  }, []);

  const availableMediaFieldKeys = React.useMemo(
    () => enabledMediaFieldKeys,
    [enabledMediaFieldKeys],
  );
  const hiddenMediaFieldKeys = React.useMemo(
    () => availableMediaFieldKeys.filter((fieldKey) => !objectMediaSections.includes(fieldKey)),
    [availableMediaFieldKeys, objectMediaSections],
  );
  const canAddMediaSection = hiddenMediaFieldKeys.length > 0;
  const getMediaFallbackLabel = React.useCallback(
    (fieldKey) => {
      const index = OBJECT_MEDIA_FIELD_KEYS.indexOf(fieldKey);
      if (index < 0) return String(fieldKey || '');
      return getObjectFieldLabel(
        fieldKey,
        t(`object_media_field_${index + 1}`),
      );
    },
    [getObjectFieldLabel, t],
  );
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
  const changeMediaLabel = React.useCallback((fieldKey, label) => {
    setDraft((prev) => ({ ...prev, [`${fieldKey}_label`]: String(label || '').trim() }));
  }, []);
  const addMediaSection = React.useCallback(() => {
    const nextField = hiddenMediaFieldKeys[0];
    if (!nextField) return;
    setObjectMediaSections((prev) => [...prev, nextField].sort(
      (a, b) => OBJECT_MEDIA_FIELD_KEYS.indexOf(a) - OBJECT_MEDIA_FIELD_KEYS.indexOf(b),
    ));
    setDraft((prev) => ({
      ...prev,
      [`${nextField}_label`]: String(prev?.[`${nextField}_label`] || '').trim() || getMediaFallbackLabel(nextField),
    }));
  }, [getMediaFallbackLabel, hiddenMediaFieldKeys]);
  const clearMediaSectionLocal = React.useCallback((fieldKey) => {
    setObjectMediaSections((prev) => prev.filter((value) => value !== fieldKey));
    setDraft((prev) => ({ ...prev, [`${fieldKey}_label`]: '' }));
  }, []);
  const uploadObjectMediaFile = React.useCallback(
    async (category, uri) => {
      if (!objectId || !canEditObjects) return false;
      const prepared = await prepareImageForUpload(uri, {
        maxWidth: PHOTO_MAX_WIDTH,
        quality: PHOTO_COMPRESS_QUALITY,
      });
      const { publicUrl, displayUrl } = await uploadObjectMediaPhoto(objectId, category, prepared.uri, PHOTO_MIME_TYPE);
      const sourceUrl = String(publicUrl || '').trim();
      const resolvedUrl = String(displayUrl || '').trim();
      if (sourceUrl && resolvedUrl) {
        setResolvedObjectMediaUrls((prev) => ({ ...prev, [sourceUrl]: resolvedUrl }));
      }
      return sourceUrl;
    },
    [canEditObjects, objectId],
  );

  const commitObjectMediaUrls = React.useCallback(
    async (category, urls = []) => {
      const uploadedUrls = (Array.isArray(urls) ? urls : []).map((value) => String(value || '').trim()).filter(Boolean);
      if (!objectId || !canEditObjects || !uploadedUrls.length) return false;
      const current = Array.isArray(objectMediaRef.current?.[category]) ? objectMediaRef.current[category] : [];
      const uploadedSet = new Set(uploadedUrls);
      const next = [...uploadedUrls, ...current.filter((value) => !uploadedSet.has(String(value || '')))];
      const updated = await updateMutation.mutateAsync({
        id: objectId,
        patch: { [category]: next },
      });
      objectMediaRef.current = {
        ...objectMediaRef.current,
        [category]: Array.isArray(updated?.[category]) ? updated[category] : next,
      };
      setObjectMediaSections((prev) => (prev.includes(category) ? prev : [...prev, category]));
      return true;
    },
    [canEditObjects, objectId, updateMutation],
  );

  const uploadLocalMediaUri = React.useCallback(
    async (category, uri) => {
      const publicUrl = await uploadObjectMediaFile(category, uri);
      if (!publicUrl) return false;
      return commitObjectMediaUrls(category, [publicUrl]);
    },
    [commitObjectMediaUrls, uploadObjectMediaFile],
  );
  const handleUploadUri = React.useCallback(
    async (category, uri) => {
      const pendingId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setLocalPendingMap((prev) => ({
        ...prev,
        [category]: [...(prev?.[category] || []), { id: pendingId, uri }],
      }));
      try {
        await uploadLocalMediaUri(category, uri);
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
    [t, toast, uploadLocalMediaUri],
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
            const publicUrl = await uploadObjectMediaFile(category, item.uri);
            if (!publicUrl) throw new Error(t('order_toast_upload_error'));
            return publicUrl;
          },
          { concurrency: 3 },
        );
        uploadedUrls = results
          .filter((result) => result.status === 'fulfilled' && result.value)
          .map((result) => String(result.value));
        if (uploadedUrls.length) await commitObjectMediaUrls(category, uploadedUrls);
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
        toast.success(
          uploadedCount === 1
            ? t('order_toast_photo_uploaded')
            : t('order_toast_photos_uploaded').replace('{count}', String(uploadedCount)),
        );
      } else {
        toast.error(t('order_toast_upload_error'));
      }
    },
    [commitObjectMediaUrls, objectId, t, toast, uploadObjectMediaFile],
  );
  const removePhoto = React.useCallback(
    async (category, index) => {
      if (!objectId || !canEditObjects) return;
      const photos = Array.isArray(objectMediaRef.current?.[category]) ? objectMediaRef.current[category] : [];
      const removedUrl = String(photos[index] || '').trim();
      if (!removedUrl) return;
      const next = photos.filter((_, photoIndex) => photoIndex !== index);
      const updated = await updateMutation.mutateAsync({
        id: objectId,
        patch: { [category]: next },
      });
      objectMediaRef.current = {
        ...objectMediaRef.current,
        [category]: Array.isArray(updated?.[category]) ? updated[category] : next,
      };
      try {
        await deleteObjectMediaPhotoByUrl(objectId, category, removedUrl);
      } catch {}
    },
    [canEditObjects, objectId, updateMutation],
  );
  const removePhotosBatch = React.useCallback(
    async (category, urls = []) => {
      if (!objectId || !canEditObjects) return;
      const selected = new Set((urls || []).map((value) => String(value || '').trim()).filter(Boolean));
      if (!selected.size) return;
      const photos = Array.isArray(objectMediaRef.current?.[category]) ? objectMediaRef.current[category] : [];
      const next = photos.filter((value) => !selected.has(String(value || '').trim()));
      const removed = photos.filter((value) => selected.has(String(value || '').trim()));
      const updated = await updateMutation.mutateAsync({
        id: objectId,
        patch: { [category]: next },
      });
      objectMediaRef.current = {
        ...objectMediaRef.current,
        [category]: Array.isArray(updated?.[category]) ? updated[category] : next,
      };
      for (const url of removed) {
        try {
          await deleteObjectMediaPhotoByUrl(objectId, category, url);
        } catch {}
      }
    },
    [canEditObjects, objectId, updateMutation],
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
  const removeMediaSectionNow = React.useCallback(
    async (fieldKey) => {
      const photos = Array.isArray(objectMediaRef.current?.[fieldKey]) ? objectMediaRef.current[fieldKey] : [];
      if (photos.length) {
        setRemoveMediaSection(fieldKey);
        return;
      }
      clearMediaSectionLocal(fieldKey);
    },
    [clearMediaSectionLocal],
  );

  if (!canViewObjects) {
    return (
      <EditScreenTemplate title={t('routes_objects_edit')}>
        <View style={styles.blockedWrap}>
          <Text style={styles.blockedText}>{t('objects_no_view_permission')}</Text>
        </View>
      </EditScreenTemplate>
    );
  }

  if (!canEditObjects) {
    return (
      <EditScreenTemplate title={t('routes_objects_edit')}>
        <View style={styles.blockedWrap}>
          <Text style={styles.blockedText}>{t('objects_no_edit_permission')}</Text>
        </View>
      </EditScreenTemplate>
    );
  }

  return (
    <>
      <EditScreenTemplate
        title={t('routes_objects_edit')}
        rightTextLabel={saving ? t('toast_saving') : t('header_save')}
        onRightPress={saveObject}
        onBack={() => {
          if (isDirty) {
            setCancelVisible(true);
            return;
          }
          goBack();
        }}
      >
        <Card style={styles.headerCard}>
          <View style={styles.headerRow}>
            <Pressable
              style={styles.avatar}
              onPress={() => {
                setAvatarKey((value) => value + 1);
                setAvatarSheetVisible(true);
              }}
              accessibilityRole="button"
              accessibilityLabel={t('a11y_change_object_photo')}
              accessibilityHint={t('a11y_change_object_photo_hint')}
            >
              {photoAvatarUrl ? (
                <ExpoImage
                  source={{ uri: photoAvatarUrl }}
                  style={styles.avatarImg}
                  contentFit="cover"
                  cachePolicy="none"
                />
              ) : (
                <Text style={styles.avatarText}>{getObjectInitials(draft.name)}</Text>
              )}
              <View style={styles.avatarCamBadge}>
                <AntDesign name="camera" size={cameraIconSize} color={theme.colors.onPrimary} />
              </View>
            </Pressable>

            <View style={styles.headerTextWrap}>
              <Text style={styles.nameTitle} numberOfLines={2} ellipsizeMode="tail">
                {draft.name || t('objects_unnamed')}
              </Text>
              <Text style={styles.clientName} numberOfLines={2} ellipsizeMode="tail">
                {`${t('routes_clients_client')}: ${clientData?.full_name || objectItem?.client?.full_name || '-'}`}
              </Text>
            </View>
          </View>
        </Card>

        <SectionHeader topSpacing="xs">{t('section_general')}</SectionHeader>
        <Card paddedXOnly>
          <TextField
            label={withRequiredLabel('name', t('objects_field_name'))}
            value={draft.name}
            onChangeText={(value) => {
              setDraft((prev) => ({ ...prev, name: value }));
              setFieldErrors((prev) => (prev?.name ? { ...prev, name: null } : prev));
            }}
            error={fieldErrors?.name ? 'invalid' : undefined}
            style={styles.field}
          />
          <FieldErrorText message={fieldErrors?.name || null} />
          <View style={styles.field}>
            <Pressable
              style={styles.addressRow}
              onPress={openAddressModal}
              accessibilityRole="button"
            >
              <View style={styles.addressTextWrap}>
                <Text
                  style={styles.fieldLabel}
                  onLayout={(e) => setAddressLabelHeight(Math.round(e.nativeEvent.layout.height))}
                >
                  {isMapLocationMode ? t('objects_location_coordinates') : t('order_details_address')}
                </Text>
                <Text
                  style={styles.addressValue}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  onLayout={(e) => setAddressValueHeight(Math.round(e.nativeEvent.layout.height))}
                >
                  {isMapLocationMode
                    ? (hasMapPoint ? `${mapLat}, ${mapLng}` : t('objects_location_empty'))
                    : (visibleAddressSummary || t('order_details_address_not_specified'))}
                </Text>
              </View>
              {!isMapLocationMode ? (
                <View style={[styles.chevronWrap, { marginTop: chevronMarginTop }]}>
                  <Feather name="chevron-right" size={chevronIconSize} color={theme.colors.textSecondary} />
                </View>
              ) : null}
            </Pressable>
          </View>
          {settings?.enable_object_tags ? (
            <TagEditorField
              label={t('tags_field_label')}
              tagType={TAG_TYPE.OBJECT}
              tags={tags}
              onChange={setTags}
              placeholder={t('tags_input_placeholder')}
            />
          ) : null}
        </Card>

        {visibleAdditionalInfoFields.length ? (
          <>
            <SectionHeader>{t('objects_additional_info_section')}</SectionHeader>
            <Card paddedXOnly>
              {orderedAdditionalInfoFields.map((field) => (
                <React.Fragment key={field}>
                  <TextField
                    label={withRequiredLabel(field, t(`order_field_${field}`))}
                    value={String(draft[field] || '')}
                    onChangeText={(value) => {
                      setDraft((prev) => ({ ...prev, [field]: value }));
                      setFieldErrors((prev) => (prev?.[field] ? { ...prev, [field]: null } : prev));
                    }}
                    multiline={field === 'comment'}
                    minLines={field === 'comment' ? 2 : undefined}
                    error={fieldErrors?.[field] ? 'invalid' : undefined}
                    style={styles.field}
                  />
                  <FieldErrorText message={fieldErrors?.[field] || null} />
                </React.Fragment>
              ))}
            </Card>
          </>
        ) : null}
        {canShowContactSection ? (
          <>
            <SectionHeader>{t('clients_contacts_section')}</SectionHeader>
            <Card paddedXOnly>
              {visibleAdditionalPhoneSlots.filter((slotId) => orderedContactFieldKeys.includes(`additional_phone_${slotId}`)).map((slotId) => {
                const slotIndex = slotId - 1;
                const entry = additionalPhones[slotIndex] || { phone: '', label: '' };
                return (
                  <AdditionalPhoneInputRow
                    key={`additional-phone-${slotId}`}
                    phoneValue={entry.phone || ''}
                    onPhoneChange={(nextValue) => {
                      updateAdditionalPhoneBySlotId(slotId, { phone: nextValue });
                      setFieldErrors((prev) => ({ ...prev, [`additional_phone_${slotId}`]: null }));
                    }}
                    designationValue={entry.label || ''}
                    onDesignationChange={(nextValue) => updateAdditionalPhoneBySlotId(slotId, { label: nextValue })}
                    phoneRequired={requiredAdditionalPhoneSlots.includes(slotId)}
                    phoneError={
                      fieldErrors?.[`additional_phone_${slotId}`] ||
                      (requiredAdditionalPhoneSlots.includes(slotId) && !hasMobilePhoneValue(entry.phone || '')
                        ? t('clients_required_phone')
                        : hasMobilePhoneValue(entry.phone || '') && !isValidOptionalMobilePhone(entry.phone || '')
                          ? t('err_phone')
                          : null)
                    }
                    onRemove={requiredAdditionalPhoneSlots.includes(slotId) ? undefined : () => {
                      setVisibleAdditionalPhoneSlots((prev) => prev.filter((value) => value !== slotId));
                    }}
                    style={styles.additionalPhoneGroup}
                  />
                );
              })}
              {canAddAdditionalPhone ? (
                <View style={styles.additionalPhoneAddRow}>
                  <Text style={styles.additionalPhoneAddText}>{t('clients_additional_phone_add')}</Text>
                  <Pressable
                    onPress={() => {
                      const nextSlotId = hiddenEnabledAdditionalPhoneSlots[0] || null;
                      if (!nextSlotId) return;
                      setVisibleAdditionalPhoneSlots((prev) => [...prev, nextSlotId].sort((a, b) => a - b));
                    }}
                    style={styles.additionalPhoneAddButton}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={t('clients_additional_phone_a11y_add')}
                  >
                    <Feather
                      name="plus"
                      size={theme.components?.icon?.sizeXs ?? Math.round((theme.icons?.sm ?? 18) * 0.75)}
                      color={theme.colors.textSecondary}
                    />
                  </Pressable>
                </View>
              ) : null}
            </Card>
          </>
        ) : null}

        {objectMediaSections.length || canAddMediaSection ? (
          <>
            <SectionHeader>{t('order_details_photos_section')}</SectionHeader>
            <Card paddedXOnly>
              {objectMediaSections.map((fieldKey, index) => {
                const photos = Array.isArray(objectMediaRef.current?.[fieldKey]) ? objectMediaRef.current[fieldKey] : [];
                const pending = localPendingMap?.[fieldKey] || [];
                const count = photos.length + pending.length;
                const fallbackLabel = getMediaFallbackLabel(fieldKey);
                const label = String(draft?.[`${fieldKey}_label`] || '').trim();
                return (
                  <React.Fragment key={`object-media-${fieldKey}`}>
                    {index > 0 ? <View style={styles.mediaSep} /> : null}
                    <ObjectMediaEditRow
                      label={label}
                      fallbackLabel={fallbackLabel}
                      count={t('order_photos_count').replace('{count}', String(count))}
                      onChangeLabel={(nextLabel) => changeMediaLabel(fieldKey, nextLabel)}
                      onOpen={() => setObjectPhotosModal({ visible: true, category: fieldKey })}
                      onRemove={() => removeMediaSectionNow(fieldKey)}
                      canRemove
                    />
                  </React.Fragment>
                );
              })}
              {canAddMediaSection ? (
                <View style={styles.additionalPhoneAddRow}>
                  <Text style={styles.additionalPhoneAddText}>
                    {t('objects_media_add_section')}
                  </Text>
                  <Pressable
                    onPress={addMediaSection}
                    style={styles.additionalPhoneAddButton}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                  >
                    <Feather
                      name="plus"
                      size={theme.components?.icon?.sizeXs ?? Math.round((theme.icons?.sm ?? 18) * 0.75)}
                      color={theme.colors.textSecondary}
                    />
                  </Pressable>
                </View>
              ) : null}
            </Card>
          </>
        ) : null}

        <UIButton
          title={t('btn_delete')}
          variant="destructive"
          onPress={() => setDeleteVisible(true)}
          style={styles.deleteBtn}
          disabled={!canDeleteObjects}
        />
      </EditScreenTemplate>

      <ConfirmModal
        visible={cancelVisible}
        onClose={() => setCancelVisible(false)}
        title={t('dlg_leave_title')}
        message={t('dlg_leave_msg')}
        confirmLabel={t('dlg_leave_confirm')}
        cancelLabel={t('dlg_leave_cancel')}
        confirmVariant="destructive"
        onConfirm={() => {
          setCancelVisible(false);
          goBack();
        }}
      />

      <ConfirmModal
        visible={deleteVisible}
        onClose={() => setDeleteVisible(false)}
        title={t('objects_delete_title')}
        message={t('objects_delete_message')}
        confirmLabel={t('btn_delete')}
        cancelLabel={t('btn_cancel')}
        confirmVariant="destructive"
        onConfirm={async () => {
          if (!canDeleteObjects) return;
          try {
            await deleteMutation.mutateAsync({
              id: String(objectId || ''),
              clientId: objectItem?.client_id,
            });
            toast.success(t('objects_deleted'));
            goAfterDelete();
          } catch (error) {
            toast.error(error?.message || t('clients_save_failed'));
          }
        }}
      />

      <AvatarSheetModal
        key={`object-photo-${avatarKey}`}
        visible={avatarSheetVisible}
        hasPhoto={!!draft.photoUrl}
        onTakePhoto={pickFromCamera}
        onPickFromLibrary={pickFromLibrary}
        onDeletePhoto={() => setDraft((prev) => ({ ...prev, photoUrl: '' }))}
        onViewPhoto={() => setPhotoPreviewVisible(true)}
        onClose={() => setAvatarSheetVisible(false)}
      />

      <AvatarCropModal
        visible={cropVisible}
        uri={cropSrc}
        onCancel={onCropCancel}
        onConfirm={onCropConfirm}
      />

      <ConfirmModal
        visible={!!removeMediaSection}
        onClose={() => setRemoveMediaSection(null)}
        title={t('objects_media_delete_section_title')}
        message={t('objects_media_delete_section_message')}
        confirmLabel={t('btn_delete')}
        cancelLabel={t('btn_cancel')}
        confirmVariant="destructive"
        onConfirm={async () => {
          const fieldKey = removeMediaSection;
          if (!fieldKey) return;
          setRemoveMediaSection(null);
          const photos = Array.isArray(objectMediaRef.current?.[fieldKey]) ? objectMediaRef.current[fieldKey] : [];
          try {
            await updateMutation.mutateAsync({
              id: String(objectId),
              patch: {
                [fieldKey]: [],
                [`${fieldKey}_label`]: null,
                media_sections: objectMediaSections.filter((value) => value !== fieldKey),
              },
            });
            objectMediaRef.current = { ...objectMediaRef.current, [fieldKey]: [] };
            for (const url of photos) {
              try {
                await deleteObjectMediaPhotoByUrl(objectId, fieldKey, url);
              } catch {}
            }
            clearMediaSectionLocal(fieldKey);
          } catch (error) {
            toast.error(error?.message || t('clients_save_failed'));
          }
        }}
      />

      <OrderPhotosModal
        visible={objectPhotosModal.visible}
        onClose={() => setObjectPhotosModal({ visible: false, category: null })}
        category={objectPhotosModal.category}
        photos={Array.isArray(objectMediaRef.current?.[objectPhotosModal.category])
          ? objectMediaRef.current[objectPhotosModal.category]
          : []}
        pending={localPendingMap?.[objectPhotosModal.category] || []}
        getDisplayUrl={getObjectMediaDisplayUrl}
        getThumbnailUrl={getObjectMediaThumbnailUrl}
        getIssue={() => ''}
        onUploadUri={handleUploadUri}
        onUploadMultiple={handleUploadMultiple}
        onRemove={removePhoto}
        onRemoveMany={removePhotosBatch}
        onOpenViewer={(photos, idx) => {
          const category = objectPhotosModal.category;
          openViewer(
            photos,
            idx,
            category,
            String(draft?.[`${category}_label`] || '').trim() || getMediaFallbackLabel(category),
          );
        }}
      />

      <FullscreenImageViewer
        visible={viewerVisible}
        images={viewerPhotos}
        initialIndex={viewerIndex}
        onClose={() => setViewerVisible(false)}
        onDelete={handleViewerDelete}
        categoryLabel={viewerCategoryLabel}
      />

      <BaseModal
        visible={addressModalVisible}
        onClose={() => setAddressModalVisible(false)}
        title={t('objects_address_section')}
        maxHeightRatio={0.9}
        footer={(
          <UIButton
            title={t('btn_done')}
            onPress={() => setAddressModalVisible(false)}
          />
        )}
      >
        <ScrollView
          style={{ width: '100%' }}
          contentContainerStyle={{ paddingVertical: theme.spacing.sm }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.modalInset}>
            <View style={styles.locationModeRow}>
              <Pressable
                onPress={() => setLocationMode('address')}
                style={[styles.locationModeBtn, locationMode === 'address' ? styles.locationModeBtnActive : null]}
              >
                <Text style={[styles.locationModeBtnText, locationMode === 'address' ? styles.locationModeBtnTextActive : null]}>
                  {t('objects_location_mode_address')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setLocationMode('map')}
                style={[styles.locationModeBtn, locationMode === 'map' ? styles.locationModeBtnActive : null]}
              >
                <Text style={[styles.locationModeBtnText, locationMode === 'map' ? styles.locationModeBtnTextActive : null]}>
                  {t('objects_location_mode_map')}
                </Text>
              </Pressable>
            </View>
          </View>

          {locationMode === 'map' ? (
            <Card paddedXOnly style={{ marginTop: theme.spacing.sm }}>
              <View style={styles.mapPointBlock}>
                <Text style={styles.mapPointHint}>
                  {t('objects_location_map_hint')}
                </Text>
                <View style={styles.mapPointValueRow}>
                  <Text style={styles.mapPointValue}>
                    {hasMapPoint ? `${mapLat}, ${mapLng}` : t('objects_location_empty')}
                  </Text>
                  {hasMapPoint ? (
                    <Pressable
                      onPress={clearMapPoint}
                      style={styles.mapPointClearBtn}
                      hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={t('objects_location_clear')}
                    >
                      <Feather
                        name="x-circle"
                        size={theme.icons?.sm ?? 18}
                        color={theme.colors.textSecondary}
                      />
                    </Pressable>
                  ) : null}
                </View>
                <View style={styles.mapActionsRow}>
                  <View style={styles.mapActionItem}>
                    <UIButton
                      title={t('objects_location_open_map')}
                      variant="secondary"
                      onPress={openMapForPoint}
                      style={styles.mapActionBtn}
                    />
                  </View>
                  <View style={styles.mapActionItem}>
                    <UIButton
                      title={t('objects_location_paste')}
                      onPress={pasteCoordinatesFromClipboard}
                      style={[
                        styles.mapActionBtn,
                        !clipboardHasCoordinates ? styles.mapActionBtnInactive : null,
                      ]}
                    />
                  </View>
                </View>
              </View>
            </Card>
          ) : null}

          {locationMode === 'address' ? (
            <Card paddedXOnly>
              {orderedPrimaryAddressFields.map((field) => (
                <React.Fragment key={field}>
                  <TextField
                    label={withRequiredLabel(field, t(`order_field_${field}`))}
                    value={String(draft[field] || '')}
                    onChangeText={(value) => {
                      setDraft((prev) => ({ ...prev, [field]: value }));
                      setFieldErrors((prev) => (prev?.[field] ? { ...prev, [field]: null } : prev));
                    }}
                    error={fieldErrors?.[field] ? 'invalid' : undefined}
                    style={styles.field}
                  />
                  <FieldErrorText message={fieldErrors?.[field] || null} />
                </React.Fragment>
              ))}
            </Card>
          ) : null}
        </ScrollView>
      </BaseModal>

      <BaseModal
        visible={photoPreviewVisible}
        onClose={() => setPhotoPreviewVisible(false)}
        title={t('objects_photo_title')}
        maxHeightRatio={0.9}
      >
        <View style={styles.previewWrap}>
          {photoDisplayUrl ? (
            <ExpoImage
              source={{ uri: photoDisplayUrl }}
              style={styles.previewImg}
              contentFit="contain"
              cachePolicy="none"
            />
          ) : (
            <Text style={styles.previewEmpty}>{t('placeholder_no_photo')}</Text>
          )}
        </View>
      </BaseModal>
    </>
  );
}

function createStyles(theme, formStyles) {
  const insetKey = theme.components?.input?.separator?.insetX ?? 'lg';
  return StyleSheet.create({
    blockedWrap: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    blockedText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
    headerCard: {
      marginBottom: theme.spacing.md,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
    },
    headerTextWrap: {
      flex: 1,
    },
    avatar: {
      width: theme.components.avatar.md,
      height: theme.components.avatar.md,
      borderRadius: theme.components.avatar.md / 2,
      backgroundColor: withAlpha(theme.colors.primary, 0.12),
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: theme.components.card.borderWidth,
      borderColor: withAlpha(theme.colors.primary, 0.24),
      overflow: 'hidden',
    },
    avatarImg: {
      width: '100%',
      height: '100%',
    },
    avatarCamBadge: {
      position: 'absolute',
      right: -(theme.components?.avatar?.badgeOffset ?? 2),
      bottom: -(theme.components?.avatar?.badgeOffset ?? 2),
      backgroundColor: theme.colors.primary,
      borderRadius: theme.radii.md,
      paddingHorizontal: theme.spacing.xs,
      paddingVertical: theme.spacing.xs,
      borderWidth: theme.components?.avatar?.border ?? theme.components.card.borderWidth,
      borderColor: theme.colors.surface,
    },
    avatarText: {
      color: theme.colors.primary,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.bold,
    },
    nameTitle: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
      flexShrink: 1,
    },
    addressValue: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight?.regular ?? '400',
      flexShrink: 1,
    },
    clientName: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      marginTop: theme.spacing.xs,
      flexShrink: 1,
    },
    addressRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: theme.spacing.sm,
    },
    addressTextWrap: {
      flex: 1,
      paddingRight: theme.spacing.sm,
      paddingLeft: theme.spacing[insetKey],
    },
    chevronWrap: {
      justifyContent: 'center',
      alignItems: 'center',
      alignSelf: 'flex-start',
      paddingHorizontal: Math.max(0, Math.round((theme.spacing?.xs ?? 6) / 2)),
    },
    fieldLabel: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      marginBottom: theme.components?.input?.labelSpacing ?? theme.spacing.xs,
      fontWeight: theme.typography.weight?.medium ?? '500',
    },
    field: formStyles.field,
    deleteBtn: {
      marginTop: theme.spacing.sm,
    },
    additionalPhoneGroup: {
      marginBottom: theme.spacing.xs,
    },
    additionalPhoneAddRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Number(theme.spacing?.lg ?? 16),
      paddingVertical: theme.spacing.xs,
      marginBottom: theme.spacing.xs,
    },
    additionalPhoneAddText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.medium,
    },
    additionalPhoneAddButton: {
      minWidth: 24,
      minHeight: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    mediaSep: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.border,
      marginVertical: theme.spacing.xs,
    },
    modalInset: {
      paddingHorizontal: theme.spacing[theme.components?.card?.padX ?? 'lg'],
    },
    locationModeRow: {
      flexDirection: 'row',
      gap: theme.spacing.xs,
      paddingVertical: theme.spacing.sm,
    },
    locationModeBtn: {
      flex: 1,
      minHeight: 36,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.md,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.sm,
      backgroundColor: theme.colors.surface,
    },
    locationModeBtnActive: {
      borderColor: theme.colors.primary,
      backgroundColor: withAlpha(theme.colors.primary, 0.1),
    },
    locationModeBtnText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.medium,
    },
    locationModeBtnTextActive: {
      color: theme.colors.primary,
    },
    mapPointBlock: {
      paddingVertical: theme.spacing.sm,
      gap: theme.spacing.sm,
    },
    mapPointHint: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
    mapPointValueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
    },
    mapPointValue: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.medium,
      flex: 1,
    },
    mapPointClearBtn: {
      minWidth: theme.icons?.md ?? 24,
      minHeight: theme.icons?.md ?? 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    mapActionsRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      width: '100%',
    },
    mapActionItem: {
      flex: 1,
      minWidth: 0,
    },
    mapActionBtn: {
      width: '100%',
    },
    mapActionBtnInactive: {
      opacity: 0.5,
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
