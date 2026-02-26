import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ActivityIndicator,
  InteractionManager,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from 'expo-router';
import { useEditFormStyles } from '../../../components/layout/EditScreenTemplate';
import Screen from '../../../components/layout/Screen';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import { listItemStyles } from '../../../components/ui/listItemStyles';
import BaseModal from '../../../components/ui/modals/BaseModal';
import ThemedSwitch from '../../../components/ui/ThemedSwitch';
import { useToast } from '../../../components/ui/ToastProvider';
import {
  createWorkType,
  deleteWorkType,
  fetchWorkTypes,
  getMyCompanyId,
  setUseWorkTypes,
  setWorkTypeEnabled,
  updateWorkType,
} from '../../../lib/workTypes';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { getLocale } from '../../../src/i18n';
import { useLastIntentWinsToggle } from '../../../src/shared/hooks/useLastIntentWinsToggle';
import { withAlpha } from '../../../theme/colors';
import { useTheme } from '../../../theme/ThemeProvider';

const MAX_WORK_TYPES = 10;
const WORK_TYPE_NAME_MAX_LENGTH = 64;
const MODAL_AUTOFOCUS_DELAY_MS = 180;
const DEFAULT_DIVIDER_WIDTH = 1;
const DEFAULT_SEPARATOR_ALPHA = 0.18;
const DEFAULT_LINE_HEIGHT_RATIO = 1.35;
const DEFAULT_DISABLED_OPACITY = 0.5;
const DEFAULT_TOUCH_TARGET_SIZE = 44;
const DEFAULT_ICON_SIZE = 18;
const DEFAULT_ACTIVITY_INDICATOR_SIZE = 'small';
const DEFAULT_FALLBACK_SPACING_XXS = 2;

