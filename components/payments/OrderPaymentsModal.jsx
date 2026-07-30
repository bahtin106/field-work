import Feather from '@expo/vector-icons/Feather';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { formatCurrency } from '../../lib/currency';
import {
  useDeleteOrderCustomerPaymentMutation,
  useOrderCustomerPayments,
  useUpsertOrderCustomerPaymentMutation,
} from '../../src/features/payments/queries';
import { getOrderPaymentSummary } from '../../src/features/payments/model';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme/ThemeProvider';
import Button from '../ui/Button';
import Card from '../ui/Card';
import InfoHintButton from '../ui/InfoHintButton';
import LabelValueRow from '../ui/LabelValueRow';
import TextField from '../ui/TextField';
import { useToast } from '../ui/ToastProvider';
import {
  BaseModal,
  AlertModal,
  ConfirmModal,
  DateTimeModal,
  SelectModal,
} from '../ui/modals';

function parsePaymentAmount(value) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null;
}

function paymentErrorMessage(error, t) {
  const message = String(error?.message || '').trim();
  if (message === 'subscription_read_only') return t('err_subscription_read_only');
  if (/finance edit permission required|permission denied|forbidden/i.test(message)) {
    return t('order_payments_error_permission');
  }
  return t('order_payments_error_save');
}

function mergeSelectedDate(previousValue, selectedValue) {
  const previous = new Date(previousValue || Date.now());
  const selected = new Date(selectedValue || Date.now());
  if (Number.isNaN(selected.getTime())) return new Date().toISOString();
  const hours = Number.isNaN(previous.getTime()) ? 12 : previous.getHours();
  const minutes = Number.isNaN(previous.getTime()) ? 0 : previous.getMinutes();
  selected.setHours(hours, minutes, 0, 0);
  return selected.toISOString();
}

