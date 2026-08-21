import Feather from '@expo/vector-icons/Feather';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import SearchFiltersBar from '../../../components/filters/SearchFiltersBar';
import Screen from '../../../components/layout/Screen';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import EmptyListState from '../../../components/ui/EmptyListState';
import LabelValueRow from '../../../components/ui/LabelValueRow';
import {
  ThemedRefreshControl,
} from '../../../components/ui/PullToRefreshFeedback';
import SeparatedList from '../../../components/ui/SeparatedList';
import TextField, { SelectField, SwitchField } from '../../../components/ui/TextField';
import { useToast } from '../../../components/ui/ToastProvider';
import {
  BaseModal,
  ConfirmModal,
  DateTimeModal,
  SelectModal,
} from '../../../components/ui/modals';
import ModalActionsRow from '../../../components/ui/modals/ModalActionsRow';
import { useRequireSuperAdmin } from '../../../hooks/useRequireSuperAdmin';
import { formatCurrencyWithOptions } from '../../../lib/currency';
import { KeyboardAwareScrollView } from '../../../lib/keyboardControllerCompat';
import { resolveAppLocale } from '../../../lib/localeFormatting';
import { supabase } from '../../../lib/supabase';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { TEXT_INPUT_LIMITS } from '../../../src/shared/input/limits';
import { withReadDeadline } from '../../../src/shared/network/readDeadline';
import {
  canRunDeferredNetworkWork,
  useOfflineSnapshot,
} from '../../../src/shared/offline/offlineStatus';
import { buildSearchIndex, matchesSearch } from '../../../src/shared/search/matching';
import { useTheme } from '../../../theme/ThemeProvider';

const BILLING_CURRENCY = 'RUB';
const BILLING_TIME_ZONE = 'Europe/Moscow';
const GENERATED_PROMO_CODE_LENGTH = 10;
const PROMO_CODE_MAX_LENGTH = 64;
const PROMO_COMMENT_MAX_LENGTH = 2000;
const PROMO_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PROMO_QUERY_KEY = ['adminPromoCodesV2'];

const EMPTY_FORM = Object.freeze({
  name: '',
  code: '',
  discountType: 'percent',
  discountValue: '',
  validUntil: null,
  isActive: true,
  comment: '',
});

const DISCOUNT_TYPES = Object.freeze([
  { value: 'percent', labelKey: 'admin_promocode_discount_type_percent' },
  { value: 'fixed', labelKey: 'admin_promocode_discount_type_fixed' },
]);

function generatePromoCode() {
  let code = '';
  for (let index = 0; index < GENERATED_PROMO_CODE_LENGTH; index += 1) {
    code += PROMO_CODE_ALPHABET[Math.floor(Math.random() * PROMO_CODE_ALPHABET.length)];
  }
  return code;
}

