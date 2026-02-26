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
  createDepartment,
  deleteDepartment,
  fetchDepartments,
  setDepartmentEnabled,
  setUseDepartments,
  updateDepartment,
} from '../../../lib/departments';
import { getMyCompanyId } from '../../../lib/workTypes';
import { getLocale } from '../../../src/i18n';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useLastIntentWinsToggle } from '../../../src/shared/hooks/useLastIntentWinsToggle';
import { queryKeys } from '../../../src/shared/query/queryKeys';
import { withAlpha } from '../../../theme/colors';
import { useTheme } from '../../../theme/ThemeProvider';

const MAX_DEPARTMENTS = 10;
const DEPARTMENT_NAME_MAX_LENGTH = 64;
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

function sortByName(left, right, locale) {
  return String(left?.name || '').localeCompare(String(right?.name || ''), locale);
}

export default function DepartmentsSettings() {
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
  const [useDepartments, setUseDepartmentsFlag] = React.useState(false);

  const [departments, setDepartments] = React.useState([]);
  const [busyById, setBusyById] = React.useState({});

  const [newDepartmentName, setNewDepartmentName] = React.useState('');
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
        return t('departments_settings_error_forbidden');
      }
      if (
        message === 'departments_forbidden_create' ||
        message === 'departments_forbidden_update' ||
        message === 'departments_forbidden_delete'
      ) {
        return t('departments_settings_error_forbidden');
      }
      if (message === 'departments_limit_reached' || normalized.includes('departments_limit_reached')) {
        return t('departments_settings_limit_hint');
      }
      if (
        message === 'departments_create_no_row' ||
        message === 'departments_update_no_rows' ||
        message === 'departments_delete_no_rows'
      ) {
        return t('departments_settings_error_not_available');
      }
      if (normalized.includes('duplicate key')) {
        return t('departments_settings_error_name_duplicate');
      }
      return message;
    },
    [t],
  );

  React.useLayoutEffect(() => {
    const headerTitle = t('settings_management_departments');
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
    const { useDepartments: enabled, departments: fetchedDepartments } = await fetchDepartments(cid, {
      includeDisabled: true,
      forceRefresh: true,
    });

    setCompanyId(cid);
    setUseDepartmentsFlag(enabled);
    setDepartments(
      [...(fetchedDepartments || [])].sort((left, right) => sortByName(left, right, localeTag)),
    );
  }, [localeTag]);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await load();
      } catch (error) {
        if (mounted) {
          toast.error(getErrorMessage(error, 'departments_settings_toast_load_failed'));
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [getErrorMessage, load, toast]);

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

  const canCreate = departments.length < MAX_DEPARTMENTS && !!companyId && !creating && useDepartments;

  const validateName = React.useCallback(
    (name, currentId = null) => {
      const normalized = normalizeName(name);
      if (!normalized) return t('departments_settings_error_name_required');
      if (normalized.length > DEPARTMENT_NAME_MAX_LENGTH) {
        return t('departments_settings_error_name_too_long');
      }

      const duplicateExists = departments.some(
        (item) =>
          String(item.id) !== String(currentId) &&
          normalizeName(item.name).toLocaleLowerCase(localeTag) ===
            normalized.toLocaleLowerCase(localeTag),
      );
      if (duplicateExists) return t('departments_settings_error_name_duplicate');
      return null;
    },
    [departments, localeTag, t],
  );

  const applyMasterSwitch = useLastIntentWinsToggle({
    value: useDepartments,
    setValue: setUseDepartmentsFlag,
    rollback: (previous) => {
      queryClient.setQueryData(
        ['companySettings'],
        (prev) =>
          prev && typeof prev === 'object'
            ? { ...prev, use_departments: !!previous }
            : { use_departments: !!previous },
      );
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'departments_settings_toast_save_failed'));
    },
    beforeCommit: async () => {
      if (!companyId) return;
      await Promise.all([
        queryClient.cancelQueries({ queryKey: queryKeys.employees.departments(companyId, true) }),
        queryClient.cancelQueries({ queryKey: queryKeys.employees.departments(companyId, false) }),
      ]);
    },
    commit: async (target) => {
      if (!companyId) return;
      const enabledDepartmentsKey = queryKeys.employees.departments(companyId, true);
      const allDepartmentsKey = queryKeys.employees.departments(companyId, false);
      queryClient.setQueryData(
        ['companySettings'],
        (prev) =>
          prev && typeof prev === 'object'
            ? { ...prev, use_departments: !!target }
            : { use_departments: !!target },
      );
      if (!target) {
        queryClient.setQueryData(enabledDepartmentsKey, []);
        queryClient.setQueryData(allDepartmentsKey, []);
      } else {
        const allDepartments = Array.isArray(departments) ? [...departments] : [];
        const enabledDepartments = allDepartments.filter((item) => item?.is_enabled !== false);
        queryClient.setQueryData(allDepartmentsKey, allDepartments);
        queryClient.setQueryData(enabledDepartmentsKey, enabledDepartments);
      }
      await setUseDepartments(companyId, !!target);
    },
    onCommitted: (target) => {
      if (!companyId) return;
      const companySettingsKey = ['companySettings'];
      const enabledDepartmentsKey = queryKeys.employees.departments(companyId, true);
      const allDepartmentsKey = queryKeys.employees.departments(companyId, false);
      toast.success(
        target
          ? t('departments_settings_toast_master_enabled')
          : t('departments_settings_toast_master_disabled'),
      );
      queryClient.invalidateQueries({ queryKey: companySettingsKey }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: enabledDepartmentsKey }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: allDepartmentsKey }).catch(() => {});
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

    const normalized = normalizeName(newDepartmentName);
    const validationError = validateName(normalized);
    if (validationError) {
      setCreateModalWarning(validationError);
      return;
    }

    setCreateModalWarning('');
    setCreating(true);
    try {
      const created = await createDepartment(companyId, { name: normalized });
      setDepartments((prev) =>
        [...prev, created].sort((left, right) => sortByName(left, right, localeTag)),
      );
      setNewDepartmentName('');
      setCreateModalWarning('');
      setCreateModalOpen(false);
      toast.success(t('departments_settings_toast_created'));
    } catch (error) {
      const message = getErrorMessage(error, 'departments_settings_toast_create_failed');
      setCreateModalWarning(message);
    } finally {
      setCreating(false);
    }
  }, [canCreate, companyId, getErrorMessage, localeTag, newDepartmentName, t, toast, validateName]);

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
          const updated = await updateDepartment(companyId, item.id, { name: draft });
          setDepartments((prev) =>
            prev.map((existing) => (String(existing.id) === String(item.id) ? updated : existing)),
          );
          toast.success(t('departments_settings_toast_renamed'));
          return true;
        } catch (error) {
          const message = getErrorMessage(error, 'departments_settings_toast_rename_failed');
          setEditModalWarning(message);
          return false;
        }
      });
    },
    [companyId, getErrorMessage, t, toast, validateName, withBusy],
  );

  const onToggleDepartment = React.useCallback(
    async (item, nextEnabled) => {
      if (!companyId || !item?.id) return;
      await withBusy(item.id, async () => {
        try {
          const updated = await setDepartmentEnabled(companyId, item.id, nextEnabled);
          setDepartments((prev) =>
            prev.map((existing) => (String(existing.id) === String(item.id) ? updated : existing)),
          );
          toast.success(
            nextEnabled
              ? t('departments_settings_toast_department_enabled')
              : t('departments_settings_toast_department_disabled_preserve_existing'),
          );
        } catch (error) {
          toast.error(getErrorMessage(error, 'departments_settings_toast_save_failed'));
        }
      });
    },
    [companyId, getErrorMessage, t, toast, withBusy],
  );

  const onOpenCreateModal = React.useCallback(() => {
    if (!useDepartments) {
      toast.warning(t('departments_settings_enable_first_hint'));
      return;
    }
    if (!canCreate) {
      toast.warning(t('departments_settings_limit_hint'));
      return;
    }
    setCreateModalWarning('');
    setCreateModalOpen(true);
  }, [canCreate, t, toast, useDepartments]);

  const onOpenEditModal = React.useCallback((item) => {
    setEditModalWarning('');
    setEditModal({
      open: true,
      id: item.id,
      value: String(item?.name || ''),
    });
  }, []);

  const onSaveEditModal = React.useCallback(async () => {
    const editingItem = departments.find((item) => String(item.id) === String(editModal.id));
    if (!editingItem) return;

    const ok = await onRename(editingItem, editModal.value);
    if (ok) {
      setEditModal({ open: false, id: null, value: '' });
    }
  }, [departments, editModal.id, editModal.value, onRename]);

  const openDeleteModal = React.useCallback((item) => {
    setDeleteModal({ open: true, id: item?.id ?? null, name: item?.name ?? '' });
  }, []);

  const onDelete = React.useCallback(async () => {
    if (!companyId || !deleteModal.id) return;
    const removingId = deleteModal.id;

    await withBusy(removingId, async () => {
      try {
        await deleteDepartment(companyId, removingId);
        setDepartments((prev) => prev.filter((item) => String(item.id) !== String(removingId)));
        setDeleteModal({ open: false, id: null, name: '' });
        toast.success(t('departments_settings_toast_deleted_with_unassign'));
      } catch (error) {
        toast.error(getErrorMessage(error, 'departments_settings_toast_delete_failed'));
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
          <Text style={s.loadingText}>{t('departments_settings_loading')}</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView style={s.screen} contentContainerStyle={s.content}>
        <Card padded={false} style={formStyles.card}>
          <View style={[base.row, formStyles.field, { paddingHorizontal: separatorInset }]}>
            <Text style={s.headerTitle}>{t('departments_settings_title')}</Text>
            <ThemedSwitch
              value={useDepartments}
              onValueChange={onMasterSwitchChange}
            />
          </View>
          <View style={s.separator} />

          <View style={s.captionWrap}>
            <Text style={s.headerSubtitle}>
              {useDepartments
                ? t('departments_settings_master_hint_enabled')
                : t('departments_settings_master_hint_disabled')}
            </Text>
          </View>

          {useDepartments ? (
            <>
              {departments.length ? (
                <View>
                  {departments.map((item, index) => {
                    const isBusy = !!busyById[item.id];
                    const isEnabled = item.is_enabled !== false;
                    const isLast = index === departments.length - 1;

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
                                onValueChange={(next) => onToggleDepartment(item, next)}
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
                  <Text style={s.emptyTitle}>{t('departments_settings_empty_title')}</Text>
                  <Text style={s.emptyText}>{t('departments_settings_empty_subtitle')}</Text>
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
                  <Text style={s.addRowText}>{t('departments_settings_create_button')}</Text>
                </Pressable>
              </View>

              <View style={s.captionWrap}>
                <Text style={s.limitText}>
                  {canCreate
                    ? `${t('departments_settings_remaining_hint')} ${MAX_DEPARTMENTS - departments.length}`
                    : t('departments_settings_limit_hint')}
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
        title={t('departments_settings_create_modal_title')}
        keyboardExtraPadding={
          (theme.spacing?.xxxl ?? 0) + (theme.spacing?.xl ?? theme.spacing?.lg ?? 0)
        }
        feedback={createModalWarning ? { message: createModalWarning, type: 'warning' } : null}
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
                title={t('departments_settings_create_button')}
                variant="primary"
                onPress={onCreate}
                loading={creating}
                disabled={!normalizeName(newDepartmentName)}
              />
            </View>
          </View>
        }
      >
        <TextInput
          ref={createInputRef}
          value={newDepartmentName}
          onChangeText={setNewDepartmentName}
          placeholder={t('departments_settings_create_placeholder')}
          placeholderTextColor={theme.colors.inputPlaceholder}
          maxLength={DEPARTMENT_NAME_MAX_LENGTH}
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
        title={t('departments_settings_edit_modal_title')}
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
          placeholder={t('departments_settings_create_placeholder')}
          placeholderTextColor={theme.colors.inputPlaceholder}
          maxLength={DEPARTMENT_NAME_MAX_LENGTH}
          style={s.modalInput}
          editable={!busyById[editModal.id]}
          returnKeyType="done"
          onSubmitEditing={onSaveEditModal}
        />
      </BaseModal>

      <BaseModal
        visible={disableGlobalConfirmOpen}
        onClose={() => setDisableGlobalConfirmOpen(false)}
        title={t('departments_settings_disable_confirm_title')}
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
                title={t('departments_settings_disable_confirm_action')}
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
        <Text style={s.modalMessage}>{t('departments_settings_disable_confirm_message')}</Text>
      </BaseModal>

      <BaseModal
        visible={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, id: null, name: '' })}
        title={t('departments_settings_delete_confirm_title')}
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
          {`${t('departments_settings_delete_confirm_message_prefix')} "${deleteModal.name}"?`}
        </Text>
        <Text style={s.modalHint}>
          {t('departments_settings_delete_with_related_hint')}
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
    modalHint: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      lineHeight: Math.round(theme.typography.sizes.sm * lineHeightRatio),
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
