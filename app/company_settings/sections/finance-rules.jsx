import React from 'react';
import Feather from '@expo/vector-icons/Feather';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Screen from '../../../components/layout/Screen';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import SectionHeader from '../../../components/ui/SectionHeader';
import ThemedSwitch from '../../../components/ui/ThemedSwitch';
import TextField from '../../../components/ui/TextField';
import { listItemStyles } from '../../../components/ui/listItemStyles';
import { BaseModal, ConfirmModal, SelectModal } from '../../../components/ui/modals';
import { useToast } from '../../../components/ui/ToastProvider';
import { formatCurrency } from '../../../lib/currency';
import { usePermissions } from '../../../lib/permissions';
import { supabase } from '../../../lib/supabase';
import { useCompanySettings } from '../../../hooks/useCompanySettings';
import {
  useDeleteCompanyFinanceRuleMutation,
  useCompanyFinanceRules,
  useUpsertCompanyFinanceRuleMutation,
} from '../../../src/features/finance/queries';
import { FEEDBACK_CODES, getMessageByCode } from '../../../src/shared/feedback/messages';
import { getRequiredTextFieldError } from '../../../src/shared/validation/fields';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

const CALC_MODE_OPTIONS = [
  { id: 'fixed', labelKey: 'finance_calc_fixed', fallback: 'Фиксированная сумма' },
  { id: 'percent', labelKey: 'finance_calc_percent', fallback: 'Процент' },
];

const PERCENT_BASE_OPTIONS = [
  { id: 'gross_after_discount', labelKey: 'finance_rule_subtract_from_gross', fallback: 'Из общей суммы' },
  { id: 'base_price', labelKey: 'finance_rule_subtract_from_base', fallback: 'Из изначальной суммы' },
  {
    id: 'gross_before_discount',
    labelKey: 'finance_rule_subtract_from_before_discount',
    fallback: 'Из суммы без скидок',
  },
  {
    id: 'income_total',
    labelKey: 'finance_rule_subtract_from_income_total',
    fallback: 'Из суммы доп. работ',
  },
];

const RECIPIENT_MODE_OPTIONS = [
  { id: 'executor', labelKey: 'finance_expense_payer_executor', fallback: 'Исполнитель' },
  { id: 'company', labelKey: 'finance_expense_payer_company', fallback: 'Компания' },
];

const CONDITION_PAYMENT_METHOD_OPTIONS = [
  { id: 'any', labelKey: 'finance_rule_condition_any', fallback: 'Любой' },
  { id: 'cash', labelKey: 'order_payment_method_cash', fallback: 'Наличные' },
  { id: 'cashless', labelKey: 'order_payment_method_cashless', fallback: 'Безнал' },
];

const CONDITION_PAYMENT_STATUS_OPTIONS = [
  { id: 'any', labelKey: 'finance_rule_condition_any', fallback: 'Любой' },
  { id: 'paid', labelKey: 'order_payment_status_paid', fallback: 'Оплачено' },
  { id: 'unpaid', labelKey: 'order_payment_status_unpaid', fallback: 'Не оплачено' },
];

const IF_FILTER_OPTIONS = [
  { id: 'payment_method', labelKey: 'finance_rule_condition_fact_payment_method', fallback: 'Способ оплаты' },
  { id: 'payment_status', labelKey: 'finance_rule_condition_fact_payment_status', fallback: 'Статус оплаты' },
  { id: 'min_gross_after_discount', labelKey: 'finance_rule_condition_min_gross_after_discount', fallback: 'Общая сумма от' },
  { id: 'max_gross_after_discount', labelKey: 'finance_rule_condition_max_gross_after_discount', fallback: 'Общая сумма до' },
  { id: 'min_base_price', labelKey: 'finance_rule_condition_min_base_price', fallback: 'Изначальная сумма от' },
  { id: 'max_base_price', labelKey: 'finance_rule_condition_max_base_price', fallback: 'Изначальная сумма до' },
  { id: 'min_gross_before_discount', labelKey: 'finance_rule_condition_min_gross_before_discount', fallback: 'Сумма без скидок от' },
  { id: 'max_gross_before_discount', labelKey: 'finance_rule_condition_max_gross_before_discount', fallback: 'Сумма без скидок до' },
  { id: 'min_income_total', labelKey: 'finance_rule_condition_min_income_total', fallback: 'Сумма доп. работ от' },
  { id: 'max_income_total', labelKey: 'finance_rule_condition_max_income_total', fallback: 'Сумма доп. работ до' },
];

