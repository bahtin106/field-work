import React from 'react';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import AdditionalPhoneInputRow from '../../components/clients/AdditionalPhoneInputRow';
import ClientObjectEditorModal from '../../components/objects/ClientObjectEditorModal';
import EditScreenTemplate from '../../components/layout/EditScreenTemplate';
import Card from '../../components/ui/Card';
import PhoneInput from '../../components/ui/PhoneInput';
import SectionHeader from '../../components/ui/SectionHeader';
import TextField from '../../components/ui/TextField';
import { SelectModal } from '../../components/ui/modals';
import { useToast } from '../../components/ui/ToastProvider';
import TagEditorField from '../../components/tags/TagEditorField';
import { TAG_TYPE } from '../../components/tags/tagConfig';
import { useCompanySettings } from '../../hooks/useCompanySettings';
import { usePermissions } from '../../lib/permissions';
import { useCreateClientMutation, useUpdateClientMutation } from '../../src/features/clients/queries';
import {
  extractConflictingClientId,
  findClientByPrimaryPhone,
} from '../../src/features/clients/api';
import { useCreateClientObjectMutation } from '../../src/features/objects/queries';
import { useSetClientTagsMutation } from '../../src/features/tags/queries';
import { resolveTagErrorMessage } from '../../src/features/tags/errors';
import { uploadClientAvatar } from '../../src/features/clients/avatar';
import { CLIENT_COMMENT_MAX_LENGTH } from '../../src/features/clients/constants';
import {
  buildClientAdditionalPhonesPatch,
  CLIENT_ADDITIONAL_PHONE_SLOT_COUNT,
  createEmptyAdditionalClientPhones,
  getNextHiddenAdditionalPhoneSlotId,
} from '../../src/features/clients/additionalPhones';
import {
  hasMobilePhoneValue,
  isValidOptionalMobilePhone,
  normalizeOptionalMobilePhone,
} from '../../src/shared/validation/phone';
import {
  buildClientObjectAddressSummary,
  createEmptyClientObjectDraft,
  hasClientObjectAddressContent,
  sanitizeClientObjectPayload,
} from '../../src/features/objects/addressing';
import { useTheme } from '../../theme/ThemeProvider';
import { useTranslation } from '../../src/i18n/useTranslation';

const IMAGE_MEDIA_TYPES = (() => {
  try {
    if (ImagePicker.MediaType && ImagePicker.MediaType.Images) return ImagePicker.MediaType.Images;
    if (ImagePicker.MediaType && ImagePicker.MediaType.images) return ImagePicker.MediaType.images;
    if (ImagePicker.MediaType && ImagePicker.MediaType.image) return ImagePicker.MediaType.image;
  } catch {}
  return ['images'];
})();

