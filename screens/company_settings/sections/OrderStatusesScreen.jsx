import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import Screen from '../../../components/layout/Screen';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import SectionHeader from '../../../components/ui/SectionHeader';
import TextField from '../../../components/ui/TextField';
import ThemedSwitch from '../../../components/ui/ThemedSwitch';
import { BaseModal, ConfirmModal, SelectModal } from '../../../components/ui/modals';
import MultiSelectModal from '../../../components/ui/modals/MultiSelectModal';
import { useToast } from '../../../components/ui/ToastProvider';
import {
  ORDER_STATUS_LIMIT,
  createCompanyOrderStatus,
  deleteCompanyOrderStatus,
  getCompanyOrderStatusUsage,
  getOrderStatusLabel,
  invalidateCompanyOrderStatuses,
  renameCompanyOrderStatus,
  setCompanyFeedStatusEnabled,
  setCompanyOrderStatusesEnabled,
  useCompanyOrderStatuses,
} from '../../../lib/orderStatuses';
import {
  FEED_ORDER_FIELD_OPTIONS,
  normalizeFeedOrderFields,
  saveFeedOrderFieldVisibility,
} from '../../../lib/feedOrderFieldVisibility';
import { getMyCompanyId } from '../../../lib/workTypes';
import { useAuthContext } from '../../../providers/SimpleAuthProvider';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

const MAX_NAME_LENGTH = 64;

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function resolveError(error, t) {
  const raw = String(error?.message || error || '').trim();
  const lower = raw.toLowerCase();
  if (lower.includes('company_order_statuses_limit_reached')) return t('order_statuses_error_limit');
  if (lower.includes('duplicate') || lower.includes('company_order_statuses_company_name_unique')) return t('order_statuses_error_duplicate');
  if (lower.includes('forbidden') || lower.includes('row-level security')) return t('order_statuses_error_forbidden');
  if (lower.includes('replacement_status_not_available') || lower.includes('company_order_status_replacement_required')) {
    return t('order_statuses_error_replacement');
  }
  if (lower.includes('company_feed_has_orders')) return t('order_statuses_feed_disable_blocked_message');
  return raw || t('common_unexpected_error');
}

function emptyDeleteState() {
  return {
    visible: false,
    row: null,
    usageCount: 0,
    replacement: null,
    loading: false,
    error: '',
  };
}

