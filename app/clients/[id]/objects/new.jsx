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
import { useClient } from '../../../../src/features/clients/queries';
import { useCreateClientObjectMutation } from '../../../../src/features/objects/queries';
import { useEntityFieldSettings } from '../../../../src/features/fieldSettings/queries';
import {
  ENTITY_FIELD_TYPES,
  buildFallbackEntityFieldSettings,
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

  const canEditClients = has('canEditClients');
  const { data: client } = useClient(clientId, { enabled: !!clientId });
  const { settings } = useCompanySettings();
  const { data: objectFieldSettingsData } = useEntityFieldSettings(ENTITY_FIELD_TYPES.OBJECT, {
    enabled: !!clientId,
  });
  const createMutation = useCreateClientObjectMutation();
  const setObjectTagsMutation = useSetObjectTagsMutation();
  const [draft, setDraft] = React.useState(createEmptyClientObjectDraft());
  const [tags, setTags] = React.useState([]);
  const [saving, setSaving] = React.useState(false);
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
  const withRequiredLabel = React.useCallback(
    (field, label) => (objectFieldsByKey.get(field)?.isRequired ? `${label} *` : label),
    [objectFieldsByKey],
  );

  const saveObject = React.useCallback(async () => {
    if (!clientId || !canEditClients || saving) return;
    const missingRequiredField = ['name', ...visibleAddressFields].find((field) => {
      if (!objectFieldsByKey.get(field)?.isRequired) return false;
      return !String(draft?.[field] || '').trim();
    });
    if (missingRequiredField) {
      toast.warning(t('field_settings_required_fill', 'Заполните обязательные поля'));
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
  }, [canEditClients, clientId, createMutation, draft, objectFieldsByKey, router, saving, setObjectTagsMutation, settings?.enable_object_tags, t, tags, toast, visibleAddressFields]);

  if (!canEditClients) {
    return (
      <EditScreenTemplate title={t('routes_objects_new')}>
        <View style={styles.blockedWrap}>
          <Text style={styles.blockedText}>{t('clients_no_edit_permission')}</Text>
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
          onChangeText={(value) => setDraft((prev) => ({ ...prev, name: value }))}
          style={styles.field}
        />
      </Card>

      <SectionHeader topSpacing="xs">{t('objects_address_section')}</SectionHeader>
      <Card paddedXOnly>
        {visibleAddressFields.map((field) => (
          <TextField
            key={field}
            label={withRequiredLabel(field, t(`order_field_${field}`))}
            value={String(draft[field] || '')}
            onChangeText={(value) => setDraft((prev) => ({ ...prev, [field]: value }))}
            style={styles.field}
          />
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