export default function NewClientScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const router = useRouter();
  const params = useLocalSearchParams();
  const prefillFirstName = Array.isArray(params?.prefill_first_name)
    ? params.prefill_first_name[0]
    : params?.prefill_first_name;
  const prefillLastName = Array.isArray(params?.prefill_last_name)
    ? params.prefill_last_name[0]
    : params?.prefill_last_name;
  const prefillMiddleName = Array.isArray(params?.prefill_middle_name)
    ? params.prefill_middle_name[0]
    : params?.prefill_middle_name;
  const prefillPhone = Array.isArray(params?.prefill_phone)
    ? params.prefill_phone[0]
    : params?.prefill_phone;
  const flowKey = Array.isArray(params?.flow_key) ? params.flow_key[0] : params?.flow_key;
  const flowReturnTo = Array.isArray(params?.flow_return_to)
    ? params.flow_return_to[0]
    : params?.flow_return_to;
  const { has } = usePermissions();
  const canCreateClients = has('canCreateClients');

  const createMutation = useCreateClientMutation();
  const createObjectMutation = useCreateClientObjectMutation();
  const updateMutation = useUpdateClientMutation();
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
  const [avatarUrl, setAvatarUrl] = React.useState('');
  const [primaryObjectDraft, setPrimaryObjectDraft] = React.useState(createEmptyClientObjectDraft());
  const [tags, setTags] = React.useState([]);
  const [objectModalVisible, setObjectModalVisible] = React.useState(false);
  const [avatarSheetVisible, setAvatarSheetVisible] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [duplicateClient, setDuplicateClient] = React.useState(null);
  const prefillAppliedRef = React.useRef(false);

  const styles = React.useMemo(() => createStyles(theme), [theme]);

  React.useEffect(() => {
    if (prefillAppliedRef.current) return;
    prefillAppliedRef.current = true;
    if (prefillFirstName) setFirstName(String(prefillFirstName));
    if (prefillLastName) setLastName(String(prefillLastName));
    if (prefillMiddleName) setMiddleName(String(prefillMiddleName));
    if (prefillPhone) setPhone(String(prefillPhone));
  }, [prefillFirstName, prefillLastName, prefillMiddleName, prefillPhone]);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      const passSelectedClientToOrderFlow = async () => {
        if (!flowKey) return;
        const key = `order_client_flow:${String(flowKey)}`;
        try {
          const raw = await AsyncStorage.getItem(key);
          if (!raw || cancelled) return;
          const parsed = JSON.parse(raw);
          const selectedClientId = String(parsed?.selectedClientId || '').trim();
          if (!selectedClientId) return;
          router.back();
        } catch {}
      };
      void passSelectedClientToOrderFlow();
      return () => {
        cancelled = true;
      };
    }, [flowKey, router]),
  );

  React.useEffect(() => {
    let active = true;
    const hasValue = hasMobilePhoneValue(phone);
    const isValid = isValidOptionalMobilePhone(phone);
    if (!hasValue || !isValid) {
      setDuplicateClient(null);
      return () => {
        active = false;
      };
    }
    const timerId = setTimeout(async () => {
      try {
        const found = await findClientByPrimaryPhone(phone);
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
  }, [phone]);

  const openDuplicateClient = React.useCallback(() => {
    if (!duplicateClient?.id) return;
    router.push({
      pathname: `/clients/${duplicateClient.id}/edit`,
      params: {
        ...(flowKey ? { flow_key: String(flowKey), select_mode: '1' } : {}),
        ...(flowReturnTo ? { flow_return_to: String(flowReturnTo) } : {}),
      },
    });
  }, [duplicateClient?.id, flowKey, flowReturnTo, router]);

  const pickAvatar = React.useCallback(async (source) => {
    try {
      if (source === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          toast.warning(t('error_camera_denied'));
          return;
        }
        const result = await ImagePicker.launchCameraAsync({
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.9,
          mediaTypes: IMAGE_MEDIA_TYPES,
        });
        if (!result.canceled && result.assets?.[0]?.uri) {
          setAvatarUrl(result.assets[0].uri);
        }
        return;
      }

      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        toast.warning(t('error_library_denied'));
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
        mediaTypes: IMAGE_MEDIA_TYPES,
      });
      if (!result.canceled && result.assets?.[0]?.uri) {
        setAvatarUrl(result.assets[0].uri);
      }
    } catch (error) {
      toast.error(error?.message || t('clients_save_failed'));
    } finally {
      setAvatarSheetVisible(false);
    }
  }, [t, toast]);

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

  const saveClient = React.useCallback(async () => {
    if (!canCreateClients || saving) return;

    const cleanFirstName = String(firstName || '').trim();
    const cleanLastName = String(lastName || '').trim();
    const cleanMiddleName = String(middleName || '').trim();
    if (!cleanFirstName && !cleanLastName && !cleanMiddleName) {
      toast.warning(t('clients_required_any_name'));
      return;
    }
    if (!hasMobilePhoneValue(phone)) {
      toast.warning(t('clients_required_phone'));
      return;
    }
    if (!isValidOptionalMobilePhone(phone)) {
      toast.warning(t('err_phone'));
      return;
    }
    if (duplicateClient?.id) {
      toast.warning(t('clients_phone_duplicate_hint'));
      return;
    }
    const firstInvalidAdditional = visibleAdditionalPhoneSlots.find((slotId) => {
      const slotIndex = Number(slotId) - 1;
      const value = additionalPhones?.[slotIndex]?.phone || '';
      return hasMobilePhoneValue(value) && !isValidOptionalMobilePhone(value);
    });
    if (firstInvalidAdditional) {
      toast.warning(t('err_phone'));
      return;
    }

    setSaving(true);
    try {
      const created = await createMutation.mutateAsync({
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
      });

      if (!created?.id) {
        throw new Error(t('clients_save_failed'));
      }

      if (avatarUrl && !String(avatarUrl).startsWith('http')) {
        const uploadedUrl = await uploadClientAvatar(created.id, avatarUrl);
        if (uploadedUrl) {
          await updateMutation.mutateAsync({
            id: created.id,
            patch: { avatar_url: uploadedUrl },
          });
        }
      }

      if (hasClientObjectAddressContent(primaryObjectDraft)) {
        await createObjectMutation.mutateAsync({
          client_id: created.id,
          is_primary: true,
          ...sanitizeClientObjectPayload(primaryObjectDraft),
        });
      }

      if (settings?.enable_client_tags && tags.length > 0) {
        await setClientTagsMutation.mutateAsync({
          clientId: String(created.id),
          tags,
        });
      }

      toast.success(t('clients_created_success'));
      if (flowKey) {
        try {
          await AsyncStorage.setItem(
            `order_client_flow:${String(flowKey)}`,
            JSON.stringify({ createdClientId: String(created.id), ts: Date.now() }),
          );
        } catch {}
        router.back();
        return;
      }
      router.replace(`/clients/${created.id}`);
    } catch (error) {
      const duplicateClientId = extractConflictingClientId(error);
      if (duplicateClientId) {
        try {
          const found = await findClientByPrimaryPhone(phone);
          setDuplicateClient(found || { id: duplicateClientId });
        } catch {
          setDuplicateClient({ id: duplicateClientId });
        }
        toast.warning(t('clients_phone_duplicate_hint'));
        return;
      }
      const tagError = resolveTagErrorMessage(error, t);
      toast.error(tagError || error?.message || t('clients_save_failed'));
    } finally {
      setSaving(false);
    }
  }, [
    canCreateClients,
    createMutation,
    createObjectMutation,
    setClientTagsMutation,
    updateMutation,
    email,
    firstName,
    lastName,
    middleName,
    comment,
    primaryObjectDraft,
    settings?.enable_client_tags,
    tags,
    avatarUrl,
    phone,
    flowKey,
    additionalPhones,
    visibleAdditionalPhoneSlots,
    duplicateClient?.id,
    router,
    saving,
    t,
    toast,
  ]);

  if (!canCreateClients) {
    return (
      <EditScreenTemplate title={t('routes_clients_new')}>
        <View style={styles.blockedWrap}>
          <Text style={styles.blockedText}>{t('clients_no_create_permission')}</Text>
        </View>
      </EditScreenTemplate>
    );
  }

  return (
    <>
      <EditScreenTemplate
        title={t('routes_clients_new')}
        rightTextLabel={saving ? t('toast_saving') : t('btn_create')}
        onRightPress={saveClient}
      >
        <View style={styles.avatarWrap}>
          <Pressable style={styles.avatarBox} onPress={() => setAvatarSheetVisible(true)}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImg} />
            ) : (
              <Text style={styles.avatarText}>+</Text>
            )}
          </Pressable>
        </View>

        <SectionHeader topSpacing="xs">{t('section_personal')}</SectionHeader>
        <Card paddedXOnly>
          <TextField
            label={t('label_first_name')}
            value={firstName}
            onChangeText={setFirstName}
            required
            style={styles.field}
          />
          <TextField
            label={t('label_last_name')}
            value={lastName}
            onChangeText={setLastName}
            required
            style={styles.field}
          />
          <TextField
            label={t('label_middle_name')}
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
          <Pressable onPress={() => setObjectModalVisible(true)} style={styles.addressCard}>
            <Text style={styles.addressTitle}>{t('objects_primary')}</Text>
            <Text style={styles.addressSummary}>
              {buildClientObjectAddressSummary(primaryObjectDraft) || t('objects_empty')}
            </Text>
          </Pressable>
        </Card>
      </EditScreenTemplate>

      <SelectModal
        visible={avatarSheetVisible}
        onClose={() => setAvatarSheetVisible(false)}
        title={t('profile_photo_title')}
        searchable={false}
        items={[
          {
            id: 'camera',
            label: t('profile_photo_take'),
            onPress: () => pickAvatar('camera'),
          },
          {
            id: 'gallery',
            label: t('profile_photo_choose'),
            onPress: () => pickAvatar('gallery'),
          },
          ...(avatarUrl
            ? [
                {
                  id: 'remove',
                  label: t('profile_photo_delete'),
                  onPress: () => {
                    setAvatarUrl('');
                    setAvatarSheetVisible(false);
                  },
                },
              ]
            : []),
        ]}
        onSelect={(item) => item?.onPress?.()}
      />

      <ClientObjectEditorModal
        visible={objectModalVisible}
        title={t('objects_primary')}
        draft={primaryObjectDraft}
        onChange={(field, value) => {
          setPrimaryObjectDraft((prev) => ({ ...prev, [field]: value }));
        }}
        onSave={() => setObjectModalVisible(false)}
        onClose={() => setObjectModalVisible(false)}
      />
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
    avatarWrap: {
      alignItems: 'center',
      marginBottom: theme.spacing.md,
    },
    avatarBox: {
      width: theme.components?.avatar?.xl ?? 96,
      height: theme.components?.avatar?.xl ?? 96,
      borderRadius: (theme.components?.avatar?.xl ?? 96) / 2,
      borderWidth: theme.components?.card?.borderWidth ?? 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarImg: {
      width: '100%',
      height: '100%',
    },
    avatarText: {
      color: theme.colors.primary,
      fontSize: theme.typography.sizes.xl,
      fontWeight: theme.typography.weight.semibold,
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
    addressCard: {
      paddingVertical: theme.spacing.sm,
    },
    addressTitle: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
      marginBottom: theme.spacing.xs,
    },
    addressSummary: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
  });
}
