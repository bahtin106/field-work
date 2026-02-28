import { AntDesign, Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import React from 'react';
import { BackHandler, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import EditScreenTemplate from '../../../components/layout/EditScreenTemplate';
import AvatarCropModal from '../../../components/ui/AvatarCropModal';
import UIButton from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import PhoneInput from '../../../components/ui/PhoneInput';
import SectionHeader from '../../../components/ui/SectionHeader';
import TextField from '../../../components/ui/TextField';
import { BaseModal, ConfirmModal, SelectModal } from '../../../components/ui/modals';
import { useToast } from '../../../components/ui/ToastProvider';
import { usePermissions } from '../../../lib/permissions';
import {
  useClient,
  useDeleteClientMutation,
  useUpdateClientMutation,
} from '../../../src/features/clients/queries';
import { useClientObjects } from '../../../src/features/objects/queries';
import { uploadClientAvatar } from '../../../src/features/clients/avatar';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

const getImagePickerMediaTypesImages = () => {
  try {
    if (ImagePicker.MediaType && ImagePicker.MediaType.Images) return ImagePicker.MediaType.Images;
    if (ImagePicker.MediaType && ImagePicker.MediaType.images) return ImagePicker.MediaType.images;
    if (ImagePicker.MediaType && ImagePicker.MediaType.image) return ImagePicker.MediaType.image;
  } catch {
    // ignore
  }
  return ['images'];
};

function withAlpha(color, a) {
  if (typeof color === 'string') {
    const hex = color.match(/^#([0-9a-fA-F]{6})$/);
    if (hex) {
      const alpha = Math.round(Math.max(0, Math.min(1, a)) * 255)
        .toString(16)
        .padStart(2, '0');
      return color + alpha;
    }
    const rgb = color.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
    if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${a})`;
  }
  return `rgba(0,0,0,${a})`;
}

function AvatarSheetModal({
  visible,
  hasAvatar,
  onTakePhoto,
  onPickFromLibrary,
  onDeletePhoto,
  onViewPhoto,
  onClose,
}) {
  const { t } = useTranslation();

  const { theme } = useTheme();
  const ICON_SM = theme.icons?.sm ?? 18;

  const chevron = (color) => (
    <Feather name="chevron-right" size={ICON_SM} color={color} />
  );

  const items = [
    { id: 'camera', label: t('profile_photo_take'), right: chevron(theme.colors.textSecondary) },
    { id: 'library', label: t('profile_photo_choose'), right: chevron(theme.colors.textSecondary) },
    ...(hasAvatar
      ? [
          { id: 'view', label: t('profile_photo_title'), right: chevron(theme.colors.textSecondary) },
          { id: 'delete', label: t('profile_photo_delete'), right: chevron(theme.colors.textSecondary) },
        ]
      : []),
  ];

  return (
    <SelectModal
      visible={visible}
      title={t('profile_photo_title')}
      items={items}
      searchable={false}
      onSelect={(it) => {
        try {
          if (it.id === 'camera') onTakePhoto?.();
          else if (it.id === 'library') onPickFromLibrary?.();
          else if (it.id === 'delete') onDeletePhoto?.();
          else if (it.id === 'view') onViewPhoto?.();
        } finally {
          onClose?.();
        }
      }}
      onClose={onClose}
    />
  );
}

function snapshotClientForm(obj = {}) {
  return JSON.stringify({
    firstName: String(obj.firstName || '').trim(),
    lastName: String(obj.lastName || '').trim(),
    middleName: String(obj.middleName || '').trim(),
    email: String(obj.email || '').trim().toLowerCase() || '',
    phone: String(obj.phone || '').trim() || '',
    secondaryPhone: String(obj.secondaryPhone || '').trim() || '',
    contactPref: String(obj.contactPref || '').trim() || '',
    avatarUrl: String(obj.avatarUrl || '') || '',
  });
}

export default function EditClientScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const router = useRouter();
  const navigation = useNavigation();
  const { has } = usePermissions();

  const canEditClients = has('canEditClients');
  const canDeleteClients = has('canDeleteClients');

  const { id } = useLocalSearchParams();
  const clientId = Array.isArray(id) ? id[0] : id;

  const { data: client } = useClient(clientId, { enabled: !!clientId });
  const { data: clientObjects = [] } = useClientObjects(clientId, { enabled: !!clientId });
  const updateMutation = useUpdateClientMutation();
  const deleteMutation = useDeleteClientMutation();

  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [middleName, setMiddleName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [secondaryPhone, setSecondaryPhone] = React.useState('');
  const [contactPref, setContactPref] = React.useState('');
  const [avatarUrl, setAvatarUrl] = React.useState('');

  const [avatarSheetVisible, setAvatarSheetVisible] = React.useState(false);
  const [cropVisible, setCropVisible] = React.useState(false);
  const [cropSrc, setCropSrc] = React.useState(null);
  const [avatarKey, setAvatarKey] = React.useState(0);
  const [viewAvatarVisible, setViewAvatarVisible] = React.useState(false);

  const [cancelVisible, setCancelVisible] = React.useState(false);
  const [cancelKey, setCancelKey] = React.useState(0);
  const [deleteVisible, setDeleteVisible] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [initialSnap, setInitialSnap] = React.useState(null);

  const allowLeaveRef = React.useRef(false);
  const cameraIconSize = React.useMemo(() => {
    const iconSm = theme.icons?.sm ?? 18;
    return Math.max(
      theme.icons?.minCamera ?? 12,
      Math.round(iconSm * (theme.icons?.cameraRatio ?? 0.67)),
    );
  }, [theme]);

  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const stripRequiredStar = React.useCallback((label) => {
    try {
      return String(label || '').replace(/\s*\*\s*$/, '');
    } catch {
      return String(label || '');
    }
  }, []);

  React.useEffect(() => {
    if (!client) return;
    const next = {
      firstName: client.firstName || '',
      lastName: client.lastName || '',
      middleName: client.middleName || '',
      email: client.email || '',
      phone: client.phone || '',
      secondaryPhone: client.secondaryPhone || '',
      contactPref: client.contactPref || '',
      avatarUrl: client.avatarUrl || '',
    };

    setFirstName(next.firstName);
    setLastName(next.lastName);
    setMiddleName(next.middleName);
    setEmail(next.email);
    setPhone(next.phone);
    setSecondaryPhone(next.secondaryPhone);
    setContactPref(next.contactPref);
    setAvatarUrl(next.avatarUrl);
    setInitialSnap(snapshotClientForm(next));
  }, [client]);

  const sortedObjects = React.useMemo(
    () =>
      [...clientObjects].sort((left, right) => {
        if (!!left?.is_primary !== !!right?.is_primary) return left?.is_primary ? -1 : 1;
        return String(left?.name || '').localeCompare(String(right?.name || ''), 'ru');
      }),
    [clientObjects],
  );

  const headerName = React.useMemo(() => {
    const name = `${lastName || ''} ${firstName || ''} ${middleName || ''}`
      .replace(/\s+/g, ' ')
      .trim();
    return name || t('placeholder_no_name');
  }, [firstName, lastName, middleName, t]);

  const initials = React.useMemo(
    () => `${(firstName || '').trim().slice(0, 1)}${(lastName || '').trim().slice(0, 1)}`.toUpperCase(),
    [firstName, lastName],
  );

  const isDirty = React.useMemo(() => {
    if (!initialSnap) return false;
    return (
      snapshotClientForm({
        firstName,
        lastName,
        middleName,
        email,
        phone,
        secondaryPhone,
        contactPref,
        avatarUrl,
      }) !== initialSnap
    );
  }, [avatarUrl, contactPref, email, firstName, initialSnap, lastName, middleName, phone, secondaryPhone]);

  const goBack = React.useCallback(() => {
    allowLeaveRef.current = true;
    if (navigation && typeof navigation.goBack === 'function') {
      navigation.goBack();
      return;
    }
    router.back();
  }, [navigation, router]);

  const handleCancelPress = React.useCallback(() => {
    if (isDirty) {
      setCancelKey((v) => v + 1);
      setCancelVisible(true);
      return;
    }
    goBack();
  }, [goBack, isDirty]);

  const handleLeaveWithoutSaving = React.useCallback(() => {
    setCancelVisible(false);
    goBack();
  }, [goBack]);

  React.useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (allowLeaveRef.current || !isDirty) return;
      e.preventDefault();
      setCancelKey((v) => v + 1);
      setCancelVisible(true);
    });
    return sub;
  }, [isDirty, navigation]);

  useFocusEffect(
    React.useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (allowLeaveRef.current) return false;
        if (!isDirty) return false;
        setCancelKey((v) => v + 1);
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

  const mediaTypesOpt = React.useMemo(() => getImagePickerMediaTypesImages(), []);
  const mediaAspect = React.useMemo(
    () => (Array.isArray(theme.media?.aspect) ? theme.media.aspect : [1, 1]),
    [theme.media?.aspect],
  );
  const mediaQuality = React.useMemo(
    () => (typeof theme.media?.quality === 'number' ? theme.media.quality : 0.85),
    [theme.media?.quality],
  );

  const pickFromCamera = React.useCallback(async () => {
    const okCam = await ensureCameraPerms();
    if (!okCam) {
      toast.warning(t('error_camera_denied'));
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      aspect: mediaAspect,
      quality: mediaQuality,
      mediaTypes: mediaTypesOpt,
    });
    if (!res.canceled && res.assets && res.assets[0]?.uri) {
      setCropSrc(res.assets[0].uri);
      setCropVisible(true);
    }
  }, [ensureCameraPerms, mediaAspect, mediaQuality, mediaTypesOpt, t, toast]);

  const pickFromLibrary = React.useCallback(async () => {
    const okLib = await ensureLibraryPerms();
    if (!okLib) {
      toast.warning(t('error_library_denied'));
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      aspect: mediaAspect,
      quality: mediaQuality,
      selectionLimit: 1,
      mediaTypes: mediaTypesOpt,
    });
    if (!res.canceled && res.assets && res.assets[0]?.uri) {
      setCropSrc(res.assets[0].uri);
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
    setAvatarUrl(croppedUri);
  }, []);

  const saveClient = React.useCallback(async () => {
    if (!canEditClients || saving || !clientId) return false;

    const cleanFirstName = String(firstName || '').trim();
    const cleanLastName = String(lastName || '').trim();
    const cleanMiddleName = String(middleName || '').trim();

    if (!cleanFirstName && !cleanLastName && !cleanMiddleName) {
      toast.warning(t('clients_required_any_name'));
      return false;
    }

    setSaving(true);
    try {
      const patch = {
        first_name: cleanFirstName,
        last_name: cleanLastName,
        middle_name: cleanMiddleName || null,
        email: String(email || '').trim().toLowerCase() || null,
        phone: String(phone || '').trim() || null,
        secondary_phone: String(secondaryPhone || '').trim() || null,
        contact_pref: String(contactPref || '').trim() || null,
      };

      if (!avatarUrl) {
        patch.avatar_url = null;
      } else if (String(avatarUrl).startsWith('http')) {
        patch.avatar_url = avatarUrl;
      }

      await updateMutation.mutateAsync({
        id: String(clientId),
        patch,
      });

      if (avatarUrl && !String(avatarUrl).startsWith('http')) {
        const uploadedUrl = await uploadClientAvatar(String(clientId), avatarUrl);
        if (uploadedUrl) {
          await updateMutation.mutateAsync({
            id: String(clientId),
            patch: { avatar_url: uploadedUrl },
          });
        }
      }

      toast.success(t('clients_saved_success'));
      allowLeaveRef.current = true;
      if (navigation && typeof navigation.canGoBack === 'function' && navigation.canGoBack()) {
        navigation.goBack();
      } else {
        router.replace(`/clients/${clientId}`);
      }
      return true;
    } catch (error) {
      toast.error(error?.message || t('clients_save_failed'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [
    avatarUrl,
    canEditClients,
    clientId,
    email,
    firstName,
    lastName,
    middleName,
    navigation,
    phone,
    secondaryPhone,
    contactPref,
    router,
    saving,
    t,
    toast,
    updateMutation,
  ]);

  if (!canEditClients) {
    return (
      <EditScreenTemplate title={t('header_edit_user')}>
        <View style={styles.blockedWrap}>
          <Text style={styles.blockedText}>{t('clients_no_edit_permission')}</Text>
        </View>
      </EditScreenTemplate>
    );
  }

  return (
    <>
      <EditScreenTemplate
        title={t('header_edit_user')}
        rightTextLabel={saving ? t('toast_saving') : t('header_save')}
        onRightPress={saveClient}
        onBack={handleCancelPress}
      >
        <Card style={styles.headerCard}>
          <View style={styles.headerRow}>
            <Pressable
              style={styles.avatar}
              onPress={() => {
                setAvatarKey((k) => k + 1);
                setAvatarSheetVisible(true);
              }}
              accessibilityRole="button"
              accessibilityLabel={t('a11y_change_avatar')}
              accessibilityHint={t('a11y_change_avatar_hint')}
            >
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatarImg} />
              ) : (
                <Text style={styles.avatarText}>{initials || '*'}</Text>
              )}
              <View style={styles.avatarCamBadge}>
                <AntDesign name="camera" size={cameraIconSize} color={theme.colors.onPrimary} />
              </View>
            </Pressable>
            <View style={styles.headerNameWrap}>
              <Text style={styles.nameTitle}>{headerName}</Text>
            </View>
          </View>
        </Card>

        <SectionHeader topSpacing="xs">{t('section_personal')}</SectionHeader>
        <Card paddedXOnly>
          <TextField
            label={stripRequiredStar(t('label_last_name'))}
            value={lastName}
            onChangeText={setLastName}
            style={styles.field}
          />
          <TextField
            label={stripRequiredStar(t('label_first_name'))}
            value={firstName}
            onChangeText={setFirstName}
            style={styles.field}
          />
          <TextField
            label={stripRequiredStar(t('label_middle_name'))}
            value={middleName}
            onChangeText={setMiddleName}
            style={styles.field}
          />
          <TextField
            label={t('label_email')}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            style={styles.field}
          />
          <PhoneInput value={phone} onChangeText={setPhone} style={styles.field} />
          <PhoneInput
            label={t('order_field_secondary_phone')}
            value={secondaryPhone}
            onChangeText={setSecondaryPhone}
            style={styles.field}
          />
          <TextField
            label={t('order_field_contact_pref')}
            value={contactPref}
            onChangeText={setContactPref}
            style={styles.field}
          />
        </Card>

        <SectionHeader topSpacing="xs">{t('clients_objects_section')}</SectionHeader>
        <Card paddedXOnly>
          {sortedObjects.length ? (
            sortedObjects.map((objectItem) => {
              return (
                <TextField
                  key={objectItem.id}
                  label={t('routes_objects_object')}
                  value={objectItem.name || t('objects_unnamed')}
                  pressable
                  style={styles.field}
                  onPress={() => router.push(`/objects/${objectItem.id}`)}
                />
              );
            })
          ) : (
            <Text style={styles.emptyText}>{t('objects_empty')}</Text>
          )}
          <UIButton
            title={t('objects_add')}
            variant="secondary"
            onPress={() => router.push(`/clients/${clientId}/objects/new`)}
          />
        </Card>

        {canDeleteClients ? (
          <UIButton
            title={t('btn_delete')}
            variant="destructive"
            onPress={() => setDeleteVisible(true)}
            style={styles.deleteBtn}
          />
        ) : null}
      </EditScreenTemplate>

      <ConfirmModal
        key={`cancel-${cancelKey}`}
        visible={cancelVisible}
        onClose={() => setCancelVisible(false)}
        title={t('dlg_leave_title')}
        message={t('dlg_leave_msg')}
        confirmLabel={t('dlg_leave_confirm')}
        cancelLabel={t('dlg_leave_cancel')}
        confirmVariant="destructive"
        onConfirm={handleLeaveWithoutSaving}
      />

      <ConfirmModal
        visible={deleteVisible}
        onClose={() => setDeleteVisible(false)}
        title={t('clients_delete_title')}
        message={t('clients_delete_message')}
        confirmLabel={t('btn_delete')}
        cancelLabel={t('btn_cancel')}
        confirmVariant="destructive"
        onConfirm={async () => {
          try {
            await deleteMutation.mutateAsync(String(clientId || ''));
            toast.success(t('clients_deleted_success'));
            allowLeaveRef.current = true;
            router.replace('/clients');
          } catch (error) {
            toast.error(error?.message || t('clients_save_failed'));
          }
        }}
      />

      <AvatarSheetModal
        key={`avatar-${avatarKey}`}
        visible={avatarSheetVisible}
        hasAvatar={!!avatarUrl}
        onTakePhoto={pickFromCamera}
        onPickFromLibrary={pickFromLibrary}
        onDeletePhoto={() => setAvatarUrl('')}
        onViewPhoto={() => setViewAvatarVisible(true)}
        onClose={() => setAvatarSheetVisible(false)}
      />

      <AvatarCropModal
        visible={cropVisible}
        uri={cropSrc}
        onCancel={onCropCancel}
        onConfirm={onCropConfirm}
      />

      <BaseModal
        visible={viewAvatarVisible}
        onClose={() => setViewAvatarVisible(false)}
        title={t('profile_photo_title')}
        maxHeightRatio={0.9}
      >
        <View style={styles.avatarPreviewWrap}>
          {avatarUrl ? (
            <Image
              source={{ uri: avatarUrl }}
              style={styles.avatarPreviewImg}
              resizeMode="contain"
            />
          ) : (
            <Text style={styles.avatarPreviewEmpty}>{t('placeholder_no_photo')}</Text>
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
    headerNameWrap: {
      flex: 1,
    },
    nameTitle: {
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
      color: theme.colors.text,
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
    avatarText: {
      color: theme.colors.primary,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.bold,
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
    field: {
      marginVertical: theme.spacing.xs,
    },
    emptyText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      marginBottom: theme.spacing.sm,
    },
    deleteBtn: {
      alignSelf: 'stretch',
      marginTop: theme.spacing.sm,
    },
    leaveBody: {
      marginBottom: theme.spacing.md,
    },
    leaveText: {
      fontSize: theme.typography.sizes.md,
      color: theme.colors.textSecondary,
    },
    leaveFooter: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: theme.spacing.md,
    },
    leaveBtn: {
      // do not force flex:1 here — allow buttons to size naturally
    },

    avatarPreviewWrap: {
      alignItems: 'center',
      padding: theme.spacing.md,
    },
    avatarPreviewImg: {
      width: '100%',
      height: undefined,
      aspectRatio: 1,
      borderRadius: theme.radii.lg,
    },
    avatarPreviewEmpty: {
      color: theme.colors.textSecondary,
    },
  });
}
