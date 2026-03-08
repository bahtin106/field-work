import { AntDesign, Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import AdditionalPhoneInputRow from '../../../components/clients/AdditionalPhoneInputRow';
import EditScreenTemplate from '../../../components/layout/EditScreenTemplate';
import AvatarCropModal from '../../../components/ui/AvatarCropModal';
import UIButton from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import PhoneInput from '../../../components/ui/PhoneInput';
import SectionHeader from '../../../components/ui/SectionHeader';
import TextField from '../../../components/ui/TextField';
import { BaseModal, ConfirmModal, SelectModal } from '../../../components/ui/modals';
import ModalActionsRow from '../../../components/ui/modals/ModalActionsRow';
import { useToast } from '../../../components/ui/ToastProvider';
import TagEditorField from '../../../components/tags/TagEditorField';
import { TAG_TYPE } from '../../../components/tags/tagConfig';
import { useCompanySettings } from '../../../hooks/useCompanySettings';
import { usePermissions } from '../../../lib/permissions';
import {
  extractConflictingClientId,
  findClientByPrimaryPhone,
  getClientById,
} from '../../../src/features/clients/api';
import {
  useClient,
  useClientDeleteBlockers,
  useDeleteClientMutation,
  useUpdateClientMutation,
} from '../../../src/features/clients/queries';
import {
  buildClientAdditionalPhonesPatch,
  CLIENT_ADDITIONAL_PHONE_SLOT_COUNT,
  createEmptyAdditionalClientPhones,
  getClientAdditionalPhones,
  getNextHiddenAdditionalPhoneSlotId,
  getVisibleAdditionalPhoneSlotIds,
  normalizeAdditionalClientPhones,
} from '../../../src/features/clients/additionalPhones';
import { useClientObjects } from '../../../src/features/objects/queries';
import { uploadClientAvatar } from '../../../src/features/clients/avatar';
import { cleanupProfileMediaEntity } from '../../../src/features/profileMedia/api';
import { useSetClientTagsMutation } from '../../../src/features/tags/queries';
import { resolveTagErrorMessage } from '../../../src/features/tags/errors';
import { CLIENT_COMMENT_MAX_LENGTH } from '../../../src/features/clients/constants';
import {
  hasMobilePhoneValue,
  isValidOptionalMobilePhone,
  normalizeOptionalMobilePhone,
} from '../../../src/shared/validation/phone';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';
import dismissToRoute from '../../../lib/navigation/dismissToRoute';
import { hasRelationFilters } from '../../../src/features/requests/relationFilters';

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
  const additionalPhones = normalizeAdditionalClientPhones(obj.additionalPhones);
  const visibleSlots = Array.isArray(obj.additionalPhoneVisibleSlots)
    ? Array.from(
        new Set(
          obj.additionalPhoneVisibleSlots
            .map((slotId) => Number(slotId))
            .filter((slotId) => Number.isFinite(slotId))
            .map((slotId) => Math.trunc(slotId)),
        ),
      ).sort((a, b) => a - b)
    : getVisibleAdditionalPhoneSlotIds(additionalPhones);
  return JSON.stringify({
    firstName: String(obj.firstName || '').trim(),
    lastName: String(obj.lastName || '').trim(),
    middleName: String(obj.middleName || '').trim(),
    comment: String(obj.comment || '').trim(),
    email: String(obj.email || '').trim().toLowerCase() || '',
    phone: String(obj.phone || '').trim() || '',
    additionalPhones,
    additionalPhoneVisibleSlots: visibleSlots,
    avatarUrl: String(obj.avatarUrl || '') || '',
    tags: Array.isArray(obj.tags) ? obj.tags.map((v) => String(v || '').trim().toLowerCase()) : [],
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
  const canViewAllOrders = has('canViewAllOrders');

  const params = useLocalSearchParams();
  const id = params?.id;
  const rawReturnTo = params?.returnTo;
  const rawReturnParams = params?.returnParams;
  const rawSelectMode = params?.select_mode;
  const rawFlowKey = params?.flow_key;
  const rawFlowReturnTo = params?.flow_return_to;
  const clientId = Array.isArray(id) ? id[0] : id;
  const selectMode = React.useMemo(() => {
    const value = Array.isArray(rawSelectMode) ? rawSelectMode[0] : rawSelectMode;
    return String(value || '').toLowerCase() === '1' || String(value || '').toLowerCase() === 'true';
  }, [rawSelectMode]);
  const flowKey = React.useMemo(() => {
    const value = Array.isArray(rawFlowKey) ? rawFlowKey[0] : rawFlowKey;
    return value ? String(value) : '';
  }, [rawFlowKey]);
  const flowReturnTo = React.useMemo(() => {
    const value = Array.isArray(rawFlowReturnTo) ? rawFlowReturnTo[0] : rawFlowReturnTo;
    return value ? String(value) : '';
  }, [rawFlowReturnTo]);
  const returnTo = React.useMemo(() => {
    const value = Array.isArray(rawReturnTo) ? rawReturnTo[0] : rawReturnTo;
    return value ? String(value) : '/clients';
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

  const [deleteVisible, setDeleteVisible] = React.useState(false);
  const { data: client } = useClient(clientId, { enabled: !!clientId });
  const {
    data: deleteBlockers,
    isLoading: deleteBlockersLoading,
    isError: deleteBlockersError,
    refetch: refetchDeleteBlockers,
  } = useClientDeleteBlockers(clientId, {
    enabled: !!clientId,
  });
  const { data: clientObjects = [] } = useClientObjects(clientId, { enabled: !!clientId });
  const updateMutation = useUpdateClientMutation();
  const deleteMutation = useDeleteClientMutation();
  const setClientTagsMutation = useSetClientTagsMutation();
  const { settings } = useCompanySettings();

  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [middleName, setMiddleName] = React.useState('');
  const [comment, setComment] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [additionalPhones, setAdditionalPhones] = React.useState(createEmptyAdditionalClientPhones());
  const [visibleAdditionalPhoneSlots, setVisibleAdditionalPhoneSlots] = React.useState([]);
  const [tags, setTags] = React.useState([]);
  const [avatarUrl, setAvatarUrl] = React.useState('');
  const avatarDisplayUrl = React.useMemo(
    () => (String(avatarUrl || '').startsWith('http') ? client?.avatarDisplayUrl || avatarUrl : avatarUrl),
    [avatarUrl, client?.avatarDisplayUrl],
  );

  const [avatarSheetVisible, setAvatarSheetVisible] = React.useState(false);
  const [cropVisible, setCropVisible] = React.useState(false);
  const [cropSrc, setCropSrc] = React.useState(null);
  const [avatarKey, setAvatarKey] = React.useState(0);
  const [viewAvatarVisible, setViewAvatarVisible] = React.useState(false);

  const [cancelVisible, setCancelVisible] = React.useState(false);
  const [cancelKey, setCancelKey] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const [initialSnap, setInitialSnap] = React.useState(null);
  const [duplicateClient, setDuplicateClient] = React.useState(null);

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
    const nextAdditionalPhones = getClientAdditionalPhones(client);
    const nextVisibleSlots = getVisibleAdditionalPhoneSlotIds(nextAdditionalPhones);
    const next = {
      firstName: client.firstName || '',
      lastName: client.lastName || '',
      middleName: client.middleName || '',
      comment: client.comment || '',
      email: client.email || '',
      phone: client.phone || '',
      additionalPhones: nextAdditionalPhones,
      additionalPhoneVisibleSlots: nextVisibleSlots,
      avatarUrl: client.avatarUrl || '',
      tags: Array.isArray(client?.tags) ? client.tags.map((tag) => String(tag?.value || '').trim()) : [],
    };

    setFirstName(next.firstName);
    setLastName(next.lastName);
    setMiddleName(next.middleName);
    setComment(next.comment);
    setEmail(next.email);
    setPhone(next.phone);
    setAdditionalPhones(next.additionalPhones);
    setVisibleAdditionalPhoneSlots(nextVisibleSlots);
    setAvatarUrl(next.avatarUrl);
    setTags(next.tags);
    setInitialSnap(snapshotClientForm(next));
  }, [client]);

  React.useEffect(() => {
    let active = true;
    const hasValue = hasMobilePhoneValue(phone);
    const isValid = isValidOptionalMobilePhone(phone);
    if (!hasValue || !isValid || !clientId) {
      setDuplicateClient(null);
      return () => {
        active = false;
      };
    }
    const timerId = setTimeout(async () => {
      try {
        const found = await findClientByPrimaryPhone(phone, { excludeClientId: String(clientId) });
        if (!active) return;
        setDuplicateClient(found || null);
      } catch {
        if (!active) return;
        setDuplicateClient(null);
      }
    }, 240);
    return () => {
      active = false;
      clearTimeout(timerId);
    };
  }, [clientId, phone]);

  const updateAdditionalPhoneBySlotId = React.useCallback((slotId, patch) => {
    const slotIndex = Number(slotId) - 1;
    if (!Number.isFinite(slotIndex) || slotIndex < 0) return;
    setAdditionalPhones((prev) =>
      prev.map((item, itemIndex) =>
        itemIndex === slotIndex ? { ...item, ...patch } : item,
      ),
    );
  }, []);

  const canAddAdditionalPhone = visibleAdditionalPhoneSlots.length < CLIENT_ADDITIONAL_PHONE_SLOT_COUNT;

  const handleAddAdditionalPhone = React.useCallback(() => {
    setVisibleAdditionalPhoneSlots((prev) => {
      const nextSlotId = getNextHiddenAdditionalPhoneSlotId(prev);
      if (!nextSlotId) return prev;
      return [...prev, nextSlotId].sort((a, b) => a - b);
    });
  }, []);

  const handleRemoveAdditionalPhone = React.useCallback((slotId) => {
    setVisibleAdditionalPhoneSlots((prev) => prev.filter((value) => value !== slotId));
  }, []);

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

  const blockingOrdersCount = Number(deleteBlockers?.blockingOrdersCount || 0);
  const blockingObjectsCount = Number(deleteBlockers?.blockingObjectsCount || 0);
  const accessibleBlockingOrdersCount = canViewAllOrders
    ? blockingOrdersCount
    : Number(deleteBlockers?.myOrdersCount || 0) + Number(deleteBlockers?.feedOrdersCount || 0);

  const blockersRoute = React.useMemo(() => {
    if (!deleteBlockers) return null;
    const relationClientId = String(clientId || '');
    const relationObjectIds = Array.isArray(deleteBlockers?.blockingObjectIds)
      ? deleteBlockers.blockingObjectIds.map((value) => String(value || '')).filter(Boolean)
      : [];

    if (
      !hasRelationFilters({
        clientId: relationClientId,
        objectIds: relationObjectIds,
      })
    ) {
      return null;
    }

    if (!canViewAllOrders && accessibleBlockingOrdersCount <= 0) {
      return null;
    }

    return {
      pathname: canViewAllOrders ? '/orders/all-orders' : '/orders/my-orders',
      params: {
        ...(canViewAllOrders ? {} : { seedFilter: 'all' }),
        relation_client_id: relationClientId,
        relation_object_ids: relationObjectIds.join(','),
        relation_label: headerName,
      },
    };
  }, [accessibleBlockingOrdersCount, canViewAllOrders, clientId, deleteBlockers, headerName]);

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
        comment,
        email,
        phone,
        additionalPhones,
        additionalPhoneVisibleSlots: visibleAdditionalPhoneSlots,
        avatarUrl,
        tags,
      }) !== initialSnap
    );
  }, [
    avatarUrl,
    email,
    firstName,
    initialSnap,
    lastName,
    middleName,
    comment,
    phone,
    additionalPhones,
    visibleAdditionalPhoneSlots,
    tags,
  ]);

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

  const openDuplicateClient = React.useCallback(() => {
    if (!duplicateClient?.id) return;
    router.push({
      pathname: `/clients/${duplicateClient.id}/edit`,
      params: {
        ...(flowKey ? { flow_key: flowKey, select_mode: selectMode ? '1' : '0' } : {}),
        ...(flowReturnTo ? { flow_return_to: flowReturnTo } : {}),
      },
    });
  }, [duplicateClient?.id, flowKey, flowReturnTo, router, selectMode]);

  const handleChooseClient = React.useCallback(async () => {
    if (!clientId || !flowKey) return;
    try {
      await AsyncStorage.setItem(
        `order_client_flow:${String(flowKey)}`,
        JSON.stringify({ selectedClientId: String(clientId), ts: Date.now() }),
      );
    } catch {}
    allowLeaveRef.current = true;
    router.back();
  }, [clientId, flowKey, router]);

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
      if (clientId) {
        refetchDeleteBlockers().catch(() => {});
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (allowLeaveRef.current) return false;
        if (!isDirty) return false;
        setCancelKey((v) => v + 1);
        setCancelVisible(true);
        return true;
      });
      return () => sub.remove();
    }, [clientId, isDirty, refetchDeleteBlockers]),
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
    if (!hasMobilePhoneValue(phone)) {
      toast.warning(t('clients_required_phone'));
      return false;
    }
    if (!isValidOptionalMobilePhone(phone)) {
      toast.warning(t('err_phone'));
      return false;
    }
    if (duplicateClient?.id) {
      toast.warning(t('clients_phone_duplicate_hint'));
      return false;
    }
    const firstInvalidAdditional = visibleAdditionalPhoneSlots.find((slotId) => {
      const slotIndex = Number(slotId) - 1;
      const value = additionalPhones?.[slotIndex]?.phone || '';
      return hasMobilePhoneValue(value) && !isValidOptionalMobilePhone(value);
    });
    if (firstInvalidAdditional) {
      toast.warning(t('err_phone'));
      return false;
    }

    setSaving(true);
    try {
      const patch = {
        first_name: cleanFirstName,
        last_name: cleanLastName,
        middle_name: cleanMiddleName || null,
        comment: String(comment || '').trim() || null,
        email: String(email || '').trim().toLowerCase() || null,
        phone: normalizeOptionalMobilePhone(phone),
        ...buildClientAdditionalPhonesPatch(additionalPhones, {
          defaultLabel: t('order_field_secondary_phone'),
          visibleSlotIds: visibleAdditionalPhoneSlots,
        }),
      };

      if (!avatarUrl) {
        if (client?.avatarUrl) {
          await cleanupProfileMediaEntity('client', String(clientId));
        }
        patch.avatar_url = null;
      } else if (String(avatarUrl).startsWith('http')) {
        patch.avatar_url = avatarUrl;
      }

      await updateMutation.mutateAsync({
        id: String(clientId),
        patch,
      });

      if (settings?.enable_client_tags) {
        await setClientTagsMutation.mutateAsync({
          clientId: String(clientId),
          tags,
        });
      }

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
      const duplicateClientId = extractConflictingClientId(error);
      if (duplicateClientId) {
        try {
          const found = await getClientById(duplicateClientId);
          setDuplicateClient(
            found
              ? {
                  id: String(found.id),
                  fullName: found.fullName || '',
                  phone: found.phone || null,
                }
              : { id: duplicateClientId },
          );
        } catch {
          setDuplicateClient({ id: duplicateClientId });
        }
        toast.warning(t('clients_phone_duplicate_hint'));
        return false;
      }
      const tagError = resolveTagErrorMessage(error, t);
      toast.error(tagError || error?.message || t('clients_save_failed'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [
    avatarUrl,
    canEditClients,
    clientId,
    client?.avatarUrl,
    email,
    firstName,
    lastName,
    middleName,
    comment,
    navigation,
    phone,
    additionalPhones,
    visibleAdditionalPhoneSlots,
    duplicateClient?.id,
    router,
    saving,
    t,
    toast,
    updateMutation,
    setClientTagsMutation,
    settings?.enable_client_tags,
    tags,
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
        rightTextLabel={
          selectMode && flowKey
            ? t('btn_choose')
            : saving
              ? t('toast_saving')
              : t('header_save')
        }
        onRightPress={selectMode && flowKey ? handleChooseClient : saveClient}
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
              {avatarDisplayUrl ? (
                <ExpoImage
                  source={{ uri: avatarDisplayUrl }}
                  style={styles.avatarImg}
                  contentFit="cover"
                  cachePolicy="none"
                />
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
            label={t('clients_comment_label')}
            value={comment}
            onChangeText={setComment}
            placeholder={t('clients_comment_placeholder')}
            maxLength={CLIENT_COMMENT_MAX_LENGTH}
            multiline
            numberOfLines={3}
            style={styles.field}
          />
          {settings?.enable_client_tags ? (
            <TagEditorField
              label={t('tags_field_label')}
              tagType={TAG_TYPE.CLIENT}
              tags={tags}
              onChange={setTags}
              placeholder={t('tags_input_placeholder')}
            />
          ) : null}
        </Card>
        <SectionHeader topSpacing="xs">{t('clients_contacts_section')}</SectionHeader>
        <Card paddedXOnly>
          <TextField
            label={t('label_email')}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            style={styles.field}
          />
          <PhoneInput value={phone} onChangeText={setPhone} style={styles.field} required />
          {duplicateClient?.id ? (
            <Pressable
              onPress={openDuplicateClient}
              style={styles.duplicateHintRow}
              accessibilityRole="button"
            >
              <Text style={styles.duplicateHintText}>{t('clients_phone_duplicate_hint')}</Text>
              <Text style={styles.duplicateHintAction}>{t('clients_phone_duplicate_action')}</Text>
            </Pressable>
          ) : null}
          {visibleAdditionalPhoneSlots.map((slotId) => {
            const slotIndex = slotId - 1;
            const entry = additionalPhones[slotIndex] || { phone: '', label: '' };
            return (
              <AdditionalPhoneInputRow
                key={`additional-phone-${slotId}`}
                phoneValue={entry.phone || ''}
                onPhoneChange={(nextValue) => updateAdditionalPhoneBySlotId(slotId, { phone: nextValue })}
                designationValue={entry.label || ''}
                onDesignationChange={(nextValue) => updateAdditionalPhoneBySlotId(slotId, { label: nextValue })}
                onRemove={() => handleRemoveAdditionalPhone(slotId)}
                style={styles.additionalPhoneGroup}
              />
            );
          })}
          {canAddAdditionalPhone ? (
            <View style={styles.additionalPhoneAddRow}>
              <Text style={styles.additionalPhoneAddText}>{t('clients_additional_phone_add')}</Text>
              <Pressable
                onPress={handleAddAdditionalPhone}
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
                  onPress={() =>
                    router.push({
                      pathname: `/objects/${objectItem.id}`,
                      params: {
                        returnTo: `/clients/${clientId}/edit`,
                        returnParams: JSON.stringify({ returnTo, returnParams: JSON.stringify(returnParams) }),
                      },
                    })
                  }
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

        {canDeleteClients && !(selectMode && flowKey) ? (
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

      <BaseModal
        visible={deleteVisible}
        onClose={() => setDeleteVisible(false)}
        title={t('clients_delete_title')}
        footer={
          deleteBlockersLoading ? (
            <ModalActionsRow
              actions={[
                {
                  key: 'cancel',
                  title: t('btn_cancel'),
                  variant: 'secondary',
                  onPress: () => setDeleteVisible(false),
                },
                {
                  key: 'loading',
                  title: t('clients_delete_checking_orders'),
                  variant: 'secondary',
                  disabled: true,
                  loading: true,
                },
              ]}
            />
          ) : blockingOrdersCount > 0 ? (
            <ModalActionsRow
              actions={[
                {
                  key: 'cancel',
                  title: t('btn_cancel'),
                  variant: 'secondary',
                  onPress: () => setDeleteVisible(false),
                },
                blockersRoute
                  ? {
                      key: 'view',
                      title: t('common_view'),
                      variant: 'primary',
                      onPress: () => {
                        setDeleteVisible(false);
                        router.push(blockersRoute);
                      },
                    }
                  : null,
              ]}
            />
          ) : (
            <ModalActionsRow
              actions={[
                {
                  key: 'cancel',
                  title: t('btn_cancel'),
                  variant: 'secondary',
                  onPress: () => setDeleteVisible(false),
                },
                {
                  key: 'delete',
                  title: t('btn_delete'),
                  variant: 'destructive',
                  loading: deleteMutation.isPending,
                  onPress: async () => {
                    try {
                      const latest = await refetchDeleteBlockers();
                      const nextBlockingCount = Number(latest?.data?.blockingOrdersCount || 0);
                      if (nextBlockingCount > 0) {
                        toast.warning(t('clients_delete_has_orders'));
                        return;
                      }
                      await cleanupProfileMediaEntity('client', String(clientId || ''));
                      for (const objectItem of clientObjects || []) {
                        await cleanupProfileMediaEntity('object', String(objectItem?.id || ''));
                      }
                      await deleteMutation.mutateAsync(String(clientId || ''));
                      toast.success(t('clients_deleted_success'));
                      setDeleteVisible(false);
                      allowLeaveRef.current = true;
                      dismissToRoute(router, {
                        pathname: returnTo,
                        params: returnParams,
                      });
                    } catch (error) {
                      const rawMessage = String(error?.message || '');
                      if (
                        rawMessage.includes('orders_client_id_fkey') ||
                        rawMessage.includes('orders_object_id_fkey') ||
                        rawMessage.includes('violates foreign key constraint')
                      ) {
                        toast.error(t('clients_delete_has_orders'));
                        return;
                      }
                      toast.error(rawMessage || t('clients_save_failed'));
                    }
                  },
                },
              ]}
            />
          )
        }
      >
        <View style={styles.deleteModalContent}>
          {deleteBlockersLoading ? (
            <View style={styles.deleteModalLoading}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
              <Text style={styles.deleteModalMessage}>{t('clients_delete_checking_orders')}</Text>
            </View>
          ) : deleteBlockersError ? (
            <Text style={styles.deleteModalMessage}>{t('clients_delete_check_failed')}</Text>
          ) : blockingOrdersCount > 0 ? (
            <>
              <Text style={styles.deleteModalMessage}>
                {t('clients_delete_blocked_message')
                  .replace('{orders}', String(blockingOrdersCount))
                  .replace('{objects}', String(blockingObjectsCount))}
              </Text>
              {!canViewAllOrders && Number(deleteBlockers?.otherOrdersCount || 0) > 0 ? (
                <Text style={styles.deleteModalHint}>
                  {t('clients_delete_blocked_other_orders').replace(
                    '{count}',
                    String(deleteBlockers?.otherOrdersCount || 0),
                  )}
                </Text>
              ) : null}
              {deleteBlockers?.isPartial ? (
                <Text style={styles.deleteModalHint}>{t('clients_delete_partial_check')}</Text>
              ) : null}
            </>
          ) : (
            <Text style={styles.deleteModalMessage}>{t('clients_delete_message')}</Text>
          )}
        </View>
      </BaseModal>

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
          {avatarDisplayUrl ? (
            <ExpoImage
              source={{ uri: avatarDisplayUrl }}
              style={styles.avatarPreviewImg}
              contentFit="contain"
              cachePolicy="none"
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
    duplicateHintRow: {
      marginBottom: theme.spacing.xs,
      paddingHorizontal: Number(theme.spacing?.lg ?? 16),
      paddingTop: Math.max(2, Number(theme.spacing?.xxs ?? 2)),
      paddingBottom: Number(theme.spacing?.xs ?? 8),
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.xs,
    },
    duplicateHintText: {
      flex: 1,
      color: theme.colors.warning,
      fontSize: theme.typography.sizes.sm,
    },
    duplicateHintAction: {
      color: theme.colors.primary,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.semibold,
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
    deleteModalContent: {
      gap: theme.spacing.sm,
      paddingBottom: theme.spacing.sm,
    },
    deleteModalLoading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    deleteModalMessage: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.md,
      lineHeight: Math.round(theme.typography.sizes.md * 1.35),
    },
    deleteModalHint: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      lineHeight: Math.round(theme.typography.sizes.sm * 1.4),
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