function normalizeLocaleTag() {
  try {
    const raw = String(getLocale?.() || '').trim();
    if (!raw) return 'ru';
    return raw.replace('_', '-');
  } catch {
    return 'ru';
  }
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function sortByPosition(left, right, locale) {
  const leftPosition = Number.isFinite(left?.position) ? left.position : Number.MAX_SAFE_INTEGER;
  const rightPosition = Number.isFinite(right?.position)
    ? right.position
    : Number.MAX_SAFE_INTEGER;
  if (leftPosition !== rightPosition) return leftPosition - rightPosition;
  return String(left?.name || '').localeCompare(String(right?.name || ''), locale);
}

export default function WorkTypesSettings() {
  const nav = useNavigation();
  const queryClient = useQueryClient();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const localeTag = React.useMemo(() => normalizeLocaleTag(), []);

  const formStyles = useEditFormStyles();
  const base = React.useMemo(() => listItemStyles(theme), [theme]);

  const sepConfig = theme.components?.input?.separator || {};
  const sepInsetKey = sepConfig.insetX || 'lg';
  const separatorHeight =
    sepConfig.height ?? theme.components?.listItem?.dividerWidth ?? DEFAULT_DIVIDER_WIDTH;
  const separatorAlpha = sepConfig.alpha ?? DEFAULT_SEPARATOR_ALPHA;
  const separatorColor = withAlpha(theme.colors.primary, separatorAlpha);
  const separatorInset = Number(theme.spacing?.[sepInsetKey] ?? 0) || 0;

  const s = React.useMemo(
    () => styles(theme, separatorColor, separatorHeight, separatorInset),
    [theme, separatorColor, separatorHeight, separatorInset],
  );

  const [companyId, setCompanyId] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [useWorkTypes, setUseWT] = React.useState(false);

  const [types, setTypes] = React.useState([]);
  const [busyById, setBusyById] = React.useState({});

  const [newTypeName, setNewTypeName] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [createModalOpen, setCreateModalOpen] = React.useState(false);
  const [editModal, setEditModal] = React.useState({ open: false, id: null, value: '' });
  const [createModalWarning, setCreateModalWarning] = React.useState('');
  const [editModalWarning, setEditModalWarning] = React.useState('');
  const createInputRef = React.useRef(null);
  const editInputRef = React.useRef(null);

  const [disableGlobalConfirmOpen, setDisableGlobalConfirmOpen] = React.useState(false);
  const [deleteModal, setDeleteModal] = React.useState({ open: false, id: null, name: '' });

  const getErrorMessage = React.useCallback(
    (error, fallbackKey) => {
      const message = String(error?.message || '').trim();
      if (!message) return t(fallbackKey);

      const normalized = message.toLowerCase();
      if (normalized.includes('row-level security')) {
        return t('work_types_settings_error_forbidden');
      }
      if (
        message === 'work_types_forbidden_create' ||
        message === 'work_types_forbidden_update' ||
        message === 'work_types_forbidden_delete'
      ) {
        return t('work_types_settings_error_forbidden');
      }
      if (message === 'work_types_update_no_rows' || message === 'work_types_create_no_row') {
        return t('work_types_settings_error_not_available');
      }
      if (message === 'work_types_delete_no_rows') {
        return t('work_types_settings_error_not_available');
      }
      if (normalized.includes('cannot coerce the result to a single json object')) {
        return t('work_types_settings_error_not_available');
      }
      return message;
    },
    [t],
  );

  React.useLayoutEffect(() => {
    const headerTitle = t('settings_management_work_types');
    try {
      nav?.setParams?.({ title: headerTitle, headerTitle });
    } catch {}
  }, [nav, t]);

  const withBusy = React.useCallback(async (id, fn) => {
    setBusyById((prev) => ({ ...prev, [id]: true }));
    try {
      return await fn();
    } finally {
      setBusyById((prev) => ({ ...prev, [id]: false }));
    }
  }, []);

  const load = React.useCallback(async () => {
    const cid = await getMyCompanyId();
    const { useWorkTypes: enabled, types: fetchedTypes } = await fetchWorkTypes(cid, {
      includeDisabled: true,
      forceRefresh: true,
    });

    setCompanyId(cid);
    setUseWT(enabled);
    setTypes([...(fetchedTypes || [])].sort((left, right) => sortByPosition(left, right, localeTag)));
  }, [localeTag]);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await load();
      } catch (error) {
        if (mounted) {
          toast.error(getErrorMessage(error, 'work_types_settings_toast_load_failed'));
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [getErrorMessage, load, t, toast]);

  React.useEffect(() => {
    if (!createModalOpen) return undefined;
    let cancelled = false;
    let timer = null;
    const task = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(() => {
        if (cancelled) return;
        createInputRef.current?.focus?.();
      }, MODAL_AUTOFOCUS_DELAY_MS);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      task?.cancel?.();
    };
  }, [createModalOpen]);

  React.useEffect(() => {
    if (!editModal.open) return undefined;
    let cancelled = false;
    let timer = null;
    const task = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(() => {
        if (cancelled) return;
        editInputRef.current?.focus?.();
      }, MODAL_AUTOFOCUS_DELAY_MS);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      task?.cancel?.();
    };
  }, [editModal.open]);

  const canCreate = types.length < MAX_WORK_TYPES && !!companyId && !creating;

  const validateName = React.useCallback(
    (name, currentId = null) => {
      const normalized = normalizeName(name);
      if (!normalized) return t('work_types_settings_error_name_required');
      if (normalized.length > WORK_TYPE_NAME_MAX_LENGTH) {
        return t('work_types_settings_error_name_too_long');
      }

      const duplicateExists = types.some(
        (item) =>
          String(item.id) !== String(currentId) &&
          normalizeName(item.name).toLocaleLowerCase(localeTag) ===
            normalized.toLocaleLowerCase(localeTag),
      );
      if (duplicateExists) return t('work_types_settings_error_name_duplicate');
      return null;
    },
    [localeTag, t, types],
  );

  const applyMasterSwitch = useLastIntentWinsToggle({
    value: useWorkTypes,
    setValue: setUseWT,
    rollback: (previous) => {
      queryClient.setQueryData(
        ['companySettings'],
        (prev) =>
          prev && typeof prev === 'object'
            ? { ...prev, use_work_types: !!previous }
            : { use_work_types: !!previous },
      );
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'work_types_settings_toast_save_failed'));
    },
    commit: async (target) => {
      if (!companyId) return;
      queryClient.setQueryData(
        ['companySettings'],
        (prev) =>
          prev && typeof prev === 'object'
            ? { ...prev, use_work_types: !!target }
            : { use_work_types: !!target },
      );
      await setUseWorkTypes(companyId, !!target);
    },
    onCommitted: (target) => {
      toast.success(
        target
          ? t('work_types_settings_toast_master_enabled')
          : t('work_types_settings_toast_master_disabled'),
      );
      queryClient.invalidateQueries({ queryKey: ['companySettings'] }).catch(() => {});
    },
  });

  const onMasterSwitchChange = React.useCallback(
    (next) => {
      if (next) {
        applyMasterSwitch(true);
        return;
      }
      setDisableGlobalConfirmOpen(true);
    },
    [applyMasterSwitch],
  );

  const onCreate = React.useCallback(async () => {
    if (!companyId || !canCreate) return;

    const normalized = normalizeName(newTypeName);
    const validationError = validateName(normalized);
    if (validationError) {
      setCreateModalWarning(validationError);
      return;
    }

    setCreateModalWarning('');
    setCreating(true);
    try {
      const nextPosition =
        Math.max(0, ...types.map((item) => (Number.isFinite(item.position) ? item.position : 0))) +
        1;

      const created = await createWorkType(companyId, {
        name: normalized,
        position: nextPosition,
      });

      setTypes((prev) =>
        [...prev, created].sort((left, right) => sortByPosition(left, right, localeTag)),
      );
      setNewTypeName('');
      setCreateModalWarning('');
      setCreateModalOpen(false);
      toast.success(t('work_types_settings_toast_created'));
    } catch (error) {
      const message = getErrorMessage(error, 'work_types_settings_toast_create_failed');
      setCreateModalWarning(message);
    } finally {
      setCreating(false);
    }
  }, [canCreate, companyId, getErrorMessage, localeTag, newTypeName, t, toast, types, validateName]);

  const onRename = React.useCallback(
    async (item, nextName) => {
      if (!companyId || !item?.id) return false;

      const draft = normalizeName(nextName);
      const current = normalizeName(item.name);
      if (draft === current) return true;

      const validationError = validateName(draft, item.id);
      if (validationError) {
        setEditModalWarning(validationError);
        return false;
      }

      setEditModalWarning('');
      return withBusy(item.id, async () => {
        try {
          const updated = await updateWorkType(companyId, item.id, { name: draft });
          setTypes((prev) =>
            prev.map((existing) => (String(existing.id) === String(item.id) ? updated : existing)),
          );
          toast.success(t('work_types_settings_toast_renamed'));
          return true;
        } catch (error) {
          const message = getErrorMessage(error, 'work_types_settings_toast_rename_failed');
          setEditModalWarning(message);
          return false;
        }
      });
    },
    [companyId, getErrorMessage, t, toast, validateName, withBusy],
  );

  const onToggleType = React.useCallback(
    async (item, nextEnabled) => {
      if (!companyId || !item?.id) return;
      await withBusy(item.id, async () => {
        try {
          const updated = await setWorkTypeEnabled(companyId, item.id, nextEnabled);
          setTypes((prev) =>
            prev.map((existing) => (String(existing.id) === String(item.id) ? updated : existing)),
          );
          toast.success(
            nextEnabled
              ? t('work_types_settings_toast_type_enabled')
              : t('work_types_settings_toast_type_disabled_preserve_existing'),
          );
        } catch (error) {
          toast.error(getErrorMessage(error, 'work_types_settings_toast_save_failed'));
        }
      });
    },
    [companyId, getErrorMessage, t, toast, withBusy],
  );

  const onOpenCreateModal = React.useCallback(() => {
    if (!canCreate) {
      toast.warning(t('work_types_settings_limit_hint'));
      return;
    }
    setCreateModalWarning('');
    setCreateModalOpen(true);
  }, [canCreate, t, toast]);

  const onOpenEditModal = React.useCallback((item) => {
    setEditModalWarning('');
    setEditModal({
      open: true,
      id: item.id,
      value: String(item?.name || ''),
    });
  }, []);

  const onSaveEditModal = React.useCallback(async () => {
    const editingItem = types.find((item) => String(item.id) === String(editModal.id));
    if (!editingItem) return;

    const ok = await onRename(editingItem, editModal.value);
    if (ok) {
      setEditModal({ open: false, id: null, value: '' });
    }
  }, [editModal.id, editModal.value, onRename, types]);

  const openDeleteModal = React.useCallback((item) => {
    setDeleteModal({ open: true, id: item?.id ?? null, name: item?.name ?? '' });
  }, []);

  const onDelete = React.useCallback(async () => {
    if (!companyId || !deleteModal.id) return;
    const removingId = deleteModal.id;

    await withBusy(removingId, async () => {
      try {
        await deleteWorkType(companyId, removingId);
        setTypes((prev) => prev.filter((item) => String(item.id) !== String(removingId)));
        setDeleteModal({ open: false, id: null, name: '' });
        toast.success(t('work_types_settings_toast_deleted'));
      } catch (error) {
        toast.error(getErrorMessage(error, 'work_types_settings_toast_delete_failed'));
      }
    });
  }, [companyId, deleteModal.id, getErrorMessage, t, toast, withBusy]);

  if (loading) {
    return (
      <Screen>
        <View style={s.loadingWrap}>
          <ActivityIndicator
            size={theme.components?.activityIndicator?.size || DEFAULT_ACTIVITY_INDICATOR_SIZE}
            color={theme.colors.primary}
          />
          <Text style={s.loadingText}>{t('work_types_settings_loading')}</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView style={s.screen} contentContainerStyle={s.content}>
        <Card padded={false} style={formStyles.card}>
          <View style={[base.row, formStyles.field, { paddingHorizontal: separatorInset }]}> 
            <Text style={s.headerTitle}>{t('work_types_settings_title')}</Text>
            <ThemedSwitch
              value={useWorkTypes}
              onValueChange={onMasterSwitchChange}
            />
          </View>
          <View style={s.separator} />

          <View style={s.captionWrap}>
            <Text style={s.headerSubtitle}>
              {useWorkTypes
                ? t('work_types_settings_master_hint_enabled')
                : t('work_types_settings_master_hint_disabled')}
            </Text>
          </View>

          {useWorkTypes ? (
            <>
              {types.length ? (
                <View>
                  {types.map((item, index) => {
                    const isBusy = !!busyById[item.id];
                    const isEnabled = item.is_enabled !== false;
                    const isLast = index === types.length - 1;

                    return (
                      <View key={String(item.id)}>
                        <View style={[base.row, formStyles.field, { paddingHorizontal: separatorInset }]}>
                          <View style={s.nameWrap}>
                            <Text style={s.nameText} numberOfLines={1}>
                              {item.name}
                            </Text>
                            <Pressable
                              onPress={() => onOpenEditModal(item)}
                              disabled={isBusy}
                              style={({ pressed }) => [s.iconPressable, pressed ? s.iconPressablePressed : null]}
                              accessibilityLabel={t('btn_edit')}
                            >
                              <Feather
                                name="edit-2"
                                size={theme.icons?.sm ?? DEFAULT_ICON_SIZE}
                                color={theme.colors.textSecondary}
                              />
                            </Pressable>
                          </View>

                          <View style={s.rightActions}>
                            {isBusy ? (
                              <ActivityIndicator
                                size={theme.components?.activityIndicator?.size || DEFAULT_ACTIVITY_INDICATOR_SIZE}
                                color={theme.colors.primary}
                              />
                            ) : (
                              <ThemedSwitch
                                value={isEnabled}
                                onValueChange={(next) => onToggleType(item, next)}
                              />
                            )}
                            <Pressable
                              onPress={() => openDeleteModal(item)}
                              disabled={isBusy}
                              style={({ pressed }) => [s.iconPressable, pressed ? s.iconPressablePressed : null]}
                              accessibilityLabel={t('btn_delete')}
                            >
                              <Feather
                                name="trash-2"
                                size={theme.icons?.sm ?? DEFAULT_ICON_SIZE}
                                color={theme.colors.danger}
                              />
                            </Pressable>
                          </View>
                        </View>
                        {!isLast ? <View style={s.separator} /> : null}
                      </View>
                    );
                  })}
                </View>
              ) : (
                <View style={s.emptyWrap}>
                  <Text style={s.emptyTitle}>{t('work_types_settings_empty_title')}</Text>
                  <Text style={s.emptyText}>{t('work_types_settings_empty_subtitle')}</Text>
                </View>
              )}

              <View style={s.separator} />
              <View style={[base.row, formStyles.field, { paddingHorizontal: separatorInset }]}> 
                <Pressable
                  onPress={onOpenCreateModal}
                  disabled={!canCreate}
                  style={({ pressed }) => [
                    s.addRowButton,
                    !canCreate && s.addRowButtonDisabled,
                    pressed ? s.addRowButtonPressed : null,
                  ]}
                >
                  <Feather
                    name="plus-circle"
                    size={theme.icons?.sm || theme.components?.listItem?.chevronSize || theme.typography?.sizes?.md}
                    color={theme.colors.primary}
                  />
                  <Text style={s.addRowText}>{t('work_types_settings_create_button')}</Text>
                </Pressable>
              </View>

              <View style={s.captionWrap}>
                <Text style={s.limitText}>
                  {canCreate
                    ? `${t('work_types_settings_remaining_hint')} ${MAX_WORK_TYPES - types.length}`
                    : t('work_types_settings_limit_hint')}
                </Text>
              </View>
            </>
          ) : null}
        </Card>
      </ScrollView>

      <BaseModal
        visible={createModalOpen}
        onClose={() => {
          setCreateModalWarning('');
          setCreateModalOpen(false);
        }}
        title={t('work_types_settings_create_modal_title')}
        keyboardExtraPadding={
          (theme.spacing?.xxxl ?? 0) + (theme.spacing?.xl ?? theme.spacing?.lg ?? 0)
        }
        feedback={
          createModalWarning ? { message: createModalWarning, type: 'warning' } : null
        }
        footer={
          <View style={s.modalFooter}>
            <View style={s.modalButtonWrap}>
              <Button
                title={t('btn_cancel')}
                variant="secondary"
                onPress={() => {
                  setCreateModalWarning('');
                  setCreateModalOpen(false);
                }}
              />
            </View>
            <View style={s.modalButtonWrap}>
              <Button
                title={t('work_types_settings_create_button')}
                variant="primary"
                onPress={onCreate}
                loading={creating}
                disabled={!normalizeName(newTypeName)}
              />
            </View>
          </View>
        }
      >
        <TextInput
          ref={createInputRef}
          value={newTypeName}
          onChangeText={setNewTypeName}
          placeholder={t('work_types_settings_create_placeholder')}
          placeholderTextColor={theme.colors.inputPlaceholder}
          maxLength={WORK_TYPE_NAME_MAX_LENGTH}
          style={s.modalInput}
          editable={!creating}
          returnKeyType="done"
          onSubmitEditing={onCreate}
        />
      </BaseModal>

      <BaseModal
        visible={editModal.open}
        onClose={() => {
          setEditModalWarning('');
          setEditModal({ open: false, id: null, value: '' });
        }}
        title={t('work_types_settings_edit_modal_title')}
        feedback={editModalWarning ? { message: editModalWarning, type: 'warning' } : null}
        footer={
          <View style={s.modalFooter}>
            <View style={s.modalButtonWrap}>
              <Button
                title={t('btn_cancel')}
                variant="secondary"
                onPress={() => {
                  setEditModalWarning('');
                  setEditModal({ open: false, id: null, value: '' });
                }}
              />
            </View>
            <View style={s.modalButtonWrap}>
              <Button
                title={t('btn_save')}
                variant="primary"
                onPress={onSaveEditModal}
                disabled={!normalizeName(editModal.value)}
                loading={!!busyById[editModal.id]}
              />
            </View>
          </View>
        }
      >
        <TextInput
          ref={editInputRef}
          value={editModal.value}
          onChangeText={(value) => setEditModal((prev) => ({ ...prev, value }))}
          placeholder={t('work_types_settings_create_placeholder')}
          placeholderTextColor={theme.colors.inputPlaceholder}
          maxLength={WORK_TYPE_NAME_MAX_LENGTH}
          style={s.modalInput}
          editable={!busyById[editModal.id]}
          returnKeyType="done"
          onSubmitEditing={onSaveEditModal}
        />
      </BaseModal>

      <BaseModal
        visible={disableGlobalConfirmOpen}
        onClose={() => setDisableGlobalConfirmOpen(false)}
        title={t('work_types_settings_disable_confirm_title')}
        footer={
          <View style={s.modalFooter}>
            <View style={s.modalButtonWrap}>
              <Button
                title={t('btn_cancel')}
                variant="secondary"
                onPress={() => setDisableGlobalConfirmOpen(false)}
              />
            </View>
            <View style={s.modalButtonWrap}>
              <Button
                title={t('work_types_settings_disable_confirm_action')}
                variant="primary"
                onPress={async () => {
                  setDisableGlobalConfirmOpen(false);
                  await applyMasterSwitch(false);
                }}
              />
            </View>
          </View>
        }
      >
        <Text style={s.modalMessage}>{t('work_types_settings_disable_confirm_message')}</Text>
      </BaseModal>

      <BaseModal
        visible={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, id: null, name: '' })}
        title={t('work_types_settings_delete_confirm_title')}
        footer={
          <View style={s.modalFooter}>
            <View style={s.modalButtonWrap}>
              <Button
                title={t('btn_cancel')}
                variant="secondary"
                onPress={() => setDeleteModal({ open: false, id: null, name: '' })}
              />
            </View>
            <View style={s.modalButtonWrap}>
              <Button
                title={t('btn_delete')}
                variant="destructive"
                onPress={onDelete}
                loading={!!busyById[deleteModal.id]}
              />
            </View>
          </View>
        }
      >
        <Text style={s.modalMessage}>
          {`${t('work_types_settings_delete_confirm_message_prefix')} "${deleteModal.name}"?`}
        </Text>
      </BaseModal>
    </Screen>
  );
}

