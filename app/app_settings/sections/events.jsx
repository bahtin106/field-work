import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import Screen from '../../../components/layout/Screen';
import Card from '../../../components/ui/Card';
import SectionHeader from '../../../components/ui/SectionHeader';
import { SelectField, SwitchField } from '../../../components/ui/TextField';
import { SelectModal } from '../../../components/ui/modals';
import { useToast } from '../../../components/ui/ToastProvider';
import { listItemStyles } from '../../../components/ui/listItemStyles';
import { PERM_KEYS, TBL } from '../../../lib/constants';
import { readProfile, readRolePerm, getUid } from '../../../lib/supabaseHelpers';
import { supabase } from '../../../lib/supabase';
import { devWarn as __devLog } from '../../../src/utils/dev';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme';

const DEFAULT_REMINDER_DELAY_MINUTES = 20;
const REMINDER_DELAY_MINUTES_MIN = 1;
const REMINDER_DELAY_MINUTES_MAX = 30 * 24 * 60;

function parseMissingNotifPrefsColumn(error) {
  const message = String(error?.message || '').toLowerCase();
  if (!message.includes('notification_prefs')) return null;

  const quotedMatch = message.match(/column\s+"?([a-z_][a-z0-9_]*)"?\s+of relation\s+"?notification_prefs"?\s+does not exist/i);
  if (quotedMatch?.[1]) return quotedMatch[1];

  const dottedMatch = message.match(/column\s+(?:public\.)?notification_prefs\.([a-z_][a-z0-9_]*)\s+does not exist/i);
  if (dottedMatch?.[1]) return dottedMatch[1];

  const schemaCacheMatch = message.match(/could not find the\s+'([a-z_][a-z0-9_]*)'\s+column of\s+'notification_prefs'/i);
  if (schemaCacheMatch?.[1]) return schemaCacheMatch[1];

  return null;
}

const UNIT_CONFIG = Object.freeze({
  minutes: { factor: 1, max: 59, titleKey: 'settings_events_reminder_unit_minutes' },
  hours: { factor: 60, max: 23, titleKey: 'settings_events_reminder_unit_hours' },
  days: { factor: 24 * 60, max: 30, titleKey: 'settings_events_reminder_unit_days' },
});

const EVENT_GROUPS = Object.freeze([
  {
    key: 'orders',
    titleKey: 'settings_events_group_orders_title',
    items: [
      { key: 'new_orders', type: 'switch', labelKey: 'settings_events_newOrders' },
      { key: 'feed_orders', type: 'switch', labelKey: 'settings_events_feedOrders' },
      {
        key: 'reminders',
        type: 'switch',
        labelKey: 'settings_events_reminders',
        childrenKey: 'reminder_delay',
        requiresCreateOrders: true,
      },
    ],
  },
]);

function clampDelayMinutes(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_REMINDER_DELAY_MINUTES;
  return Math.min(REMINDER_DELAY_MINUTES_MAX, Math.max(REMINDER_DELAY_MINUTES_MIN, Math.round(numeric)));
}

function decomposeDelayMinutes(totalMinutes) {
  const minutes = clampDelayMinutes(totalMinutes);
  if (minutes % UNIT_CONFIG.days.factor === 0) {
    return { unit: 'days', value: Math.max(1, minutes / UNIT_CONFIG.days.factor) };
  }
  if (minutes % UNIT_CONFIG.hours.factor === 0) {
    return { unit: 'hours', value: Math.max(1, minutes / UNIT_CONFIG.hours.factor) };
  }
  return { unit: 'minutes', value: Math.max(1, minutes) };
}

function composeDelayMinutes(unit, value) {
  const cfg = UNIT_CONFIG[unit] || UNIT_CONFIG.minutes;
  const safeValue = Math.min(cfg.max, Math.max(1, Number(value) || 1));
  return clampDelayMinutes(safeValue * cfg.factor);
}

