import React from 'react';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import AdditionalPhoneInputRow from '../../../../components/clients/AdditionalPhoneInputRow';
import EditScreenTemplate from '../../../../components/layout/EditScreenTemplate';
import Card from '../../../../components/ui/Card';
import SectionHeader from '../../../../components/ui/SectionHeader';
import TextField from '../../../../components/ui/TextField';
import { useToast } from '../../../../components/ui/ToastProvider';
import TagEditorField from '../../../../components/tags/TagEditorField';
import { TAG_TYPE } from '../../../../components/tags/tagConfig';
import { useCompanySettings } from '../../../../hooks/useCompanySettings';
import { usePermissions } from '../../../../lib/permissions';
import { FieldErrorText, FEEDBACK_CODES, getMessageByCode } from '../../../../src/shared/feedback';
import { getRequiredFieldLabel } from '../../../../src/shared/forms/fieldValidation';
import { useClient } from '../../../../src/features/clients/queries';
import { useCreateClientObjectMutation } from '../../../../src/features/objects/queries';
import { useEntityFieldSettings } from '../../../../src/features/fieldSettings/queries';
import {
  ENTITY_FIELD_TYPES,
  buildFallbackEntityFieldSettings,
  getOrderedEntityFields,
  getEntityFieldMap,
} from '../../../../src/features/fieldSettings/catalog';
import { useSetObjectTagsMutation } from '../../../../src/features/tags/queries';
import {
  CLIENT_OBJECT_ADDRESS_FIELDS,
  createEmptyClientObjectDraft,
  hasClientObjectAddressContent,
  sanitizeClientObjectPayload,
} from '../../../../src/features/objects/addressing';
import {
  buildObjectAdditionalPhonesPatch,
  createEmptyAdditionalObjectPhones,
  getAddableAdditionalObjectPhoneSlotIds,
  getVisibleAdditionalObjectPhoneSlotIds,
  OBJECT_ADDITIONAL_PHONE_SLOT_COUNT,
  resolveVisibleAdditionalObjectPhoneSlotIds,
} from '../../../../src/features/objects/additionalPhones';
import { useTranslation } from '../../../../src/i18n/useTranslation';
import { hasDisplayValue } from '../../../../src/shared/display/value';
import { getRequiredTextFieldError } from '../../../../src/shared/validation/fields';
import { hasMobilePhoneValue, isValidOptionalMobilePhone } from '../../../../src/shared/validation/phone';
import { useTheme } from '../../../../theme/ThemeProvider';