function styles(theme, separatorColor, separatorHeight, separatorInset) {
  const lineHeightRatio = theme.typography?.lineHeights?.normal ?? DEFAULT_LINE_HEIGHT_RATIO;
  const touchTargetSize =
    theme.components?.input?.height ?? theme.components?.listItem?.height ?? DEFAULT_TOUCH_TARGET_SIZE;
  const rightActionsGap = theme.spacing.xxs ?? theme.spacing.xs ?? DEFAULT_FALLBACK_SPACING_XXS;
  const rightActionsMarginRight = -(theme.spacing.xs ?? 0);

  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    content: {
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.xxl,
    },
    loadingWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.sm,
    },
    loadingText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
    headerTitle: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
    },
    headerSubtitle: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      lineHeight: Math.round(theme.typography.sizes.sm * lineHeightRatio),
    },
    separator: {
      height: separatorHeight,
      backgroundColor: separatorColor,
      marginLeft: separatorInset,
      marginRight: separatorInset,
    },
    captionWrap: {
      paddingHorizontal: separatorInset,
      paddingTop: theme.spacing.xs,
      paddingBottom: theme.spacing.sm,
    },
    nameWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
      flex: 1,
      minWidth: 0,
    },
    nameText: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      flex: 1,
    },
    rightActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: rightActionsGap,
      marginLeft: theme.spacing.xs,
      marginRight: rightActionsMarginRight,
    },
    iconPressable: {
      width: touchTargetSize,
      height: touchTargetSize,
      borderRadius: theme.radii.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconPressablePressed: {
      backgroundColor: theme.colors.ripple,
    },
    addRowButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.xs,
      minHeight: touchTargetSize,
      width: '100%',
      borderRadius: theme.radii.md,
    },
    addRowButtonDisabled: {
      opacity: theme.components?.listItem?.disabledOpacity ?? DEFAULT_DISABLED_OPACITY,
    },
    addRowButtonPressed: {
      backgroundColor: theme.colors.ripple,
    },
    addRowText: {
      color: theme.colors.primary,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.medium,
    },
    limitText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      textAlign: 'center',
    },
    emptyWrap: {
      paddingHorizontal: separatorInset,
      paddingVertical: theme.spacing.md,
      gap: theme.spacing.xs,
    },
    emptyTitle: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
    },
    emptyText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      lineHeight: Math.round(theme.typography.sizes.sm * lineHeightRatio),
    },
    modalFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    modalButtonWrap: {
      flex: 1,
    },
    modalMessage: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.md,
      lineHeight: Math.round(theme.typography.sizes.md * lineHeightRatio),
      marginBottom: theme.spacing.md,
    },
    modalInput: {
      minHeight: touchTargetSize,
      borderRadius: theme.radii.md,
      borderWidth: theme.components?.card?.borderWidth ?? 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: theme.spacing.md,
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      marginBottom: theme.spacing.md,
    },
  });
}

