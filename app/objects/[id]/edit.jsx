import React from 'react';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import EditScreenTemplate from '../../../components/layout/EditScreenTemplate';
import UIButton from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import SectionHeader from '../../../components/ui/SectionHeader';
import TextField from '../../../components/ui/TextField';
import { ConfirmModal } from '../../../components/ui/modals';
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
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

function snapshotObjectForm(obj = {}) {
  return JSON.stringify({
    name: String(obj.name || '').trim() || '',
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
  const allowLeaveRef = React.useRef(false);
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  React.useEffect(() => {
    if (!objectItem) return;
    const next = createEmptyClientObjectDraft({
      name: objectItem.name || CLIENT_OBJECT_DEFAULT_NAME,
      ...Object.fromEntries(
        CLIENT_OBJECT_ADDRESS_FIELDS.map((field) => [field, objectItem[field] || '']),
      ),
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

  const saveObject = React.useCallback(async () => {
    if (!objectId || saving || !canEditClients) return;
    setSaving(true);
    try {
      await updateMutation.mutateAsync({
        id: String(objectId),
        patch: sanitizeClientObjectPayload(draft, { nameRequired: false }),
      });
      toast.success(t('objects_saved'));
      allowLeaveRef.current = true;
      router.replace(`/objects/${objectId}`);
    } catch (error) {
      toast.error(error?.message || t('clients_save_failed'));
    } finally {
      setSaving(false);
    }
  }, [canEditClients, draft, objectId, router, saving, t, toast, updateMutation]);

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
          <Text style={styles.nameTitle}>{draft.name || t('objects_unnamed')}</Text>
          <Text style={styles.clientName}>{objectItem?.client?.full_name || t('common_dash')}</Text>
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
  });
}