function formatDateTime(value, t, locale, emptyLabelKey = 'admin_promocode_no_expiry') {
  if (!value) return t(emptyLabelKey);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t(emptyLabelKey);

  return new Intl.DateTimeFormat(resolveAppLocale(locale), {
    timeZone: BILLING_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDiscount(row, locale) {
  const value = Number(row?.discount_value || 0);
  if (row?.discount_type === 'percent') return `${value}%`;

  return formatCurrencyWithOptions(
    value,
    BILLING_CURRENCY,
    resolveAppLocale(locale),
    { maximumFractionDigits: 2 },
  );
}

function getPromoStatus(row) {
  const expiresAt = row?.valid_until ? new Date(row.valid_until).getTime() : null;
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return 'expired';
  return row?.is_active === true ? 'active' : 'inactive';
}

function getPromoStatusLabel(row, t) {
  const status = getPromoStatus(row);
  if (status === 'active') return t('admin_promocode_status_active');
  if (status === 'expired') return t('admin_promocode_status_expired');
  return t('admin_promocode_status_inactive');
}

function getPromoStatusColor(row, theme) {
  const status = getPromoStatus(row);
  if (status === 'active') return theme.colors.success;
  if (status === 'expired') return theme.colors.danger;
  return theme.colors.textSecondary;
}

function formatDiscountType(row, t) {
  return row?.discount_type === 'fixed'
    ? t('admin_promocode_discount_type_fixed')
    : t('admin_promocode_discount_type_percent');
}

function serializeForm(form) {
  return JSON.stringify({
    name: String(form.name || '').trim(),
    code: String(form.code || '').trim(),
    discountType: form.discountType,
    discountValue: String(form.discountValue || '').trim(),
    validUntil: form.validUntil || null,
    isActive: !!form.isActive,
    comment: String(form.comment || '').trim(),
  });
}

async function listPromoCodes(signal) {
  const { data, error } = await supabase
    .rpc('admin_list_billing_promo_codes_v2')
    .abortSignal(signal);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function createPromoCode(form, t) {
  const discountValue = Number(String(form.discountValue || '').replace(',', '.'));
  if (!String(form.code || '').trim()) {
    throw new Error(t('admin_promocode_validation_code_required'));
  }
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    throw new Error(t('admin_promocode_validation_discount_required'));
  }
  if (form.discountType === 'percent' && discountValue > 100) {
    throw new Error(t('admin_promocode_validation_percent_max'));
  }

  const { data, error } = await supabase.rpc('admin_create_billing_promo_code', {
    p_code: String(form.code || '').trim(),
    p_name: String(form.name || '').trim() || String(form.code || '').trim(),
    p_discount_type: form.discountType,
    p_discount_value: discountValue,
    p_valid_until: form.validUntil || null,
    p_is_active: !!form.isActive,
    p_comment: String(form.comment || '').trim() || null,
  });

  if (error?.code === '23505') {
    throw new Error(t('admin_promocode_validation_code_duplicate'));
  }
  if (error) throw error;
  return data;
}

async function setPromoCodeActive(id, isActive) {
  const { data, error } = await supabase.rpc('admin_set_billing_promo_code_active', {
    p_id: id,
    p_is_active: isActive,
  });
  if (error) throw error;
  return data;
}

async function deletePromoCode(id) {
  const { data, error } = await supabase.rpc('admin_delete_billing_promo_code', {
    p_id: id,
  });
  if (error) throw error;
  return data;
}

function resolveThemeSpacing(theme, value, fallback) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return theme.spacing[value] ?? fallback;
  return fallback;
}

export default function AdminPromoCodesScreen() {
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const toast = useToast();
  const queryClient = useQueryClient();
  const { isAllowed, isLoading: guardLoading } = useRequireSuperAdmin();
  const offlineSnapshot = useOfflineSnapshot();
  const canUseAdminNetwork = canRunDeferredNetworkWork(offlineSnapshot);
  const [search, setSearch] = React.useState('');
  const [createVisible, setCreateVisible] = React.useState(false);
  const [dateVisible, setDateVisible] = React.useState(false);
  const [discountTypeVisible, setDiscountTypeVisible] = React.useState(false);
  const [discardVisible, setDiscardVisible] = React.useState(false);
  const [selectedPromoId, setSelectedPromoId] = React.useState(null);
  const [deleteTargetId, setDeleteTargetId] = React.useState(null);
  const [form, setForm] = React.useState({ ...EMPTY_FORM });
  const [initialSnapshot, setInitialSnapshot] = React.useState(serializeForm(EMPTY_FORM));

  const discountTypes = React.useMemo(
    () =>
      DISCOUNT_TYPES.map((item) => ({
        id: item.value,
        value: item.value,
        label: t(item.labelKey),
      })),
    [t],
  );

  const query = useQuery({
    queryKey: PROMO_QUERY_KEY,
    queryFn: ({ signal }) =>
      withReadDeadline(
        (readSignal) => listPromoCodes(readSignal),
        { label: 'Admin promo codes', signal },
      ),
    enabled: isAllowed && canUseAdminNetwork,
    placeholderData: (previousData) => previousData,
    staleTime: 30 * 1000,
  });
  const refreshPromoCodes = React.useCallback(
    () => (canUseAdminNetwork ? query.refetch() : Promise.resolve()),
    [canUseAdminNetwork, query],
  );

  const promoCodes = React.useMemo(
    () => (Array.isArray(query.data) ? query.data : []),
    [query.data],
  );

  const filteredPromoCodes = React.useMemo(() => {
    const normalizedSearch = search.trim();
    if (!normalizedSearch) return promoCodes;

    return promoCodes.filter((row) => {
      const index = buildSearchIndex({
        texts: [
          row.id,
          row.name,
          row.code,
          row.comment,
          row.discount_type,
          formatDiscountType(row, t),
          formatDiscount(row, locale),
          getPromoStatusLabel(row, t),
          formatDateTime(row.valid_until, t, locale),
          row.successful_redemptions,
          row.unique_companies_count,
          row.total_discount_amount,
          formatDateTime(
            row.last_redeemed_at,
            t,
            locale,
            'admin_promocode_never_redeemed',
          ),
          formatDateTime(row.created_at, t, locale, 'admin_promocode_never_redeemed'),
        ],
      });
      return matchesSearch(index, normalizedSearch);
    });
  }, [locale, promoCodes, search, t]);

  const selectedPromo = React.useMemo(
    () => promoCodes.find((row) => String(row.id) === String(selectedPromoId)) || null,
    [promoCodes, selectedPromoId],
  );

  const deleteTarget = React.useMemo(
    () => promoCodes.find((row) => String(row.id) === String(deleteTargetId)) || null,
    [deleteTargetId, promoCodes],
  );

  const createMutation = useMutation({
    mutationFn: (nextForm) => createPromoCode(nextForm, t),
    onSuccess: async () => {
      setCreateVisible(false);
      await queryClient.invalidateQueries({ queryKey: PROMO_QUERY_KEY });
      toast.success(t('admin_promocode_created'));
    },
    onError: (error) =>
      toast.error(String(error?.message || t('admin_promocode_create_error'))),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }) => setPromoCodeActive(id, isActive),
    onSuccess: async (updated, variables) => {
      queryClient.setQueryData(PROMO_QUERY_KEY, (current) =>
        Array.isArray(current)
          ? current.map((row) =>
              String(row.id) === String(variables.id)
                ? { ...row, is_active: updated?.is_active ?? variables.isActive }
                : row,
            )
          : current,
      );
      await queryClient.invalidateQueries({ queryKey: PROMO_QUERY_KEY });
      toast.success(
        variables.isActive
          ? t('admin_promocode_activated')
          : t('admin_promocode_deactivated'),
      );
    },
    onError: (error) =>
      toast.error(String(error?.message || t('admin_promocode_status_change_error'))),
  });

  const deleteMutation = useMutation({
    mutationFn: deletePromoCode,
    onSuccess: async (_result, deletedId) => {
      setSelectedPromoId(null);
      queryClient.setQueryData(PROMO_QUERY_KEY, (current) =>
        Array.isArray(current)
          ? current.filter((row) => String(row.id) !== String(deletedId))
          : current,
      );
      await queryClient.invalidateQueries({ queryKey: PROMO_QUERY_KEY });
      toast.success(t('admin_promocode_deleted'));
    },
    onError: (error) =>
      toast.error(String(error?.message || t('admin_promocode_delete_error'))),
  });

  const isDirty = serializeForm(form) !== initialSnapshot;

  const openCreate = React.useCallback(() => {
    const next = { ...EMPTY_FORM, code: generatePromoCode() };
    setForm(next);
    setInitialSnapshot(serializeForm(next));
    setCreateVisible(true);
  }, []);

  const requestCloseCreate = React.useCallback(() => {
    if (createMutation.isPending) return;
    if (isDirty) {
      setDiscardVisible(true);
      return;
    }
    setCreateVisible(false);
  }, [createMutation.isPending, isDirty]);

  const headerOptions = React.useMemo(
    () => ({
      title: t('admin_promocodes_title'),
      rightTextLabel: t('btn_create'),
      onRightPress: openCreate,
    }),
    [openCreate, t],
  );

  const renderPromoCode = React.useCallback(
    ({ item: row }) => {
      const statusColor = getPromoStatusColor(row, theme);
      const statusLabel = getPromoStatusLabel(row, t);
      const summary = t('admin_promocode_card_summary')
        .replace('{discount}', formatDiscount(row, locale))
        .replace('{validUntil}', formatDateTime(row.valid_until, t, locale));

      return (
        <Card padded={false}>
          <Pressable
            style={({ pressed }) => [
              styles.promoRow,
              pressed ? styles.promoRowPressed : null,
            ]}
            onPress={() => setSelectedPromoId(row.id)}
            android_ripple={{ color: theme.colors.ripple, borderless: false }}
            pressRetentionOffset={theme.components.interactive.pressRetentionOffset}
            accessibilityRole="button"
            accessibilityLabel={row.name || row.code}
          >
            <View style={styles.promoInfo}>
              <View style={styles.cardHeader}>
                <Text style={styles.promoName} numberOfLines={2}>
                  {row.name || row.code}
                </Text>
                <View style={[styles.statusBadge, { borderColor: statusColor }]}>
                  <Text
                    style={[styles.statusText, { color: statusColor }]}
                    numberOfLines={1}
                  >
                    {statusLabel}
                  </Text>
                </View>
              </View>

              <Text style={styles.promoCode} numberOfLines={1}>
                {row.code}
              </Text>
              <Text style={styles.promoMeta} numberOfLines={2}>
                {summary}
              </Text>
              <Text style={styles.redemptions} numberOfLines={1}>
                {t('admin_promocode_paid_redemptions_label')}: {row.successful_redemptions ?? 0}
              </Text>
            </View>

            <View style={styles.chevron}>
              <Feather
                name="chevron-right"
                size={theme.components.listItem.chevronSize}
                color={theme.colors.textSecondary}
              />
            </View>
          </Pressable>
        </Card>
      );
    },
    [locale, styles, t, theme],
  );

  const keyExtractor = React.useCallback((row) => String(row.id), []);
  const refreshing = query.isRefetching && !query.isLoading;
  const selectedStatus = selectedPromo ? getPromoStatus(selectedPromo) : null;
  const selectedStatusColor = selectedPromo
    ? getPromoStatusColor(selectedPromo, theme)
    : theme.colors.textSecondary;
  const togglePendingForSelected =
    toggleMutation.isPending &&
    String(toggleMutation.variables?.id || '') === String(selectedPromo?.id || '');

  const errorCard = query.error ? (
    <Card style={styles.stateCard}>
      <Text style={styles.errorTitle}>{t('admin_error_title')}</Text>
      <Text style={styles.errorText}>
        {String(query.error?.message || t('admin_promocodes_load_error'))}
      </Text>
      <Button
        title={t('btn_retry')}
        size="sm"
        onPress={refreshPromoCodes}
        containerStyle={styles.retryButton}
      />
    </Card>
  ) : null;

  if (guardLoading || !isAllowed) {
    return <Screen scroll={false} />;
  }

  return (
    <Screen scroll={false} headerOptions={headerOptions}>
      <View style={styles.screen}>
        <View style={styles.search}>
          <SearchFiltersBar
            value={search}
            onChangeText={setSearch}
            onClear={() => setSearch('')}
            placeholder={t('admin_promocodes_search_placeholder')}
            metaText={`${t('common_total')}: ${filteredPromoCodes.length}`}
            searchProps={{ maxLength: TEXT_INPUT_LIMITS.search }}
          />
        </View>

        <FlatList
          style={styles.list}
          contentContainerStyle={[
            styles.listContent,
            filteredPromoCodes.length === 0 ? styles.emptyListContent : null,
          ]}
          data={filteredPromoCodes}
          keyExtractor={keyExtractor}
          renderItem={renderPromoCode}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={
            <ThemedRefreshControl refreshing={refreshing} onRefresh={refreshPromoCodes} />
          }
          ListHeaderComponent={query.error && promoCodes.length > 0 ? errorCard : null}
          ListEmptyComponent={
            query.isLoading ? (
              <View style={styles.state}>
                <ActivityIndicator
                  size={theme.components.activityIndicator.size}
                  color={theme.colors.primary}
                />
              </View>
            ) : query.error ? (
              errorCard
            ) : (
              <EmptyListState
                style={styles.state}
                message={
                  search.trim() ? t('empty_noResults') : t('admin_promocodes_empty')
                }
              />
            )
          }
        />
      </View>

      <BaseModal
        visible={createVisible}
        onRequestClose={requestCloseCreate}
        onClose={() => setCreateVisible(false)}
        title={t('admin_promocode_new_title')}
        presentation="sheet"
        footer={
          <ModalActionsRow
            actions={[
              {
                key: 'cancel',
                title: t('btn_cancel'),
                variant: 'secondary',
                onPress: requestCloseCreate,
                disabled: createMutation.isPending,
              },
              {
                key: 'create',
                title: t('btn_create'),
                variant: 'primary',
                onPress: () => createMutation.mutate(form),
                loading: createMutation.isPending,
                formSubmit: true,
              },
            ]}
          />
        }
      >
        <KeyboardAwareScrollView contentContainerStyle={styles.form}>
          <TextField
            label={t('admin_promocode_name_label')}
            value={form.name}
            onChangeText={(name) => setForm((previous) => ({ ...previous, name }))}
            maxLength={TEXT_INPUT_LIMITS.name}
          />
          <View style={styles.codeRow}>
            <View style={styles.codeInput}>
              <TextField
                label={t('admin_promocode_code_label')}
                value={form.code}
                onChangeText={(code) =>
                  setForm((previous) => ({
                    ...previous,
                    code: String(code || '').toUpperCase().replace(/\s+/g, ''),
                  }))
                }
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={PROMO_CODE_MAX_LENGTH}
              />
            </View>
            <Button
              title={t('admin_promocode_generate_action')}
              variant="outline"
              size="sm"
              onPress={() =>
                setForm((previous) => ({ ...previous, code: generatePromoCode() }))
              }
            />
          </View>
          <SelectField
            label={t('admin_promocode_discount_type_label')}
            value={
              discountTypes.find((item) => item.value === form.discountType)?.label || ''
            }
            onPress={() => setDiscountTypeVisible(true)}
          />
          <TextField
            label={
              form.discountType === 'percent'
                ? t('admin_promocode_discount_percent_label')
                : t('admin_promocode_discount_amount_label')
            }
            value={form.discountValue}
            onChangeText={(discountValue) =>
              setForm((previous) => ({ ...previous, discountValue }))
            }
            keyboardType="decimal-pad"
            numericInput={{ allowNegative: false }}
            maxLength={TEXT_INPUT_LIMITS.numeric}
          />
          <SelectField
            label={t('admin_promocode_valid_until_label')}
            value={formatDateTime(form.validUntil, t, locale)}
            onPress={() => setDateVisible(true)}
          />
          {form.validUntil ? (
            <Pressable
              onPress={() =>
                setForm((previous) => ({ ...previous, validUntil: null }))
              }
              accessibilityRole="button"
              accessibilityLabel={t('admin_promocode_make_unlimited')}
            >
              <Text style={styles.clearDate}>
                {t('admin_promocode_make_unlimited')}
              </Text>
            </Pressable>
          ) : null}
          <SwitchField
            label={t('admin_promocode_active_label')}
            value={form.isActive}
            onValueChange={(isActive) =>
              setForm((previous) => ({ ...previous, isActive }))
            }
          />
          <TextField
            label={t('admin_promocode_comment_label')}
            value={form.comment}
            onChangeText={(comment) =>
              setForm((previous) => ({ ...previous, comment }))
            }
            multiline
            minLines={3}
            maxLength={PROMO_COMMENT_MAX_LENGTH}
          />
        </KeyboardAwareScrollView>
      </BaseModal>

      <BaseModal
        visible={!!selectedPromo}
        onClose={() => setSelectedPromoId(null)}
        title={selectedPromo?.name || selectedPromo?.code || t('admin_promocodes_title')}
        presentation="sheet"
        footer={
          selectedPromo ? (
            <ModalActionsRow
              actions={[
                {
                  key: 'toggle',
                  title:
                    selectedStatus === 'active'
                      ? t('admin_promocode_deactivate_action')
                      : t('admin_promocode_activate_action'),
                  variant: selectedStatus === 'active' ? 'outline' : 'primary',
                  onPress: () =>
                    toggleMutation.mutate({
                      id: selectedPromo.id,
                      isActive: selectedStatus !== 'active',
                    }),
                  loading: togglePendingForSelected,
                  disabled:
                    selectedStatus === 'expired' ||
                    deleteMutation.isPending ||
                    togglePendingForSelected,
                },
                {
                  key: 'delete',
                  title: t('btn_delete'),
                  variant: 'destructive',
                  onPress: () => setDeleteTargetId(selectedPromo.id),
                  disabled: toggleMutation.isPending || deleteMutation.isPending,
                },
              ]}
            />
          ) : null
        }
      >
        {selectedPromo ? (
          <ScrollView
            contentContainerStyle={styles.detailsContent}
            showsVerticalScrollIndicator={false}
          >
            <SeparatedList>
              <LabelValueRow
                label={t('admin_promocode_code_label')}
                value={selectedPromo.code}
              />
              <LabelValueRow
                label={t('admin_promocode_status_label')}
                valueComponent={
                  <Text style={[styles.detailStatus, { color: selectedStatusColor }]}>
                    {getPromoStatusLabel(selectedPromo, t)}
                  </Text>
                }
              />
              <LabelValueRow
                label={t('admin_promocode_discount_type_label')}
                value={formatDiscountType(selectedPromo, t)}
              />
              <LabelValueRow
                label={t('admin_promocode_discount_label')}
                value={formatDiscount(selectedPromo, locale)}
              />
              <LabelValueRow
                label={t('admin_promocode_valid_until_label')}
                value={formatDateTime(selectedPromo.valid_until, t, locale)}
              />
              <LabelValueRow
                label={t('admin_promocode_paid_redemptions_label')}
                value={String(selectedPromo.successful_redemptions ?? 0)}
              />
              <LabelValueRow
                label={t('admin_promocode_unique_companies_label')}
                value={String(selectedPromo.unique_companies_count ?? 0)}
              />
              <LabelValueRow
                label={t('admin_promocode_total_discount_label')}
                value={formatCurrencyWithOptions(
                  selectedPromo.total_discount_amount || 0,
                  BILLING_CURRENCY,
                  resolveAppLocale(locale),
                  { maximumFractionDigits: 2 },
                )}
              />
              <LabelValueRow
                label={t('admin_promocode_last_redeemed_label')}
                value={formatDateTime(
                  selectedPromo.last_redeemed_at,
                  t,
                  locale,
                  'admin_promocode_never_redeemed',
                )}
              />
              <LabelValueRow
                label={t('admin_promocode_created_at_label')}
                value={formatDateTime(
                  selectedPromo.created_at,
                  t,
                  locale,
                  'admin_promocode_never_redeemed',
                )}
              />
              {selectedPromo.comment ? (
                <LabelValueRow
                  label={t('admin_promocode_comment_label')}
                  value={selectedPromo.comment}
                  fullRow
                  maxValueLines={8}
                />
              ) : null}
            </SeparatedList>
            <Text style={styles.redemptionHint}>
              {t('admin_promocode_paid_redemptions_hint')}
            </Text>
          </ScrollView>
        ) : null}
      </BaseModal>

      <DateTimeModal
        visible={dateVisible}
        onClose={() => setDateVisible(false)}
        mode="datetime"
        initial={form.validUntil || new Date()}
        onApply={(date) =>
          setForm((previous) => ({ ...previous, validUntil: date.toISOString() }))
        }
        allowFutureDates
        allowPastDates={false}
      />

      <SelectModal
        visible={discountTypeVisible}
        onClose={() => setDiscountTypeVisible(false)}
        title={t('admin_promocode_discount_type_label')}
        searchable={false}
        items={discountTypes}
        selectedId={form.discountType}
        onSelect={(item) => {
          setForm((previous) => ({ ...previous, discountType: item.value }));
          setDiscountTypeVisible(false);
        }}
      />

      <ConfirmModal
        visible={discardVisible}
        title={t('admin_promocode_discard_title')}
        message={t('admin_promocode_discard_message')}
        confirmLabel={t('admin_promocode_discard_confirm')}
        confirmVariant="destructive"
        onClose={() => setDiscardVisible(false)}
        onConfirm={() => {
          setDiscardVisible(false);
          setCreateVisible(false);
        }}
      />

      <ConfirmModal
        visible={!!deleteTarget}
        title={t('admin_promocode_delete_title')}
        message={t('admin_promocode_delete_message').replace(
          '{code}',
          deleteTarget?.code || '',
        )}
        confirmLabel={t('btn_delete')}
        confirmVariant="destructive"
        loading={deleteMutation.isPending}
        onClose={() => setDeleteTargetId(null)}
        onConfirm={() => deleteMutation.mutate(deleteTargetId)}
      />
    </Screen>
  );
}