const RANGE_FILTERS = [
  {
    minFilterId: 'min_gross_after_discount',
    maxFilterId: 'max_gross_after_discount',
    minField: 'condition_min_gross_after_discount',
    maxField: 'condition_max_gross_after_discount',
    fact: 'gross_after_discount',
    factLabelKey: 'finance_rule_condition_fact_gross_after_discount',
    factFallback: 'Общая сумма',
  },
  {
    minFilterId: 'min_base_price',
    maxFilterId: 'max_base_price',
    minField: 'condition_min_base_price',
    maxField: 'condition_max_base_price',
    fact: 'base_price',
    factLabelKey: 'finance_rule_condition_fact_base_price',
    factFallback: 'Изначальная сумма',
  },
  {
    minFilterId: 'min_gross_before_discount',
    maxFilterId: 'max_gross_before_discount',
    minField: 'condition_min_gross_before_discount',
    maxField: 'condition_max_gross_before_discount',
    fact: 'gross_before_discount',
    factLabelKey: 'finance_rule_condition_fact_gross_before_discount',
    factFallback: 'Сумма без скидок',
  },
  {
    minFilterId: 'min_income_total',
    maxFilterId: 'max_income_total',
    minField: 'condition_min_income_total',
    maxField: 'condition_max_income_total',
    fact: 'income_total',
    factLabelKey: 'finance_rule_condition_fact_income_total',
    factFallback: 'Сумма доп. работ',
  },
];

const DEFAULT_SORT_ORDER = 100;
const PRESSED_OPACITY = 0.7;
const MAX_RULES_PER_COMPANY = 10;

function allowedRecipientModes() {
  return ['executor', 'company'];
}

function normalizeRecipientModeForKind(_kind, value) {
  const allowed = allowedRecipientModes();
  const normalized = String(value || '').trim();
  if (normalized === 'customer') return 'company';
  return allowed.includes(normalized) ? normalized : 'company';
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
    condition_payment_method: 'any',
    condition_payment_status: 'any',
    condition_min_gross_after_discount: '',
    condition_max_gross_after_discount: '',
    condition_min_base_price: '',
    condition_max_base_price: '',
    condition_min_gross_before_discount: '',
    condition_max_gross_before_discount: '',
    condition_min_income_total: '',
    condition_max_income_total: '',
    if_filters: [],
    note_template: '',
    apply_to_existing: false,
    requires_note: false,
    note_visible: true,
    is_enabled: true,
    sort_order: DEFAULT_SORT_ORDER,
  };
}

function buildConditionsJsonFromDraft(draft) {
  const conditions = [];
  const selectedFilters = new Set(Array.isArray(draft?.if_filters) ? draft.if_filters : []);
  const paymentMethod = String(draft?.condition_payment_method || 'any');
  const paymentStatus = String(draft?.condition_payment_status || 'any');

  if (selectedFilters.has('payment_method') && (paymentMethod === 'cash' || paymentMethod === 'cashless')) {
    conditions.push({ fact: 'payment_method', operator: 'eq', value: paymentMethod });
  } else if (selectedFilters.has('payment_method') && paymentMethod === 'any') {
    conditions.push({ fact: 'payment_method', operator: 'eq', value: 'any' });
  }

  if (selectedFilters.has('payment_status') && (paymentStatus === 'paid' || paymentStatus === 'unpaid')) {
    conditions.push({ fact: 'payment_status', operator: 'eq', value: paymentStatus });
  } else if (selectedFilters.has('payment_status') && paymentStatus === 'any') {
    conditions.push({ fact: 'payment_status', operator: 'eq', value: 'any' });
  }

  for (const rangeFilter of RANGE_FILTERS) {
    const minRaw = String(draft?.[rangeFilter.minField] || '').trim();
    const maxRaw = String(draft?.[rangeFilter.maxField] || '').trim();
    if (selectedFilters.has(rangeFilter.minFilterId) && minRaw) {
      conditions.push({ fact: rangeFilter.fact, operator: 'gte', value: parseNumberSafe(minRaw, 0) });
    }
    if (selectedFilters.has(rangeFilter.maxFilterId) && maxRaw) {
      conditions.push({ fact: rangeFilter.fact, operator: 'lte', value: parseNumberSafe(maxRaw, 0) });
    }
  }

  return { op: 'all', conditions };
}

function parseDraftConditions(conditionsJson) {
  let normalizedConditions = conditionsJson;
  if (typeof normalizedConditions === 'string') {
    try {
      normalizedConditions = JSON.parse(normalizedConditions);
    } catch {
      normalizedConditions = null;
    }
  }
  const result = {
    condition_payment_method: 'any',
    condition_payment_status: 'any',
    condition_min_gross_after_discount: '',
    condition_max_gross_after_discount: '',
    condition_min_base_price: '',
    condition_max_base_price: '',
    condition_min_gross_before_discount: '',
    condition_max_gross_before_discount: '',
    condition_min_income_total: '',
    condition_max_income_total: '',
    if_filters: [],
  };

  const conditions = Array.isArray(normalizedConditions?.conditions) ? normalizedConditions.conditions : [];
  for (const condition of conditions) {
    const fact = String(condition?.fact || '');
    const operator = String(condition?.operator || '');
    const value = condition?.value;

    if (fact === 'payment_method' && operator === 'eq') {
      if (value === 'cash' || value === 'cashless' || value === 'any') result.condition_payment_method = String(value);
      result.if_filters.push('payment_method');
    } else if (fact === 'payment_status' && operator === 'eq' && (value === 'paid' || value === 'unpaid' || value === 'any')) {
      result.condition_payment_status = String(value);
      result.if_filters.push('payment_status');
    } else {
      const normalizedFact = fact === 'price' ? 'gross_after_discount' : fact;
      const mapping = RANGE_FILTERS.find((item) => item.fact === normalizedFact);
      if (!mapping) continue;
      if (operator === 'gte') {
        result[mapping.minField] = String(value ?? '');
        result.if_filters.push(mapping.minFilterId);
      } else if (operator === 'lte') {
        result[mapping.maxField] = String(value ?? '');
        result.if_filters.push(mapping.maxFilterId);
      }
    }
  }

  result.if_filters = Array.from(new Set(result.if_filters));
  return result;
}

