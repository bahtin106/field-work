import React from 'react';
import Feather from '@expo/vector-icons/Feather';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Screen from '../../../components/layout/Screen';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import SectionHeader from '../../../components/ui/SectionHeader';
import TextField from '../../../components/ui/TextField';
import ThemedSwitch from '../../../components/ui/ThemedSwitch';
import { listItemStyles } from '../../../components/ui/listItemStyles';
import { BaseModal, SelectModal } from '../../../components/ui/modals';
import { useToast } from '../../../components/ui/ToastProvider';
import { usePermissions } from '../../../lib/permissions';
import { supabase } from '../../../lib/supabase';
import {
  useCompanyFinanceRules,
  useUpsertCompanyFinanceRuleMutation,
} from '../../../src/features/finance/queries';
import { FEEDBACK_CODES, getMessageByCode } from '../../../src/shared/feedback/messages';
import { getRequiredTextFieldError } from '../../../src/shared/validation/fields';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

const KIND_OPTIONS = [
  { id: 'income', labelKey: 'finance_kind_income', fallback: 'Доп. работы' },
  { id: 'expense', labelKey: 'finance_kind_expense', fallback: 'Расход' },
  { id: 'discount', labelKey: 'finance_kind_discount', fallback: 'Скидка' },
];

const CALC_MODE_OPTIONS = [
  { id: 'fixed', labelKey: 'finance_calc_fixed', fallback: 'Фиксированная сумма' },
  { id: 'percent', labelKey: 'finance_calc_percent', fallback: 'Процент' },
];

const PERCENT_BASE_OPTIONS = [
  { id: 'base_price', labelKey: 'finance_percent_base_price', fallback: 'От базовой суммы заявки' },
  {
    id: 'gross_before_discount',
    labelKey: 'finance_percent_gross_before_discount',
    fallback: 'От суммы до скидок',
  },
  {
    id: 'gross_after_discount',
    labelKey: 'finance_percent_gross_after_discount',
    fallback: 'От суммы после скидок',
  },
  {
    id: 'net_before_expense',
    labelKey: 'finance_percent_net_before_expense',
    fallback: 'От прибыли до расходов',
  },
];

const RECIPIENT_MODE_OPTIONS = [
  { id: 'customer', labelKey: 'finance_rule_recipient_customer', fallback: 'Заказчик' },
  { id: 'executor', labelKey: 'finance_expense_payer_executor', fallback: 'Исполнитель' },
  { id: 'company', labelKey: 'finance_expense_payer_company', fallback: 'Компания' },
];

const DEFAULT_SORT_ORDER = 100;
const PRESSED_OPACITY = 0.7;
const MAX_RULES_PER_COMPANY = 10;

function allowedRecipientModes(kind) {
  const normalizedKind = String(kind || 'expense');
  if (normalizedKind === 'expense') return ['executor', 'company'];
  return ['customer'];
}

function normalizeRecipientModeForKind(kind, value) {
  const allowed = allowedRecipientModes(kind);
  return allowed.includes(String(value || '')) ? String(value) : allowed[0];
}

function createEmptyRuleDraft() {
  return {
    id: null,
    name: '',
    kind: 'expense',
    calc_mode: 'fixed',
    fixed_amount: '',
    percent_value: '',
    percent_base: 'gross_after_discount',
    recipient_mode: 'company',
    recipient_user_id: null,
    note_template: '',
    requires_note: false,
    note_visible: true,
    is_enabled: true,
    sort_order: DEFAULT_SORT_ORDER,
  };
}

function parseNumberSafe(raw, fallback = 0) {
  const value = Number(String(raw ?? '').replace(',', '.'));
  return Number.isFinite(value) ? value : fallback;
}

