import { AntDesign, Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import EditScreenTemplate from '../../../components/layout/EditScreenTemplate';
import AvatarCropModal from '../../../components/ui/AvatarCropModal';
import UIButton from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import SectionHeader from '../../../components/ui/SectionHeader';
import TextField from '../../../components/ui/TextField';
import { BaseModal, ConfirmModal, SelectModal } from '../../../components/ui/modals';
import { useToast } from '../../../components/ui/ToastProvider';
import { usePermissions } from '../../../lib/permissions';
import {
  useClientObject,
  useDeleteClientObjectMutation,
  useUpdateClientObjectMutation,
} from '../../../src/features/objects/queries';
import {
  CLIENT_OBJECT_ADDRESS_FIELDS,
  CLIENT_OBJECT_DEFAULT_NAME,
  createEmptyClientObjectDraft,
  sanitizeClientObjectPayload,
} from '../../../src/features/objects/addressing';
import { uploadClientObjectPhoto } from '../../../src/features/objects/photo';
import { cleanupProfileMediaEntity } from '../../../src/features/profileMedia/api';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

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
  return JSON.stringify({
    name: String(obj.name || '').trim() || '',
    photoUrl: String(obj.photoUrl || '').trim() || '',
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
  const { id } = useLocalSearchParams();
  const objectId = Array.isArray(id) ? id[0] : id;

  const canEditClients = has('canEditClients');
  const { data: objectItem } = useClientObject(objectId, { enabled: !!objectId });
  const updateMutation = useUpdateClientObjectMutation();
  const deleteMutation = useDeleteClientObjectMutation();

  const [draft, setDraft] = React.useState(createEmptyClientObjectDraft());
  const [initialSnap, setInitialSnap] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [cancelVisible, setCancelVisible] = React.useState(false);
  const [deleteVisible, setDeleteVisible] = React.useState(false);
  const [avatarSheetVisible, setAvatarSheetVisible] = React.useState(false);
  const [cropVisible, setCropVisible] = React.useState(false);
  const [cropSrc, setCropSrc] = React.useState(null);
  const [photoPreviewVisible, setPhotoPreviewVisible] = React.useState(false);
  const [avatarKey, setAvatarKey] = React.useState(0);
  const allowLeaveRef = React.useRef(false);
  const styles = React.useMemo(() => createStyles(theme), [theme]);
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
    const next = createEmptyClientObjectDraft({
      name: objectItem.name || CLIENT_OBJECT_DEFAULT_NAME,
      photoUrl: objectItem.photoUrl || '',
      ...Object.fromEntries(CLIENT_OBJECT_ADDRESS_FIELDS.map((field) => [field, objectItem[field] || ''])),
    });
    setDraft(next);
    setInitialSnap(snapshotObjectForm(next));
  }, [objectItem]);

  const isDirty = React.useMemo(() => {
    if (!initialSnap) return false;
    return snapshotObjectForm(draft) !== initialSnap;
  }, [draft, initialSnap]);

  const goBack = React.useCallback(() => {
    allowLeaveRef.current = true;
    if (navigation && typeof navigation.goBack === 'function') {
      navigation.goBack();
      return;
    }
    router.back();
  }, [navigation, router]);

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
    if (!objectId || saving || !canEditClients) return;
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
          photo_url: persistedPhotoUrl,
        },
      });

      toast.success(t('objects_saved'));
      allowLeaveRef.current = true;
      router.replace(`/objects/${objectId}`);
    } catch (error) {
      toast.error(error?.message || t('clients_save_failed'));
    } finally {
      setSaving(false);
    }
  }, [canEditClients, draft, objectId, objectItem?.photoUrl, router, saving, t, toast, updateMutation]);

  if (!canEditClients) {
    return (
      <EditScreenTemplate title={t('routes_objects_edit')}>
        <View style={styles.blockedWrap}>
          <Text style={styles.blockedText}>{t('clients_no_edit_permission')}</Text>
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
              <Text style={styles.nameTitle}>{draft.name || t('objects_unnamed')}</Text>
              <Text style={styles.clientName}>{objectItem?.client?.full_name || t('common_dash')}</Text>
            </View>
          </View>
        </Card>

        <SectionHeader topSpacing="xs">{t('section_personal')}</SectionHeader>
        <Card paddedXOnly>
          <TextField
            label={t('objects_field_name')}
            value={draft.name}
            onChangeText={(value) => setDraft((prev) => ({ ...prev, name: value }))}
            style={styles.field}
          />
        </Card>

        <SectionHeader topSpacing="xs">{t('objects_address_section')}</SectionHeader>
        <Card paddedXOnly>
          {CLIENT_OBJECT_ADDRESS_FIELDS.map((field) => (
            <TextField
              key={field}
              label={t(`order_field_${field}`)}
              value={String(draft[field] || '')}
              onChangeText={(value) => setDraft((prev) => ({ ...prev, [field]: value }))}
              style={styles.field}
            />
          ))}
        </Card>

        <UIButton
          title={t('btn_delete')}
          variant="destructive"
          onPress={() => setDeleteVisible(true)}
          style={styles.deleteBtn}
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
          try {
            await cleanupProfileMediaEntity('object', String(objectId || ''));
            await deleteMutation.mutateAsync({
              id: String(objectId || ''),
              clientId: objectItem?.client_id,
            });
            toast.success(t('objects_deleted'));
            allowLeaveRef.current = true;
            router.replace(`/clients/${objectItem?.client_id}`);
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

function createStyles(theme) {
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
    },
    clientName: {
      color: theme.colors.primary,
      fontSize: theme.typography.sizes.sm,
      marginTop: theme.spacing.xs,
    },
    field: {
      marginVertical: theme.spacing.xs,
    },
    deleteBtn: {
      marginTop: theme.spacing.sm,
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