const createStyles = (theme) => {
  const cardPaddingX = resolveThemeSpacing(
    theme,
    theme.components.card.padX,
    theme.spacing.lg,
  );
  const cardPaddingY = resolveThemeSpacing(
    theme,
    theme.components.card.padY,
    theme.spacing.md,
  );

  return StyleSheet.create({
    screen: {
      flex: 1,
    },
    search: {
      paddingTop: theme.spacing.sm,
    },
    list: {
      flex: 1,
    },
    listContent: {
      paddingHorizontal: theme.components.screenLayout.contentPaddingX,
      paddingBottom: theme.components.screenLayout.contentPaddingBottom,
      gap: theme.spacing.sm,
    },
    emptyListContent: {
      flexGrow: 1,
    },
    promoRow: {
      minHeight: theme.components.listItem.height,
      paddingHorizontal: cardPaddingX,
      paddingVertical: cardPaddingY,
      borderRadius: theme.components.card.radius,
      flexDirection: 'row',
      alignItems: 'center',
    },
    promoRowPressed: {
      opacity: theme.components.button.pressedOpacity,
    },
    promoInfo: {
      flex: 1,
      minWidth: 0,
      gap: theme.spacing.xs,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.sm,
    },
    promoName: {
      flex: 1,
      minWidth: 0,
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
    },
    promoCode: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.bold,
    },
    promoMeta: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
    redemptions: {
      color: theme.colors.primary,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.semibold,
    },
    statusBadge: {
      flexShrink: 0,
      borderRadius: theme.radii.pill,
      borderWidth: theme.components.card.borderWidth,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
      backgroundColor: theme.colors.surface,
    },
    statusText: {
      fontSize: theme.typography.sizes.xs,
      fontWeight: theme.typography.weight.bold,
    },
    chevron: {
      flexShrink: 0,
      marginLeft: theme.components.listItem.chevronGap,
      alignItems: 'center',
      justifyContent: 'center',
    },
    state: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.components.screenLayout.contentPaddingX,
      paddingVertical: theme.spacing.xl,
    },
    stateCard: {
      gap: theme.spacing.sm,
    },
    errorTitle: {
      color: theme.colors.danger,
      fontSize: theme.typography.sizes.lg,
      fontWeight: theme.typography.weight.bold,
    },
    errorText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
    retryButton: {
      alignSelf: 'flex-start',
    },
    form: {
      gap: theme.spacing.sm,
      paddingBottom: theme.spacing.md,
    },
    codeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    codeInput: {
      flex: 1,
      minWidth: 0,
    },
    clearDate: {
      color: theme.colors.primary,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.semibold,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.xs,
    },
    detailsContent: {
      paddingTop: theme.spacing.sm,
      paddingBottom: theme.spacing.md,
      gap: theme.spacing.md,
    },
    detailStatus: {
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
    },
    redemptionHint: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      lineHeight: Math.round(
        theme.typography.sizes.sm * theme.typography.lineHeights.normal,
      ),
    },
  });
};
