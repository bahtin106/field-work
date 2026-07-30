import React from 'react';
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { KeyboardAwareScrollView } from '../../../lib/keyboardControllerCompat';
import Screen from '../../../components/layout/Screen';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import InfoHintButton from '../../../components/ui/InfoHintButton';
import SeparatedList from '../../../components/ui/SeparatedList';
import SectionHeader from '../../../components/ui/SectionHeader';
import ThemedSwitch from '../../../components/ui/ThemedSwitch';
import TextField from '../../../components/ui/TextField';
import { listItemStyles } from '../../../components/ui/listItemStyles';
import { AlertModal, BaseModal, ConfirmModal, SelectModal } from '../../../components/ui/modals';
import MultiSelectModal from '../../../components/ui/modals/MultiSelectModal';
import { useToast } from '../../../components/ui/ToastProvider';
import { formatCurrency } from '../../../lib/currency';
import { resolveAppLocale } from '../../../lib/localeFormatting';
import { usePermissions } from '../../../lib/permissions';
import { supabase } from '../../../lib/supabase';
import { fetchWorkTypes } from '../../../lib/workTypes';
import { useCompanySettings } from '../../../hooks/useCompanySettings';
import { useAuthContext } from '../../../providers/SimpleAuthProvider';
import {
  useArchiveCompanyFinanceSchemeMutation,
  useCompanyFinanceSchemes,
  useSetCompanyFinanceSchemeEnabledMutation,
  useUpsertCompanyFinanceSchemeMutation,
} from '../../../src/features/finance/queries';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

const PRESSED_OPACITY = 0.7;
const MAX_SCHEMES_PER_COMPANY = 25;

const COMPENSATION_MODES = [
  { id: 'worker_percent', labelKey: 'finance_scheme_mode_worker_percent' },
  { id: 'company_percent', labelKey: 'finance_scheme_mode_company_percent' },
  { id: 'worker_fixed', labelKey: 'finance_scheme_mode_worker_fixed' },
  { id: 'company_fixed', labelKey: 'finance_scheme_mode_company_fixed' },
  { id: 'worker_fixed_plus_percent', labelKey: 'finance_scheme_mode_worker_fixed_plus_percent' },
  { id: 'manual', labelKey: 'finance_scheme_mode_manual' },
];

const PERCENT_BASES = [
  { id: 'customer_total', labelKey: 'finance_scheme_base_customer_total' },
  { id: 'base_price', labelKey: 'finance_scheme_base_initial_amount' },
  { id: 'income_total', labelKey: 'finance_scheme_base_additional_work' },
];

const PAYMENT_METHODS = [
  { id: 'any', labelKey: 'finance_rule_condition_any' },
  { id: 'cash', labelKey: 'order_payment_method_cash' },
  { id: 'cashless', labelKey: 'order_payment_method_cashless' },
];

const PAYMENT_STATUSES = [
  { id: 'any', labelKey: 'finance_rule_condition_any' },
  { id: 'paid', labelKey: 'order_payment_status_paid' },
  { id: 'partial', labelKey: 'order_payment_status_partial' },
  { id: 'unpaid', labelKey: 'order_payment_status_unpaid' },
];

function parseNumber(raw, fallback = 0) {
  const value = Number(String(raw ?? '').trim().replace(',', '.'));
  return Number.isFinite(value) ? value : fallback;
}

function normalizeIds(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return Array.from(new Set(list.map((item) => String(item || '').trim()).filter(Boolean)));
}

function createEmptyDraft() {
  return {
    id: null,
    name: '',
    compensation_mode: 'worker_percent',
    fixed_amount: '',
    percent_value: '50',
    percent_base: 'customer_total',
    minimum_worker_amount: '',
    maximum_worker_amount: '',
    condition_work_type_ids: [],
    condition_payment_method: 'any',
    condition_payment_status: 'any',
    condition_min_customer_total: '',
    condition_max_customer_total: '',
    preserved_conditions: [],
    is_default: true,
    is_enabled: true,
    priority: 100,
    apply_to_existing: true,
    preview_base: '10000',
    preview_income: '0',
    preview_discount: '0',
    preview_cost: '0',
  };
}

function buildConditions(draft) {
  if (draft?.is_default === true) {
    return { op: 'all', conditions: [] };
  }
  const conditions = Array.isArray(draft?.preserved_conditions)
    ? draft.preserved_conditions.filter(
        (condition) => condition && typeof condition === 'object' && !Array.isArray(condition),
      )
    : [];
  const workTypeIds = normalizeIds(draft?.condition_work_type_ids);
  if (workTypeIds.length) {
    conditions.push({ fact: 'work_type_id', operator: 'in', value: workTypeIds });
  }
  const paymentMethod = String(draft?.condition_payment_method || 'any');
  if (paymentMethod !== 'any') {
    conditions.push({ fact: 'payment_method', operator: 'eq', value: paymentMethod });
  }
  const paymentStatus = String(draft?.condition_payment_status || 'any');
  if (paymentStatus !== 'any') {
    conditions.push({ fact: 'payment_status', operator: 'eq', value: paymentStatus });
  }
  const minTotal = String(draft?.condition_min_customer_total || '').trim();
  const maxTotal = String(draft?.condition_max_customer_total || '').trim();
  if (minTotal) {
    conditions.push({ fact: 'customer_total', operator: 'gte', value: parseNumber(minTotal, 0) });
  }
  if (maxTotal) {
    conditions.push({ fact: 'customer_total', operator: 'lte', value: parseNumber(maxTotal, 0) });
  }
  return { op: 'all', conditions };
}

function parseConditions(conditionsJson) {
  let source = conditionsJson;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      source = null;
    }
  }
  const parsed = {
    condition_work_type_ids: [],
    condition_payment_method: 'any',
    condition_payment_status: 'any',
    condition_min_customer_total: '',
    condition_max_customer_total: '',
    preserved_conditions: [],
  };
  for (const condition of Array.isArray(source?.conditions) ? source.conditions : []) {
    const fact = String(condition?.fact || '');
    const operator = String(condition?.operator || '');
    if (fact === 'work_type_id' && (operator === 'in' || operator === 'eq')) {
      parsed.condition_work_type_ids = normalizeIds(condition.value);
    } else if (fact === 'payment_method' && operator === 'eq') {
      parsed.condition_payment_method = String(condition.value || 'any');
    } else if (fact === 'payment_status' && operator === 'eq') {
      parsed.condition_payment_status = String(condition.value || 'any');
    } else if ((fact === 'customer_total' || fact === 'gross_after_discount') && operator === 'gte') {
      parsed.condition_min_customer_total = String(condition.value ?? '');
    } else if ((fact === 'customer_total' || fact === 'gross_after_discount') && operator === 'lte') {
      parsed.condition_max_customer_total = String(condition.value ?? '');
    } else {
      parsed.preserved_conditions.push(condition);
    }
  }
  return parsed;
}