export default function FinanceRulesSettingsScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const { has, loading: permissionsLoading } = usePermissions();
  const canManageFinanceRules = has('canManageFinanceRules');

  const [companyId, setCompanyId] = React.useState(null);
  const [editorVisible, setEditorVisible] = React.useState(false);
  const [kindModalVisible, setKindModalVisible] = React.useState(false);
  const [calcModeModalVisible, setCalcModeModalVisible] = React.useState(false);
  const [percentBaseModalVisible, setPercentBaseModalVisible] = React.useState(false);
  const [recipientModeModalVisible, setRecipientModeModalVisible] = React.useState(false);
  const [editorSubmitAttempt, setEditorSubmitAttempt] = React.useState(false);
  const [draft, setDraft] = React.useState(() => createEmptyRuleDraft());

  const rulesQuery = useCompanyFinanceRules(companyId, { enabled: !!companyId });
  const saveMutation = useUpsertCompanyFinanceRuleMutation(companyId);

  React.useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { data: userRes, error: userErr } = await supabase.auth.getUser();
        if (userErr) throw userErr;
        const userId = userRes?.user?.id;
        if (!userId) throw new Error(t('access_settings_error_user_not_found'));

        const { data: profile, error: profileErr } = await supabase
          .from('profiles')
          .select('company_id')
          .eq('id', userId)
          .single();
        if (profileErr) throw profileErr;

        if (mounted) setCompanyId(profile?.company_id || null);
      } catch (error) {
        if (mounted) toast.error(String(error?.message || error));
      }
    })();

    return () => {
      mounted = false;
    };
  }, [t, toast]);

  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const base = React.useMemo(() => listItemStyles(theme), [theme]);
  const requiredFieldMessage = React.useMemo(
    () => getMessageByCode(FEEDBACK_CODES.REQUIRED_FIELD, t),
    [t],
  );
  const draftNameError = React.useMemo(
    () => getRequiredTextFieldError(draft.name, { required: true, message: requiredFieldMessage }),
    [draft.name, requiredFieldMessage],
  );
  const draftAmountValue = draft.calc_mode === 'fixed' ? draft.fixed_amount : draft.percent_value;
  const draftAmountError = React.useMemo(
    () => getRequiredTextFieldError(draftAmountValue, { required: true, message: requiredFieldMessage }),
    [draftAmountValue, requiredFieldMessage],
  );
  const normalizedRecipientMode = React.useMemo(
    () => normalizeRecipientModeForKind(draft.kind, draft.recipient_mode),
    [draft.kind, draft.recipient_mode],
  );
  const draftRecipientModeError = React.useMemo(
    () => (normalizedRecipientMode ? null : requiredFieldMessage),
    [normalizedRecipientMode, requiredFieldMessage],
  );
  const rules = React.useMemo(() => (Array.isArray(rulesQuery.data) ? rulesQuery.data : []), [rulesQuery.data]);
  const canAddRule = rules.length < MAX_RULES_PER_COMPANY;

  const getOptionLabel = React.useCallback(
    (options, id) => {
      const item = options.find((opt) => opt.id === id);
      if (!item) return String(id || '');
      return t(item.labelKey, item.fallback);
    },
    [t],
  );

  const openCreate = React.useCallback(() => {
    if (!canAddRule) {
      toast.error(
        t('finance_rules_limit_reached', `Можно добавить не более ${MAX_RULES_PER_COMPANY} правил`),
      );
      return;
    }
    setDraft(createEmptyRuleDraft());
    setEditorSubmitAttempt(false);
    setEditorVisible(true);
  }, [canAddRule, t, toast]);

  const openEdit = React.useCallback((rule) => {
    const kind = String(rule?.kind || 'expense');
    const recipientMode = kind === 'expense' && String(rule?.recipient_mode || '') === 'assigned_to'
      ? 'executor'
      : kind === 'expense'
        ? 'company'
        : 'customer';
    setDraft({
      id: rule?.id || null,
      name: String(rule?.name || ''),
      kind,
      calc_mode: String(rule?.calc_mode || 'fixed'),
      fixed_amount: String(rule?.fixed_amount ?? ''),
      percent_value: String(rule?.percent_value ?? ''),
      percent_base: String(rule?.percent_base || 'gross_after_discount'),
      recipient_mode: normalizeRecipientModeForKind(kind, recipientMode),
      recipient_user_id: null,
      note_template: String(rule?.note_template || ''),
      requires_note: rule?.requires_note === true,
      note_visible: rule?.note_visible !== false,
      is_enabled: rule?.is_enabled !== false,
      sort_order: Number.isFinite(Number(rule?.sort_order)) ? Number(rule.sort_order) : DEFAULT_SORT_ORDER,
    });
    setEditorSubmitAttempt(false);
    setEditorVisible(true);
  }, []);

  const saveRule = React.useCallback(async () => {
    if (!companyId) return;

    setEditorSubmitAttempt(true);
    const firstError = draftNameError || draftAmountError || draftRecipientModeError;
    if (firstError) {
      toast.error(firstError);
      return;
    }

    const recipientMode = normalizeRecipientModeForKind(draft.kind, draft.recipient_mode);
    const expensePayer = recipientMode === 'executor' ? 'executor' : 'company';

    try {
      await saveMutation.mutateAsync({
        id: draft.id || undefined,
        company_id: companyId,
        name: String(draft.name || '').trim(),
        kind: draft.kind,
        calc_mode: draft.calc_mode,
        fixed_amount: parseNumberSafe(draft.fixed_amount, 0),
        percent_value: parseNumberSafe(draft.percent_value, 0),
        percent_base: draft.percent_base,
        recipient_mode: recipientMode === 'executor' ? 'assigned_to' : 'none',
        recipient_user_id: null,
        expense_payer: draft.kind === 'expense' ? expensePayer : 'company',
        note_template: draft.note_template,
        requires_note: draft.requires_note === true,
        note_visible: draft.note_visible !== false,
        is_enabled: draft.is_enabled !== false,
        sort_order: parseNumberSafe(draft.sort_order, DEFAULT_SORT_ORDER),
      });
      setEditorVisible(false);
      setEditorSubmitAttempt(false);
      toast.success(t('finance_rule_saved', 'Правило сохранено'));
    } catch (error) {
      toast.error(String(error?.message || error));
    }
  }, [
    companyId,
    draft,
    draftAmountError,
    draftNameError,
    draftRecipientModeError,
    saveMutation,
    t,
    toast,
  ]);

  if (permissionsLoading) {
    return (
      <Screen
        background="background"
        headerOptions={{ title: t('finance_rules_title', 'Финансовые правила') }}
        contentContainerStyle={styles.container}
      >
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      </Screen>
    );
  }

  if (!canManageFinanceRules) {
    return (
      <Screen
        background="background"
        headerOptions={{ title: t('finance_rules_title', 'Финансовые правила') }}
        contentContainerStyle={styles.container}
      >
        <Card paddedXOnly>
          <Text style={styles.emptyText}>
            {t('order_edit_no_permission', 'Недостаточно прав')}
          </Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      background="background"
      headerOptions={{ title: t('finance_rules_title', 'Финансовые правила') }}
      contentContainerStyle={styles.container}
    >
      <SectionHeader bottomSpacing="xs">
        {t('finance_rules_scope_title', 'Правила для всех заявок')}
      </SectionHeader>
      <Card paddedXOnly>
        <Text style={styles.scopeHint}>
          {t(
            'finance_rules_scope_hint',
            'Эти правила применяются ко всем заявкам и не редактируются внутри заявки',
          )}
        </Text>

        {rulesQuery.isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : null}

        {!rulesQuery.isLoading && rules.length === 0 ? (
          <View>
            <Text style={styles.emptyText}>{t('finance_rules_empty', 'Правил пока нет')}</Text>
          </View>
        ) : null}

        {rules.map((rule) => (
          <Pressable
            key={rule.id}
            style={({ pressed }) => [styles.ruleItem, pressed && { opacity: PRESSED_OPACITY }]}
            onPress={() => openEdit(rule)}
          >
            <View style={styles.ruleRow}>
              <View style={styles.ruleTextWrap}>
                <Text style={styles.ruleName}>{rule.name}</Text>
                <Text style={styles.ruleMeta}>
                  {getOptionLabel(KIND_OPTIONS, rule.kind)} • {getOptionLabel(CALC_MODE_OPTIONS, rule.calc_mode)} •{' '}
                  {getOptionLabel(
                    RECIPIENT_MODE_OPTIONS,
                    normalizeRecipientModeForKind(
                      rule.kind,
                      rule.kind === 'expense' && String(rule?.recipient_mode || '') === 'assigned_to'
                        ? 'executor'
                        : rule.kind === 'expense'
                          ? 'company'
                          : 'customer',
                    ),
                  )}
                </Text>
              </View>
              <Feather
                name="chevron-right"
                size={theme.icons?.sm ?? 18}
                color={theme.colors.textSecondary}
              />
            </View>
          </Pressable>
        ))}

        {!rulesQuery.isLoading ? <View style={base.sep} /> : null}
        {!rulesQuery.isLoading && canAddRule ? (
          <Pressable
            style={({ pressed }) => [base.row, pressed && { opacity: PRESSED_OPACITY }]}
            onPress={openCreate}
          >
            <Text style={styles.addRuleText}>{t('finance_rule_add_new', 'Добавить новое правило')}</Text>
            <View style={base.rightWrap}>
              <Feather
                name="chevron-right"
                size={theme.icons?.sm ?? 18}
                color={theme.colors.textSecondary}
              />
            </View>
          </Pressable>
        ) : null}
      </Card>

      <BaseModal
        visible={editorVisible}
        onClose={() => {
          setEditorVisible(false);
          setEditorSubmitAttempt(false);
        }}
        title={t('finance_rule_editor_title', 'Редактор правила')}
        footer={
          <View style={styles.modalFooter}>
            <Button
              title={t('btn_cancel')}
              variant="ghost"
              onPress={() => {
                setEditorVisible(false);
                setEditorSubmitAttempt(false);
              }}
            />
            <Button title={t('btn_save')} loading={saveMutation.isPending} onPress={saveRule} />
          </View>
        }
      >
        <ScrollView keyboardShouldPersistTaps="handled">
          <TextField
            label={t('finance_rule_name', 'Название')}
            required
            forceValidation={editorSubmitAttempt}
            error={editorSubmitAttempt ? draftNameError : null}
            value={draft.name}
            onChangeText={(value) => setDraft((prev) => ({ ...prev, name: value }))}
            style={styles.field}
          />

          <TextField
            label={t('finance_rule_kind', 'Тип')}
            value={getOptionLabel(KIND_OPTIONS, draft.kind)}
            pressable
            onPress={() => setKindModalVisible(true)}
            style={styles.field}
          />

          <TextField
            label={t('finance_rule_calc_mode', 'Формат расчёта')}
            value={getOptionLabel(CALC_MODE_OPTIONS, draft.calc_mode)}
            pressable
            onPress={() => setCalcModeModalVisible(true)}
            style={styles.field}
          />

          {draft.calc_mode === 'fixed' ? (
            <TextField
              label={t('finance_rule_fixed_amount', 'Сумма')}
              required
              forceValidation={editorSubmitAttempt}
              error={editorSubmitAttempt ? draftAmountError : null}
              keyboardType="decimal-pad"
              value={String(draft.fixed_amount)}
              onChangeText={(value) => setDraft((prev) => ({ ...prev, fixed_amount: value }))}
              style={styles.field}
            />
          ) : (
            <>
              <TextField
                label={t('finance_rule_percent_value', 'Процент')}
                required
                forceValidation={editorSubmitAttempt}
                error={editorSubmitAttempt ? draftAmountError : null}
                keyboardType="decimal-pad"
                value={String(draft.percent_value)}
                onChangeText={(value) => setDraft((prev) => ({ ...prev, percent_value: value }))}
                style={styles.field}
              />
              <TextField
                label={t('finance_rule_percent_base', 'Основа процента')}
                value={getOptionLabel(PERCENT_BASE_OPTIONS, draft.percent_base)}
                pressable
                onPress={() => setPercentBaseModalVisible(true)}
                style={styles.field}
              />
            </>
          )}

          <TextField
            label={t('finance_rule_recipient_mode', 'Получатель')}
            required
            forceValidation={editorSubmitAttempt}
            error={editorSubmitAttempt ? draftRecipientModeError : null}
            value={getOptionLabel(RECIPIENT_MODE_OPTIONS, normalizedRecipientMode)}
            pressable
            onPress={() => setRecipientModeModalVisible(true)}
            style={styles.field}
          />

          <TextField
            label={t('finance_rule_note_template', 'Шаблон комментария')}
            value={draft.note_template}
            onChangeText={(value) => setDraft((prev) => ({ ...prev, note_template: value }))}
            style={styles.field}
          />

          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>{t('finance_rule_requires_note', 'Комментарий обязателен')}</Text>
            <ThemedSwitch
              value={draft.requires_note === true}
              onValueChange={(value) => setDraft((prev) => ({ ...prev, requires_note: value }))}
            />
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>{t('finance_rule_note_visible', 'Показывать комментарий')}</Text>
            <ThemedSwitch
              value={draft.note_visible !== false}
              onValueChange={(value) => setDraft((prev) => ({ ...prev, note_visible: value }))}
            />
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>{t('finance_rule_enabled', 'Правило включено')}</Text>
            <ThemedSwitch
              value={draft.is_enabled !== false}
              onValueChange={(value) => setDraft((prev) => ({ ...prev, is_enabled: value }))}
            />
          </View>
        </ScrollView>
      </BaseModal>

      <SelectModal
        visible={kindModalVisible}
        title={t('finance_rule_kind', 'Тип')}
        items={KIND_OPTIONS.map((item) => ({ id: item.id, label: t(item.labelKey, item.fallback) }))}
        selectedId={draft.kind}
        searchable={false}
        onSelect={(item) => {
          setDraft((prev) => ({
            ...prev,
            kind: item.id,
            recipient_mode: normalizeRecipientModeForKind(item.id, prev.recipient_mode),
          }));
          setKindModalVisible(false);
        }}
        onClose={() => setKindModalVisible(false)}
      />

      <SelectModal
        visible={calcModeModalVisible}
        title={t('finance_rule_calc_mode', 'Формат расчёта')}
        items={CALC_MODE_OPTIONS.map((item) => ({ id: item.id, label: t(item.labelKey, item.fallback) }))}
        selectedId={draft.calc_mode}
        searchable={false}
        onSelect={(item) => {
          setDraft((prev) => ({ ...prev, calc_mode: item.id }));
          setCalcModeModalVisible(false);
        }}
        onClose={() => setCalcModeModalVisible(false)}
      />

      <SelectModal
        visible={percentBaseModalVisible}
        title={t('finance_rule_percent_base', 'Основа процента')}
        items={PERCENT_BASE_OPTIONS.map((item) => ({ id: item.id, label: t(item.labelKey, item.fallback) }))}
        selectedId={draft.percent_base}
        searchable={false}
        onSelect={(item) => {
          setDraft((prev) => ({ ...prev, percent_base: item.id }));
          setPercentBaseModalVisible(false);
        }}
        onClose={() => setPercentBaseModalVisible(false)}
      />

      <SelectModal
        visible={recipientModeModalVisible}
        title={t('finance_rule_recipient_mode', 'Получатель')}
        items={allowedRecipientModes(draft.kind).map((id) => {
          const option = RECIPIENT_MODE_OPTIONS.find((item) => item.id === id);
          return { id, label: t(option?.labelKey, option?.fallback || id) };
        })}
        selectedId={normalizedRecipientMode}
        searchable={false}
        onSelect={(item) => {
          setDraft((prev) => ({ ...prev, recipient_mode: item.id, recipient_user_id: null }));
          setRecipientModeModalVisible(false);
        }}
        onClose={() => setRecipientModeModalVisible(false)}
      />
    </Screen>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    container: {
      gap: theme.spacing.md,
    },
    loadingWrap: {
      paddingVertical: theme.spacing.lg,
      alignItems: 'center',
    },
    emptyText: {
      color: theme.colors.textSecondary,
      textAlign: 'center',
      paddingVertical: theme.spacing.lg,
    },
    scopeHint: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      paddingHorizontal: theme.spacing.md,
      paddingTop: theme.spacing.sm,
      paddingBottom: theme.spacing.xs,
    },
    ruleItem: {
      paddingVertical: theme.spacing.sm,
      borderBottomWidth: theme.components?.card?.borderWidth || 1,
      borderBottomColor: theme.colors.border,
      paddingHorizontal: theme.spacing.md,
    },
    ruleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
    },
    ruleTextWrap: {
      flex: 1,
      minWidth: 0,
    },
    ruleName: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
      flexShrink: 1,
    },
    ruleMeta: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      marginTop: theme.spacing.xs,
    },
    addRuleText: {
      color: theme.colors.primary,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.medium,
    },
    modalFooter: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      justifyContent: 'flex-end',
    },
    field: {
      marginBottom: theme.spacing.sm,
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
    },
    switchLabel: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      flexShrink: 1,
      paddingRight: theme.spacing.sm,
    },
  });
}
