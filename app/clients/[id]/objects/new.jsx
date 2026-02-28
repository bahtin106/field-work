import React from 'react';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import EditScreenTemplate from '../../../../components/layout/EditScreenTemplate';
import Card from '../../../../components/ui/Card';
import SectionHeader from '../../../../components/ui/SectionHeader';
import TextField from '../../../../components/ui/TextField';
import { useToast } from '../../../../components/ui/ToastProvider';
import { usePermissions } from '../../../../lib/permissions';
import { useClient } from '../../../../src/features/clients/queries';
import { useCreateClientObjectMutation } from '../../../../src/features/objects/queries';
import {
  CLIENT_OBJECT_ADDRESS_FIELDS,
  createEmptyClientObjectDraft,
  hasClientObjectAddressContent,
  sanitizeClientObjectPayload,
} from '../../../../src/features/objects/addressing';
import { useTranslation } from '../../../../src/i18n/useTranslation';
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
  const createMutation = useCreateClientObjectMutation();
  const [draft, setDraft] = React.useState(createEmptyClientObjectDraft());
  const [saving, setSaving] = React.useState(false);
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const saveObject = React.useCallback(async () => {
    if (!clientId || !canEditClients || saving) return;
    if (!hasClientObjectAddressContent(draft)) {
      toast.warning(t('order_details_address_not_specified'));
      return;
    }
    setSaving(true);
    try {
      const created = await createMutation.mutateAsync({
        client_id: String(clientId),
        ...sanitizeClientObjectPayload(draft),
      });
      toast.success(t('objects_saved'));
      router.replace(`/objects/${created.id}`);
    } catch (error) {
      toast.error(error?.message || t('clients_save_failed'));
    } finally {
      setSaving(false);
    }
  }, [canEditClients, clientId, createMutation, draft, router, saving, t, toast]);

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
        <Text style={styles.nameTitle}>{client?.fullName || t('common_dash')}</Text>
        <Text style={styles.clientName}>{t('routes_clients_client')}</Text>
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

