import { useQueryClient } from '@tanstack/react-query';
// Heavy implementation is loaded by a lightweight Expo Router wrapper.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import LabelValueRow from '../../../components/ui/LabelValueRow';
import SectionHeader from '../../../components/ui/SectionHeader';
import TextField, { SelectField } from '../../../components/ui/TextField';
import { SelectModal } from '../../../components/ui/modals';
import { useToast } from '../../../components/ui/ToastProvider';
import { useCompanySettings } from '../../../hooks/useCompanySettings';
import {
  applyCompanySettingsCachePatch,
  broadcastCompanySettingsChanged,
  COMPANY_SETTINGS_QUERY_KEY,
} from '../../../lib/companySettingsQuery';
import {
  buildCompanyPhoneVisibilityPatch,
  formatPhoneVisibilitySummary,
  parsePhoneVisibilityRules,
  PHONE_VISIBILITY_DURATION_UNITS,
  PHONE_VISIBILITY_RULE_VERSION,
  PHONE_VISIBILITY_START_CONDITIONS,
  PHONE_VISIBILITY_STATUS_OPTIONS,
  PHONE_VISIBILITY_STOP_CONDITIONS,
  phoneVisibilityDurationToMinutes,
  phoneVisibilityMinutesToDuration,
} from '../../../lib/phoneVisibilityRules';
import { supabase } from '../../../lib/supabase';
import { useAuthContext } from '../../../providers/SimpleAuthProvider';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { TEXT_INPUT_LIMITS } from '../../../src/shared/input/limits';
import { useTheme } from '../../../theme/ThemeProvider';
import Screen from '../../../components/layout/Screen';

function createDraftRule(rule) {
  const delay = phoneVisibilityMinutesToDuration(rule?.offsetMins || 0);
  return {
    type: rule?.type || 'never',
    status: rule?.status || 'in_progress',
    delayValue: delay.value,
    delayUnit: delay.unit,
  };
}

function normalizeDraftRuleStatus(rule, statusOptions = PHONE_VISIBILITY_STATUS_OPTIONS) {
  const fallback = statusOptions.includes('in_progress') ? 'in_progress' : statusOptions[0];
  const status = statusOptions.includes(rule?.status) ? rule.status : fallback;
  return status === rule?.status ? rule : { ...rule, status };
}

function toRule(draft) {
  return {
    type: draft.type,
    status: draft.status,
    offsetMins: phoneVisibilityDurationToMinutes(draft.delayValue, draft.delayUnit),
  };
}

export default function PhoneVisibilitySettingsScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { profile } = useAuthContext();
  const companyId = profile?.company_id || null;
  const { settings, isLoading, refetch } = useCompanySettings(companyId);
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const [startRule, setStartRule] = React.useState(() => createDraftRule(parsePhoneVisibilityRules({}).start));
  const [stopRule, setStopRule] = React.useState(() => createDraftRule(parsePhoneVisibilityRules({}).stop));
  const [saving, setSaving] = React.useState(false);
  const [picker, setPicker] = React.useState(null);
  const statusOptions = PHONE_VISIBILITY_STATUS_OPTIONS;

  React.useEffect(() => {
    if (!settings) return;
    const parsed = parsePhoneVisibilityRules(settings);
    setStartRule(normalizeDraftRuleStatus(createDraftRule(parsed.start), statusOptions));
    setStopRule(normalizeDraftRuleStatus(createDraftRule(parsed.stop), statusOptions));
  }, [settings, statusOptions]);

  React.useEffect(() => {
    setStartRule((prev) => normalizeDraftRuleStatus(prev, statusOptions));
    setStopRule((prev) => normalizeDraftRuleStatus(prev, statusOptions));
  }, [statusOptions]);

  const conditionItems = React.useMemo(() => {
    const build = (ids) =>
      ids.map((id) => ({
        id,
        label: t(`phone_visibility_condition_${id}`),
      }));
    return {
      start: build(PHONE_VISIBILITY_START_CONDITIONS),
      stop: build(PHONE_VISIBILITY_STOP_CONDITIONS),
    };
  }, [t]);

  const statusItems = React.useMemo(
    () => statusOptions.map((id) => ({ id, label: t(`phone_visibility_status_${id}`) })),
    [statusOptions, t],
  );

  const unitItems = React.useMemo(
    () => PHONE_VISIBILITY_DURATION_UNITS.map((id) => ({
      id,
      label: t(`phone_visibility_unit_${id}`),
    })),
    [t],
  );

  const currentRules = React.useMemo(
    () => ({
      version: PHONE_VISIBILITY_RULE_VERSION,
      start: toRule(normalizeDraftRuleStatus(startRule, statusOptions)),
      stop: toRule(normalizeDraftRuleStatus(stopRule, statusOptions)),
    }),
    [startRule, statusOptions, stopRule],
  );

  const summary = React.useMemo(
    () => formatPhoneVisibilitySummary(currentRules, t),
    [currentRules, t],
  );

  const save = React.useCallback(async () => {
    if (!companyId) {
      toast.error(t('errors_companyNotFound'));
      return;
    }
    setSaving(true);
    try {
      const normalizedRules = currentRules;
      const patch = buildCompanyPhoneVisibilityPatch(normalizedRules);
      const { error } = await supabase
        .from('companies')
        .update(patch)
        .eq('id', companyId);
      if (error) throw error;
      applyCompanySettingsCachePatch(queryClient, companyId, patch);
      await broadcastCompanySettingsChanged(companyId, Object.keys(patch));
      await queryClient.invalidateQueries({ queryKey: COMPANY_SETTINGS_QUERY_KEY, refetchType: 'active' });
      await refetch?.();
      toast.success(t('toast_settingsSaved'));
    } catch (error) {
      toast.error(error?.message || t('toast_error'));
    } finally {
      setSaving(false);
    }
  }, [companyId, currentRules, queryClient, refetch, t, toast]);

  const openPicker = React.useCallback((kind, field) => {
    setPicker({ kind, field });
  }, []);

  const updateRule = React.useCallback((kind, patch) => {
    const setter = kind === 'start' ? setStartRule : setStopRule;
    setter((prev) => ({ ...prev, ...patch }));
  }, []);

  const pickerItems = React.useMemo(() => {
    if (!picker) return [];
    if (picker.field === 'type') return conditionItems[picker.kind] || [];
    if (picker.field === 'status') return statusItems;
    if (picker.field === 'unit') return unitItems;
    return [];
  }, [conditionItems, picker, statusItems, unitItems]);

  const selectedPickerId = React.useMemo(() => {
    if (!picker) return null;
    const rule = picker.kind === 'start' ? startRule : stopRule;
    if (picker.field === 'type') return rule.type;
    if (picker.field === 'status') return rule.status;
    if (picker.field === 'unit') return rule.delayUnit;
    return null;
  }, [picker, startRule, stopRule]);

  const renderRule = (kind, rule) => {
    const isStart = kind === 'start';
    const conditionLabel = conditionItems[kind].find((item) => item.id === rule.type)?.label || '';
    const statusLabel = statusItems.find((item) => item.id === rule.status)?.label || '';
    const unitLabel = unitItems.find((item) => item.id === rule.delayUnit)?.label || '';
    const hasStatus = rule.type === 'status';
    const hasDelay = rule.type === 'time_before_departure' || rule.type === 'time_after_departure' || hasStatus;
    const delayLabel = hasStatus
      ? t('phone_visibility_rule_delay_after_status')
      : isStart
        ? t('phone_visibility_rule_delay_before_departure')
        : t('phone_visibility_rule_delay_after_departure');

    return (
      <Card paddedXOnly separated>
        <SelectField
          label={t('phone_visibility_rule_condition')}
          value={conditionLabel}
          onPress={() => openPicker(kind, 'type')}
        />
        {hasStatus ? (
          <>
            <SelectField
              label={t('phone_visibility_rule_status')}
              value={statusLabel}
              onPress={() => openPicker(kind, 'status')}
            />
          </>
        ) : null}
        {hasDelay ? (
          <>
            <TextField
              label={delayLabel}
              value={String(rule.delayValue || '')}
              maxLength={TEXT_INPUT_LIMITS.numeric}
              onChangeText={(delayValue) => updateRule(kind, { delayValue })}
              keyboardType="number-pad"
              numericInput={{ allowDecimal: false, allowNegative: false }}
              returnKeyType="done"
              placeholder={t('phone_visibility_delay_placeholder')}
              hideSeparator
            />
            <SelectField
              label={t('phone_visibility_rule_delay_unit')}
              value={unitLabel}
              onPress={() => openPicker(kind, 'unit')}
            />
          </>
        ) : null}
      </Card>
    );
  };

  return (
    <Screen
      background="background"
      headerOptions={{ title: t('phone_visibility_title'), helpTopic: 'phone_visibility' }}
      contentContainerStyle={styles.screenContent}
    >
      <SectionHeader>{t('phone_visibility_scope_section')}</SectionHeader>
      <Card paddedXOnly>
        <LabelValueRow
          label={t('phone_visibility_scope_role')}
          value={t('role_worker')}
          hideWhenEmpty={false}
        />
      </Card>
      <Text style={styles.hintText}>{t('phone_visibility_scope_hint')}</Text>

      <SectionHeader>{t('phone_visibility_start_section')}</SectionHeader>
      {renderRule('start', startRule)}

      <SectionHeader>{t('phone_visibility_stop_section')}</SectionHeader>
      {renderRule('stop', stopRule)}

      <SectionHeader>{t('phone_visibility_summary_title')}</SectionHeader>
      <Card>
        <View style={styles.summaryContent}>
          <Text style={styles.summaryText}>{isLoading ? t('access_settings_loading') : summary}</Text>
          <Text style={styles.hintText}>{t('phone_visibility_conflict_hint')}</Text>
        </View>
      </Card>

      <Button
        title={t('access_settings_save')}
        onPress={save}
        formSubmit
        loading={saving}
        disabled={saving || isLoading}
      />

      <SelectModal
        visible={!!picker}
        title={t('phone_visibility_picker_title')}
        items={pickerItems}
        selectedId={selectedPickerId}
        onSelect={(item) => {
          if (!picker || !item?.id) return;
          const field = picker.field === 'unit' ? 'delayUnit' : picker.field;
          updateRule(picker.kind, { [field]: item.id });
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
        searchable={false}
      />
    </Screen>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    screenContent: {
      paddingHorizontal: theme.components.screenLayout.contentPaddingX,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.components.screenLayout.contentPaddingBottom,
      gap: theme.components.screenLayout.sectionGap,
    },
    summaryContent: {
      gap: theme.spacing.sm,
    },
    summaryText: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      lineHeight: Math.round(
        theme.typography.sizes.sm * theme.typography.lineHeights.relaxed,
      ),
      fontWeight: theme.typography.weight.medium,
    },
    hintText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.xs,
      lineHeight: Math.round(
        theme.typography.sizes.xs * theme.typography.lineHeights.relaxed,
      ),
    },
  });
}