function modeUsesPercent(mode) {
  return ['worker_percent', 'company_percent', 'worker_fixed_plus_percent'].includes(mode);
}

function modeUsesFixed(mode) {
  return ['worker_fixed', 'company_fixed', 'worker_fixed_plus_percent'].includes(mode);
}

function calculatePreview(draft) {
  const base = Math.max(0, parseNumber(draft.preview_base, 0));
  const income = Math.max(0, parseNumber(draft.preview_income, 0));
  const discount = Math.max(0, parseNumber(draft.preview_discount, 0));
  const directCost = Math.max(0, parseNumber(draft.preview_cost, 0));
  const customerTotal = base + income - discount;
  const percentBase =
    draft.percent_base === 'base_price'
      ? base
      : draft.percent_base === 'income_total'
        ? income
        : customerTotal;
  const fixed = Math.max(0, parseNumber(draft.fixed_amount, 0));
  const percent = Math.max(0, parseNumber(draft.percent_value, 0));
  let workerBase = 0;

  switch (draft.compensation_mode) {
    case 'worker_percent':
      workerBase = percentBase * percent / 100;
      break;
    case 'company_percent':
      workerBase = customerTotal - percentBase * percent / 100;
      break;
    case 'worker_fixed':
      workerBase = fixed;
      break;
    case 'company_fixed':
      workerBase = customerTotal - fixed;
      break;
    case 'worker_fixed_plus_percent':
      workerBase = fixed + percentBase * percent / 100;
      break;
    default:
      workerBase = 0;
  }

  workerBase = Math.max(0, workerBase);
  const minimum = String(draft.minimum_worker_amount || '').trim();
  const maximum = String(draft.maximum_worker_amount || '').trim();
  if (minimum) workerBase = Math.max(workerBase, parseNumber(minimum, 0));
  if (maximum) workerBase = Math.min(workerBase, parseNumber(maximum, workerBase));

  const companyCosts = directCost;
  return {
    customerTotal,
    workerCompensation: workerBase,
    companyCosts,
    companyMargin: customerTotal - workerBase - companyCosts,
  };
}

function schemeSummary(t, scheme, currency) {
  const version = scheme?.current_version || {};
  const template = (key, values) =>
    Object.entries(values).reduce(
      (message, [name, value]) => message.replace(`{${name}}`, String(value)),
      t(key),
    );
  const percent = Number(version.percent_value ?? 0);
  const percentText = `${new Intl.NumberFormat(resolveAppLocale(), {
    maximumFractionDigits: 2,
  }).format(Number.isFinite(percent) ? percent : 0)}%`;
  const percentBaseKey = {
    customer_total: 'finance_snapshot_scheme_rule_base_customer_total',
    base_price: 'finance_snapshot_scheme_rule_base_initial_amount',
    income_total: 'finance_snapshot_scheme_rule_base_additional_work',
  }[String(version.percent_base || 'customer_total')];
  const percentBase = t(percentBaseKey || 'finance_snapshot_scheme_rule_base_customer_total');
  const fixedAmount = formatCurrency(Number(version.fixed_amount || 0), currency, resolveAppLocale());
  let ruleText;

  switch (String(version.compensation_mode || 'manual')) {
    case 'worker_percent':
      ruleText = template('finance_snapshot_scheme_rule_worker_percent', {
        percent: percentText,
        base: percentBase,
      });
      break;
    case 'company_percent':
      ruleText = template('finance_snapshot_scheme_rule_company_percent', {
        percent: percentText,
        base: percentBase,
      });
      break;
    case 'worker_fixed':
      ruleText = template('finance_snapshot_scheme_rule_worker_fixed', { amount: fixedAmount });
      break;
    case 'company_fixed':
      ruleText = template('finance_snapshot_scheme_rule_company_fixed', { amount: fixedAmount });
      break;
    case 'worker_fixed_plus_percent':
      ruleText = template('finance_snapshot_scheme_rule_worker_fixed_plus_percent', {
        amount: fixedAmount,
        percent: percentText,
        base: percentBase,
      });
      break;
    default:
      ruleText = t('finance_snapshot_scheme_rule_manual');
  }

  const minimum = version.minimum_worker_amount;
  const maximum = version.maximum_worker_amount;
  const hasMinimum = minimum !== null && minimum !== undefined;
  const hasMaximum = maximum !== null && maximum !== undefined;
  if (hasMinimum && hasMaximum) {
    return `${ruleText} ${template('finance_snapshot_scheme_rule_limit_range', {
      min: formatCurrency(minimum, currency, resolveAppLocale()),
      max: formatCurrency(maximum, currency, resolveAppLocale()),
    })}`;
  }
  if (hasMinimum) {
    return `${ruleText} ${template('finance_snapshot_scheme_rule_limit_min', {
      amount: formatCurrency(minimum, currency, resolveAppLocale()),
    })}`;
  }
  if (hasMaximum) {
    return `${ruleText} ${template('finance_snapshot_scheme_rule_limit_max', {
      amount: formatCurrency(maximum, currency, resolveAppLocale()),
    })}`;
  }
  return ruleText;
}