function formatRuleOutcomeSummary(t, rule) {
  const ruleCurrency = String(rule?.currency || 'RUB');
  const conditionsClause = formatRuleConditionsClause(t, rule?.conditions_json, ruleCurrency);
  const recipient = String(rule?.recipient_mode || '') === 'assigned_to'
    ? t('finance_recipient_executor_dative', 'исполнителю')
    : t('finance_recipient_company_dative', 'компании');
  const subtractFromOption = PERCENT_BASE_OPTIONS.find((item) => item.id === String(rule?.percent_base || 'gross_after_discount'));
  const subtractFrom = t(
    subtractFromOption?.labelKey,
    subtractFromOption?.fallback || 'Из общей суммы',
  );

  let outcomeText = '';

  if (String(rule?.calc_mode || 'fixed') === 'percent') {
    const percentValue = Number(rule?.percent_value ?? 0);
    outcomeText = t(
      'order_finance_entry_sentence_percent_plain',
      'Отчисление в пользу {recipient} в размере {percent}% {base}',
    )
      .replace('{recipient}', recipient)
      .replace('{percent}', String(percentValue))
      .replace('{base}', String(subtractFrom || '').toLowerCase());
  } else {
    const amountValue = formatCurrency(Number(rule?.fixed_amount ?? 0), ruleCurrency, 'ru-RU');
    outcomeText = t(
      'order_finance_entry_sentence_fixed_plain',
      'Отчисление в пользу {recipient} в размере {amount} {base}',
    )
      .replace('{recipient}', recipient)
      .replace('{amount}', amountValue)
      .replace('{base}', String(subtractFrom || '').toLowerCase());
  }

  if (!conditionsClause) return outcomeText;
  return `${conditionsClause}, ${outcomeText}`;
}