export default function NewClientObjectScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const router = useRouter();
  const navigation = useNavigation();
  const { has } = usePermissions();
  const { id } = useLocalSearchParams();
  const clientId = Array.isArray(id) ? id[0] : id;

  const canCreateObjects = has('canCreateObjects');
  const canViewClients = has('canViewClients');
  const { data: client } = useClient(clientId, { enabled: !!clientId && canViewClients });
  const { settings } = useCompanySettings();
  const { data: objectFieldSettingsData } = useEntityFieldSettings(ENTITY_FIELD_TYPES.OBJECT, {
    enabled: !!clientId,
  });
  const createMutation = useCreateClientObjectMutation();
  const setObjectTagsMutation = useSetObjectTagsMutation();
  const [draft, setDraft] = React.useState(createEmptyClientObjectDraft());
  const [additionalPhones, setAdditionalPhones] = React.useState(createEmptyAdditionalObjectPhones());
  const [visibleAdditionalPhoneSlots, setVisibleAdditionalPhoneSlots] = React.useState([]);
  const [tags, setTags] = React.useState([]);
  const [saving, setSaving] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState({});
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const objectFieldSettings = React.useMemo(
    () => objectFieldSettingsData || buildFallbackEntityFieldSettings(ENTITY_FIELD_TYPES.OBJECT),
    [objectFieldSettingsData],
  );
  const objectFieldsByKey = React.useMemo(() => getEntityFieldMap(objectFieldSettings), [objectFieldSettings]);
  const visibleAddressFields = React.useMemo(
    () => CLIENT_OBJECT_ADDRESS_FIELDS.filter((field) => objectFieldsByKey.get(field)?.isEnabled !== false),
    [objectFieldsByKey],
  );
  const orderedAddressFields = React.useMemo(
    () =>
      getOrderedEntityFields(objectFieldSettings, {
        visibleOnly: true,
        requiredFirst: true,
        fieldKeys: CLIENT_OBJECT_ADDRESS_FIELDS,
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
  const updateAdditionalPhoneBySlotId = React.useCallback((slotId, patch) => {
    const slotIndex = Number(slotId) - 1;
    if (!Number.isFinite(slotIndex) || slotIndex < 0) return;
    setAdditionalPhones((prev) =>
      prev.map((item, itemIndex) => (itemIndex === slotIndex ? { ...item, ...patch } : item)),
    );
  }, []);
  const hiddenEnabledAdditionalPhoneSlots = React.useMemo(
    () => addableAdditionalPhoneSlots.filter((slotId) => !visibleAdditionalPhoneSlots.includes(slotId)),
    [addableAdditionalPhoneSlots, visibleAdditionalPhoneSlots],
  );
  const canAddAdditionalPhone =
    hiddenEnabledAdditionalPhoneSlots.length > 0 &&
    visibleAdditionalPhoneSlots.length < OBJECT_ADDITIONAL_PHONE_SLOT_COUNT;

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

  const saveObject = React.useCallback(async () => {
    if (!clientId || !canCreateObjects || saving) return;
    const nextFieldErrors = ['name', ...visibleAddressFields].reduce((acc, field) => {
      const message = getRequiredTextFieldError(draft?.[field], {
        required: objectFieldsByKey.get(field)?.isRequired === true,
        requiredMessage: getMessageByCode(FEEDBACK_CODES.REQUIRED_FIELD, t),
      });
      if (!message) return acc;
      return { ...acc, [field]: message };
    }, {});
    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) {
      return;
    }
    if (!hasClientObjectAddressContent(
      visibleAddressFields.reduce((acc, field) => ({ ...acc, [field]: draft?.[field] || '' }), {}),
    )) {
      toast.warning(t('order_details_address_not_specified'));
      return;
    }
    const firstInvalidAdditional = visibleAdditionalPhoneSlots.find((slotId) => {
      const slotIndex = Number(slotId) - 1;
      const value = additionalPhones?.[slotIndex]?.phone || '';
      if (requiredAdditionalPhoneSlots.includes(slotId) && !hasMobilePhoneValue(value)) return true;
      return hasMobilePhoneValue(value) && !isValidOptionalMobilePhone(value);
    });
    if (firstInvalidAdditional) {
      setFieldErrors((prev) => ({ ...prev, [`additional_phone_${firstInvalidAdditional}`]: t('err_phone') }));
      return;
    }
    setSaving(true);
    try {
      const created = await createMutation.mutateAsync({
        client_id: String(clientId),
        ...sanitizeClientObjectPayload(draft),
        ...buildObjectAdditionalPhonesPatch(additionalPhones, {
          defaultLabel: t('order_field_secondary_phone'),
          visibleSlotIds: visibleAdditionalPhoneSlots,
        }),
      });

      if (settings?.enable_object_tags && tags.length > 0) {
        await setObjectTagsMutation.mutateAsync({
          objectId: String(created.id),
          tags,
        });
      }

      toast.success(t('objects_saved'));
      router.replace(`/objects/${created.id}`);
    } catch (error) {
      toast.error(error?.message || t('clients_save_failed'));
    } finally {
      setSaving(false);
    }
  }, [additionalPhones, canCreateObjects, clientId, createMutation, draft, objectFieldsByKey, requiredAdditionalPhoneSlots, router, saving, setObjectTagsMutation, settings?.enable_object_tags, t, tags, toast, visibleAddressFields, visibleAdditionalPhoneSlots]);

  if (!canCreateObjects) {
    return (
      <EditScreenTemplate title={t('routes_objects_new')}>
        <View style={styles.blockedWrap}>
          <Text style={styles.blockedText}>{t('objects_no_create_permission')}</Text>
        </View>
      </EditScreenTemplate>
    );
  }

  return (
    <EditScreenTemplate
      title={t('routes_objects_new')}
      rightTextLabel={saving ? t('toast_saving') : t('btn_create')}
      onRightPress={saveObject}
      onBack={() => navigation.goBack()}
    >
      <Card style={styles.headerCard}>
        {hasDisplayValue(client?.fullName) ? (
          <Text style={styles.nameTitle}>{client.fullName}</Text>
        ) : null}
        <Text style={styles.clientName}>{t('routes_clients_client')}</Text>
      </Card>

      <SectionHeader topSpacing="xs">{t('section_personal')}</SectionHeader>
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
      </Card>

      <SectionHeader topSpacing="xs">{t('objects_address_section')}</SectionHeader>
      <Card paddedXOnly>
        {orderedAddressFields.map((field) => (
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
      {canShowContactSection ? <SectionHeader topSpacing="xs">{t('clients_contacts_section')}</SectionHeader> : null}
      {canShowContactSection ? (
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
      ) : null}
    </EditScreenTemplate>
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
  });
}