export default function NotificationEventsScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const s = React.useMemo(() => styles(theme), [theme]);
  const base = React.useMemo(() => listItemStyles(theme), [theme]);
  const mountedRef = React.useRef(true);
  const unsupportedColsRef = React.useRef(new Set());
  const lastErrorMessageRef = React.useRef(null);

  const [prefs, setPrefs] = React.useState({
    allow: true,
    new_orders: true,
    feed_orders: true,
    reminders: true,
    reminder_delay_minutes: DEFAULT_REMINDER_DELAY_MINUTES,
  });
  const prefsRef = React.useRef(prefs);
  const [unitModalOpen, setUnitModalOpen] = React.useState(false);
  const [valueModalOpen, setValueModalOpen] = React.useState(false);

  React.useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  React.useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const { data: prefsData, isLoading, refetch, error } = useQuery({
    queryKey: ['appSettings', 'notifPrefs'],
    queryFn: async () => {
      const uid = await getUid();
      const { data, error: prefsErr } = await supabase
        .from(TBL.NOTIF_PREFS)
        .select('*')
        .eq('user_id', uid)
        .maybeSingle();

      if (prefsErr) throw prefsErr;
      if (!data) {
        return {
          allow: true,
          new_orders: true,
          feed_orders: true,
          reminders: true,
          reminder_delay_minutes: DEFAULT_REMINDER_DELAY_MINUTES,
        };
      }
      return {
        allow: data.allow !== false,
        new_orders: data.new_orders !== false,
        feed_orders: data.feed_orders !== false,
        reminders: data.reminders !== false,
        reminder_delay_minutes: clampDelayMinutes(data.reminder_delay_minutes),
      };
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  React.useEffect(() => {
    if (!prefsData || !mountedRef.current) return;
    setPrefs((prev) => ({ ...prev, ...prefsData }));
  }, [prefsData]);

  React.useEffect(() => {
    if (!error) return;
    const message = String(error?.message || error || '');
    if (lastErrorMessageRef.current === message) return;
    lastErrorMessageRef.current = message;
    toast.error(t('errors_loadSettings'));
  }, [error, t, toast]);

  const { data: canCreateOrdersData } = useQuery({
    queryKey: ['appSettings', 'eventsPerm'],
    queryFn: async () => {
      try {
        const uid = await getUid();
        const profile = await readProfile(uid);
        if (!profile?.company_id || !profile?.role) return false;
        const permValue = await readRolePerm(profile.company_id, profile.role, PERM_KEYS.CAN_CREATE_ORDERS);
        const v = String(permValue ?? '').trim().toLowerCase();
        return v in { 1: 1, true: 1, t: 1, yes: 1, y: 1 };
      } catch (e) {
        __devLog('events perm load failed:', e?.message || e);
        return false;
      }
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev ?? false,
  });
  const canCreateOrders = !!canCreateOrdersData;

  const savePrefs = React.useCallback(
    async (patch) => {
      try {
        const uid = await getUid();
        let saveErr = null;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const payload = { ...patch };
          unsupportedColsRef.current.forEach((col) => {
            delete payload[col];
          });

          const result = await supabase
            .from(TBL.NOTIF_PREFS)
            .upsert({ user_id: uid, ...payload }, { onConflict: 'user_id', returning: 'minimal' });
          saveErr = result.error || null;
          if (!saveErr) break;

          const missingCol = parseMissingNotifPrefsColumn(saveErr);
          if (!missingCol) break;

          unsupportedColsRef.current.add(missingCol);
        }

        if (saveErr) {
          let msg = t('errors_saveGeneric');
          if (/permission denied/i.test(saveErr.message)) msg = t('errors_noSettingsAccess');
          else if (/row level security|rls/i.test(saveErr.message)) msg = t('errors_rls');
          else if (/timeout|network|failed to fetch/i.test(saveErr.message)) msg = t('errors_network');
          return { ok: false, message: msg };
        }
        await refetch();
        return { ok: true };
      } catch (e) {
        const normalized = String(e?.message || e || '').toLowerCase();
        if (normalized.includes('failed to fetch') || normalized.includes('network')) {
          return { ok: false, message: t('errors_network') };
        }
        return { ok: false, message: t('errors_saveGeneric') };
      }
    },
    [refetch, t],
  );

  const reminderDelayMinutes = clampDelayMinutes(prefs.reminder_delay_minutes);
  const reminderDelayDecomposed = decomposeDelayMinutes(reminderDelayMinutes);
  const reminderDelayLabel = t('settings_events_reminder_delay_value').replace(
    '{value}',
    `${reminderDelayDecomposed.value}`,
  ).replace('{unit}', t(UNIT_CONFIG[reminderDelayDecomposed.unit].titleKey));

  const unitItems = React.useMemo(
    () =>
      Object.keys(UNIT_CONFIG).map((key) => ({
        id: key,
        label: t(UNIT_CONFIG[key].titleKey),
      })),
    [t],
  );

  const valueItems = React.useMemo(() => {
    const cfg = UNIT_CONFIG[reminderDelayDecomposed.unit] || UNIT_CONFIG.minutes;
    return Array.from({ length: cfg.max }, (_, i) => {
      const value = i + 1;
      return {
        id: String(value),
        label: t('settings_events_reminder_value_item').replace('{value}', `${value}`),
      };
    });
  }, [reminderDelayDecomposed.unit, t]);

  const onToggleEvent = React.useCallback(
    (key) => async (value) => {
      const prev = prefsRef.current;
      const patch = { [key]: value };
      if (key === 'reminders' && value) {
        patch.reminder_delay_minutes = clampDelayMinutes(prev.reminder_delay_minutes);
      }

      const next = { ...prev, ...patch };
      setPrefs(next);
      prefsRef.current = next;

      const result = await savePrefs(patch);
      if (!result.ok) {
        setPrefs(prev);
        prefsRef.current = prev;
        toast.error(result.message || t('errors_saveGeneric'));
      }
    },
    [savePrefs, t, toast],
  );

  const onSelectReminderUnit = React.useCallback(
    async (nextUnit) => {
      const prev = prefsRef.current;
      const minutes = composeDelayMinutes(nextUnit, reminderDelayDecomposed.value);
      const next = { ...prev, reminder_delay_minutes: minutes };
      setPrefs(next);
      prefsRef.current = next;
      setUnitModalOpen(false);
      const result = await savePrefs({ reminder_delay_minutes: minutes });
      if (!result.ok) {
        setPrefs(prev);
        prefsRef.current = prev;
        toast.error(result.message || t('errors_saveGeneric'));
      } else {
        toast.info(t('toast_settingsSaved'));
      }
    },
    [reminderDelayDecomposed.value, savePrefs, t, toast],
  );

  const onSelectReminderValue = React.useCallback(
    async (nextValue) => {
      const prev = prefsRef.current;
      const minutes = composeDelayMinutes(reminderDelayDecomposed.unit, Number(nextValue));
      const next = { ...prev, reminder_delay_minutes: minutes };
      setPrefs(next);
      prefsRef.current = next;
      setValueModalOpen(false);
      const result = await savePrefs({ reminder_delay_minutes: minutes });
      if (!result.ok) {
        setPrefs(prev);
        prefsRef.current = prev;
        toast.error(result.message || t('errors_saveGeneric'));
      } else {
        toast.info(t('toast_settingsSaved'));
      }
    },
    [reminderDelayDecomposed.unit, savePrefs, t, toast],
  );

  return (
    <Screen
      scroll={false}
      headerOptions={{ title: t('settings_events_title') }}
    >
      <ScrollView
        contentContainerStyle={s.container}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {EVENT_GROUPS.map((group) => {
          const visibleItems = group.items.filter((item) => !item.requiresCreateOrders || canCreateOrders);
          return (
            <View key={group.key} style={s.sectionWrap}>
              <SectionHeader topSpacing={0}>{t(group.titleKey)}</SectionHeader>
              <Card paddedXOnly>
                {visibleItems.map((item, index) => {
                  const isLast = index === visibleItems.length - 1;
                  const isDisabled = isLoading || !prefs.allow;
                  const isExpanded = item.childrenKey === 'reminder_delay' && !!prefs.reminders && canCreateOrders;

                  return (
                    <React.Fragment key={item.key}>
                      <SwitchField
                        label={t(item.labelKey)}
                        value={!!prefs[item.key]}
                        onValueChange={onToggleEvent(item.key)}
                        disabled={isDisabled}
                        accessibilityLabel={t(item.labelKey)}
                      />
                      {isExpanded ? (
                        <View style={s.expandedWrap}>
                          <SelectField
                            label={t('settings_events_reminder_delay_value_label')}
                            value={String(reminderDelayDecomposed.value)}
                            onPress={() => setValueModalOpen(true)}
                            disabled={isLoading}
                          />
                          <View style={base.sep} />
                          <SelectField
                            label={t('settings_events_reminder_delay_unit_label')}
                            value={t(UNIT_CONFIG[reminderDelayDecomposed.unit].titleKey)}
                            onPress={() => setUnitModalOpen(true)}
                            disabled={isLoading}
                          />
                          <View style={base.sep} />
                          <View style={s.helperWrap}>
                            <Text style={s.helperText}>{reminderDelayLabel}</Text>
                          </View>
                        </View>
                      ) : null}
                      {!isLast ? <View style={base.sep} /> : null}
                    </React.Fragment>
                  );
                })}
              </Card>
            </View>
          );
        })}
      </ScrollView>

      <SelectModal
        visible={valueModalOpen}
        title={t('settings_events_reminder_value_modal_title')}
        items={valueItems}
        searchable={false}
        selectedId={String(reminderDelayDecomposed.value)}
        onSelect={(item) => {
          const id = Number(item?.id);
          if (!Number.isFinite(id)) return;
          onSelectReminderValue(id);
        }}
        onClose={() => setValueModalOpen(false)}
      />

      <SelectModal
        visible={unitModalOpen}
        title={t('settings_events_reminder_unit_modal_title')}
        items={unitItems}
        searchable={false}
        selectedId={reminderDelayDecomposed.unit}
        onSelect={(item) => {
          const nextUnit = String(item?.id || '');
          if (!UNIT_CONFIG[nextUnit]) return;
          onSelectReminderUnit(nextUnit);
        }}
        onClose={() => setUnitModalOpen(false)}
      />
    </Screen>
  );
}

const styles = (theme) =>
  StyleSheet.create({
    container: {
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.xl,
      gap: theme.spacing.sm,
    },
    sectionWrap: {
      marginBottom: theme.spacing.sm,
    },
    expandedWrap: {
      marginLeft: theme.spacing.lg,
      borderLeftWidth: 1,
      borderLeftColor: theme.colors.border,
    },
    helperWrap: {
      minHeight: theme.components?.listItem?.height ?? 52,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.lg,
    },
    helperText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
  });