function formatRuleConditionsClause(t, conditionsJson, currency = 'RUB') {
  const draftConditions = parseDraftConditions(conditionsJson);
  const parts = [];
  const locale = 'ru-RU';
  const formatConditionAmount = (raw) => {
    const value = parseNumberSafe(raw, Number.NaN);
    if (!Number.isFinite(value)) return String(raw ?? '');
    return formatCurrency(value, currency, locale);
  };

  const paymentLabel = CONDITION_PAYMENT_METHOD_OPTIONS.find(
    (item) => item.id === draftConditions.condition_payment_method,
  );
  if (draftConditions.if_filters.includes('payment_method')) {
    const paymentFact = String(t('finance_rule_condition_fact_payment_method', 'Способ оплаты')).toLowerCase();
    parts.push(
      `${paymentFact} - ${String(
        t(paymentLabel?.labelKey, paymentLabel?.fallback || draftConditions.condition_payment_method),
      ).toLowerCase()}`,
    );
  }

  const statusLabel = CONDITION_PAYMENT_STATUS_OPTIONS.find(
    (item) => item.id === draftConditions.condition_payment_status,
  );
  if (draftConditions.if_filters.includes('payment_status')) {
    const statusFact = String(t('finance_rule_condition_fact_payment_status', 'Статус оплаты')).toLowerCase();
    parts.push(
      `${statusFact} - ${String(
        t(statusLabel?.labelKey, statusLabel?.fallback || draftConditions.condition_payment_status),
      ).toLowerCase()}`,
    );
  }

  for (const rangeFilter of RANGE_FILTERS) {
    const minRaw = String(draftConditions[rangeFilter.minField] || '').trim();
    const maxRaw = String(draftConditions[rangeFilter.maxField] || '').trim();
    if (!minRaw && !maxRaw) continue;

    const factLabel = String(t(rangeFilter.factLabelKey, rangeFilter.factFallback)).toLowerCase();
    if (minRaw && maxRaw) {
      parts.push(
        `${factLabel} ${t('finance_rule_condition_between', 'от')} ${formatConditionAmount(minRaw)} ${t('finance_rule_condition_to', 'до')} ${formatConditionAmount(maxRaw)}`,
      );
    } else if (minRaw) {
      parts.push(
        `${factLabel} ${t('finance_rule_condition_from', 'от')} ${formatConditionAmount(minRaw)}`,
      );
    } else if (maxRaw) {
      parts.push(
        `${factLabel} ${t('finance_rule_condition_to', 'до')} ${formatConditionAmount(maxRaw)}`,
      );
    }
  }

  if (parts.length === 0) return '';
  return `${t('finance_rule_if', 'Если')} ${parts.join(` ${t('finance_rule_and', 'И').toLowerCase()} `)}`;
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
  const [calcModeModalVisible, setCalcModeModalVisible] = React.useState(false);
  const [percentBaseModalVisible, setPercentBaseModalVisible] = React.useState(false);
  const [recipientModeModalVisible, setRecipientModeModalVisible] = React.useState(false);
  const [conditionPaymentMethodModalVisible, setConditionPaymentMethodModalVisible] = React.useState(false);
  const [conditionPaymentStatusModalVisible, setConditionPaymentStatusModalVisible] = React.useState(false);
  const [ifFilterPickerVisible, setIfFilterPickerVisible] = React.useState(false);
  const [confirmApplyToExistingVisible, setConfirmApplyToExistingVisible] = React.useState(false);
  const [confirmToggleVisible, setConfirmToggleVisible] = React.useState(false);
  const [pendingToggle, setPendingToggle] = React.useState({ rule: null, nextEnabled: null });
  const [deleteRuleChoiceVisible, setDeleteRuleChoiceVisible] = React.useState(false);
  const [editorSubmitAttempt, setEditorSubmitAttempt] = React.useState(false);
  const [draft, setDraft] = React.useState(() => createEmptyRuleDraft());
  const { settings: companySettings } = useCompanySettings(companyId);

  const rulesQuery = useCompanyFinanceRules(companyId, { enabled: !!companyId });
  const saveMutation = useUpsertCompanyFinanceRuleMutation(companyId);
  const deleteMutation = useDeleteCompanyFinanceRuleMutation(companyId);

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
  const draftAmountPositiveError = React.useMemo(() => {
    const value = parseNumberSafe(draftAmountValue, Number.NaN);
    if (!Number.isFinite(value)) return null;
    if (value <= 0) return t('finance_rule_amount_must_be_gt_zero', 'Сумма или процент должны быть больше нуля');
    return null;
  }, [draftAmountValue, t]);
  const normalizedRecipientMode = React.useMemo(
    () => normalizeRecipientModeForKind(draft.kind, draft.recipient_mode),
    [draft.kind, draft.recipient_mode],
  );
  const draftRecipientModeError = React.useMemo(
    () => (normalizedRecipientMode ? null : requiredFieldMessage),
    [normalizedRecipientMode, requiredFieldMessage],
  );
  const draftConditionsPriceError = React.useMemo(() => {
    const selectedFilters = new Set(Array.isArray(draft.if_filters) ? draft.if_filters : []);
    for (const rangeFilter of RANGE_FILTERS) {
      const minRaw = String(draft?.[rangeFilter.minField] || '').trim();
      const maxRaw = String(draft?.[rangeFilter.maxField] || '').trim();
      if (selectedFilters.has(rangeFilter.minFilterId) && !minRaw) {
        return t('finance_rule_condition_value_required', 'Укажите значение условия');
      }
      if (selectedFilters.has(rangeFilter.maxFilterId) && !maxRaw) {
        return t('finance_rule_condition_value_required', 'Укажите значение условия');
      }
      if (minRaw && !Number.isFinite(parseNumberSafe(minRaw, Number.NaN))) {
        return t('finance_rule_condition_price_invalid', 'Для стоимости укажите корректное число');
      }
      if (maxRaw && !Number.isFinite(parseNumberSafe(maxRaw, Number.NaN))) {
        return t('finance_rule_condition_price_invalid', 'Для стоимости укажите корректное число');
      }
      const minValue = minRaw ? parseNumberSafe(minRaw, Number.NaN) : null;
      const maxValue = maxRaw ? parseNumberSafe(maxRaw, Number.NaN) : null;
      if (
        minValue !== null &&
        maxValue !== null &&
        Number.isFinite(minValue) &&
        Number.isFinite(maxValue) &&
        minValue > maxValue
      ) {
        return t('finance_rule_condition_price_range_invalid', 'Минимальная сумма не может быть больше максимальной');
      }
    }
    return null;
  }, [draft, t]);
  const draftIfConditionsError = React.useMemo(() => {
    if (!Array.isArray(draft?.if_filters) || draft.if_filters.length === 0) {
      return t('finance_rule_if_required', 'Добавьте хотя бы одно условие "Если"');
    }
    return null;
  }, [draft?.if_filters, t]);
  const rules = React.useMemo(() => (Array.isArray(rulesQuery.data) ? rulesQuery.data : []), [rulesQuery.data]);
  const canAddRule = rules.length < MAX_RULES_PER_COMPANY;
  const selectedIfFilters = React.useMemo(
    () => (Array.isArray(draft.if_filters) ? Array.from(new Set(draft.if_filters)) : []),
    [draft.if_filters],
  );
  const availableIfFilters = React.useMemo(
    () => IF_FILTER_OPTIONS.filter((item) => !selectedIfFilters.includes(item.id)),
    [selectedIfFilters],
  );

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
    setDraft({ ...createEmptyRuleDraft(), kind: 'expense' });
    setEditorSubmitAttempt(false);
    setEditorVisible(true);
  }, [canAddRule, t, toast]);

  const openEdit = React.useCallback((rule) => {
    const kind = String(rule?.kind || 'expense');
    const recipientMode = String(rule?.recipient_mode || '') === 'assigned_to' ? 'executor' : 'company';
    const parsedConditions = parseDraftConditions(rule?.conditions_json);

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
      ...parsedConditions,
      note_template: String(rule?.note_template || ''),
      apply_to_existing: rule?.apply_to_existing === true,
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
    const firstError =
      draftNameError ||
      draftAmountError ||
      draftAmountPositiveError ||
      draftRecipientModeError ||
      draftIfConditionsError ||
      draftConditionsPriceError;
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
        conditions_json: buildConditionsJsonFromDraft(draft),
        recipient_mode: recipientMode === 'executor' ? 'assigned_to' : 'none',
        recipient_user_id: null,
        expense_payer: draft.kind === 'expense' ? expensePayer : 'company',
        note_template: draft.note_template,
        apply_to_existing: draft.apply_to_existing === true,
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
    draftAmountPositiveError,
    draftConditionsPriceError,
    draftIfConditionsError,
    draftNameError,
    draftRecipientModeError,
    saveMutation,
    t,
    toast,
  ]);

  const saveRuleWithConfirm = React.useCallback(() => {
    if (draft?.apply_to_existing === true) {
      setConfirmApplyToExistingVisible(true);
      return;
    }
    void saveRule();
  }, [draft?.apply_to_existing, saveRule]);

  const toggleRuleEnabled = React.useCallback(
    async (rule, nextEnabled) => {
      if (!companyId || !rule?.id) return;
      try {
        await saveMutation.mutateAsync({
          id: rule.id,
          company_id: companyId,
          name: String(rule.name || '').trim(),
          kind: String(rule.kind || 'expense'),
          calc_mode: String(rule.calc_mode || 'fixed'),
          fixed_amount: parseNumberSafe(rule.fixed_amount, 0),
          percent_value: parseNumberSafe(rule.percent_value, 0),
          percent_base: String(rule.percent_base || 'gross_after_discount'),
          conditions_json: rule.conditions_json || { op: 'all', conditions: [] },
          recipient_mode: String(rule.recipient_mode || 'none'),
          recipient_user_id: rule.recipient_user_id || null,
          expense_payer: String(rule.expense_payer || 'company') === 'executor' ? 'executor' : 'company',
          note_template: String(rule.note_template || ''),
          apply_to_existing: rule.apply_to_existing === true,
          requires_note: rule.requires_note === true,
          note_visible: rule.note_visible !== false,
          is_enabled: nextEnabled === true,
          sort_order: parseNumberSafe(rule.sort_order, DEFAULT_SORT_ORDER),
        });
        if (nextEnabled !== true) {
          toast.info(
            t(
              'finance_rule_disable_notice_new_only',
              'Правило выключено: оно не будет применяться к новым заявкам. Старые заявки не меняются.',
            ),
          );
        }
      } catch (error) {
        toast.error(String(error?.message || error));
      }
    },
    [companyId, saveMutation, t, toast],
  );

  const requestToggleRuleEnabled = React.useCallback((rule, nextEnabled) => {
    setPendingToggle({ rule: rule || null, nextEnabled: nextEnabled === true });
    setConfirmToggleVisible(true);
  }, []);

  const deleteRule = React.useCallback(
    async (ruleId, deleteExistingEntries = false) => {
      if (!ruleId) return;
      try {
        await deleteMutation.mutateAsync({
          ruleId,
          deleteExistingEntries: deleteExistingEntries === true,
        });
        setEditorVisible(false);
        setDeleteRuleChoiceVisible(false);
        setEditorSubmitAttempt(false);
        toast.success(t('finance_rule_deleted', 'Правило удалено'));
      } catch (error) {
        toast.error(String(error?.message || error));
      }
    },
    [deleteMutation, t, toast],
  );

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

        {rules.map((rule, index) => (
          <View key={rule.id}>
            {index > 0 ? <View style={base.sep} /> : null}
            <Pressable
              style={({ pressed }) => [styles.ruleItem, pressed && { opacity: PRESSED_OPACITY }]}
              onPress={() => openEdit(rule)}
            >
              <View style={styles.ruleRow}>
                <View style={styles.ruleTextWrap}>
                  <Text style={styles.ruleName}>{rule.name}</Text>
                  <Text style={styles.ruleConditionsText}>
                    {formatRuleOutcomeSummary(t, { ...rule, currency: companySettings?.currency || 'RUB' })}
                  </Text>
                </View>
                <ThemedSwitch
                  value={rule?.is_enabled !== false}
                  onValueChange={(value) => requestToggleRuleEnabled(rule, value === true)}
                />
                <Feather
                  name="chevron-right"
                  size={theme.icons?.sm ?? 18}
                  color={theme.colors.textSecondary}
                />
              </View>
            </Pressable>
          </View>
        ))}

        {!rulesQuery.isLoading && rules.length > 0 ? <View style={base.sep} /> : null}

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
            {draft.id ? (
              <Button
                title={t('btn_delete', 'Удалить')}
                variant="ghost"
                loading={deleteMutation.isPending}
                onPress={() => setDeleteRuleChoiceVisible(true)}
              />
            ) : null}
            <Button
              title={t('btn_cancel')}
              variant="ghost"
              onPress={() => {
                setEditorVisible(false);
                setEditorSubmitAttempt(false);
              }}
            />
            <Button title={t('btn_save')} loading={saveMutation.isPending} onPress={saveRuleWithConfirm} />
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

          <Text style={styles.conditionsHeader}>{t('finance_rule_if', 'Если')}</Text>

          {selectedIfFilters.map((filterKey, index) => (
            <View key={`if-filter-${filterKey}`} style={styles.conditionRowWrap}>
              <View style={styles.conditionRowHeader}>
                <Text style={styles.conditionPrefix}>{index === 0 ? t('finance_rule_if', 'Если') : t('finance_rule_and', 'И')}</Text>
                <Pressable
                  style={({ pressed }) => [styles.conditionRemoveButton, pressed && { opacity: PRESSED_OPACITY }]}
                  onPress={() => {
                    const rangeFilter = RANGE_FILTERS.find(
                      (item) => item.minFilterId === filterKey || item.maxFilterId === filterKey,
                    );
                    setDraft((prev) => ({
                      ...prev,
                      if_filters: (prev.if_filters || []).filter((item) => item !== filterKey),
                      ...(filterKey === 'payment_method' ? { condition_payment_method: 'any' } : {}),
                      ...(filterKey === 'payment_status' ? { condition_payment_status: 'any' } : {}),
                      ...(rangeFilter && filterKey === rangeFilter.minFilterId ? { [rangeFilter.minField]: '' } : {}),
                      ...(rangeFilter && filterKey === rangeFilter.maxFilterId ? { [rangeFilter.maxField]: '' } : {}),
                    }));
                  }}
                >
                  <Feather name="x" size={theme.icons?.sm ?? 16} color={theme.colors.textSecondary} />
                </Pressable>
              </View>

              {filterKey === 'payment_method' ? (
                <TextField
                  label={t('finance_rule_condition_fact_payment_method', 'Способ оплаты')}
                  value={getOptionLabel(CONDITION_PAYMENT_METHOD_OPTIONS, draft.condition_payment_method)}
                  pressable
                  onPress={() => setConditionPaymentMethodModalVisible(true)}
                  style={styles.field}
                />
              ) : null}

              {filterKey === 'payment_status' ? (
                <TextField
                  label={t('finance_rule_condition_fact_payment_status', 'Статус оплаты')}
                  value={getOptionLabel(CONDITION_PAYMENT_STATUS_OPTIONS, draft.condition_payment_status)}
                  pressable
                  onPress={() => setConditionPaymentStatusModalVisible(true)}
                  style={styles.field}
                />
              ) : null}

              {RANGE_FILTERS.map((rangeFilter) => (
                <React.Fragment key={`${rangeFilter.fact}-${filterKey}`}>
                  {filterKey === rangeFilter.minFilterId ? (
                    <TextField
                      label={t(
                        IF_FILTER_OPTIONS.find((item) => item.id === rangeFilter.minFilterId)?.labelKey,
                        IF_FILTER_OPTIONS.find((item) => item.id === rangeFilter.minFilterId)?.fallback || 'Сумма от',
                      )}
                      keyboardType="decimal-pad"
                      value={String(draft?.[rangeFilter.minField] || '')}
                      onChangeText={(value) => setDraft((prev) => ({ ...prev, [rangeFilter.minField]: value }))}
                      style={styles.field}
                    />
                  ) : null}
                  {filterKey === rangeFilter.maxFilterId ? (
                    <TextField
                      label={t(
                        IF_FILTER_OPTIONS.find((item) => item.id === rangeFilter.maxFilterId)?.labelKey,
                        IF_FILTER_OPTIONS.find((item) => item.id === rangeFilter.maxFilterId)?.fallback || 'Сумма до',
                      )}
                      keyboardType="decimal-pad"
                      value={String(draft?.[rangeFilter.maxField] || '')}
                      onChangeText={(value) => setDraft((prev) => ({ ...prev, [rangeFilter.maxField]: value }))}
                      style={styles.field}
                    />
                  ) : null}
                </React.Fragment>
              ))}
            </View>
          ))}

          {availableIfFilters.length > 0 ? (
            <Pressable
              style={({ pressed }) => [styles.addConditionRow, pressed && { opacity: PRESSED_OPACITY }]}
              onPress={() => setIfFilterPickerVisible(true)}
            >
              <Feather name="plus-circle" size={theme.icons?.sm ?? 16} color={theme.colors.primary} />
              <Text style={styles.addConditionText}>{t('finance_rule_add_condition', 'Добавить условие')}</Text>
            </Pressable>
          ) : null}

          {editorSubmitAttempt && draftConditionsPriceError ? (
            <Text style={styles.conditionsErrorText}>{draftConditionsPriceError}</Text>
          ) : null}
          {editorSubmitAttempt && draftIfConditionsError ? (
            <Text style={styles.conditionsErrorText}>{draftIfConditionsError}</Text>
          ) : null}

          <Text style={styles.conditionsHeader}>{t('finance_rule_then', 'То')}</Text>

          <TextField
            label={t('finance_rule_subtract_from', 'Вычитаем из')}
            value={getOptionLabel(PERCENT_BASE_OPTIONS, draft.percent_base)}
            pressable
            onPress={() => setPercentBaseModalVisible(true)}
            style={styles.field}
          />

          <TextField
            label={t('finance_rule_recipient_payout', 'Кому отчисляем')}
            required
            forceValidation={editorSubmitAttempt}
            error={editorSubmitAttempt ? draftRecipientModeError : null}
            value={getOptionLabel(RECIPIENT_MODE_OPTIONS, normalizedRecipientMode)}
            pressable
            onPress={() => setRecipientModeModalVisible(true)}
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
              error={editorSubmitAttempt ? (draftAmountError || draftAmountPositiveError) : null}
              keyboardType="decimal-pad"
              value={String(draft.fixed_amount)}
              onChangeText={(value) => setDraft((prev) => ({ ...prev, fixed_amount: value }))}
              style={styles.field}
            />
          ) : (
            <TextField
              label={t('finance_rule_percent_value', 'Процент')}
              required
              forceValidation={editorSubmitAttempt}
              error={editorSubmitAttempt ? (draftAmountError || draftAmountPositiveError) : null}
              keyboardType="decimal-pad"
              value={String(draft.percent_value)}
              onChangeText={(value) => setDraft((prev) => ({ ...prev, percent_value: value }))}
              style={styles.field}
            />
          )}

          <TextField
            label={t('finance_rule_comment', 'Комментарий')}
            value={draft.note_template}
            onChangeText={(value) => setDraft((prev) => ({ ...prev, note_template: value }))}
            style={styles.field}
          />

          <View style={styles.switchRow}>
            <View style={styles.switchTextWrap}>
              <Text style={styles.switchLabel}>
                {t(
                  'finance_rule_apply_to_existing_label',
                  'Пересчитать существующие заявки',
                )}
              </Text>
              <Text style={styles.switchHint}>
                {t(
                  'finance_rule_apply_to_existing_hint',
                  'Если включено, правило будет применяться и к старым заявкам при пересчёте. Если выключено - только к новым.',
                )}
              </Text>
            </View>
            <ThemedSwitch
              value={draft.apply_to_existing === true}
              onValueChange={(value) => setDraft((prev) => ({ ...prev, apply_to_existing: value === true }))}
            />
          </View>
        </ScrollView>
      </BaseModal>

      <ConfirmModal
        visible={confirmApplyToExistingVisible}
        title={t('finance_rule_apply_to_existing_confirm_title', 'Пересчитать существующие заявки?')}
        message={t(
          'finance_rule_apply_to_existing_confirm_message',
          'После сохранения правило пересчитает старые заявки. Проверьте настройки перед продолжением.',
        )}
        confirmLabel={t('btn_save', 'Сохранить')}
        loading={saveMutation.isPending}
        onClose={() => setConfirmApplyToExistingVisible(false)}
        onConfirm={() => {
          setConfirmApplyToExistingVisible(false);
          void saveRule();
        }}
      />

      <ConfirmModal
        visible={confirmToggleVisible}
        title={t(
          pendingToggle?.nextEnabled === true
            ? 'finance_rule_enable_confirm_title'
            : 'finance_rule_disable_confirm_title',
          pendingToggle?.nextEnabled === true ? 'Включить правило?' : 'Выключить правило?',
        )}
        message={t(
          pendingToggle?.nextEnabled === true
            ? 'finance_rule_enable_confirm_message'
            : 'finance_rule_disable_confirm_message',
          pendingToggle?.nextEnabled === true
            ? 'Вновь созданные заявки теперь будут создаваться с этим правилом. Старые заявки также имеют это правило.'
            : 'Если выключить правило, на заявках, где оно уже применено, ничего не изменится. Правило останется. Если нужно удалить и из существующих заявок, удалите правило целиком.',
        )}
        confirmLabel={t('btn_confirm', 'Подтвердить')}
        loading={saveMutation.isPending}
        onClose={() => {
          setConfirmToggleVisible(false);
          setPendingToggle({ rule: null, nextEnabled: null });
        }}
        onConfirm={() => {
          const rule = pendingToggle?.rule;
          const nextEnabled = pendingToggle?.nextEnabled === true;
          setConfirmToggleVisible(false);
          setPendingToggle({ rule: null, nextEnabled: null });
          if (rule?.id) {
            void toggleRuleEnabled(rule, nextEnabled);
          }
        }}
      />

      <BaseModal
        visible={deleteRuleChoiceVisible}
        onClose={() => setDeleteRuleChoiceVisible(false)}
        title={t('finance_rule_delete_confirm_title', 'Удалить правило?')}
        maxHeightRatio={0.55}
        footer={
          <View style={styles.modalFooter}>
            <Button
              title={t('btn_cancel', 'Отмена')}
              variant="ghost"
              onPress={() => setDeleteRuleChoiceVisible(false)}
            />
          </View>
        }
      >
        <Text style={styles.deleteRuleHint}>
          {t(
            'finance_rule_delete_confirm_message',
            'Выберите, как удалить правило: оставить его в старых заявках или удалить в старых заявках тоже.',
          )}
        </Text>
        <View style={styles.deleteActionsColumn}>
          <Button
            title={t('finance_rule_delete_keep_old', 'Оставить в старых заявках')}
            variant="secondary"
            loading={deleteMutation.isPending}
            onPress={() => void deleteRule(draft.id, false)}
          />
          <Button
            title={t('finance_rule_delete_purge_old', 'Удалить и из старых заявок')}
            variant="destructive"
            loading={deleteMutation.isPending}
            onPress={() => void deleteRule(draft.id, true)}
          />
        </View>
      </BaseModal>

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
        title={t('finance_rule_subtract_from', 'Вычитаем из')}
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
        title={t('finance_rule_recipient_payout', 'Кому отчисляем')}
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

      <SelectModal
        visible={conditionPaymentMethodModalVisible}
        title={t('finance_rule_condition_fact_payment_method', 'Способ оплаты')}
        items={CONDITION_PAYMENT_METHOD_OPTIONS.map((item) => ({ id: item.id, label: t(item.labelKey, item.fallback) }))}
        selectedId={draft.condition_payment_method}
        searchable={false}
        onSelect={(item) => {
          setDraft((prev) => ({ ...prev, condition_payment_method: String(item?.id || 'any') }));
          setConditionPaymentMethodModalVisible(false);
        }}
        onClose={() => setConditionPaymentMethodModalVisible(false)}
      />

      <SelectModal
        visible={conditionPaymentStatusModalVisible}
        title={t('finance_rule_condition_fact_payment_status', 'Статус оплаты')}
        items={CONDITION_PAYMENT_STATUS_OPTIONS.map((item) => ({ id: item.id, label: t(item.labelKey, item.fallback) }))}
        selectedId={draft.condition_payment_status}
        searchable={false}
        onSelect={(item) => {
          setDraft((prev) => ({ ...prev, condition_payment_status: String(item?.id || 'any') }));
          setConditionPaymentStatusModalVisible(false);
        }}
        onClose={() => setConditionPaymentStatusModalVisible(false)}
      />

      <SelectModal
        visible={ifFilterPickerVisible}
        title={t('finance_rule_add_condition', 'Добавить условие')}
        items={availableIfFilters.map((item) => ({ id: item.id, label: t(item.labelKey, item.fallback) }))}
        selectedId=""
        searchable={false}
        onSelect={(item) => {
          const nextId = String(item?.id || '');
          if (!nextId) {
            setIfFilterPickerVisible(false);
            return;
          }
          setDraft((prev) => ({
            ...prev,
            if_filters: Array.from(new Set([...(prev.if_filters || []), nextId])),
          }));
          setIfFilterPickerVisible(false);
        }}
        onClose={() => setIfFilterPickerVisible(false)}
      />
    </Screen>
  );
}

