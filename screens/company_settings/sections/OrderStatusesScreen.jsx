import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import Screen from '../../../components/layout/Screen';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import SeparatedList from '../../../components/ui/SeparatedList';
import SectionHeader from '../../../components/ui/SectionHeader';
import TextField from '../../../components/ui/TextField';
import ThemedSwitch from '../../../components/ui/ThemedSwitch';
import { BaseModal, SelectModal } from '../../../components/ui/modals';
import MultiSelectModal from '../../../components/ui/modals/MultiSelectModal';
import { useToast } from '../../../components/ui/ToastProvider';
import {
  ORDER_STATUS_LIMIT,
  ORDER_STATUS_COLOR_PALETTE,
  createCompanyOrderStatus,
  deleteCompanyOrderStatus,
  getCompanyOrderStatusUsage,
  getOrderStatusLabel,
  getDefaultOrderStatusColor,
  getRandomOrderStatusColor,
  invalidateCompanyOrderStatuses,
  updateCompanyOrderStatus,
  setCompanyFeedStatusEnabled,
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
const PROTECTED_STATUS_KEYS = new Set(['new', 'done']);

function isProtectedStatus(row) {
  return PROTECTED_STATUS_KEYS.has(String(row?.status_key || '').trim());
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function resolveError(error, t) {
  const raw = String(error?.message || error || '').trim();
  const lower = raw.toLowerCase();
  if (lower.includes('company_order_statuses_limit_reached')) return t('order_statuses_error_limit');
  if (lower.includes('company_order_status_color_invalid')) return t('common_unexpected_error');
  if (lower.includes('duplicate') || lower.includes('company_order_statuses_company_name_unique')) return t('order_statuses_error_duplicate');
  if (lower.includes('forbidden') || lower.includes('row-level security')) return t('order_statuses_error_forbidden');
  if (lower.includes('replacement_status_not_available') || lower.includes('company_order_status_replacement_required')) {
    return t('order_statuses_error_replacement');
  }
  if (lower.includes('core_order_status_is_immutable')) return t('order_statuses_core_locked');
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
  const [feedBusy, setFeedBusy] = React.useState(false);
  const [feedFieldsModalVisible, setFeedFieldsModalVisible] = React.useState(false);
  const [feedFieldsBusy, setFeedFieldsBusy] = React.useState(false);
  const [feedDisableBlocked, setFeedDisableBlocked] = React.useState({ visible: false, count: 0 });
  const [createModal, setCreateModal] = React.useState({ visible: false, name: '', color: '', error: '' });
  const [editModal, setEditModal] = React.useState({ visible: false, row: null, name: '', color: '', error: '' });
  const [feedColorModal, setFeedColorModal] = React.useState({ visible: false, color: '', error: '' });
  const [deleteModal, setDeleteModal] = React.useState(emptyDeleteState);
  const [replacementPickerVisible, setReplacementPickerVisible] = React.useState(false);
  const [busyId, setBusyId] = React.useState(null);
  const canManage = String(profile?.role || '').toLowerCase() === 'admin';
  const isSoloAdmin =
    canManage && String(user?.user_metadata?.account_type || '').toLowerCase() === 'solo';
  const {
    isLoading: statusesLoading,
    feedEnabled,
    regularStatuses,
    feedStatus,
    settings,
  } = useCompanyOrderStatuses(companyId);
  const s = React.useMemo(() => styles(theme), [theme]);
  const canAdd = canManage && regularStatuses.length < ORDER_STATUS_LIMIT;

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

  const changeFeed = React.useCallback(async (nextValue) => {
    if (!companyId || !canManage || feedBusy) return;
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
  }, [canManage, companyId, feedBusy, feedStatus?.id, queryClient, refresh, t, toast]);

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
      await createCompanyOrderStatus(companyId, {
        name,
        color: createModal.color,
        sortOrder: regularStatuses.length + 1,
      });
      setCreateModal({ visible: false, name: '', color: '', error: '' });
      refresh();
      toast.success(t('order_statuses_created'));
    } catch (error) {
      setCreateModal((prev) => ({ ...prev, error: resolveError(error, t) }));
    } finally {
      setBusyId(null);
    }
  }, [canAdd, companyId, createModal.color, createModal.name, refresh, regularStatuses.length, t, toast, validateName]);

  const renameStatus = React.useCallback(async () => {
    const row = editModal.row;
    if (isProtectedStatus(row)) {
      setEditModal({ visible: false, row: null, name: '', color: '', error: '' });
      toast.info(t('order_statuses_core_locked'));
      return;
    }
    const name = normalizeName(editModal.name);
    const validation = validateName(name, row?.id);
    if (!companyId || !row?.id) return;
    if (validation) {
      setEditModal((prev) => ({ ...prev, error: validation }));
      return;
    }
    setBusyId(row.id);
    try {
      await updateCompanyOrderStatus(companyId, row.id, { name, color: editModal.color });
      setEditModal({ visible: false, row: null, name: '', color: '', error: '' });
      refresh();
      toast.success(t('order_statuses_renamed'));
    } catch (error) {
      setEditModal((prev) => ({ ...prev, error: resolveError(error, t) }));
    } finally {
      setBusyId(null);
    }
  }, [companyId, editModal.color, editModal.name, editModal.row, refresh, t, toast, validateName]);

  const saveFeedColor = React.useCallback(async () => {
    if (!companyId || !feedStatus?.id || !canManage) return;
    setBusyId(feedStatus.id);
    try {
      await updateCompanyOrderStatus(companyId, feedStatus.id, { color: feedColorModal.color });
      setFeedColorModal({ visible: false, color: '', error: '' });
      refresh();
      toast.success(t('order_statuses_color_saved'));
    } catch (error) {
      setFeedColorModal((prev) => ({ ...prev, error: resolveError(error, t) }));
    } finally {
      setBusyId(null);
    }
  }, [canManage, companyId, feedColorModal.color, feedStatus?.id, refresh, t, toast]);

  const openDelete = React.useCallback(async (row) => {
    if (!row?.id || busyId) return;
    if (isProtectedStatus(row)) {
      toast.info(t('order_statuses_core_locked'));
      return;
    }
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
    if (isProtectedStatus(deleteModal.row)) {
      setDeleteModal(emptyDeleteState());
      toast.info(t('order_statuses_core_locked'));
      return;
    }
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
  }, [deleteModal.replacement, deleteModal.row, deleteModal.usageCount, refresh, t, toast]);

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
    return <Screen background="background" headerOptions={{ title: t('order_statuses_title'), helpTopic: 'order_statuses' }}><View style={s.loading}><ActivityIndicator color={theme.colors.primary} /></View></Screen>;
  }

  return (
    <Screen background="background" headerOptions={{ title: t('order_statuses_title'), helpTopic: 'order_statuses' }} scroll={false}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {!isSoloAdmin ? <>
            <SectionHeader>{t('order_statuses_feed_section')}</SectionHeader>
            <Card padded={false} separated>
              <View style={s.row}>
                <View style={[s.colorDot, { backgroundColor: feedStatus?.color || getDefaultOrderStatusColor('feed') }]} />
                <View style={s.textWrap}>
                  <Text style={s.title}>{feedStatus ? getOrderStatusLabel(feedStatus.status_key, [feedStatus], t) : t('order_status_in_feed')}</Text>
                  <Text style={s.hint}>{t('order_statuses_feed_hint')}</Text>
                </View>
                <Pressable
                  disabled={!canManage || !feedStatus || busyId === feedStatus?.id}
                  onPress={() => setFeedColorModal({ visible: true, color: feedStatus?.color || getDefaultOrderStatusColor('feed'), error: '' })}
                  style={({ pressed }) => [s.iconButton, pressed && s.pressed]}
                  accessibilityLabel={t('order_statuses_change_color')}
                >
                  <Feather name="edit-2" size={18} color={theme.colors.textSecondary} />
                </Pressable>
                {feedBusy ? <ActivityIndicator color={theme.colors.primary} /> : <ThemedSwitch value={feedEnabled} onValueChange={changeFeed} disabled={!canManage || !feedStatus} />}
              </View>
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
          <SeparatedList>
            {regularStatuses.map((row) => <View key={row.id} style={s.row}>
                  <View style={[s.colorDot, { backgroundColor: row.color }]} />
                  <Text style={s.statusName} numberOfLines={1}>{getOrderStatusLabel(row.status_key, regularStatuses, t)}</Text>
                  <View style={s.actions}>
                    {busyId === row.id ? <ActivityIndicator color={theme.colors.primary} /> : null}
                    {isProtectedStatus(row) ? (
                      <View style={s.protectedStatus} accessibilityLabel={t('order_statuses_core_locked')}>
                        <Feather name="lock" size={16} color={theme.colors.textSecondary} />
                        <Text style={s.protectedStatusText}>{t('order_statuses_core_badge')}</Text>
                      </View>
                    ) : (
                      <>
                        <Pressable disabled={!canManage || busyId === row.id} onPress={() => setEditModal({ visible: true, row, name: row.name, color: row.color, error: '' })} style={({ pressed }) => [s.iconButton, pressed && s.pressed]} accessibilityLabel={t('btn_edit')}>
                          <Feather name="edit-2" size={18} color={theme.colors.textSecondary} />
                        </Pressable>
                        <Pressable disabled={!canManage || busyId === row.id} onPress={() => openDelete(row)} style={({ pressed }) => [s.iconButton, pressed && s.pressed]} accessibilityLabel={t('btn_delete')}>
                          <Feather name="trash-2" size={18} color={theme.colors.danger} />
                        </Pressable>
                      </>
                    )}
                  </View>
                </View>)}
            {!regularStatuses.length ? <View style={s.empty}><Text style={s.hint}>{t('order_statuses_empty')}</Text></View> : null}
            <Pressable disabled={!canAdd} onPress={() => setCreateModal({ visible: true, name: '', color: getRandomOrderStatusColor(regularStatuses.map((row) => row.color)), error: '' })} style={({ pressed }) => [s.addRow, !canAdd && s.disabled, pressed && s.pressed]}>
              <Feather name="plus-circle" size={18} color={theme.colors.primary} />
              <Text style={s.addText}>{t('order_statuses_add')}</Text>
            </Pressable>
          </SeparatedList>
          <Text style={s.limit}>{t('order_statuses_limit_hint').replace('{count}', String(ORDER_STATUS_LIMIT - regularStatuses.length))}</Text>
        </Card>
      </ScrollView>

      <BaseModal visible={createModal.visible} onClose={() => setCreateModal({ visible: false, name: '', color: '', error: '' })} title={t('order_statuses_create_title')} feedback={createModal.error ? { message: createModal.error, type: 'warning' } : null} footer={<Actions t={t} onCancel={() => setCreateModal({ visible: false, name: '', color: '', error: '' })} onConfirm={createStatus} confirmTitle={t('btn_create')} loading={busyId === 'create'} disabled={!normalizeName(createModal.name) || !createModal.color} />}>
        <TextInput value={createModal.name} onChangeText={(name) => setCreateModal((prev) => ({ ...prev, name }))} placeholder={t('order_statuses_name_placeholder')} placeholderTextColor={theme.colors.inputPlaceholder} maxLength={MAX_NAME_LENGTH} style={s.input} returnKeyType="done" onSubmitEditing={createStatus} />
        <ColorSelector value={createModal.color} onChange={(color) => setCreateModal((prev) => ({ ...prev, color }))} t={t} s={s} />
      </BaseModal>

      <BaseModal visible={editModal.visible} onClose={() => setEditModal({ visible: false, row: null, name: '', color: '', error: '' })} title={t('order_statuses_edit_title')} feedback={editModal.error ? { message: editModal.error, type: 'warning' } : null} footer={<Actions t={t} onCancel={() => setEditModal({ visible: false, row: null, name: '', color: '', error: '' })} onConfirm={renameStatus} confirmTitle={t('btn_save')} loading={busyId === editModal.row?.id} disabled={!normalizeName(editModal.name) || !editModal.color} />}>
        <TextInput value={editModal.name} onChangeText={(name) => setEditModal((prev) => ({ ...prev, name }))} placeholder={t('order_statuses_name_placeholder')} placeholderTextColor={theme.colors.inputPlaceholder} maxLength={MAX_NAME_LENGTH} style={s.input} returnKeyType="done" onSubmitEditing={renameStatus} />
        <ColorSelector value={editModal.color} onChange={(color) => setEditModal((prev) => ({ ...prev, color }))} defaultColor={getDefaultOrderStatusColor(editModal.row?.status_key)} t={t} s={s} />
      </BaseModal>

      <BaseModal visible={feedColorModal.visible} onClose={() => setFeedColorModal({ visible: false, color: '', error: '' })} title={t('order_statuses_change_color')} feedback={feedColorModal.error ? { message: feedColorModal.error, type: 'warning' } : null} footer={<Actions t={t} onCancel={() => setFeedColorModal({ visible: false, color: '', error: '' })} onConfirm={saveFeedColor} confirmTitle={t('btn_save')} loading={busyId === feedStatus?.id} disabled={!feedColorModal.color} />}>
        <ColorSelector value={feedColorModal.color} onChange={(color) => setFeedColorModal((prev) => ({ ...prev, color }))} defaultColor={getDefaultOrderStatusColor('feed')} t={t} s={s} />
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
    </Screen>
  );
}

