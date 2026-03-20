import { AntDesign, Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
  CLIENT_OBJECT_DEFAULT_NAME,
  CLIENT_OBJECT_PRIMARY_ADDRESS_FIELDS,
  createEmptyClientObjectDraft,
  sanitizeClientObjectPayload,
  buildClientObjectShortAddress,
} from '../../../src/features/objects/addressing';
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
import { cleanupProfileMediaEntity } from '../../../src/features/profileMedia/api';
import { useSetObjectTagsMutation } from '../../../src/features/tags/queries';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { getRequiredFieldLabel } from '../../../src/shared/forms/fieldValidation';
import { getRequiredTextFieldError } from '../../../src/shared/validation/fields';
import { hasMobilePhoneValue, isValidOptionalMobilePhone } from '../../../src/shared/validation/phone';
import { useTheme } from '../../../theme/ThemeProvider';
import dismissToRoute from '../../../lib/navigation/dismissToRoute';

const DEFAULT_OBJECT_INITIALS = 'OB';

const getImagePickerMediaTypesImages = () => {
  try {
    if (ImagePicker.MediaType && ImagePicker.MediaType.Images) return ImagePicker.MediaType.Images;
    if (ImagePicker.MediaType && ImagePicker.MediaType.images) return ImagePicker.MediaType.images;
    if (ImagePicker.MediaType && ImagePicker.MediaType.image) return ImagePicker.MediaType.image;
  } catch {
    return ['images'];
  }
  return ['images'];
};

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
    ...Object.fromEntries(
      CLIENT_OBJECT_ADDRESS_FIELDS.map((field) => [field, String(obj[field] || '').trim() || '']),
    ),
  });
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
  const [avatarKey, setAvatarKey] = React.useState(0);
  const [fieldErrors, setFieldErrors] = React.useState({});
  const allowLeaveRef = React.useRef(false);
  const formStyles = useEditFormStyles();
  const styles = React.useMemo(() => createStyles(theme, formStyles), [theme, formStyles]);
  const [addressLabelHeight, setAddressLabelHeight] = React.useState(0);
  const [addressValueHeight, setAddressValueHeight] = React.useState(0);
  const objectFieldSettings = React.useMemo(
    () => objectFieldSettingsData || buildFallbackEntityFieldSettings(ENTITY_FIELD_TYPES.OBJECT),
    [objectFieldSettingsData],
  );
  const objectFieldsByKey = React.useMemo(() => getEntityFieldMap(objectFieldSettings), [objectFieldSettings]);
  const visibleAddressFields = React.useMemo(
    () => CLIENT_OBJECT_ADDRESS_FIELDS.filter((field) => objectFieldsByKey.get(field)?.isEnabled !== false),
    [objectFieldsByKey],
  );
  const _visiblePrimaryAddressFields = React.useMemo(
    () =>
      CLIENT_OBJECT_PRIMARY_ADDRESS_FIELDS.filter(
        (field) => objectFieldsByKey.get(field)?.isEnabled !== false,
      ),
    [objectFieldsByKey],
  );
  const visibleAdditionalInfoFields = React.useMemo(
    () =>
      CLIENT_OBJECT_ADDITIONAL_INFO_FIELDS.filter(
        (field) => objectFieldsByKey.get(field)?.isEnabled !== false,
      ),
    [objectFieldsByKey],
  );
  const orderedPrimaryAddressFields = React.useMemo(
    () =>
      getOrderedEntityFields(objectFieldSettings, {
        visibleOnly: true,
        requiredFirst: true,
        fieldKeys: CLIENT_OBJECT_PRIMARY_ADDRESS_FIELDS,
      }).map((field) => field.fieldKey),
    [objectFieldSettings],
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
    () => [1, 2, 3].filter((slotId) => objectFieldsByKey.get(`additional_phone_${slotId}`)?.isEnabled !== false),
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
      name: objectItem.name || CLIENT_OBJECT_DEFAULT_NAME,
      photoUrl: objectItem.photoUrl || '',
      ...Object.fromEntries(CLIENT_OBJECT_ADDRESS_FIELDS.map((field) => [field, objectItem[field] || ''])),
    });
    const nextTags = Array.isArray(objectItem?.tags) ? objectItem.tags.map((tag) => String(tag?.value || '').trim()) : [];
    setDraft(next);
    setAdditionalPhones(nextAdditionalPhones);
    setVisibleAdditionalPhoneSlots(nextVisibleSlots);
    setTags(nextTags);
    setInitialSnap(
      snapshotObjectForm({
        ...next,
        tags: nextTags,
        additionalPhones: nextAdditionalPhones,
        additionalPhoneVisibleSlots: nextVisibleSlots,
      }),
    );
  }, [enabledAdditionalPhoneSlots, objectItem, requiredAdditionalPhoneSlots]);

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

  const isDirty = React.useMemo(() => {
    if (!initialSnap) return false;
    return snapshotObjectForm({
      ...draft,
      tags,
      additionalPhones,
      additionalPhoneVisibleSlots: visibleAdditionalPhoneSlots,
    }) !== initialSnap;
  }, [additionalPhones, draft, initialSnap, tags, visibleAdditionalPhoneSlots]);

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
      const message = getRequiredTextFieldError(draft?.[field], {
        required: objectFieldsByKey.get(field)?.isRequired === true,
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
          ...buildObjectAdditionalPhonesPatch(additionalPhones, {
            defaultLabel: t('order_field_secondary_phone'),
            visibleSlotIds: visibleAdditionalPhoneSlots,
            hiddenSource: getObjectAdditionalPhones(objectItem),
            preserveHidden: true,
          }),
          photo_url: persistedPhotoUrl,
        },
      });

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
  }, [additionalPhones, canEditObjects, draft, goBack, objectFieldsByKey, objectId, objectItem, requiredAdditionalPhoneSlots, saving, setObjectTagsMutation, settings?.enable_object_tags, t, tags, toast, updateMutation, visibleAdditionalInfoFields, visibleAdditionalPhoneSlots, visibleAddressFields]);

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
              {photoDisplayUrl ? (
                <ExpoImage
                  source={{ uri: photoDisplayUrl }}
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
              onPress={() => setAddressModalVisible(true)}
              accessibilityRole="button"
            >
              <View style={styles.addressTextWrap}>
                <Text
                  style={styles.fieldLabel}
                  onLayout={(e) => setAddressLabelHeight(Math.round(e.nativeEvent.layout.height))}
                >
                  {t('order_details_address')}
                </Text>
                <Text
                  style={styles.addressValue}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  onLayout={(e) => setAddressValueHeight(Math.round(e.nativeEvent.layout.height))}
                >
                  {buildClientObjectShortAddress(draft) || t('objects_empty')}
                </Text>
              </View>
              <View style={[styles.chevronWrap, { marginTop: chevronMarginTop }]}>
                <Feather name="chevron-right" size={chevronIconSize} color={theme.colors.textSecondary} />
              </View>
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
                    keyboardType={field === 'geo_lat' || field === 'geo_lng' ? 'decimal-pad' : undefined}
                    multiline={field === 'entrance_info' || field === 'parking_notes'}
                    minLines={field === 'entrance_info' || field === 'parking_notes' ? 2 : undefined}
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
      color: '#000',
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
