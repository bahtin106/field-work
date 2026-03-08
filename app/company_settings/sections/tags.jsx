import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Screen from '../../../components/layout/Screen';
import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import SectionHeader from '../../../components/ui/SectionHeader';
import { SwitchField } from '../../../components/ui/TextField';
import { ConfirmModal } from '../../../components/ui/modals';
import { useToast } from '../../../components/ui/ToastProvider';
import TagEditorField from '../../../components/tags/TagEditorField';
import TagList from '../../../components/tags/TagList';
import { TAG_TYPE } from '../../../components/tags/tagConfig';
import { useAuthContext } from '../../../providers/SimpleAuthProvider';
import { useCompanySettings } from '../../../hooks/useCompanySettings';
import {
  useCreateCompanyTagMutation,
  useCompanyTags,
  useDeleteAllCompanyTagsMutation,
  useDeleteCompanyTagMutation,
  useUpdateCompanyTagSettingsMutation,
} from '../../../src/features/tags/queries';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

function normalize(values = []) {
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    const trimmed = String(value || '').replace(/\s+/g, ' ').trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(trimmed);
  });
  return result;
}

export default function TagsSettingsScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const { profile } = useAuthContext();
  const companyId = profile?.company_id || null;

  const { settings } = useCompanySettings(companyId);
  const updateSettings = useUpdateCompanyTagSettingsMutation();
  const createTagMutation = useCreateCompanyTagMutation();
  const deleteAllTagsMutation = useDeleteAllCompanyTagsMutation();
  const deleteTagMutation = useDeleteCompanyTagMutation();

  const enableClientTags = !!settings?.enable_client_tags;
  const enableObjectTags = !!settings?.enable_object_tags;
  const [localClientEnabled, setLocalClientEnabled] = React.useState(null);
  const [localObjectEnabled, setLocalObjectEnabled] = React.useState(null);
  const [toggleBusy, setToggleBusy] = React.useState({ client: false, object: false });
  const lastCompanyIdRef = React.useRef(companyId);

  const { data: clientTags = [] } = useCompanyTags({
    companyId,
    tagType: TAG_TYPE.CLIENT,
    enabled: !!companyId,
  });
  const { data: objectTags = [] } = useCompanyTags({
    companyId,
    tagType: TAG_TYPE.OBJECT,
    enabled: !!companyId,
  });

  const [clientDraft, setClientDraft] = React.useState([]);
  const [objectDraft, setObjectDraft] = React.useState([]);
  const [confirmDelete, setConfirmDelete] = React.useState({ visible: false, tag: null });
  const [confirmDeleteAll, setConfirmDeleteAll] = React.useState({ visible: false, tagType: null });

  React.useEffect(() => {
    setClientDraft(clientTags.map((tag) => tag.value));
  }, [clientTags]);

  React.useEffect(() => {
    setObjectDraft(objectTags.map((tag) => tag.value));
  }, [objectTags]);

  React.useEffect(() => {
    if (lastCompanyIdRef.current !== companyId) {
      lastCompanyIdRef.current = companyId;
      setLocalClientEnabled(enableClientTags);
      setLocalObjectEnabled(enableObjectTags);
      return;
    }
    if (localClientEnabled === null) {
      setLocalClientEnabled(enableClientTags);
    }
    if (localObjectEnabled === null) {
      setLocalObjectEnabled(enableObjectTags);
    }
  }, [companyId, enableClientTags, enableObjectTags, localClientEnabled, localObjectEnabled]);

  const syncClientDraft = React.useCallback(async (nextValues) => {
    const next = normalize(nextValues);
    setClientDraft(next);
    const missing = next.filter(
      (value) => !clientTags.some((tag) => String(tag.value || '').toLowerCase() === value.toLowerCase()),
    );
    if (!missing.length) return;

    try {
      await Promise.all(
        missing.map((value) =>
          createTagMutation.mutateAsync({ companyId, tagType: TAG_TYPE.CLIENT, value }),
        ),
      );
    } catch (error) {
      toast.error(error?.message || t('errors_saveGeneric'));
    }
  }, [clientTags, companyId, createTagMutation, t, toast]);

  const syncObjectDraft = React.useCallback(async (nextValues) => {
    const next = normalize(nextValues);
    setObjectDraft(next);
    const missing = next.filter(
      (value) => !objectTags.some((tag) => String(tag.value || '').toLowerCase() === value.toLowerCase()),
    );
    if (!missing.length) return;

    try {
      await Promise.all(
        missing.map((value) =>
          createTagMutation.mutateAsync({ companyId, tagType: TAG_TYPE.OBJECT, value }),
        ),
      );
    } catch (error) {
      toast.error(error?.message || t('errors_saveGeneric'));
    }
  }, [companyId, createTagMutation, objectTags, t, toast]);

  const renderDictionaryBlock = (type) => {
    const isClient = type === TAG_TYPE.CLIENT;
    const enabled = isClient
      ? (typeof localClientEnabled === 'boolean' ? localClientEnabled : enableClientTags)
      : (typeof localObjectEnabled === 'boolean' ? localObjectEnabled : enableObjectTags);
    const tags = isClient ? clientTags : objectTags;
    const draftTags = isClient ? clientDraft : objectDraft;
    const onChange = isClient ? syncClientDraft : syncObjectDraft;

    return (
      <Card paddedXOnly>
        <SwitchField
          label={isClient ? t('tags_enable_clients') : t('tags_enable_objects')}
          value={enabled}
          disabled={isClient ? toggleBusy.client : toggleBusy.object}
          onValueChange={async (nextValue) => {
            const key = isClient ? 'client' : 'object';
            const prevValue = enabled;
            if (isClient) setLocalClientEnabled(nextValue);
            else setLocalObjectEnabled(nextValue);
            setToggleBusy((prev) => ({ ...prev, [key]: true }));
            try {
              await updateSettings.mutateAsync(
                isClient
                  ? { companyId, enableClientTags: nextValue }
                  : { companyId, enableObjectTags: nextValue },
              );
            } catch (error) {
              if (isClient) setLocalClientEnabled(prevValue);
              else setLocalObjectEnabled(prevValue);
              toast.error(error?.message || t('errors_saveGeneric'));
            } finally {
              setToggleBusy((prev) => ({ ...prev, [key]: false }));
            }
          }}
        />

        {enabled ? (
          <View style={styles.blockInner}>
            <TagEditorField
              label={isClient ? t('tags_clients_label') : t('tags_objects_label')}
              tagType={type}
              tags={draftTags}
              onChange={onChange}
              showSuggestions
              allowRemove={false}
              showLabel={false}
              showInlineTags={false}
              commitOnBlur={false}
              maxTags={null}
              placeholder={t('tags_input_placeholder')}
              hideSeparator
            />

            {tags.length > 0 ? (
              <TagList
                tags={tags}
                onDeleteTag={(tag) => setConfirmDelete({ visible: true, tag: { ...tag, type } })}
              />
            ) : (
              <Text style={styles.emptyText}>{t('tags_empty_hint')}</Text>
            )}

            <View style={styles.deleteAllWrap}>
              <Button
                title={isClient ? t('tags_delete_all_clients') : t('tags_delete_all_objects')}
                variant="destructive"
                onPress={() => setConfirmDeleteAll({ visible: true, tagType: type })}
                disabled={tags.length === 0 || deleteAllTagsMutation.isPending}
              />
            </View>
          </View>
        ) : (
          <Text style={styles.disabledHint}>{t('common_off')}</Text>
        )}
      </Card>
    );
  };

  return (
    <Screen headerOptions={{ title: t('settings_sections_reference_items_tags') }}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SectionHeader topSpacing="xs">{t('tags_clients_title')}</SectionHeader>
        {renderDictionaryBlock(TAG_TYPE.CLIENT)}

        <SectionHeader topSpacing="xs">{t('tags_objects_title')}</SectionHeader>
        {renderDictionaryBlock(TAG_TYPE.OBJECT)}
      </ScrollView>

      <ConfirmModal
        visible={confirmDelete.visible}
        onClose={() => setConfirmDelete({ visible: false, tag: null })}
        title={t('tags_delete_title')}
        message={t('tags_delete_message')}
        confirmLabel={t('btn_delete')}
        cancelLabel={t('btn_cancel')}
        confirmVariant="destructive"
        onConfirm={async () => {
          const tagId = String(confirmDelete?.tag?.id || '');
          if (!tagId) return;
          try {
            await deleteTagMutation.mutateAsync(tagId);
            toast.success(t('tags_deleted_success'));
            setConfirmDelete({ visible: false, tag: null });
          } catch (error) {
            toast.error(error?.message || t('errors_saveGeneric'));
          }
        }}
      />

      <ConfirmModal
        visible={confirmDeleteAll.visible}
        onClose={() => setConfirmDeleteAll({ visible: false, tagType: null })}
        title={t('tags_delete_all_title')}
        message={t('tags_delete_all_message')}
        confirmLabel={t('btn_delete')}
        cancelLabel={t('btn_cancel')}
        confirmVariant="destructive"
        onConfirm={async () => {
          const tagType = confirmDeleteAll?.tagType;
          if (!tagType || !companyId) return;
          try {
            await deleteAllTagsMutation.mutateAsync({ companyId, tagType });
            toast.success(t('tags_delete_all_success'));
            setConfirmDeleteAll({ visible: false, tagType: null });
          } catch (error) {
            toast.error(error?.message || t('errors_saveGeneric'));
          }
        }}
      />
    </Screen>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    content: {
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.xxl,
      gap: 0,
    },
    blockInner: {
      paddingHorizontal: 0,
      paddingBottom: theme.spacing.sm,
      gap: theme.spacing.xs,
    },
    disabledHint: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      paddingHorizontal: theme.spacing.md,
      paddingBottom: theme.spacing.md,
    },
    emptyText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      paddingHorizontal: theme.spacing.xs,
      paddingBottom: theme.spacing.xs,
    },
    deleteAllWrap: {
      marginTop: theme.spacing.xs,
    },
  });
}

