import React from 'react';
import * as ImagePicker from 'expo-image-picker';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import ClientObjectEditorModal from '../../components/objects/ClientObjectEditorModal';
import EditScreenTemplate from '../../components/layout/EditScreenTemplate';
import Card from '../../components/ui/Card';
import PhoneInput from '../../components/ui/PhoneInput';
import SectionHeader from '../../components/ui/SectionHeader';
import TextField from '../../components/ui/TextField';
import { SelectModal } from '../../components/ui/modals';
import { useToast } from '../../components/ui/ToastProvider';
import { usePermissions } from '../../lib/permissions';
import { useCreateClientMutation, useUpdateClientMutation } from '../../src/features/clients/queries';
import { useCreateClientObjectMutation } from '../../src/features/objects/queries';
import { uploadClientAvatar } from '../../src/features/clients/avatar';
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
  const { has } = usePermissions();
  const canCreateClients = has('canCreateClients');

  const createMutation = useCreateClientMutation();
  const createObjectMutation = useCreateClientObjectMutation();
  const updateMutation = useUpdateClientMutation();

  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [middleName, setMiddleName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [secondaryPhone, setSecondaryPhone] = React.useState('');
  const [contactPref, setContactPref] = React.useState('');
  const [avatarUrl, setAvatarUrl] = React.useState('');
  const [primaryObjectDraft, setPrimaryObjectDraft] = React.useState(createEmptyClientObjectDraft());
  const [objectModalVisible, setObjectModalVisible] = React.useState(false);
  const [avatarSheetVisible, setAvatarSheetVisible] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const styles = React.useMemo(() => createStyles(theme), [theme]);

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

  const saveClient = React.useCallback(async () => {
    if (!canCreateClients || saving) return;

    const cleanFirstName = String(firstName || '').trim();
    const cleanLastName = String(lastName || '').trim();
    const cleanMiddleName = String(middleName || '').trim();
    if (!cleanFirstName && !cleanLastName && !cleanMiddleName) {
      toast.warning(t('clients_required_any_name'));
      return;
    }

    setSaving(true);
    try {
      const created = await createMutation.mutateAsync({
        first_name: cleanFirstName,
        last_name: cleanLastName,
        middle_name: cleanMiddleName || null,
        email: String(email || '').trim().toLowerCase() || null,
        phone: String(phone || '').trim() || null,
        secondary_phone: String(secondaryPhone || '').trim() || null,
        contact_pref: String(contactPref || '').trim() || null,
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

      toast.success(t('clients_created_success'));
      router.replace(`/clients/${created.id}`);
    } catch (error) {
      toast.error(error?.message || t('clients_save_failed'));
    } finally {
      setSaving(false);
    }
  }, [
    canCreateClients,
    createMutation,
    createObjectMutation,
    updateMutation,
    email,
    firstName,
    lastName,
    middleName,
    primaryObjectDraft,
    avatarUrl,
    phone,
    secondaryPhone,
    contactPref,
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
