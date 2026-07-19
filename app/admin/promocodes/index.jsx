import Feather from '@expo/vector-icons/Feather';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Screen from '../../../components/layout/Screen';
import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import LabelValueRow from '../../../components/ui/LabelValueRow';
import SeparatedList from '../../../components/ui/SeparatedList';
import TextField, { SelectField, SwitchField } from '../../../components/ui/TextField';
import BaseModal from '../../../components/ui/modals/BaseModal';
import DateTimeModal from '../../../components/ui/modals/DateTimeModal';
import { ConfirmModal } from '../../../components/ui/modals';
import { useToast } from '../../../components/ui/ToastProvider';
import { useRequireSuperAdmin } from '../../../hooks/useRequireSuperAdmin';
import { supabase } from '../../../lib/supabase';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';
import { withAlpha } from '../../../theme/colors';
import { KeyboardAwareScrollView } from '../../../lib/keyboardControllerCompat';

const EMPTY_FORM = {
  id: null,
  name: '',
  code: '',
  discountType: 'percent',
  discountValue: '',
  validUntil: null,
  isActive: true,
  comment: '',
};

const DISCOUNT_TYPES = [
  { value: 'percent', labelKey: 'admin_promocode_discount_type_percent' },
  { value: 'fixed', labelKey: 'admin_promocode_discount_type_fixed' },
];

function generatePromoCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 10; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function formatDateTime(value, t, locale) {
  if (!value) return t('admin_promocode_no_expiry');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t('admin_promocode_no_expiry');
  return date.toLocaleString(locale || undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDiscount(row, locale) {
  const value = Number(row?.discount_value || 0);
  if (row?.discount_type === 'percent') return `${value}%`;
  return new Intl.NumberFormat(locale || undefined, {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(value);
}

function mapRowToForm(row) {
  return {
    id: row?.id || null,
    name: row?.name || '',
    code: row?.code || '',
    discountType: row?.discount_type || 'percent',
    discountValue: row?.discount_value != null ? String(row.discount_value) : '',
    validUntil: row?.valid_until || null,
    isActive: row?.is_active !== false,
    comment: row?.comment || '',
  };
}

function serializeForm(form) {
  return JSON.stringify({
    id: form.id || null,
    name: String(form.name || '').trim(),
    code: String(form.code || '').trim(),
    discountType: form.discountType,
    discountValue: String(form.discountValue || '').trim(),
    validUntil: form.validUntil || null,
    isActive: !!form.isActive,
    comment: String(form.comment || '').trim(),
  });
}

async function listPromoCodes() {
  const { data, error } = await supabase.rpc('admin_list_billing_promo_codes');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function savePromoCode(form, t) {
  const discountValue = Number(String(form.discountValue || '').replace(',', '.'));
  if (!String(form.code || '').trim()) throw new Error(t('admin_promocode_validation_code_required'));
  if (!Number.isFinite(discountValue) || discountValue < 0) {
    throw new Error(t('admin_promocode_validation_discount_required'));
  }
  if (form.discountType === 'percent' && discountValue > 100) {
    throw new Error(t('admin_promocode_validation_percent_max'));
  }

  const { data, error } = await supabase.rpc('admin_upsert_billing_promo_code', {
    p_id: form.id || null,
    p_code: String(form.code || '').trim(),
    p_name: String(form.name || '').trim() || String(form.code || '').trim(),
    p_discount_type: form.discountType,
    p_discount_value: discountValue,
    p_valid_until: form.validUntil || null,
    p_is_active: !!form.isActive,
    p_comment: String(form.comment || '').trim() || null,
  });
  if (error) throw error;
  return data;
}

export default function AdminPromoCodesScreen() {
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const nav = useNavigation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { isAllowed, isLoading } = useRequireSuperAdmin();
  const [formVisible, setFormVisible] = React.useState(false);
  const [dateVisible, setDateVisible] = React.useState(false);
  const [discountTypeVisible, setDiscountTypeVisible] = React.useState(false);
  const [discardVisible, setDiscardVisible] = React.useState(false);
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [initialSnapshot, setInitialSnapshot] = React.useState(serializeForm(EMPTY_FORM));
  const discountTypes = React.useMemo(
    () => DISCOUNT_TYPES.map((item) => ({ ...item, label: t(item.labelKey) })),
    [t],
  );

  React.useLayoutEffect(() => {
    nav.setParams({ headerTitle: t('admin_promocodes_title') });
  }, [nav, t]);

  const query = useQuery({
    queryKey: ['adminPromoCodes'],
    queryFn: listPromoCodes,
    enabled: isAllowed,
  });

  const mutation = useMutation({
    mutationFn: (nextForm) => savePromoCode(nextForm, t),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['adminPromoCodes'] });
      setFormVisible(false);
      toast.success(t('admin_promocode_saved'));
    },
    onError: (error) => toast.error(String(error?.message || t('admin_promocode_save_error'))),
  });

  const isDirty = serializeForm(form) !== initialSnapshot;

  const openCreate = React.useCallback(() => {
    const next = { ...EMPTY_FORM, code: generatePromoCode() };
    setForm(next);
    setInitialSnapshot(serializeForm(next));
    setFormVisible(true);
  }, []);

  const openEdit = React.useCallback((row) => {
    const next = mapRowToForm(row);
    setForm(next);
    setInitialSnapshot(serializeForm(next));
    setFormVisible(true);
  }, []);

  const requestCloseForm = React.useCallback(() => {
    if (mutation.isPending) return;
    if (isDirty) {
      setDiscardVisible(true);
      return;
    }
    setFormVisible(false);
  }, [isDirty, mutation.isPending]);

  if (isLoading || !isAllowed) return <Screen background="background" />;

  return (
    <Screen background="background">
      <ScrollView contentContainerStyle={styles(theme).content}>
        <Button title={t('admin_promocodes_create_action')} onPress={openCreate} />

        {query.error ? (
          <Card>
            <Text style={styles(theme).error}>{String(query.error?.message || t('admin_promocodes_load_error'))}</Text>
          </Card>
        ) : null}

        {!query.isLoading && query.data?.length === 0 ? (
          <Card>
            <Text style={styles(theme).muted}>{t('admin_promocodes_empty')}</Text>
          </Card>
        ) : null}

        {(query.data || []).map((row) => {
          const expired = row.valid_until && new Date(row.valid_until).getTime() < Date.now();
          const active = row.is_active && !expired;
          const tone = active ? theme.colors.success : theme.colors.textSecondary;
          return (
            <Pressable key={row.id} onPress={() => openEdit(row)}>
              <Card style={styles(theme).promoCard}>
                <View style={styles(theme).cardHeader}>
                  <View style={styles(theme).cardTitleWrap}>
                    <Text style={styles(theme).promoName}>{row.name || row.code}</Text>
                    <Text style={styles(theme).promoCode}>{row.code}</Text>
                  </View>
                  <View style={[styles(theme).statusPill, { backgroundColor: withAlpha(tone, 0.14) }]}>
                    <Text style={[styles(theme).statusText, { color: tone }]}>
                      {active
                        ? t('admin_promocode_status_active')
                        : expired
                          ? t('admin_promocode_status_expired')
                          : t('admin_promocode_status_inactive')}
                    </Text>
                  </View>
                </View>
                <SeparatedList>
                  <LabelValueRow label={t('admin_promocode_discount_label')} value={formatDiscount(row, locale)} />
                  <LabelValueRow label={t('admin_promocode_valid_until_label')} value={formatDateTime(row.valid_until, t, locale)} />
                </SeparatedList>
                {row.comment ? <Text style={styles(theme).comment}>{row.comment}</Text> : null}
              </Card>
            </Pressable>
          );
        })}
      </ScrollView>

      <BaseModal
        visible={formVisible}
        onClose={requestCloseForm}
        title={form.id ? t('admin_promocode_edit_title') : t('admin_promocode_new_title')}
        maxHeightRatio={0.92}
        presentation="sheet"
        footer={
          <View style={styles(theme).footer}>
            <View style={styles(theme).footerButton}>
              <Button title={t('btn_cancel')} variant="secondary" onPress={requestCloseForm} disabled={mutation.isPending} />
            </View>
            <View style={styles(theme).footerButton}>
              <Button title={t('btn_apply')} onPress={() => mutation.mutate(form)} loading={mutation.isPending} formSubmit />
            </View>
          </View>
        }
      >
        <KeyboardAwareScrollView contentContainerStyle={styles(theme).form}>
          <TextField label={t('admin_promocode_name_label')} value={form.name} onChangeText={(name) => setForm((p) => ({ ...p, name }))} />
          <View style={styles(theme).codeRow}>
            <View style={styles(theme).codeInput}>
              <TextField label={t('admin_promocode_code_label')} value={form.code} onChangeText={(code) => setForm((p) => ({ ...p, code }))} autoCapitalize="characters" />
            </View>
            <Pressable style={styles(theme).generateButton} onPress={() => setForm((p) => ({ ...p, code: generatePromoCode() }))}>
              <Feather name="shuffle" size={16} color={theme.colors.primary} />
              <Text style={styles(theme).generateText}>{t('admin_promocode_generate_action')}</Text>
            </Pressable>
          </View>
          <SelectField
            label={t('admin_promocode_discount_type_label')}
            value={discountTypes.find((x) => x.value === form.discountType)?.label || ''}
            onPress={() => setDiscountTypeVisible(true)}
          />
          <TextField
            label={form.discountType === 'percent' ? t('admin_promocode_discount_percent_label') : t('admin_promocode_discount_amount_label')}
            value={form.discountValue}
            onChangeText={(discountValue) => setForm((p) => ({ ...p, discountValue }))}
            keyboardType="decimal-pad"
            numericInput={{ allowNegative: false }}
          />
          <SelectField label={t('admin_promocode_valid_until_label')} value={formatDateTime(form.validUntil, t, locale)} onPress={() => setDateVisible(true)} />
          {form.validUntil ? (
            <Pressable onPress={() => setForm((p) => ({ ...p, validUntil: null }))}>
              <Text style={styles(theme).clearDate}>{t('admin_promocode_make_unlimited')}</Text>
            </Pressable>
          ) : null}
          <SwitchField label={t('admin_promocode_active_label')} value={form.isActive} onValueChange={(isActive) => setForm((p) => ({ ...p, isActive }))} />
          <TextField
            label={t('admin_promocode_comment_label')}
            value={form.comment}
            onChangeText={(comment) => setForm((p) => ({ ...p, comment }))}
            multiline
            minLines={3}
          />
        </KeyboardAwareScrollView>
      </BaseModal>

      <DateTimeModal
        visible={dateVisible}
        onClose={() => setDateVisible(false)}
        mode="datetime"
        initial={form.validUntil || new Date()}
        onApply={(date) => setForm((p) => ({ ...p, validUntil: date.toISOString() }))}
        allowFutureDates
        allowPastDates={false}
      />

      <BaseModal
        visible={discountTypeVisible}
        onClose={() => setDiscountTypeVisible(false)}
        title={t('admin_promocode_discount_type_label')}
        maxHeightRatio={0.45}
        presentation="sheet"
      >
        <SeparatedList>
          {discountTypes.map((item) => (
            <Pressable
              key={item.value}
              style={styles(theme).optionRow}
              onPress={() => {
                setForm((p) => ({ ...p, discountType: item.value }));
                setDiscountTypeVisible(false);
              }}
            >
              <Text style={styles(theme).optionText}>{item.label}</Text>
              {form.discountType === item.value ? <Feather name="check" size={18} color={theme.colors.primary} /> : null}
            </Pressable>
          ))}
        </SeparatedList>
      </BaseModal>

      <ConfirmModal
        visible={discardVisible}
        title={t('admin_promocode_discard_title')}
        message={t('admin_promocode_discard_message')}
        confirmLabel={t('admin_promocode_discard_confirm')}
        confirmVariant="destructive"
        onClose={() => setDiscardVisible(false)}
        onConfirm={() => {
          setDiscardVisible(false);
          setFormVisible(false);
        }}
      />
    </Screen>
  );
}

const styles = (theme) =>
  StyleSheet.create({
    content: {
      paddingHorizontal: theme.components.screenLayout.contentPaddingX,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.components.screenLayout.contentPaddingBottom,
      gap: theme.spacing.md,
    },
    promoCard: { gap: theme.spacing.sm },
    cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.spacing.sm },
    cardTitleWrap: { flex: 1, minWidth: 0 },
    promoName: { color: theme.colors.text, fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weight.bold },
    promoCode: { marginTop: 2, color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weight.semibold },
    statusPill: { paddingHorizontal: theme.spacing.sm, paddingVertical: 4, borderRadius: theme.radii.pill },
    statusText: { fontSize: theme.typography.sizes.xs, fontWeight: theme.typography.weight.bold },
    muted: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.md },
    error: { color: theme.colors.danger, fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weight.semibold },
    comment: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm },
    footer: { flexDirection: 'row', gap: theme.spacing.sm },
    footerButton: { flex: 1 },
    form: { gap: theme.spacing.sm },
    codeRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
    codeInput: { flex: 1 },
    generateButton: {
      minHeight: 48,
      paddingHorizontal: theme.spacing.sm,
      borderRadius: theme.radii.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    generateText: { color: theme.colors.primary, fontSize: theme.typography.sizes.xs, fontWeight: theme.typography.weight.bold },
    clearDate: { color: theme.colors.primary, fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weight.semibold, paddingHorizontal: theme.spacing.md },
    optionRow: {
      minHeight: theme.components.listItem.height,
      paddingHorizontal: theme.spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    optionText: { color: theme.colors.text, fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weight.medium },
  });