function Actions({ t, onCancel, onConfirm, confirmTitle, destructive = false, loading = false, disabled = false }) {
  return <View style={{ flexDirection: 'row', gap: 8 }}>
    <View style={{ flex: 1 }}><Button title={t('btn_cancel')} variant="secondary" onPress={onCancel} /></View>
    <View style={{ flex: 1 }}><Button title={confirmTitle} variant={destructive ? 'destructive' : 'primary'} onPress={onConfirm} loading={loading} disabled={disabled} formSubmit /></View>
  </View>;
}

function ColorSelector({ value, onChange, defaultColor = null, t, s }) {
  return <View style={s.colorSection}>
    <View style={s.colorHeader}>
      <Text style={s.colorLabel}>{t('order_statuses_color_label')}</Text>
      {defaultColor && value !== defaultColor ? (
        <Pressable onPress={() => onChange(defaultColor)} accessibilityRole="button">
          <Text style={s.resetColor}>{t('order_statuses_color_reset')}</Text>
        </Pressable>
      ) : null}
    </View>
    <View style={s.colorGrid}>
      {ORDER_STATUS_COLOR_PALETTE.map((color) => {
        const selected = color === value;
        return <Pressable key={color} onPress={() => onChange(color)} style={[s.colorSwatchWrap, selected && s.colorSwatchSelected]} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={color}>
          <View style={[s.colorSwatch, { backgroundColor: color }]}>
            {selected ? <Feather name="check" size={18} color="#FFFFFF" /> : null}
          </View>
        </Pressable>;
      })}
    </View>
  </View>;
}

function styles(theme) {
  return StyleSheet.create({
    content: {
      paddingHorizontal: theme.components.screenLayout.contentPaddingX,
      paddingBottom: theme.components.screenLayout.contentPaddingBottom,
    },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    row: { minHeight: theme.components?.listItem?.height ?? 52, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm },
    textWrap: { flex: 1, minWidth: 0, gap: theme.spacing.xxs },
    title: { color: theme.colors.text, fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weight.medium },
    hint: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm, lineHeight: Math.round(theme.typography.sizes.sm * 1.35) },
    statusName: { flex: 1, color: theme.colors.text, fontSize: theme.typography.sizes.md },
    colorDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: theme.colors.border },
    actions: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xxs },
    protectedStatus: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs, minHeight: 44, paddingHorizontal: theme.spacing.sm },
    protectedStatusText: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm },
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
    colorSection: { marginTop: theme.spacing.lg, gap: theme.spacing.sm },
    colorHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
    colorLabel: { color: theme.colors.text, fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weight.medium },
    resetColor: { color: theme.colors.primary, fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weight.medium },
    colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
    colorSwatchWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
    colorSwatchSelected: { borderColor: theme.colors.text },
    colorSwatch: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  });
}
