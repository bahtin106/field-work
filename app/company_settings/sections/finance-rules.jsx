import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Screen from '../../../components/layout/Screen';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import SectionHeader from '../../../components/ui/SectionHeader';
import TextField from '../../../components/ui/TextField';
import ThemedSwitch from '../../../components/ui/ThemedSwitch';
import { BaseModal, SelectModal } from '../../../components/ui/modals';
import { useToast } from '../../../components/ui/ToastProvider';
import { usePermissions } from '../../../lib/permissions';
import { supabase } from '../../../lib/supabase';
import {
  useCompanyFinanceRules,
  useDeleteCompanyFinanceRuleMutation,
  useUpsertCompanyFinanceRuleMutation,
} from '../../../src/features/finance/queries';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

const KIND_OPTIONS = [
  { id: 'income', labelKey: 'finance_kind_income', fallback: 'Доход' },
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
  { id: 'none', labelKey: 'finance_recipient_none', fallback: 'Без получателя' },
  { id: 'assigned_to', labelKey: 'finance_recipient_assigned', fallback: 'Исполнитель заявки' },
  { id: 'manual_user', labelKey: 'finance_recipient_manual', fallback: 'Конкретный сотрудник' },
];

const EMPTY_RULE_DRAFT = {
  id: null,
  name: '',
  kind: 'expense',
  calc_mode: 'fixed',
  fixed_amount: '0',
  percent_value: '0',
  percent_base: 'gross_after_discount',
  recipient_mode: 'none',
  recipient_user_id: null,
  note_template: '',
  requires_note: false,
  note_visible: true,
  is_enabled: true,
  sort_order: 100,
};

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
  const [users, setUsers] = React.useState([]);
  const [editorVisible, setEditorVisible] = React.useState(false);
  const [kindModalVisible, setKindModalVisible] = React.useState(false);
  const [calcModeModalVisible, setCalcModeModalVisible] = React.useState(false);
  const [percentBaseModalVisible, setPercentBaseModalVisible] = React.useState(false);
  const [recipientModeModalVisible, setRecipientModeModalVisible] = React.useState(false);
  const [recipientModalVisible, setRecipientModalVisible] = React.useState(false);
  const [draft, setDraft] = React.useState(EMPTY_RULE_DRAFT);

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

  React.useEffect(() => {
    if (!companyId) return;
    let mounted = true;

    (async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, full_name, role')
          .eq('company_id', companyId)
          .neq('role', 'client')
          .order('full_name', { ascending: true });
        if (error) throw error;
        if (mounted) setUsers(Array.isArray(data) ? data : []);
      } catch (error) {
        if (mounted) {
          toast.error(String(error?.message || error));
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [companyId, toast]);

  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const getOptionLabel = React.useCallback(
    (options, id) => {
      const item = options.find((opt) => opt.id === id);
      if (!item) return String(id || '');
      return t(item.labelKey, item.fallback);
    },
    [t],
  );

  const openCreate = React.useCallback(() => {
    setDraft(EMPTY_RULE_DRAFT);
    setEditorVisible(true);
  }, []);

  const openEdit = React.useCallback((rule) => {
    setDraft({
      id: rule?.id || null,
      name: String(rule?.name || ''),
      kind: String(rule?.kind || 'expense'),
      calc_mode: String(rule?.calc_mode || 'fixed'),
      fixed_amount: String(rule?.fixed_amount ?? '0'),
      percent_value: String(rule?.percent_value ?? '0'),
      percent_base: String(rule?.percent_base || 'gross_after_discount'),
      recipient_mode: String(rule?.recipient_mode || 'none'),
      recipient_user_id: rule?.recipient_user_id || null,
      note_template: String(rule?.note_template || ''),
      requires_note: rule?.requires_note === true,
      note_visible: rule?.note_visible !== false,
      is_enabled: rule?.is_enabled !== false,
      sort_order: Number.isFinite(Number(rule?.sort_order)) ? Number(rule.sort_order) : 100,
    });
    setEditorVisible(true);
  }, []);

  const saveRule = React.useCallback(async () => {
    if (!companyId) return;
    if (!String(draft.name || '').trim()) {
      toast.error(t('finance_rule_name_required', 'Укажите название правила'));
      return;
    }

    try {
      await saveMutation.mutateAsync({
        ...draft,
        company_id: companyId,
        fixed_amount: parseNumberSafe(draft.fixed_amount, 0),
        percent_value: parseNumberSafe(draft.percent_value, 0),
        sort_order: parseNumberSafe(draft.sort_order, 100),
      });
      setEditorVisible(false);
      toast.success(t('finance_rule_saved', 'Правило сохранено'));
    } catch (error) {
      toast.error(String(error?.message || error));
    }
  }, [companyId, draft, saveMutation, t, toast]);

  const removeRule = React.useCallback(
    async (ruleId) => {
      try {
        await deleteMutation.mutateAsync(ruleId);
        toast.success(t('finance_rule_deleted', 'Правило удалено'));
      } catch (error) {
        toast.error(String(error?.message || error));
      }
    },
    [deleteMutation, t, toast],
  );

  const recipientLabel = React.useMemo(() => {
    if (!draft.recipient_user_id) return t('common_not_selected', 'Не выбрано');
    const user = users.find((item) => String(item.id) === String(draft.recipient_user_id));
    return user?.full_name || t('common_not_selected', 'Не выбрано');
  }, [draft.recipient_user_id, t, users]);

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
      <Button title={t('finance_rule_add', 'Добавить правило')} onPress={openCreate} />

      <SectionHeader bottomSpacing="xs">{t('finance_rules_title', 'Финансовые правила')}</SectionHeader>
      <Card paddedXOnly>
        {rulesQuery.isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : null}

        {!rulesQuery.isLoading && (rulesQuery.data || []).length === 0 ? (
          <Text style={styles.emptyText}>{t('finance_rules_empty', 'Пока нет правил')}</Text>
        ) : null}

        {(rulesQuery.data || []).map((rule) => (
          <View key={rule.id} style={styles.ruleItem}>
            <View style={styles.ruleHeader}>
              <Text style={styles.ruleName}>{rule.name}</Text>
              <ThemedSwitch
                value={rule.is_enabled !== false}
                onValueChange={(next) =>
                  saveMutation
                    .mutateAsync({ ...rule, company_id: companyId, is_enabled: next })
                    .catch((error) => toast.error(String(error?.message || error)))
                }
              />
            </View>
            <Text style={styles.ruleMeta}>
              {getOptionLabel(KIND_OPTIONS, rule.kind)} • {getOptionLabel(CALC_MODE_OPTIONS, rule.calc_mode)}
            </Text>
            <View style={styles.rowActions}>
              <Button
                title={t('common_edit', 'Изменить')}
                variant="secondary"
                onPress={() => openEdit(rule)}
              />
              <Button
                title={t('common_delete', 'Удалить')}
                variant="destructive"
                onPress={() => removeRule(rule.id)}
              />
            </View>
          </View>
        ))}
      </Card>

      <BaseModal
        visible={editorVisible}
        onClose={() => setEditorVisible(false)}
        title={t('finance_rule_editor_title', 'Редактор правила')}
        footer={
          <View style={styles.modalFooter}>
            <Button title={t('btn_cancel')} variant="ghost" onPress={() => setEditorVisible(false)} />
            <Button title={t('btn_save')} loading={saveMutation.isPending} onPress={saveRule} />
          </View>
        }
      >
        <ScrollView keyboardShouldPersistTaps="handled">
          <TextField
            label={t('finance_rule_name', 'Название')}
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
              keyboardType="decimal-pad"
              value={String(draft.fixed_amount)}
              onChangeText={(value) => setDraft((prev) => ({ ...prev, fixed_amount: value }))}
              style={styles.field}
            />
          ) : (
            <>
              <TextField
                label={t('finance_rule_percent_value', 'Процент')}
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
            value={getOptionLabel(RECIPIENT_MODE_OPTIONS, draft.recipient_mode)}
            pressable
            onPress={() => setRecipientModeModalVisible(true)}
            style={styles.field}
          />

          {draft.recipient_mode === 'manual_user' ? (
            <TextField
              label={t('finance_rule_recipient_user', 'Сотрудник')}
              value={recipientLabel}
              pressable
              onPress={() => setRecipientModalVisible(true)}
              style={styles.field}
            />
          ) : null}

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
          setDraft((prev) => ({ ...prev, kind: item.id }));
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
        items={RECIPIENT_MODE_OPTIONS.map((item) => ({ id: item.id, label: t(item.labelKey, item.fallback) }))}
        selectedId={draft.recipient_mode}
        searchable={false}
        onSelect={(item) => {
          setDraft((prev) => ({ ...prev, recipient_mode: item.id }));
          setRecipientModeModalVisible(false);
        }}
        onClose={() => setRecipientModeModalVisible(false)}
      />

      <SelectModal
        visible={recipientModalVisible}
        title={t('finance_rule_recipient_user', 'Сотрудник')}
        items={users.map((user) => ({
          id: user.id,
          label: user.full_name || t('common_noName'),
          subtitle: user.role ? t(`role_${user.role}`, user.role) : undefined,
        }))}
        selectedId={draft.recipient_user_id}
        searchable
        onSelect={(item) => {
          setDraft((prev) => ({ ...prev, recipient_user_id: item.id }));
          setRecipientModalVisible(false);
        }}
        onClose={() => setRecipientModalVisible(false)}
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
    ruleItem: {
      paddingVertical: theme.spacing.sm,
      borderBottomWidth: theme.components?.card?.borderWidth || 1,
      borderBottomColor: theme.colors.border,
    },
    ruleHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: theme.spacing.sm,
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
    rowActions: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
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