export default function OrderPaymentsModal({
  visible,
  onClose,
  orderId,
  totalAmount,
  currency = 'RUB',
  canEdit = false,
  defaultPaymentMethod = 'cash',
  defaultMoneyHolder = 'company',
  showMoneyHolder = true,
  cashEnabled = true,
  cashlessEnabled = true,
}) {
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const toast = useToast();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const paymentsQuery = useOrderCustomerPayments(orderId, {
    enabled: visible && !!orderId,
  });
  const upsertMutation = useUpsertOrderCustomerPaymentMutation(orderId);
  const deleteMutation = useDeleteOrderCustomerPaymentMutation(orderId);
  const payments = React.useMemo(
    () => (Array.isArray(paymentsQuery.data) ? paymentsQuery.data : []),
    [paymentsQuery.data],
  );
  const summary = React.useMemo(
    () => getOrderPaymentSummary(payments, totalAmount),
    [payments, totalAmount],
  );
  const [editorVisible, setEditorVisible] = React.useState(false);
  const [methodModalVisible, setMethodModalVisible] = React.useState(false);
  const [moneyHolderModalVisible, setMoneyHolderModalVisible] = React.useState(false);
  const [moneyHolderHelpVisible, setMoneyHolderHelpVisible] = React.useState(false);
  const [dateModalVisible, setDateModalVisible] = React.useState(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = React.useState(false);
  const [editorFeedback, setEditorFeedback] = React.useState('');
  const [draft, setDraft] = React.useState({
    id: null,
    amount: '',
    payment_method: defaultPaymentMethod,
    money_holder: defaultMoneyHolder,
    paid_at: new Date().toISOString(),
    note: '',
  });

  const availableMethods = React.useMemo(
    () =>
      [
        {
          id: 'cash',
          label: t('order_payment_method_cash'),
          enabled: cashEnabled === true,
        },
        {
          id: 'cashless',
          label: t('order_payment_method_cashless'),
          enabled: cashlessEnabled === true,
        },
      ].filter((item) => item.enabled),
    [cashEnabled, cashlessEnabled, t],
  );

  const paymentMethodLabel = React.useCallback(
    (value) =>
      String(value || '') === 'cashless'
        ? t('order_payment_method_cashless')
        : t('order_payment_method_cash'),
    [t],
  );

  const moneyHolderLabel = React.useCallback(
    (value) =>
      String(value || '') === 'executor'
        ? t('finance_money_holder_executor')
        : t('finance_money_holder_company'),
    [t],
  );

  const paymentMoneyHolderLabel = React.useCallback(
    (value) =>
      String(value || '') === 'executor'
        ? t('order_payments_holder_executor')
        : t('order_payments_holder_company'),
    [t],
  );

  const moneyHolderItems = React.useMemo(
    () => [
      { id: 'company', label: t('finance_money_holder_company') },
      { id: 'executor', label: t('finance_money_holder_executor') },
    ],
    [t],
  );

  const formatDate = React.useCallback(
    (value) => {
      const date = new Date(value || '');
      if (Number.isNaN(date.getTime())) return t('order_payments_date_unknown');
      try {
        return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }).format(date);
      } catch {
        return date.toLocaleDateString();
      }
    },
    [locale, t],
  );

  const openNewPayment = React.useCallback(() => {
    const preferredMethod = availableMethods.some((item) => item.id === defaultPaymentMethod)
      ? defaultPaymentMethod
      : availableMethods[0]?.id || 'cash';
    const latestMoneyHolder = String(payments[0]?.money_holder || '');
    const preferredMoneyHolder =
      showMoneyHolder && ['company', 'executor'].includes(latestMoneyHolder)
        ? latestMoneyHolder
        : showMoneyHolder && ['company', 'executor'].includes(defaultMoneyHolder)
          ? defaultMoneyHolder
          : 'company';
    const suggestedAmount = summary.remaining > 0 ? String(summary.remaining) : '';
    setDraft({
      id: null,
      amount: suggestedAmount,
      payment_method: preferredMethod,
      money_holder: preferredMoneyHolder,
      paid_at: new Date().toISOString(),
      note: '',
    });
    setEditorFeedback('');
    setEditorVisible(true);
  }, [
    availableMethods,
    defaultMoneyHolder,
    defaultPaymentMethod,
    payments,
    showMoneyHolder,
    summary.remaining,
  ]);

  const openPayment = React.useCallback((payment) => {
    setDraft({
      id: payment?.id || null,
      amount: String(payment?.amount ?? ''),
      payment_method: String(payment?.payment_method || 'cash'),
      money_holder: String(payment?.money_holder || 'company'),
      paid_at: payment?.paid_at || new Date().toISOString(),
      note: String(payment?.note || ''),
    });
    setEditorFeedback('');
    setEditorVisible(true);
  }, []);

  const closeEditor = React.useCallback(() => {
    if (upsertMutation.isPending || deleteMutation.isPending) return;
    setMethodModalVisible(false);
    setMoneyHolderModalVisible(false);
    setMoneyHolderHelpVisible(false);
    setDateModalVisible(false);
    setEditorFeedback('');
    setEditorVisible(false);
  }, [deleteMutation.isPending, upsertMutation.isPending]);

  const savePayment = React.useCallback(async () => {
    const amount = parsePaymentAmount(draft.amount);
    if (amount === null || amount <= 0) {
      setEditorFeedback(t('order_payments_amount_error'));
      return;
    }
    if (!availableMethods.some((item) => item.id === draft.payment_method)) {
      setEditorFeedback(t('order_payments_method_error'));
      return;
    }
    if (
      showMoneyHolder &&
      !['company', 'executor'].includes(String(draft.money_holder || ''))
    ) {
      setEditorFeedback(t('order_payments_money_holder_error'));
      return;
    }

    setEditorFeedback('');
    try {
      await upsertMutation.mutateAsync({
        id: draft.id,
        order_id: orderId,
        amount,
        payment_method: draft.payment_method,
        money_holder: showMoneyHolder ? draft.money_holder : 'company',
        paid_at: draft.paid_at,
        note: draft.note,
      });
      setEditorVisible(false);
      toast.success(
        draft.id
          ? t('order_payments_updated')
          : t('order_payments_added'),
      );
    } catch (error) {
      setEditorFeedback(paymentErrorMessage(error, t));
    }
  }, [availableMethods, draft, orderId, showMoneyHolder, t, toast, upsertMutation]);

  const deletePayment = React.useCallback(async () => {
    if (!draft.id) return;
    try {
      await deleteMutation.mutateAsync(draft.id);
      setDeleteConfirmVisible(false);
      setEditorVisible(false);
      toast.success(t('order_payments_deleted'));
    } catch (error) {
      setDeleteConfirmVisible(false);
      setEditorFeedback(paymentErrorMessage(error, t));
    }
  }, [deleteMutation, draft.id, t, toast]);

  const summaryStatusKey = `order_payment_status_${summary.status}`;
  const summaryStatusColor =
    summary.status === 'paid'
      ? theme.colors.success
      : summary.status === 'partial'
        ? theme.colors.warning || theme.colors.primary
        : theme.colors.textSecondary;

  return (
    <>
      <BaseModal
        visible={visible}
        onClose={onClose}
        title={t('order_payments_title')}
        maxHeightRatio={0.88}
        footer={
          canEdit ? (
            <Button
              title={t('order_payments_add')}
              onPress={openNewPayment}
              disabled={paymentsQuery.isLoading}
            />
          ) : null
        }
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Card paddedXOnly separated>
            <LabelValueRow
              label={t('order_payments_status')}
              valueComponent={
                <Text style={[styles.summaryStatus, { color: summaryStatusColor }]}>
                  {t(summaryStatusKey)}
                </Text>
              }
              hideWhenEmpty={false}
            />
            <LabelValueRow
              label={t('order_payments_total')}
              value={formatCurrency(summary.total, currency)}
              hideWhenEmpty={false}
            />
            <LabelValueRow
              label={t('order_payments_received')}
              value={formatCurrency(summary.paid, currency)}
              hideWhenEmpty={false}
            />
            <LabelValueRow
              label={
                summary.overpayment > 0
                  ? t('order_payments_overpayment')
                  : t('order_payments_remaining')
              }
              value={formatCurrency(
                summary.overpayment > 0 ? summary.overpayment : summary.remaining,
                currency,
              )}
              hideWhenEmpty={false}
            />
          </Card>

          <Text style={styles.sectionTitle}>{t('order_payments_history')}</Text>

          {paymentsQuery.isLoading ? (
            <View style={styles.stateWrap}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
            </View>
          ) : paymentsQuery.isError ? (
            <Text style={styles.stateText}>{t('order_payments_error_load')}</Text>
          ) : payments.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Feather
                name="credit-card"
                size={theme.icons?.lg ?? 24}
                color={theme.colors.textSecondary}
              />
              <Text style={styles.emptyTitle}>{t('order_payments_empty_title')}</Text>
              <Text style={styles.emptyText}>{t('order_payments_empty_text')}</Text>
            </View>
          ) : (
            <Card paddedXOnly>
              {payments.map((payment, index) => (
                <View key={payment.id}>
                  {index > 0 ? <View style={styles.separator} /> : null}
                  <Pressable
                    disabled={!canEdit}
                    onPress={() => openPayment(payment)}
                    style={({ pressed }) => [
                      styles.paymentRow,
                      canEdit && pressed ? styles.pressed : null,
                    ]}
                  >
                    <View style={styles.paymentTextWrap}>
                      <Text style={styles.paymentAmount}>
                        {formatCurrency(payment.amount, currency)}
                      </Text>
                      <Text style={styles.paymentMeta}>
                        {`${formatDate(payment.paid_at)} · ${paymentMethodLabel(payment.payment_method)} · ${paymentMoneyHolderLabel(payment.money_holder)}`}
                      </Text>
                      {payment.note ? (
                        <Text style={styles.paymentNote} numberOfLines={2}>
                          {payment.note}
                        </Text>
                      ) : payment.source === 'legacy' ? (
                        <Text style={styles.paymentNote} numberOfLines={2}>
                          {t('order_payments_legacy_note')}
                        </Text>
                      ) : null}
                    </View>
                    {canEdit ? (
                      <Feather
                        name="chevron-right"
                        size={theme.icons?.sm ?? 18}
                        color={theme.colors.textSecondary}
                      />
                    ) : null}
                  </Pressable>
                </View>
              ))}
            </Card>
          )}
        </ScrollView>
      </BaseModal>

      <BaseModal
        visible={editorVisible}
        onClose={closeEditor}
        title={draft.id ? t('order_payments_edit_title') : t('order_payments_add_title')}
        maxHeightRatio={0.82}
        feedback={
          editorFeedback
            ? { type: 'error', message: editorFeedback }
            : null
        }
        footer={
          <View style={styles.actions}>
            <Button
              title={t('btn_cancel')}
              variant="secondary"
              onPress={closeEditor}
              containerStyle={styles.actionButton}
              disabled={upsertMutation.isPending}
            />
            <Button
              title={t('btn_save')}
              onPress={savePayment}
              containerStyle={styles.actionButton}
              loading={upsertMutation.isPending}
            />
          </View>
        }
      >
        <ScrollView
          style={styles.editorScroll}
          contentContainerStyle={styles.editorContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TextField
            label={t('order_payments_amount')}
            value={draft.amount}
            onChangeText={(amount) => setDraft((previous) => ({ ...previous, amount }))}
            keyboardType="decimal-pad"
            numericInput={{ allowDecimal: true, allowNegative: false, decimalScale: 2 }}
            required
          />
          <TextField
            label={t('order_payments_method')}
            value={paymentMethodLabel(draft.payment_method)}
            pressable={availableMethods.length > 1}
            disabled={availableMethods.length <= 1}
            onPress={() => {
              if (availableMethods.length > 1) setMethodModalVisible(true);
            }}
          />
          {showMoneyHolder ? (
            <>
              <TextField
                label={t('order_payments_money_holder')}
                labelAccessory={
                  <InfoHintButton
                    size={24}
                    onPress={() => setMoneyHolderHelpVisible(true)}
                    accessibilityLabel={t('order_payments_money_holder_help_title')}
                    accessibilityHint={t('order_payments_money_holder_help')}
                  />
                }
                value={moneyHolderLabel(draft.money_holder)}
                pressable
                onPress={() => setMoneyHolderModalVisible(true)}
              />
            </>
          ) : null}
          <TextField
            label={t('order_payments_date')}
            value={formatDate(draft.paid_at)}
            pressable
            onPress={() => setDateModalVisible(true)}
          />
          <TextField
            label={t('order_payments_note')}
            value={draft.note}
            onChangeText={(note) => setDraft((previous) => ({ ...previous, note }))}
            placeholder={t('order_payments_note_placeholder')}
            multiline
            minLines={2}
            maxLines={4}
            maxLength={500}
          />
          {draft.id ? (
            <Button
              title={t('order_payments_delete')}
              variant="destructive"
              onPress={() => setDeleteConfirmVisible(true)}
              disabled={upsertMutation.isPending}
              style={styles.deleteButton}
            />
          ) : null}
        </ScrollView>
      </BaseModal>

      <SelectModal
        visible={methodModalVisible}
        onClose={() => setMethodModalVisible(false)}
        title={t('order_payments_method')}
        searchable={false}
        items={availableMethods}
        selectedId={draft.payment_method}
        onSelect={(item) => {
          setDraft((previous) => ({ ...previous, payment_method: item.id }));
          setMethodModalVisible(false);
        }}
      />

      <SelectModal
        visible={moneyHolderModalVisible}
        onClose={() => setMoneyHolderModalVisible(false)}
        title={t('order_payments_money_holder')}
        searchable={false}
        items={moneyHolderItems}
        selectedId={draft.money_holder}
        onSelect={(item) => {
          setDraft((previous) => ({ ...previous, money_holder: item.id }));
          setMoneyHolderModalVisible(false);
        }}
      />

      <DateTimeModal
        visible={dateModalVisible}
        onClose={() => setDateModalVisible(false)}
        initial={draft.paid_at}
        mode="date"
        allowFutureDates={false}
        onApply={(selected) => {
          setDraft((previous) => ({
            ...previous,
            paid_at: mergeSelectedDate(previous.paid_at, selected),
          }));
          setDateModalVisible(false);
        }}
      />

      <AlertModal
        visible={moneyHolderHelpVisible}
        title={t('order_payments_money_holder_help_title')}
        message={t('order_payments_money_holder_help')}
        onClose={() => setMoneyHolderHelpVisible(false)}
      />

      <ConfirmModal
        visible={deleteConfirmVisible}
        onClose={() => setDeleteConfirmVisible(false)}
        title={t('order_payments_delete_title')}
        message={t('order_payments_delete_message')}
        confirmLabel={t('order_payments_delete')}
        confirmVariant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={deletePayment}
      />
    </>
  );
}

