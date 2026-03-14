import React from 'react';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
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
import { useTranslation } from '../../../../src/i18n/useTranslation';
import { hasDisplayValue } from '../../../../src/shared/display/value';
import { getRequiredTextFieldError } from '../../../../src/shared/validation/fields';
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
  const withRequiredLabel = React.useCallback(
    (field, label) => getRequiredFieldLabel(label, objectFieldsByKey.get(field)?.isRequired === true),
    [objectFieldsByKey],
  );

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
    setSaving(true);
    try {
      const created = await createMutation.mutateAsync({
        client_id: String(clientId),
        ...sanitizeClientObjectPayload(draft),
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
  }, [canCreateObjects, clientId, createMutation, draft, objectFieldsByKey, router, saving, setObjectTagsMutation, settings?.enable_object_tags, t, tags, toast, visibleAddressFields]);

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
  });
}