export default function FinanceRulesSettingsScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const router = useRouter();
  const { user: authUser, profile: authProfile } = useAuthContext();
  const { has, loading: permissionsLoading } = usePermissions();
  const isSoloAdmin =
    String(authProfile?.role || '').toLowerCase() === 'admin' &&
    String(authUser?.user_metadata?.account_type || '').toLowerCase() === 'solo';
  const canManageSchemes = has('canManageFinanceRules');

  const [companyId, setCompanyId] = React.useState(authProfile?.company_id || null);
  const [workTypes, setWorkTypes] = React.useState([]);
  const [workTypesLoading, setWorkTypesLoading] = React.useState(false);
  const [workTypesEnabled, setWorkTypesEnabled] = React.useState(false);
  const [draft, setDraft] = React.useState(createEmptyDraft);
  const [submitAttempted, setSubmitAttempted] = React.useState(false);
  const [editorVisible, setEditorVisible] = React.useState(false);
  const [modeModalVisible, setModeModalVisible] = React.useState(false);
  const [baseModalVisible, setBaseModalVisible] = React.useState(false);
  const [paymentMethodModalVisible, setPaymentMethodModalVisible] = React.useState(false);
  const [paymentStatusModalVisible, setPaymentStatusModalVisible] = React.useState(false);
  const [workTypesModalVisible, setWorkTypesModalVisible] = React.useState(false);
  const [applyConfirmVisible, setApplyConfirmVisible] = React.useState(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = React.useState(false);
  const [infoHint, setInfoHint] = React.useState(null);

  const { settings: companySettings } = useCompanySettings(companyId);
  const isSoloFinanceMode =
    companySettings?.work_mode === 'solo' ||
    (companySettings?.work_mode !== 'company' && isSoloAdmin);
  const cashPaymentEnabled = companySettings?.payment_method_cash_enabled !== false;
  const cashlessPaymentEnabled = companySettings?.payment_method_cashless_enabled !== false;
  const partialPaymentsEnabled = companySettings?.use_partial_payments === true;
  const paymentMethodPickerOptions = React.useMemo(
    () =>
      PAYMENT_METHODS.filter(
        (item) =>
          item.id === 'any' ||
          (item.id === 'cash' && cashPaymentEnabled) ||
          (item.id === 'cashless' && cashlessPaymentEnabled),
      ),
    [cashPaymentEnabled, cashlessPaymentEnabled],
  );
  const paymentStatusPickerOptions = React.useMemo(
    () =>
      PAYMENT_STATUSES.filter(
        (item) => item.id !== 'partial' || partialPaymentsEnabled,
      ),
    [partialPaymentsEnabled],
  );
  const hasSinglePaymentMethod = cashPaymentEnabled !== cashlessPaymentEnabled;
  const singlePaymentMethodLabel = t(
    cashPaymentEnabled ? 'order_payment_method_cash' : 'order_payment_method_cashless',
  );
  const schemesQuery = useCompanyFinanceSchemes(companyId, {
    enabled: !!companyId && !isSoloFinanceMode,
  });
  const saveMutation = useUpsertCompanyFinanceSchemeMutation(companyId);
  const archiveMutation = useArchiveCompanyFinanceSchemeMutation(companyId);
  const setEnabledMutation = useSetCompanyFinanceSchemeEnabledMutation(companyId);

  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const baseStyles = React.useMemo(() => listItemStyles(theme), [theme]);
  const schemes = React.useMemo(
    () => (Array.isArray(schemesQuery.data) ? schemesQuery.data : []),
    [schemesQuery.data],
  );
  const currency = companySettings?.currency || 'RUB';
  const preview = React.useMemo(() => calculatePreview(draft), [draft]);
  const renderInfoButton = (titleKey, messageKey) => (
    <FinanceInfoButton
      title={t(titleKey)}
      message={t(messageKey)}
      onPress={() => setInfoHint({ title: t(titleKey), message: t(messageKey) })}
    />
  );

  React.useEffect(() => {
    if (!isSoloFinanceMode) return;
    router.replace('/company_settings');
  }, [isSoloFinanceMode, router]);

  React.useEffect(() => {
    if (companyId) return;
    let mounted = true;
    supabase.auth.getUser()
      .then(async ({ data, error }) => {
        if (error) throw error;
        const userId = data?.user?.id;
        if (!userId) return;
        const result = await supabase
          .from('profiles')
          .select('company_id')
          .eq('id', userId)
          .maybeSingle();
        if (result.error) throw result.error;
        if (mounted) setCompanyId(result.data?.company_id || null);
      })
      .catch((error) => {
        if (mounted) toast.error(String(error?.message || error));
      });
    return () => {
      mounted = false;
    };
  }, [companyId, toast]);

  React.useEffect(() => {
    if (!companyId) {
      setWorkTypes([]);
      setWorkTypesEnabled(false);
      return undefined;
    }
    let mounted = true;
    setWorkTypesLoading(true);
    fetchWorkTypes(companyId, { includeDisabled: true })
      .then((payload) => {
        if (!mounted) return;
        setWorkTypes(Array.isArray(payload?.types) ? payload.types : []);
        setWorkTypesEnabled(payload?.useWorkTypes === true);
      })
      .catch(() => {
        if (!mounted) return;
        setWorkTypes([]);
        setWorkTypesEnabled(false);
      })
      .finally(() => {
        if (mounted) setWorkTypesLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [companyId]);

  React.useEffect(() => {
    if (typeof companySettings?.use_work_types !== 'boolean') return;
    setWorkTypesEnabled(companySettings.use_work_types);
  }, [companySettings?.use_work_types]);

  React.useEffect(() => {
    if (!workTypesEnabled) setWorkTypesModalVisible(false);
  }, [workTypesEnabled]);

  const getOptionLabel = React.useCallback(
    (options, id) => {
      const option = options.find((item) => item.id === id);
      return t(option?.labelKey || String(id || ''));
    },
    [t],
  );

  const workTypesById = React.useMemo(
    () => new Map(workTypes.map((item) => [String(item.id), String(item.name || '')])),
    [workTypes],
  );
  const workTypeItems = React.useMemo(() => {
    if (workTypesLoading) {
      return [{ value: '__loading__', label: t('work_types_settings_loading'), disabled: true }];
    }
    if (!workTypes.length) {
      return [{ value: '__empty__', label: t('order_modal_work_type_empty'), disabled: true }];
    }
    const currentItems = workTypes.map((item) => ({
      id: String(item.id),
      value: String(item.id),
      label: String(item.name || t('finance_rule_condition_work_type_unknown')),
    }));
    const currentIds = new Set(currentItems.map((item) => item.value));
    const missingItems = normalizeIds(draft.condition_work_type_ids)
      .filter((id) => !currentIds.has(id))
      .map((id) => ({
        id,
        value: id,
        label: t('finance_scheme_deleted_work_type'),
        subtitle: t('finance_scheme_deleted_work_type_remove_hint'),
      }));
    return [...currentItems, ...missingItems];
  }, [draft.condition_work_type_ids, t, workTypes, workTypesLoading]);

  const deletedWorkTypeIds = React.useMemo(
    () =>
      normalizeIds(draft.condition_work_type_ids).filter((id) => !workTypesById.has(id)),
    [draft.condition_work_type_ids, workTypesById],
  );

  const selectedWorkTypesLabel = React.useMemo(() => {
    const ids = normalizeIds(draft.condition_work_type_ids);
    if (!ids.length) return t('finance_scheme_all_work_types');
    return ids
      .map((id) => workTypesById.get(id) || t('finance_scheme_deleted_work_type'))
      .join(', ');
  }, [draft.condition_work_type_ids, t, workTypesById]);

  const openCreate = React.useCallback(() => {
    if (schemes.length >= MAX_SCHEMES_PER_COMPANY) {
      toast.error(t('finance_schemes_limit_reached'));
      return;
    }
    setDraft({
      ...createEmptyDraft(),
      is_default: schemes.length === 0,
    });
    setSubmitAttempted(false);
    setEditorVisible(true);
  }, [schemes.length, t, toast]);

  const openEdit = React.useCallback((scheme) => {
    const version = scheme?.current_version || {};
    setDraft({
      ...createEmptyDraft(),
      id: scheme?.id || null,
      name: String(scheme?.name || ''),
      compensation_mode: String(version.compensation_mode || 'manual'),
      fixed_amount: String(version.fixed_amount ?? ''),
      percent_value: String(version.percent_value ?? ''),
      percent_base: String(version.percent_base || 'customer_total'),
      minimum_worker_amount: String(version.minimum_worker_amount ?? ''),
      maximum_worker_amount: String(version.maximum_worker_amount ?? ''),
      ...parseConditions(scheme?.conditions_json),
      is_default: scheme?.is_default === true,
      is_enabled: scheme?.is_enabled !== false,
      priority: Number.isFinite(Number(scheme?.priority)) ? Number(scheme.priority) : 100,
      apply_to_existing: false,
    });
    setSubmitAttempted(false);
    setEditorVisible(true);
  }, []);

  const validateDraft = React.useCallback(() => {
    if (!String(draft.name || '').trim()) return t('finance_rule_name_required');
    if (!draft.is_default && buildConditions(draft).conditions.length === 0) {
      return t('finance_scheme_condition_required');
    }
    const minTotal = String(draft.condition_min_customer_total || '').trim();
    const maxTotal = String(draft.condition_max_customer_total || '').trim();
    if (minTotal && !Number.isFinite(parseNumber(minTotal, Number.NaN))) {
      return t('finance_rule_condition_price_invalid');
    }
    if (maxTotal && !Number.isFinite(parseNumber(maxTotal, Number.NaN))) {
      return t('finance_rule_condition_price_invalid');
    }
    if (minTotal && maxTotal && parseNumber(minTotal) > parseNumber(maxTotal)) {
      return t('finance_rule_condition_price_range_invalid');
    }
    const minimum = String(draft.minimum_worker_amount || '').trim();
    const maximum = String(draft.maximum_worker_amount || '').trim();
    if (minimum && maximum && parseNumber(minimum) > parseNumber(maximum)) {
      return t('finance_scheme_worker_limit_invalid');
    }
    if (
      modeUsesPercent(draft.compensation_mode) &&
      parseNumber(draft.percent_value, 0) <= 0 &&
      !modeUsesFixed(draft.compensation_mode)
    ) {
      return t('finance_rule_amount_must_be_gt_zero');
    }
    if (
      modeUsesFixed(draft.compensation_mode) &&
      parseNumber(draft.fixed_amount, 0) <= 0 &&
      !modeUsesPercent(draft.compensation_mode)
    ) {
      return t('finance_rule_amount_must_be_gt_zero');
    }
    if (
      draft.compensation_mode === 'worker_fixed_plus_percent' &&
      parseNumber(draft.fixed_amount, 0) <= 0 &&
      parseNumber(draft.percent_value, 0) <= 0
    ) {
      return t('finance_rule_amount_must_be_gt_zero');
    }
    return null;
  }, [draft, t]);

  const saveScheme = React.useCallback(async () => {
    if (!companyId) return;
    setSubmitAttempted(true);
    const validationError = validateDraft();
    if (validationError) {
      toast.error(validationError);
      return;
    }
    try {
      await saveMutation.mutateAsync({
        id: draft.id || undefined,
        company_id: companyId,
        name: String(draft.name || '').trim(),
        conditions_json: buildConditions(draft),
        compensation_mode: draft.compensation_mode,
        fixed_amount: parseNumber(draft.fixed_amount, 0),
        percent_value: parseNumber(draft.percent_value, 0),
        percent_base: draft.percent_base,
        minimum_worker_amount: String(draft.minimum_worker_amount || '').trim()
          ? parseNumber(draft.minimum_worker_amount, 0)
          : null,
        maximum_worker_amount: String(draft.maximum_worker_amount || '').trim()
          ? parseNumber(draft.maximum_worker_amount, 0)
          : null,
        is_default: draft.is_default === true,
        is_enabled: draft.is_enabled !== false,
        priority: parseNumber(draft.priority, 100),
        apply_to_existing: draft.apply_to_existing === true,
      });
      setApplyConfirmVisible(false);
      setEditorVisible(false);
      setSubmitAttempted(false);
      toast.success(t('finance_scheme_saved'));
    } catch (error) {
      toast.error(String(error?.message || error));
    }
  }, [companyId, draft, saveMutation, t, toast, validateDraft]);

  const requestSave = React.useCallback(() => {
    if (draft.apply_to_existing) {
      setApplyConfirmVisible(true);
      return;
    }
    void saveScheme();
  }, [draft.apply_to_existing, saveScheme]);

  const toggleScheme = React.useCallback(async (scheme, nextEnabled) => {
    try {
      await setEnabledMutation.mutateAsync({
        schemeId: scheme.id,
        isEnabled: nextEnabled === true,
        recalculateExisting: true,
      });
    } catch (error) {
      toast.error(String(error?.message || error));
    }
  }, [setEnabledMutation, toast]);

  const archiveScheme = React.useCallback(async () => {
    if (!draft.id) return;
    try {
      await archiveMutation.mutateAsync({
        schemeId: draft.id,
        recalculateExisting: true,
      });
      setDeleteConfirmVisible(false);
      setEditorVisible(false);
      toast.success(t('finance_scheme_deleted'));
    } catch (error) {
      toast.error(String(error?.message || error));
    }
  }, [archiveMutation, draft.id, t, toast]);

  if (isSoloFinanceMode) return null;

  if (permissionsLoading) {
    return (
      <Screen
        background="background"
        headerOptions={{ title: t('finance_schemes_title'), helpTopic: 'finance_rules' }}
        contentContainerStyle={styles.container}
      >
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      </Screen>
    );
  }

  if (!canManageSchemes) {
    return (
      <Screen
        background="background"
        headerOptions={{ title: t('finance_schemes_title'), helpTopic: 'finance_rules' }}
        contentContainerStyle={styles.container}
      >
        <Card paddedXOnly>
          <Text style={styles.emptyText}>{t('order_edit_no_permission')}</Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      background="background"
      headerOptions={{ title: t('finance_schemes_title'), helpTopic: 'finance_rules' }}
      contentContainerStyle={styles.container}
    >
      <Card paddedXOnly>
        {schemesQuery.isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : null}
        {!schemesQuery.isLoading && schemes.length === 0 ? (
          <Text style={styles.emptyText}>{t('finance_schemes_empty')}</Text>
        ) : null}
        <SeparatedList>
          {schemes.map((scheme) => (
            <Pressable
              key={scheme.id}
              style={({ pressed }) => [styles.schemeItem, pressed && { opacity: PRESSED_OPACITY }]}
              onPress={() => openEdit(scheme)}
            >
              <View style={styles.schemeRow}>
                <View style={styles.schemeTextWrap}>
                  <View style={styles.schemeTitleRow}>
                    <Text style={styles.schemeName}>{scheme.name}</Text>
                    {scheme.is_default ? (
                      <Text style={styles.defaultBadge}>{t('finance_scheme_default_badge')}</Text>
                    ) : null}
                  </View>
                  <Text style={styles.schemeSummary}>
                    {schemeSummary(t, scheme, currency)}
                  </Text>
                </View>
                <ThemedSwitch
                  value={scheme.is_enabled !== false}
                  onValueChange={(value) => void toggleScheme(scheme, value === true)}
                />
                <Feather
                  name="chevron-right"
                  size={theme.icons?.sm ?? 18}
                  color={theme.colors.textSecondary}
                />
              </View>
            </Pressable>
          ))}
          {!schemesQuery.isLoading && schemes.length < MAX_SCHEMES_PER_COMPANY ? (
            <Pressable
              style={({ pressed }) => [baseStyles.row, pressed && { opacity: PRESSED_OPACITY }]}
              onPress={openCreate}
            >
              <Text style={styles.addSchemeText}>{t('finance_scheme_add')}</Text>
              <View style={baseStyles.rightWrap}>
                <Feather
                  name="chevron-right"
                  size={theme.icons?.sm ?? 18}
                  color={theme.colors.textSecondary}
                />
              </View>
            </Pressable>
          ) : null}
        </SeparatedList>
      </Card>

      <BaseModal
        visible={editorVisible}
        onClose={() => setEditorVisible(false)}
        title={t('finance_scheme_editor_title')}
        maxHeightRatio={0.9}
        footer={
          <View style={styles.modalFooter}>
            {draft.id ? (
              <Button
                title={t('btn_delete')}
                variant="ghost"
                onPress={() => setDeleteConfirmVisible(true)}
              />
            ) : null}
            <Button title={t('btn_cancel')} variant="ghost" onPress={() => setEditorVisible(false)} />
            <Button
              title={t('btn_save')}
              loading={saveMutation.isPending}
              onPress={requestSave}
              formSubmit
            />
          </View>
        }
      >
        <KeyboardAwareScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.editorContent}
        >
          <SectionHeader containerStyle={styles.editorSectionHeader} style={styles.editorSectionTitle}>
            {t('finance_scheme_general_title')}
          </SectionHeader>
          <Card style={styles.editorSection}>
            <TextField
              label={t('finance_scheme_name')}
              labelAccessory={renderInfoButton('finance_scheme_name', 'finance_scheme_name_help')}
              required
              value={draft.name}
              onChangeText={(value) => setDraft((previous) => ({ ...previous, name: value }))}
              forceValidation={submitAttempted}
              error={submitAttempted && !String(draft.name || '').trim() ? 'invalid' : undefined}
              style={styles.fieldLast}
            />
            <View style={styles.switchRow}>
              <View style={styles.switchTextWrap}>
                <View style={styles.switchLabelRow}>
                  <Text style={styles.switchLabel}>{t('finance_scheme_enabled')}</Text>
                  {renderInfoButton('finance_scheme_enabled', 'finance_scheme_enabled_help')}
                </View>
              </View>
              <ThemedSwitch
                value={draft.is_enabled}
                onValueChange={(value) =>
                  setDraft((previous) => ({ ...previous, is_enabled: value === true }))
                }
              />
            </View>
          </Card>

          <SectionHeader containerStyle={styles.editorSectionHeader} style={styles.editorSectionTitle}>
            {t('finance_scheme_calculation_title')}
          </SectionHeader>
          <Card style={styles.editorSection}>
            <TextField
              label={t('finance_scheme_calculation_mode')}
              labelAccessory={renderInfoButton(
                'finance_scheme_calculation_mode',
                'finance_scheme_calculation_mode_help',
              )}
              value={getOptionLabel(COMPENSATION_MODES, draft.compensation_mode)}
              pressable
              onPress={() => setModeModalVisible(true)}
              rightSlot={
                <ModalChevron
                  label={t('finance_scheme_calculation_mode')}
                  onPress={() => setModeModalVisible(true)}
                  theme={theme}
                />
              }
              multiline
              style={styles.field}
            />
            {modeUsesFixed(draft.compensation_mode) ? (
              <TextField
                label={t('finance_scheme_fixed_amount')}
                labelAccessory={renderInfoButton(
                  'finance_scheme_fixed_amount',
                  'finance_scheme_fixed_amount_help',
                )}
                keyboardType="decimal-pad"
                value={String(draft.fixed_amount)}
                onChangeText={(value) =>
                  setDraft((previous) => ({ ...previous, fixed_amount: value }))
                }
                style={styles.field}
              />
            ) : null}
            {modeUsesPercent(draft.compensation_mode) ? (
              <>
                <TextField
                  label={t('finance_scheme_percent_value')}
                  labelAccessory={renderInfoButton(
                    'finance_scheme_percent_value',
                    'finance_scheme_percent_value_help',
                  )}
                  keyboardType="decimal-pad"
                  value={String(draft.percent_value)}
                  onChangeText={(value) =>
                    setDraft((previous) => ({ ...previous, percent_value: value }))
                  }
                  style={styles.field}
                />
                <TextField
                  label={t('finance_scheme_percent_base')}
                  labelAccessory={renderInfoButton(
                    'finance_scheme_percent_base',
                    'finance_scheme_percent_base_help',
                  )}
                  value={getOptionLabel(PERCENT_BASES, draft.percent_base)}
                  pressable
                  onPress={() => setBaseModalVisible(true)}
                  rightSlot={
                    <ModalChevron
                      label={t('finance_scheme_percent_base')}
                      onPress={() => setBaseModalVisible(true)}
                      theme={theme}
                    />
                  }
                  multiline
                  style={styles.field}
                />
              </>
            ) : null}

            <View style={styles.subsectionDivider} />
            <SectionHeader
              containerStyle={styles.subsectionHeader}
              style={styles.editorSectionTitle}
              accessory={renderInfoButton('finance_scheme_limits_title', 'finance_scheme_limits_help')}
            >
              {t('finance_scheme_limits_title')}
            </SectionHeader>
            <View style={styles.twoColumns}>
              <View style={styles.column}>
                <TextField
                  label={t('finance_scheme_min_worker_amount')}
                  labelAccessory={renderInfoButton(
                    'finance_scheme_min_worker_amount',
                    'finance_scheme_min_worker_amount_help',
                  )}
                  keyboardType="decimal-pad"
                  value={String(draft.minimum_worker_amount)}
                  onChangeText={(value) =>
                    setDraft((previous) => ({ ...previous, minimum_worker_amount: value }))
                  }
                  style={styles.fieldLast}
                />
              </View>
              <View style={styles.column}>
                <TextField
                  label={t('finance_scheme_max_worker_amount')}
                  labelAccessory={renderInfoButton(
                    'finance_scheme_max_worker_amount',
                    'finance_scheme_max_worker_amount_help',
                  )}
                  keyboardType="decimal-pad"
                  value={String(draft.maximum_worker_amount)}
                  onChangeText={(value) =>
                    setDraft((previous) => ({ ...previous, maximum_worker_amount: value }))
                  }
                  style={styles.fieldLast}
                />
              </View>
            </View>
          </Card>

          <SectionHeader containerStyle={styles.editorSectionHeader} style={styles.editorSectionTitle}>
            {t('finance_scheme_conditions_title')}
          </SectionHeader>
          <Card style={styles.editorSection}>
            <View style={styles.switchRow}>
              <View style={styles.switchTextWrap}>
                <View style={styles.switchLabelRow}>
                  <Text style={styles.switchLabel}>{t('finance_scheme_default')}</Text>
                  {renderInfoButton('finance_scheme_default', 'finance_scheme_default_help')}
                </View>
              </View>
              <ThemedSwitch
                value={draft.is_default}
                onValueChange={(value) =>
                  setDraft((previous) => ({ ...previous, is_default: value === true }))
                }
              />
            </View>

            {!draft.is_default ? (
              <>
                <View style={styles.subsectionDivider} />
                {workTypesEnabled ? (
                  <>
                    <TextField
                      label={t('finance_rule_condition_fact_work_type')}
                      labelAccessory={renderInfoButton(
                        'finance_rule_condition_fact_work_type',
                        'finance_scheme_work_types_help',
                      )}
                      value={selectedWorkTypesLabel}
                      pressable
                      multiline
                      onPress={() => setWorkTypesModalVisible(true)}
                      rightSlot={
                        <ModalChevron
                          label={t('finance_rule_condition_fact_work_type')}
                          onPress={() => setWorkTypesModalVisible(true)}
                          theme={theme}
                        />
                      }
                      style={styles.field}
                    />
                    {deletedWorkTypeIds.length ? (
                      <Text style={styles.conditionNotice}>
                        {t('finance_scheme_deleted_work_type_notice')}
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <Text style={[styles.conditionNotice, styles.conditionNoticeStandalone]}>
                    {t('finance_scheme_work_types_disabled_notice')}
                  </Text>
                )}
                {hasSinglePaymentMethod ? (
                  <Text style={styles.conditionNotice}>
                    {t('finance_scheme_payment_methods_single_notice').replace(
                      '{method}',
                      singlePaymentMethodLabel,
                    )}
                  </Text>
                ) : null}
                <TextField
                  label={t('finance_rule_condition_fact_payment_method')}
                  labelAccessory={renderInfoButton(
                    'finance_rule_condition_fact_payment_method',
                    'finance_scheme_payment_method_help',
                  )}
                  value={getOptionLabel(PAYMENT_METHODS, draft.condition_payment_method)}
                  pressable
                  onPress={() => setPaymentMethodModalVisible(true)}
                  rightSlot={
                    <ModalChevron
                      label={t('finance_rule_condition_fact_payment_method')}
                      onPress={() => setPaymentMethodModalVisible(true)}
                      theme={theme}
                    />
                  }
                  style={styles.field}
                />
                <TextField
                  label={t('finance_rule_condition_fact_payment_status')}
                  labelAccessory={renderInfoButton(
                    'finance_rule_condition_fact_payment_status',
                    'finance_scheme_payment_status_help',
                  )}
                  value={getOptionLabel(PAYMENT_STATUSES, draft.condition_payment_status)}
                  pressable
                  onPress={() => setPaymentStatusModalVisible(true)}
                  rightSlot={
                    <ModalChevron
                      label={t('finance_rule_condition_fact_payment_status')}
                      onPress={() => setPaymentStatusModalVisible(true)}
                      theme={theme}
                    />
                  }
                  style={styles.field}
                />
                {!partialPaymentsEnabled ? (
                  <Text style={styles.conditionNotice}>
                    {t('finance_scheme_partial_payments_disabled_notice')}
                  </Text>
                ) : null}
                <View style={styles.twoColumns}>
                  <View style={styles.column}>
                    <TextField
                      label={t('finance_scheme_customer_total_from')}
                      labelAccessory={renderInfoButton(
                        'finance_scheme_customer_total_from',
                        'finance_scheme_customer_total_from_help',
                      )}
                      keyboardType="decimal-pad"
                      value={String(draft.condition_min_customer_total)}
                      onChangeText={(value) =>
                        setDraft((previous) => ({
                          ...previous,
                          condition_min_customer_total: value,
                        }))
                      }
                      style={styles.fieldLast}
                    />
                  </View>
                  <View style={styles.column}>
                    <TextField
                      label={t('finance_scheme_customer_total_to')}
                      labelAccessory={renderInfoButton(
                        'finance_scheme_customer_total_to',
                        'finance_scheme_customer_total_to_help',
                      )}
                      keyboardType="decimal-pad"
                      value={String(draft.condition_max_customer_total)}
                      onChangeText={(value) =>
                        setDraft((previous) => ({
                          ...previous,
                          condition_max_customer_total: value,
                        }))
                      }
                      style={styles.fieldLast}
                    />
                  </View>
                </View>
              </>
            ) : null}

            <View style={styles.subsectionDivider} />
            <View style={styles.switchRow}>
              <View style={styles.switchTextWrap}>
                <View style={styles.switchLabelRow}>
                  <Text style={styles.switchLabel}>{t('finance_scheme_apply_existing')}</Text>
                  {renderInfoButton(
                    'finance_scheme_apply_existing',
                    'finance_scheme_apply_existing_help',
                  )}
                </View>
              </View>
              <ThemedSwitch
                value={draft.apply_to_existing}
                onValueChange={(value) =>
                  setDraft((previous) => ({ ...previous, apply_to_existing: value === true }))
                }
              />
            </View>
          </Card>

          <SectionHeader
            containerStyle={styles.editorSectionHeader}
            style={styles.editorSectionTitle}
            accessory={renderInfoButton('finance_scheme_preview_title', 'finance_scheme_preview_help')}
          >
            {t('finance_scheme_preview_title')}
          </SectionHeader>
          <Card style={styles.editorSection}>
            <View style={styles.twoColumns}>
              <View style={styles.column}>
                <TextField
                  label={t('order_finance_initial_cost')}
                  labelAccessory={renderInfoButton(
                    'order_finance_initial_cost',
                    'finance_scheme_preview_base_help',
                  )}
                  keyboardType="decimal-pad"
                  value={draft.preview_base}
                  onChangeText={(value) =>
                    setDraft((previous) => ({ ...previous, preview_base: value }))
                  }
                  style={styles.field}
                />
              </View>
              <View style={styles.column}>
                <TextField
                  label={t('order_finance_income_total')}
                  labelAccessory={renderInfoButton(
                    'order_finance_income_total',
                    'finance_scheme_preview_income_help',
                  )}
                  keyboardType="decimal-pad"
                  value={draft.preview_income}
                  onChangeText={(value) =>
                    setDraft((previous) => ({ ...previous, preview_income: value }))
                  }
                  style={styles.field}
                />
              </View>
            </View>
            <View style={styles.twoColumns}>
              <View style={styles.column}>
                <TextField
                  label={t('order_finance_discount_total')}
                  labelAccessory={renderInfoButton(
                    'order_finance_discount_total',
                    'finance_scheme_preview_discount_help',
                  )}
                  keyboardType="decimal-pad"
                  value={draft.preview_discount}
                  onChangeText={(value) =>
                    setDraft((previous) => ({ ...previous, preview_discount: value }))
                  }
                  style={styles.field}
                />
              </View>
              <View style={styles.column}>
                <TextField
                  label={t('order_finance_company_expense_total')}
                  labelAccessory={renderInfoButton(
                    'order_finance_company_expense_total',
                    'finance_scheme_preview_company_cost_help',
                  )}
                  keyboardType="decimal-pad"
                  value={draft.preview_cost}
                  onChangeText={(value) =>
                    setDraft((previous) => ({ ...previous, preview_cost: value }))
                  }
                  style={styles.field}
                />
              </View>
            </View>
            <View style={styles.previewCard}>
              <PreviewRow
                label={t('finance_snapshot_customer_total')}
                value={formatCurrency(preview.customerTotal, currency, resolveAppLocale())}
                styles={styles}
              />
              <PreviewRow
                label={t('finance_snapshot_worker_compensation')}
                value={formatCurrency(preview.workerCompensation, currency, resolveAppLocale())}
                styles={styles}
              />
              <PreviewRow
                label={t('finance_snapshot_company_costs')}
                value={formatCurrency(preview.companyCosts, currency, resolveAppLocale())}
                styles={styles}
              />
              <PreviewRow
                label={t('finance_snapshot_company_margin')}
                value={formatCurrency(preview.companyMargin, currency, resolveAppLocale())}
                styles={styles}
                last
              />
            </View>
          </Card>
        </KeyboardAwareScrollView>
      </BaseModal>

      <AlertModal
        visible={!!infoHint}
        title={infoHint?.title || ''}
        message={infoHint?.message || ''}
        onClose={() => setInfoHint(null)}
      />

      <SelectModal
        visible={modeModalVisible}
        title={t('finance_scheme_calculation_mode')}
        searchable={false}
        items={COMPENSATION_MODES.map((item) => ({ id: item.id, label: t(item.labelKey) }))}
        itemTitleNumberOfLines={2}
        multilineItems
        selectedId={draft.compensation_mode}
        onSelect={(item) => {
          setDraft((previous) => ({ ...previous, compensation_mode: item.id }));
          setModeModalVisible(false);
        }}
        onClose={() => setModeModalVisible(false)}
      />
      <SelectModal
        visible={baseModalVisible}
        title={t('finance_scheme_percent_base')}
        searchable={false}
        items={PERCENT_BASES.map((item) => ({ id: item.id, label: t(item.labelKey) }))}
        selectedId={draft.percent_base}
        onSelect={(item) => {
          setDraft((previous) => ({ ...previous, percent_base: item.id }));
          setBaseModalVisible(false);
        }}
        onClose={() => setBaseModalVisible(false)}
      />
      <SelectModal
        visible={paymentMethodModalVisible}
        title={t('finance_rule_condition_fact_payment_method')}
        searchable={false}
        items={paymentMethodPickerOptions.map((item) => ({ id: item.id, label: t(item.labelKey) }))}
        selectedId={draft.condition_payment_method}
        onSelect={(item) => {
          setDraft((previous) => ({ ...previous, condition_payment_method: item.id }));
          setPaymentMethodModalVisible(false);
        }}
        onClose={() => setPaymentMethodModalVisible(false)}
      />
      <SelectModal
        visible={paymentStatusModalVisible}
        title={t('finance_rule_condition_fact_payment_status')}
        searchable={false}
        items={paymentStatusPickerOptions.map((item) => ({
          id: item.id,
          label: t(item.labelKey),
        }))}
        selectedId={draft.condition_payment_status}
        onSelect={(item) => {
          setDraft((previous) => ({ ...previous, condition_payment_status: item.id }));
          setPaymentStatusModalVisible(false);
        }}
        onClose={() => setPaymentStatusModalVisible(false)}
      />
      <MultiSelectModal
        visible={workTypesModalVisible}
        title="finance_rule_condition_fact_work_type"
        items={workTypeItems}
        value={normalizeIds(draft.condition_work_type_ids)}
        searchable={!workTypesLoading && workTypes.length > 8}
        onChange={(values) =>
          setDraft((previous) => ({
            ...previous,
            condition_work_type_ids: normalizeIds(values).filter(
              (value) => value !== '__loading__' && value !== '__empty__',
            ),
          }))
        }
        onClose={() => setWorkTypesModalVisible(false)}
      />
      <ConfirmModal
        visible={applyConfirmVisible}
        title={t('finance_scheme_apply_confirm_title')}
        message={t('finance_scheme_apply_confirm_message')}
        confirmLabel={t('btn_save')}
        loading={saveMutation.isPending}
        onClose={() => setApplyConfirmVisible(false)}
        onConfirm={() => void saveScheme()}
      />
      <ConfirmModal
        visible={deleteConfirmVisible}
        title={t('finance_scheme_delete_title')}
        message={t('finance_scheme_delete_message')}
        confirmLabel={t('btn_delete')}
        confirmVariant="destructive"
        loading={archiveMutation.isPending}
        onClose={() => setDeleteConfirmVisible(false)}
        onConfirm={() => void archiveScheme()}
      />
    </Screen>
  );
}

function FinanceInfoButton({ title, message, onPress }) {
  return (
    <InfoHintButton
      onPress={onPress}
      accessibilityLabel={title}
      accessibilityHint={message}
    />
  );
}

function ModalChevron({ label, onPress, theme }) {
  const touchTarget = theme.components?.interactive?.minTouchTarget ?? 36;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
      style={{ width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Feather
        name="chevron-right"
        size={theme.components?.listItem?.chevronSize ?? theme.icons?.sm ?? 18}
        color={theme.colors.textSecondary}
      />
    </Pressable>
  );
}

function PreviewRow({ label, value, styles, last = false }) {
  return (
    <View style={[styles.previewRow, last ? styles.previewRowLast : null]}>
      <Text style={styles.previewLabel}>{label}</Text>
      <Text style={styles.previewValue}>{value}</Text>
    </View>
  );
}

function createStyles(theme) {
  const spacing = theme?.spacing || {};
  const typography = theme?.typography || {};
  return StyleSheet.create({
    container: {
      gap: theme.components.screenLayout.sectionGap,
      paddingHorizontal: theme.components.screenLayout.contentPaddingX,
      paddingBottom: theme.components.screenLayout.contentPaddingBottom,
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
    schemeItem: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    schemeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    schemeTextWrap: {
      flex: 1,
      minWidth: 0,
    },
    schemeTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    schemeName: {
      color: theme.colors.text,
      fontSize: typography?.sizes?.md,
      fontWeight: typography?.weight?.semibold,
      flexShrink: 1,
    },
    defaultBadge: {
      color: theme.colors.primary,
      backgroundColor: theme.colors.primarySoft || theme.colors.surface,
      fontSize: typography?.sizes?.xs,
      paddingHorizontal: spacing.xs,
      paddingVertical: 2,
      borderRadius: theme.radius?.sm || 6,
      overflow: 'hidden',
    },
    schemeSummary: {
      color: theme.colors.textSecondary,
      fontSize: typography?.sizes?.sm,
      marginTop: spacing.xs,
    },
    addSchemeText: {
      color: theme.colors.primary,
      fontSize: typography?.sizes?.sm,
      fontWeight: typography?.weight?.medium,
    },
    modalFooter: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: spacing.sm,
    },
    editorContent: {
      paddingBottom: spacing.md,
    },
    editorSectionHeader: {
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    editorSection: {
      marginBottom: spacing.xs,
    },
    editorSectionTitle: {
      color: theme.colors.textStrong ?? theme.colors.text,
    },
    field: {
      marginBottom: spacing.sm,
    },
    fieldLast: {
      marginBottom: 0,
    },
    subsectionHeader: {
      marginTop: 0,
      marginBottom: spacing.sm,
    },
    subsectionDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.border,
      marginVertical: spacing.md,
    },
    twoColumns: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    column: {
      flex: 1,
      minWidth: 0,
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: theme.components?.input?.height ?? theme.components?.listItem?.height ?? 48,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xs,
      gap: spacing.sm,
    },
    switchTextWrap: {
      flex: 1,
      minWidth: 0,
    },
    switchLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 1,
      gap: spacing.xs,
    },
    switchLabel: {
      flexShrink: 1,
      color: theme.colors.textSecondary,
      fontSize: typography?.sizes?.sm,
      fontWeight: typography?.weight?.medium ?? '500',
    },
    switchHint: {
      color: theme.colors.textSecondary,
      fontSize: typography?.sizes?.xs,
      marginTop: spacing.xs,
    },
    conditionNotice: {
      color: theme.colors.textSecondary,
      fontSize: typography?.sizes?.xs,
      lineHeight: Math.round((typography?.sizes?.xs ?? 12) * 1.35),
      marginTop: -spacing.xs,
      marginBottom: spacing.sm,
    },
    conditionNoticeStandalone: {
      marginTop: 0,
    },
    previewHint: {
      color: theme.colors.textSecondary,
      fontSize: typography?.sizes?.xs,
      marginBottom: spacing.sm,
    },
    previewCard: {
      borderWidth: theme.components?.card?.borderWidth || 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius?.md || 10,
      paddingHorizontal: spacing.md,
      marginTop: spacing.xs,
    },
    previewRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    previewRowLast: {
      borderBottomWidth: 0,
    },
    previewLabel: {
      flex: 1,
      color: theme.colors.textSecondary,
      fontSize: typography?.sizes?.sm,
    },
    previewValue: {
      color: theme.colors.text,
      fontSize: typography?.sizes?.sm,
      fontWeight: typography?.weight?.semibold,
      textAlign: 'right',
    },
  });
}