export default function OrderStatusesScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile, user } = useAuthContext();
  const [companyId, setCompanyId] = React.useState(null);
  const [companyLoading, setCompanyLoading] = React.useState(true);
  const [masterBusy, setMasterBusy] = React.useState(false);
  const [disableConfirmVisible, setDisableConfirmVisible] = React.useState(false);
  const [feedBusy, setFeedBusy] = React.useState(false);
  const [feedFieldsModalVisible, setFeedFieldsModalVisible] = React.useState(false);
  const [feedFieldsBusy, setFeedFieldsBusy] = React.useState(false);
  const [feedDisableBlocked, setFeedDisableBlocked] = React.useState({ visible: false, count: 0 });
  const [createModal, setCreateModal] = React.useState({ visible: false, name: '', error: '' });
  const [editModal, setEditModal] = React.useState({ visible: false, row: null, name: '', error: '' });
  const [deleteModal, setDeleteModal] = React.useState(emptyDeleteState);
  const [replacementPickerVisible, setReplacementPickerVisible] = React.useState(false);
  const [busyId, setBusyId] = React.useState(null);
  const canManage = String(profile?.role || '').toLowerCase() === 'admin';
  const isSoloAdmin =
    canManage && String(user?.user_metadata?.account_type || '').toLowerCase() === 'solo';
  const {
    isLoading: statusesLoading,
    isEnabled,
    feedEnabled,
    regularStatuses,
    feedStatus,
    settings,
  } = useCompanyOrderStatuses(companyId, { includeWhenDisabled: true });
  const s = React.useMemo(() => styles(theme), [theme]);
  const canAdd = isEnabled && canManage && regularStatuses.length < ORDER_STATUS_LIMIT;

  React.useEffect(() => {
    let active = true;
    getMyCompanyId()
      .then((id) => {
        if (active) setCompanyId(id || null);
      })
      .catch((error) => {
        if (active) toast.error(resolveError(error, t));
      })
      .finally(() => {
        if (active) setCompanyLoading(false);
      });
    return () => {
      active = false;
    };
  }, [t, toast]);

  const validateName = React.useCallback(
    (value, ownId = null) => {
      const name = normalizeName(value);
      if (!name) return t('order_statuses_error_name_required');
      if (name.length > MAX_NAME_LENGTH) return t('order_statuses_error_name_too_long');
      const duplicate = regularStatuses.some(
        (row) => String(row.id) !== String(ownId || '') && normalizeName(row.name).toLocaleLowerCase() === name.toLocaleLowerCase(),
      );
      return duplicate ? t('order_statuses_error_duplicate') : null;
    },
    [regularStatuses, t],
  );

  const refresh = React.useCallback(() => {
    invalidateCompanyOrderStatuses(queryClient, companyId);
    queryClient.invalidateQueries({ queryKey: ['requests'] }).catch(() => {});
  }, [companyId, queryClient]);

  const changeMaster = React.useCallback(async (nextValue) => {
    if (!companyId || !canManage || masterBusy) return;
    setMasterBusy(true);
    try {
      await setCompanyOrderStatusesEnabled(companyId, nextValue, queryClient);
      refresh();
      toast.success(nextValue ? t('order_statuses_enabled') : t('order_statuses_disabled'));
    } catch (error) {
      toast.error(resolveError(error, t));
    } finally {
      setMasterBusy(false);
    }
  }, [canManage, companyId, masterBusy, queryClient, refresh, t, toast]);

  const changeFeed = React.useCallback(async (nextValue) => {
    if (!companyId || !canManage || feedBusy || !isEnabled) return;
    setFeedBusy(true);
    try {
      if (!nextValue && feedStatus?.id) {
        const usageCount = await getCompanyOrderStatusUsage(feedStatus.id);
        if (usageCount > 0) {
          setFeedDisableBlocked({ visible: true, count: usageCount });
          return;
        }
      }
      await setCompanyFeedStatusEnabled(companyId, nextValue, queryClient);
      refresh();
    } catch (error) {
      const raw = String(error?.message || error || '').toLowerCase();
      if (!nextValue && raw.includes('company_feed_has_orders')) {
        const usageCount = feedStatus?.id
          ? await getCompanyOrderStatusUsage(feedStatus.id).catch(() => 1)
          : 1;
        setFeedDisableBlocked({ visible: true, count: Math.max(1, usageCount) });
      } else {
        toast.error(resolveError(error, t));
      }
    } finally {
      setFeedBusy(false);
    }
  }, [canManage, companyId, feedBusy, feedStatus?.id, isEnabled, queryClient, refresh, t, toast]);

  const feedFieldValues = React.useMemo(
    () => normalizeFeedOrderFields(settings?.feed_order_card_fields),
    [settings?.feed_order_card_fields],
  );
  const feedFieldItems = React.useMemo(
    () => FEED_ORDER_FIELD_OPTIONS.map((field) => ({
      id: field.key,
      value: field.key,
      label: t(field.labelKey),
    })),
    [t],
  );
  const saveFeedFields = React.useCallback(async (values) => {
    if (!companyId || !canManage || !feedEnabled || feedFieldsBusy) return;
    setFeedFieldsBusy(true);
    try {
      await saveFeedOrderFieldVisibility(companyId, values, queryClient);
      toast.success(t('toast_settingsSaved'));
    } catch (error) {
      toast.error(resolveError(error, t));
    } finally {
      setFeedFieldsBusy(false);
    }
  }, [canManage, companyId, feedEnabled, feedFieldsBusy, queryClient, t, toast]);

  const openFeedOrders = React.useCallback(() => {
    setFeedDisableBlocked({ visible: false, count: 0 });
    router.push({ pathname: '/orders/all-orders', params: { filter: 'feed' } });
  }, [router]);

  const createStatus = React.useCallback(async () => {
    const name = normalizeName(createModal.name);
    const validation = validateName(name);
    if (!companyId || !canAdd) return;
    if (validation) {
      setCreateModal((prev) => ({ ...prev, error: validation }));
      return;
    }
    setBusyId('create');
    try {
      await createCompanyOrderStatus(companyId, { name, sortOrder: regularStatuses.length + 1 });
      setCreateModal({ visible: false, name: '', error: '' });
      refresh();
      toast.success(t('order_statuses_created'));
    } catch (error) {
      setCreateModal((prev) => ({ ...prev, error: resolveError(error, t) }));
    } finally {
      setBusyId(null);
    }
  }, [canAdd, companyId, createModal.name, refresh, regularStatuses.length, t, toast, validateName]);

  const renameStatus = React.useCallback(async () => {
    const row = editModal.row;
    const name = normalizeName(editModal.name);
    const validation = validateName(name, row?.id);
    if (!companyId || !row?.id) return;
    if (validation) {
      setEditModal((prev) => ({ ...prev, error: validation }));
      return;
    }
    setBusyId(row.id);
    try {
      await renameCompanyOrderStatus(companyId, row.id, name);
      setEditModal({ visible: false, row: null, name: '', error: '' });
      refresh();
      toast.success(t('order_statuses_renamed'));
    } catch (error) {
      setEditModal((prev) => ({ ...prev, error: resolveError(error, t) }));
    } finally {
      setBusyId(null);
    }
  }, [companyId, editModal.name, editModal.row, refresh, t, toast, validateName]);

  const openDelete = React.useCallback(async (row) => {
    if (!row?.id || busyId) return;
    setBusyId(row.id);
    try {
      const usageCount = await getCompanyOrderStatusUsage(row.id);
      const hasReplacement = regularStatuses.some(
        (candidate) => String(candidate.id) !== String(row.id),
      );
      setDeleteModal({
        ...emptyDeleteState(),
        visible: true,
        row,
        usageCount,
        error: usageCount > 0 && !hasReplacement ? t('order_statuses_error_replacement') : '',
      });
    } catch (error) {
      toast.error(resolveError(error, t));
    } finally {
      setBusyId(null);
    }
  }, [busyId, regularStatuses, t, toast]);

  const deleteStatus = React.useCallback(async () => {
    if (!deleteModal.row?.id) return;
    if (deleteModal.usageCount > 0 && !deleteModal.replacement) {
      setDeleteModal((prev) => ({ ...prev, error: t('order_statuses_error_replacement') }));
      return;
    }
    setDeleteModal((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      await deleteCompanyOrderStatus(deleteModal.row.id, deleteModal.replacement);
      setDeleteModal(emptyDeleteState());
      refresh();
      toast.success(t('order_statuses_deleted'));
    } catch (error) {
      setDeleteModal((prev) => ({ ...prev, loading: false, error: resolveError(error, t) }));
    }
  }, [deleteModal.replacement, deleteModal.row?.id, deleteModal.usageCount, refresh, t, toast]);

  const replacementItems = React.useMemo(
    () => regularStatuses
      .filter((row) => String(row.id) !== String(deleteModal.row?.id || ''))
      .map((row) => ({ id: row.status_key, label: getOrderStatusLabel(row.status_key, regularStatuses, t) })),
    [deleteModal.row?.id, regularStatuses, t],
  );
  const replacementLabel = React.useMemo(
    () => replacementItems.find((row) => row.id === deleteModal.replacement)?.label || '',
    [deleteModal.replacement, replacementItems],
  );

  if (companyLoading || statusesLoading) {
    return <Screen background="background" headerOptions={{ title: t('order_statuses_title') }}><View style={s.loading}><ActivityIndicator color={theme.colors.primary} /></View></Screen>;
  }

  return (
    <Screen background="background" headerOptions={{ title: t('order_statuses_title') }} scroll={false}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <SectionHeader topSpacing="xs" bottomSpacing="xs">{t('order_statuses_title')}</SectionHeader>
        <Card padded={false}>
          <View style={s.row}>
            <View style={s.textWrap}>
              <Text style={s.title}>{t('order_statuses_enable')}</Text>
              <Text style={s.hint}>{isEnabled ? t('order_statuses_enabled_hint') : t('order_statuses_disabled_hint')}</Text>
            </View>
            {masterBusy ? <ActivityIndicator color={theme.colors.primary} /> : <ThemedSwitch value={isEnabled} onValueChange={(nextValue) => {
              if (nextValue) {
                changeMaster(true);
              } else {
                setDisableConfirmVisible(true);
              }
            }} disabled={!canManage} />}
          </View>
        </Card>

        {isEnabled ? <>
          {!isSoloAdmin ? <>
            <SectionHeader>{t('order_statuses_feed_section')}</SectionHeader>
            <Card padded={false}>
              <View style={s.row}>
                <View style={s.textWrap}>
                  <Text style={s.title}>{feedStatus ? getOrderStatusLabel(feedStatus.status_key, [feedStatus], t) : t('order_status_in_feed')}</Text>
                  <Text style={s.hint}>{t('order_statuses_feed_hint')}</Text>
                </View>
                {feedBusy ? <ActivityIndicator color={theme.colors.primary} /> : <ThemedSwitch value={feedEnabled} onValueChange={changeFeed} disabled={!canManage || !feedStatus} />}
              </View>
              <View style={s.separator} />
              <Pressable
                disabled={!feedEnabled || !canManage || feedFieldsBusy}
                onPress={() => setFeedFieldsModalVisible(true)}
                style={({ pressed }) => [
                  s.visibleFieldsRow,
                  (!feedEnabled || !canManage || feedFieldsBusy) && s.disabled,
                  pressed && s.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('order_statuses_feed_visible_fields')}
                accessibilityState={{ disabled: !feedEnabled || !canManage || feedFieldsBusy }}
              >
                <Text style={s.statusName}>{t('order_statuses_feed_visible_fields')}</Text>
                {feedFieldsBusy ? (
                  <ActivityIndicator color={theme.colors.primary} />
                ) : (
                  <Feather name="chevron-right" size={20} color={theme.colors.textSecondary} />
                )}
              </Pressable>
            </Card>
          </> : null}

          <SectionHeader>{t('order_statuses_regular_section')}</SectionHeader>
          <Card padded={false}>
            {regularStatuses.map((row, index) => <View key={row.id}>
              {index > 0 ? <View style={s.separator} /> : null}
              <View style={s.row}>
                <Text style={s.statusName} numberOfLines={1}>{getOrderStatusLabel(row.status_key, regularStatuses, t)}</Text>
                <View style={s.actions}>
                  {busyId === row.id ? <ActivityIndicator color={theme.colors.primary} /> : null}
                  <Pressable disabled={!canManage || busyId === row.id} onPress={() => setEditModal({ visible: true, row, name: row.name, error: '' })} style={({ pressed }) => [s.iconButton, pressed && s.pressed]} accessibilityLabel={t('btn_edit')}>
                    <Feather name="edit-2" size={18} color={theme.colors.textSecondary} />
                  </Pressable>
                  <Pressable disabled={!canManage || busyId === row.id} onPress={() => openDelete(row)} style={({ pressed }) => [s.iconButton, pressed && s.pressed]} accessibilityLabel={t('btn_delete')}>
                    <Feather name="trash-2" size={18} color={theme.colors.danger} />
                  </Pressable>
                </View>
              </View>
            </View>)}
            {!regularStatuses.length ? <View style={s.empty}><Text style={s.hint}>{t('order_statuses_empty')}</Text></View> : null}
            <View style={s.separator} />
            <Pressable disabled={!canAdd} onPress={() => setCreateModal({ visible: true, name: '', error: '' })} style={({ pressed }) => [s.addRow, !canAdd && s.disabled, pressed && s.pressed]}>
              <Feather name="plus-circle" size={18} color={theme.colors.primary} />
              <Text style={s.addText}>{t('order_statuses_add')}</Text>
            </Pressable>
            <Text style={s.limit}>{t('order_statuses_limit_hint').replace('{count}', String(ORDER_STATUS_LIMIT - regularStatuses.length))}</Text>
          </Card>
        </> : null}
      </ScrollView>

      <BaseModal visible={createModal.visible} onClose={() => setCreateModal({ visible: false, name: '', error: '' })} title={t('order_statuses_create_title')} feedback={createModal.error ? { message: createModal.error, type: 'warning' } : null} footer={<Actions t={t} onCancel={() => setCreateModal({ visible: false, name: '', error: '' })} onConfirm={createStatus} confirmTitle={t('btn_create')} loading={busyId === 'create'} disabled={!normalizeName(createModal.name)} />}>
        <TextInput value={createModal.name} onChangeText={(name) => setCreateModal((prev) => ({ ...prev, name }))} placeholder={t('order_statuses_name_placeholder')} placeholderTextColor={theme.colors.inputPlaceholder} maxLength={MAX_NAME_LENGTH} style={s.input} returnKeyType="done" onSubmitEditing={createStatus} />
      </BaseModal>

      <BaseModal visible={editModal.visible} onClose={() => setEditModal({ visible: false, row: null, name: '', error: '' })} title={t('order_statuses_edit_title')} feedback={editModal.error ? { message: editModal.error, type: 'warning' } : null} footer={<Actions t={t} onCancel={() => setEditModal({ visible: false, row: null, name: '', error: '' })} onConfirm={renameStatus} confirmTitle={t('btn_save')} loading={busyId === editModal.row?.id} disabled={!normalizeName(editModal.name)} />}>
        <TextInput value={editModal.name} onChangeText={(name) => setEditModal((prev) => ({ ...prev, name }))} placeholder={t('order_statuses_name_placeholder')} placeholderTextColor={theme.colors.inputPlaceholder} maxLength={MAX_NAME_LENGTH} style={s.input} returnKeyType="done" onSubmitEditing={renameStatus} />
      </BaseModal>

      <BaseModal visible={deleteModal.visible} onClose={() => setDeleteModal(emptyDeleteState())} title={t('order_statuses_delete_title')} feedback={deleteModal.error ? { message: deleteModal.error, type: 'warning' } : null} footer={<Actions t={t} onCancel={() => setDeleteModal(emptyDeleteState())} onConfirm={deleteStatus} confirmTitle={t('btn_delete')} destructive loading={deleteModal.loading} disabled={deleteModal.usageCount > 0 && !deleteModal.replacement} />}>
        <Text style={s.modalText}>
          {deleteModal.usageCount > 0
            ? t('order_statuses_delete_message').replace('{name}', getOrderStatusLabel(deleteModal.row?.status_key, regularStatuses, t)).replace('{count}', String(deleteModal.usageCount))
            : t('order_statuses_delete_unused_message').replace('{name}', getOrderStatusLabel(deleteModal.row?.status_key, regularStatuses, t))}
        </Text>
        {deleteModal.usageCount > 0 ? <TextField label={t('order_statuses_replacement_label')} value={replacementLabel} pressable onPress={() => setReplacementPickerVisible(true)} style={s.replacementField} /> : null}
      </BaseModal>

      <SelectModal visible={replacementPickerVisible} onClose={() => setReplacementPickerVisible(false)} title={t('order_statuses_replacement_label')} searchable={false} items={replacementItems} selectedId={deleteModal.replacement} onSelect={(item) => { setDeleteModal((prev) => ({ ...prev, replacement: item?.id || null, error: '' })); setReplacementPickerVisible(false); }} />
      <MultiSelectModal
        visible={feedFieldsModalVisible}
        title={t('order_statuses_feed_visible_fields')}
        items={feedFieldItems}
        value={feedFieldValues}
        searchable={false}
        onChange={saveFeedFields}
        onClose={() => setFeedFieldsModalVisible(false)}
      />
      <BaseModal
        visible={feedDisableBlocked.visible}
        onClose={() => setFeedDisableBlocked({ visible: false, count: 0 })}
        title={t('order_statuses_feed_disable_blocked_title')}
        footer={<View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><Button title={t('btn_close')} variant="secondary" onPress={() => setFeedDisableBlocked({ visible: false, count: 0 })} /></View>
          <View style={{ flex: 1 }}><Button title={t('order_statuses_feed_open_action')} onPress={openFeedOrders} /></View>
        </View>}
      >
        <Text style={s.modalText}>
          {t('order_statuses_feed_disable_blocked_message').replace('{count}', String(feedDisableBlocked.count))}
        </Text>
      </BaseModal>
      <ConfirmModal
        visible={disableConfirmVisible}
        title={t('order_statuses_disable_confirm_title')}
        message={t('order_statuses_disable_confirm_message')}
        confirmLabel={t('order_statuses_disable_confirm_action')}
        confirmVariant="destructive"
        onClose={() => setDisableConfirmVisible(false)}
        onConfirm={() => changeMaster(false)}
      />
    </Screen>
  );
}

function Actions({ t, onCancel, onConfirm, confirmTitle, destructive = false, loading = false, disabled = false }) {
  return <View style={{ flexDirection: 'row', gap: 8 }}>
    <View style={{ flex: 1 }}><Button title={t('btn_cancel')} variant="secondary" onPress={onCancel} /></View>
    <View style={{ flex: 1 }}><Button title={confirmTitle} variant={destructive ? 'destructive' : 'primary'} onPress={onConfirm} loading={loading} disabled={disabled} formSubmit /></View>
  </View>;
}

function styles(theme) {
  return StyleSheet.create({
    content: { paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.xxl },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    row: { minHeight: theme.components?.listItem?.height ?? 52, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm },
    textWrap: { flex: 1, minWidth: 0, gap: theme.spacing.xxs },
    title: { color: theme.colors.text, fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weight.medium },
    hint: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm, lineHeight: Math.round(theme.typography.sizes.sm * 1.35) },
    statusName: { flex: 1, color: theme.colors.text, fontSize: theme.typography.sizes.md },
    separator: { height: 1, backgroundColor: theme.colors.border, marginHorizontal: theme.spacing.lg },
    actions: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xxs },
    iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    addRow: { minHeight: theme.components?.listItem?.height ?? 52, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg },
    visibleFieldsRow: { minHeight: theme.components?.listItem?.height ?? 52, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg },
    addText: { color: theme.colors.primary, fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weight.medium },
    limit: { paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.md, color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm },
    empty: { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md },
    disabled: { opacity: 0.45 },
    pressed: { opacity: 0.72 },
    input: { minHeight: theme.components?.input?.height ?? 48, borderWidth: 1, borderColor: theme.colors.inputBorder, borderRadius: theme.radii.md, paddingHorizontal: theme.spacing.md, color: theme.colors.text, fontSize: theme.typography.sizes.md, backgroundColor: theme.colors.inputBg },
    modalText: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.md, lineHeight: Math.round(theme.typography.sizes.md * 1.4) },
    replacementField: { marginTop: theme.spacing.md },
  });
}
