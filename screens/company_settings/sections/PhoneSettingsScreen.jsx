import { useQueryClient } from '@tanstack/react-query';
// Heavy implementation is loaded by a lightweight Expo Router wrapper.
import Feather from '@expo/vector-icons/Feather';
import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import SectionHeader from '../../../components/ui/SectionHeader';
import { SelectField } from '../../../components/ui/TextField';
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
} from '../../../lib/phoneVisibilityRules';
import { supabase } from '../../../lib/supabase';
import { useAuthContext } from '../../../providers/SimpleAuthProvider';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';
import Screen from '../../../components/layout/Screen';

const START_CONDITIONS = ['always', 'time_before_departure', 'status', 'never'];
const STOP_CONDITIONS = ['never', 'time_after_departure', 'status'];
const STATUS_OPTIONS = ['feed', 'new', 'in_progress', 'done'];
const SOLO_STATUS_OPTIONS = ['new', 'in_progress', 'done'];
const UNIT_OPTIONS = ['min', 'hour', 'day'];

const UNIT_TO_MINUTES = {
  min: 1,
  hour: 60,
  day: 1440,
};
const MAX_OFFSET_MINS = 43200;

function minutesToUnitValue(minutes) {
  const value = Math.max(0, Number(minutes) || 0);
  if (value > 0 && value % UNIT_TO_MINUTES.day === 0) {
    return { value: String(value / UNIT_TO_MINUTES.day), unit: 'day' };
  }
  if (value > 0 && value % UNIT_TO_MINUTES.hour === 0) {
    return { value: String(value / UNIT_TO_MINUTES.hour), unit: 'hour' };
  }
  return { value: String(value), unit: 'min' };
}

function toMinutes(value, unit) {
  const numeric = Math.max(0, Number(String(value || '').replace(/[^0-9]/g, '')) || 0);
  return Math.min(numeric * (UNIT_TO_MINUTES[unit] || 1), MAX_OFFSET_MINS);
}

function createDraftRule(rule) {
  const delay = minutesToUnitValue(rule?.offsetMins || 0);
  return {
    type: rule?.type || 'never',
    status: rule?.status || 'in_progress',
    delayValue: delay.value,
    delayUnit: delay.unit,
  };
}

function normalizeDraftRuleStatus(rule, statusOptions = STATUS_OPTIONS) {
  const fallback = statusOptions.includes('in_progress') ? 'in_progress' : statusOptions[0];
  const status = statusOptions.includes(rule?.status) ? rule.status : fallback;
  return status === rule?.status ? rule : { ...rule, status };
}

function toRule(draft) {
  return {
    type: draft.type,
    status: draft.status,
    offsetMins: toMinutes(draft.delayValue, draft.delayUnit),
  };
}

export default function PhoneVisibilitySettingsScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { profile, user } = useAuthContext();
  const accountType = String(user?.user_metadata?.account_type || '').trim().toLowerCase();
  const isSoloAdmin =
    String(profile?.role || '').toLowerCase() === 'admin' && accountType === 'solo';
  const companyId = profile?.company_id || null;
  const { settings, isLoading, refetch } = useCompanySettings(companyId);
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const [startRule, setStartRule] = React.useState(() => createDraftRule(parsePhoneVisibilityRules({}).start));
  const [stopRule, setStopRule] = React.useState(() => createDraftRule(parsePhoneVisibilityRules({}).stop));
  const [saving, setSaving] = React.useState(false);
  const [picker, setPicker] = React.useState(null);
  const statusOptions = React.useMemo(
    () => (isSoloAdmin ? SOLO_STATUS_OPTIONS : STATUS_OPTIONS),
    [isSoloAdmin],
  );

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
      start: build(START_CONDITIONS),
      stop: build(STOP_CONDITIONS),
    };
  }, [t]);

  const statusItems = React.useMemo(
    () => statusOptions.map((id) => ({ id, label: t(`phone_visibility_status_${id}`) })),
    [statusOptions, t],
  );

  const unitItems = React.useMemo(
    () => UNIT_OPTIONS.map((id) => ({ id, label: t(`phone_visibility_unit_${id}`) })),
    [t],
  );

  const currentRules = React.useMemo(
    () => ({
      version: 1,
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
            <View style={styles.delayControl}>
              <View style={styles.delayValueBlock}>
                <Text style={styles.fieldLabel}>{delayLabel}</Text>
                <TextInput
                  style={styles.delayInput}
                  value={String(rule.delayValue || '')}
                  onChangeText={(value) => updateRule(kind, { delayValue: value.replace(/[^0-9]/g, '') })}
                  keyboardType="numeric"
                  returnKeyType="done"
                  placeholder="0"
                  placeholderTextColor={theme.colors.textSecondary}
                  selectionColor={theme.colors.primary}
                />
              </View>
              <Pressable
                style={({ pressed }) => [styles.unitButton, pressed ? styles.unitButtonPressed : null]}
                onPress={() => openPicker(kind, 'unit')}
                accessibilityRole="button"
                accessibilityLabel={`${t('common_unit')}: ${unitLabel}`}
              >
                <Text style={styles.unitLabel} numberOfLines={1}>{unitLabel}</Text>
                <Feather name="chevron-right" size={theme.icons?.sm ?? 18} color={theme.colors.textSecondary} />
              </Pressable>
            </View>
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
      <View style={styles.content}>
        <SectionHeader>{t('phone_visibility_start_section')}</SectionHeader>
        {renderRule('start', startRule)}

        <SectionHeader>{t('phone_visibility_stop_section')}</SectionHeader>
        {renderRule('stop', stopRule)}

        <Card style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>{t('phone_visibility_summary_title')}</Text>
          <Text style={styles.summaryText}>{isLoading ? t('access_settings_loading') : summary}</Text>
          <Text style={styles.hintText}>{t('phone_visibility_conflict_hint')}</Text>
        </Card>

        <Button
          title={t('access_settings_save')}
          onPress={save}
          formSubmit
          loading={saving}
          disabled={saving || isLoading}
          style={styles.saveButton}
        />
      </View>

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
      paddingHorizontal: 0,
      paddingTop: 0,
    },
    content: {
      paddingHorizontal: theme.components.screenLayout.contentPaddingX,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.components.screenLayout.contentPaddingBottom,
      gap: theme.components.screenLayout.sectionGap,
    },
    delayControl: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      minHeight: theme.components?.listItem?.height ?? 56,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
    },
    delayValueBlock: {
      flex: 1,
      minWidth: 0,
    },
    fieldLabel: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.xs,
      fontWeight: theme.typography.weight.medium,
      marginBottom: Math.max(2, Math.floor((theme.spacing.xs || 4) / 2)),
    },
    delayInput: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
      padding: 0,
      minHeight: 28,
    },
    unitButton: {
      minWidth: 112,
      maxWidth: 144,
      height: 40,
      borderRadius: theme.radii.md,
      backgroundColor: theme.colors.inputBg ?? theme.colors.background,
      borderWidth: theme.components?.card?.borderWidth ?? 1,
      borderColor: theme.colors.border,
      paddingLeft: theme.spacing.md,
      paddingRight: theme.spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.xs,
    },
    unitButtonPressed: {
      opacity: 0.78,
    },
    unitLabel: {
      flexShrink: 1,
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.medium,
    },
    summaryCard: {
      gap: theme.spacing.xs,
      marginTop: theme.spacing.xs,
    },
    summaryTitle: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
    },
    summaryText: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      lineHeight: Math.round((theme.typography.sizes.sm || 14) * 1.4),
    },
    hintText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.xs,
      lineHeight: Math.round((theme.typography.sizes.xs || 12) * 1.4),
    },
    saveButton: {
      marginTop: theme.spacing.md,
    },
  });
}