function createStyles(theme) {
  const spacing = theme.spacing;
  return StyleSheet.create({
    scroll: {
      flexShrink: 1,
      minHeight: 0,
    },
    content: {
      paddingTop: spacing.md,
      paddingBottom: spacing.xs,
    },
    sectionTitle: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes?.md ?? 16,
      fontWeight: '700',
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    summaryStatus: {
      fontSize: theme.typography.sizes?.md ?? 16,
      fontWeight: '600',
      textAlign: 'right',
    },
    stateWrap: {
      minHeight: 96,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stateText: {
      color: theme.colors.danger,
      fontSize: theme.typography.sizes?.sm ?? 14,
      textAlign: 'center',
      paddingVertical: spacing.xl,
    },
    emptyWrap: {
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xl,
      borderRadius: theme.radii?.lg ?? 16,
      backgroundColor: theme.colors.surface,
    },
    emptyTitle: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes?.md ?? 16,
      fontWeight: '600',
      marginTop: spacing.sm,
      textAlign: 'center',
    },
    emptyText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes?.sm ?? 14,
      lineHeight: 20,
      marginTop: spacing.xs,
      textAlign: 'center',
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.border,
    },
    paymentRow: {
      minHeight: theme.components?.listItem?.height ?? 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
    },
    paymentTextWrap: {
      flex: 1,
      minWidth: 0,
    },
    paymentAmount: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes?.md ?? 16,
      fontWeight: '700',
    },
    paymentMeta: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes?.sm ?? 14,
      lineHeight: 19,
      marginTop: 2,
    },
    paymentNote: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes?.sm ?? 14,
      lineHeight: 19,
      marginTop: spacing.xs,
    },
    pressed: {
      opacity: 0.7,
    },
    editorScroll: {
      flexShrink: 1,
      minHeight: 0,
    },
    editorContent: {
      paddingTop: spacing.sm,
      paddingBottom: spacing.xs,
    },
    actions: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    actionButton: {
      flex: 1,
    },
    deleteButton: {
      marginTop: spacing.lg,
    },
  });
}