function createStyles(theme) {
  const spacing = theme?.spacing || {};
  const typography = theme?.typography || {};
  return StyleSheet.create({
    container: {
      gap: spacing.md,
      paddingHorizontal: spacing.md,
    },
    loadingWrap: {
      paddingVertical: spacing.lg,
      alignItems: 'center',
    },
    emptyText: {
      color: theme.colors.textSecondary,
      textAlign: 'center',
      paddingVertical: spacing.lg,
    },
    ruleItem: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    ruleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    ruleTextWrap: {
      flex: 1,
      minWidth: 0,
    },
    ruleName: {
      color: theme.colors.text,
      fontSize: typography?.sizes?.md,
      fontWeight: typography?.weight?.semibold,
      flexShrink: 1,
    },
    ruleConditionsText: {
      color: theme.colors.textSecondary,
      fontSize: typography?.sizes?.sm,
      marginTop: spacing.xs,
    },
    addRuleText: {
      color: theme.colors.primary,
      fontSize: typography?.sizes?.sm,
      fontWeight: typography?.weight?.medium,
    },
    modalFooter: {
      flexDirection: 'row',
      gap: spacing.sm,
      justifyContent: 'flex-end',
    },
    field: {
      marginBottom: spacing.sm,
    },
    conditionsHeader: {
      color: theme.colors.text,
      fontSize: typography?.sizes?.sm,
      fontWeight: typography?.weight?.semibold,
      marginBottom: spacing.xs,
    },
    conditionRowWrap: {
      borderWidth: theme.components?.card?.borderWidth || 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius?.md ?? spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.xs,
      marginBottom: spacing.sm,
    },
    conditionRowHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.xs,
    },
    conditionPrefix: {
      color: theme.colors.textSecondary,
      fontSize: typography?.sizes?.xs,
      fontWeight: typography?.weight?.medium,
    },
    conditionRemoveButton: {
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.xs,
    },
    addConditionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.xs,
      marginBottom: spacing.sm,
    },
    addConditionText: {
      color: theme.colors.primary,
      fontSize: typography?.sizes?.sm,
      fontWeight: typography?.weight?.medium,
    },
    conditionsErrorText: {
      color: theme.colors.danger,
      fontSize: typography?.sizes?.xs,
      marginBottom: spacing.sm,
    },
    deleteRuleHint: {
      color: theme.colors.textSecondary,
      fontSize: typography?.sizes?.sm,
      marginBottom: spacing.md,
    },
    deleteActionsColumn: {
      gap: spacing.sm,
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
      paddingVertical: spacing.xs,
    },
    switchTextWrap: {
      flex: 1,
      paddingRight: spacing.sm,
    },
    switchLabel: {
      color: theme.colors.text,
      fontSize: typography?.sizes?.sm,
      flexShrink: 1,
    },
    switchHint: {
      color: theme.colors.textSecondary,
      fontSize: typography?.sizes?.xs,
      marginTop: spacing.xs,
    },
  });
}
