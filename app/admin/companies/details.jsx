import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Screen from '../../../components/layout/Screen';
import Card from '../../../components/ui/Card';
import LabelValueRow from '../../../components/ui/LabelValueRow';
import SectionHeader from '../../../components/ui/SectionHeader';
import TextField from '../../../components/ui/TextField';
import { ConfirmModal } from '../../../components/ui/modals';
import BaseModal from '../../../components/ui/modals/BaseModal';
import DateTimeModal from '../../../components/ui/modals/DateTimeModal';
import { listItemStyles } from '../../../components/ui/listItemStyles';
import { useCompanyAccessState } from '../../../hooks/useCompanyAccessState';
import { useRequireSuperAdmin } from '../../../hooks/useRequireSuperAdmin';
import { supabase } from '../../../lib/supabase';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';
import { useToast } from '../../../components/ui/ToastProvider';

function parseDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toPickerDate(value) {
  return parseDate(value);
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function preciseDayDiff(fromDate, toDate) {
  const from = parseDate(fromDate);
  const to = parseDate(toDate);
  if (!from || !to) return 0;
  return Math.floor((from.getTime() - to.getTime()) / DAY_MS);
}

function toPeriodEndIso(value) {
  const d = parseDate(value);
  if (!d) return null;
  return d.toISOString();
}

function normalizeTimeZone(value) {
  const zone = String(value || '').trim();
  if (!zone) return 'UTC';
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    return 'UTC';
  }
}

function getTimeZoneOffsetMinutes(value, timeZone) {
  const d = parseDate(value);
  if (!d) return 0;
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    const parts = Object.fromEntries(dtf.formatToParts(d).map((part) => [part.type, part.value]));
    const zonedUtcMs = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      0,
      0,
    );
    return Math.round((zonedUtcMs - d.getTime()) / 60000);
  } catch {
    return 0;
  }
}

function formatUtcOffset(totalMinutes) {
  const mins = Number.isFinite(totalMinutes) ? Math.trunc(totalMinutes) : 0;
  const sign = mins >= 0 ? '+' : '-';
  const abs = Math.abs(mins);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hh}:${mm}`;
}

function formatDateTime(value, timeZone) {
  const d = parseDate(value);
  if (!d) return '';
  const safeZone = normalizeTimeZone(timeZone);
  const locale = Intl.DateTimeFormat?.().resolvedOptions?.().locale;
  const datePart = new Intl.DateTimeFormat(locale, {
    timeZone: safeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
  const timePart = new Intl.DateTimeFormat(locale, {
    timeZone: safeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return `${datePart}, ${timePart} (${formatUtcOffset(getTimeZoneOffsetMinutes(d, safeZone))})`;
}

function addDays(baseDate, days) {
  const base = parseDate(baseDate) || new Date();
  return new Date(base.getTime() + days * DAY_MS);
}

function toSafeInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

function toSignedInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n > 0 ? Math.floor(n) : Math.ceil(n);
}

function toFiniteInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

async function fetchCompany(companyId) {
  const { data, error } = await supabase.rpc('admin_get_company', { p_company_id: companyId });
  if (error) throw error;
  return Array.isArray(data) && data.length ? data[0] : null;
}

async function fetchSubscriptionMeta(companyId) {
  const { data, error } = await supabase.rpc('admin_get_company_subscription_meta', {
    p_company_id: companyId,
  });
  if (error) throw error;
  return Array.isArray(data) && data.length ? data[0] : null;
}

async function saveSubscription(payload) {
  const { data, error } = await supabase.rpc('admin_set_company_subscription_super', {
    p_company_id: payload.p_company_id,
    p_plan_code: payload.p_plan_code ?? null,
    p_status: payload.p_status ?? null,
    p_period_end: payload.p_period_end ?? null,
    p_grace_period_days: payload.p_grace_period_days ?? null,
    p_extra_seats: payload.p_extra_seats ?? null,
    p_extra_storage_gb: payload.p_extra_storage_gb ?? null,
    p_cancel_at_period_end: payload.p_cancel_at_period_end ?? null,
    p_addons_json: payload.p_addons_json ?? null,
  });
  if (error) throw error;
  return data;
}

function ActionRow({ label, value, onPress, disabled, theme }) {
  const base = listItemStyles(theme);
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        base.row,
        pressed && !disabled ? { opacity: theme.components.listItem.disabledOpacity } : null,
        disabled ? { opacity: theme.components.listItem.disabledOpacity } : null,
      ]}
      accessibilityRole="button"
    >
      <Text style={base.label}>{label}</Text>
      <View style={base.rightWrap}>
        {value ? <Text style={base.value}>{value}</Text> : null}
        <Feather
          name="chevron-right"
          size={theme.components.listItem.chevronSize || 18}
          color={theme.colors.textSecondary}
        />
      </View>
    </Pressable>
  );
}

export default function AdminCompanyDetailsScreen() {
  const { companyId: companyIdParam, id: idParam } = useLocalSearchParams();
  const companyIdRaw = companyIdParam ?? idParam;
  const companyId = Array.isArray(companyIdRaw) ? companyIdRaw[0] : companyIdRaw;
  const { theme } = useTheme();
  const { t } = useTranslation();
  const nav = useNavigation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { isAllowed, isLoading: guardLoading } = useRequireSuperAdmin();
  const base = React.useMemo(() => listItemStyles(theme), [theme]);
  const companyKey = React.useMemo(() => ['adminCompany', companyId], [companyId]);
  const metaKey = React.useMemo(() => ['adminCompanySubscriptionMeta', companyId], [companyId]);
  const accessKey = React.useMemo(() => ['companyAccessState', companyId], [companyId]);

  const [datePickerVisible, setDatePickerVisible] = React.useState(false);
  const [addDaysVisible, setAddDaysVisible] = React.useState(false);
  const [paidSeatsVisible, setPaidSeatsVisible] = React.useState(false);
  const [confirmVisible, setConfirmVisible] = React.useState(false);

  const [daysInput, setDaysInput] = React.useState('0');
  const [paidSeatsInput, setPaidSeatsInput] = React.useState('0');
  const [confirmState, setConfirmState] = React.useState(null);

  const { data, isLoading, error, refetch: refetchCompany } = useQuery({
    queryKey: companyKey,
    queryFn: () => fetchCompany(companyId),
    enabled: isAllowed && Boolean(companyId),
    refetchOnMount: 'always',
    refetchOnReconnect: true,
  });

  const { data: meta, refetch: refetchMeta } = useQuery({
    queryKey: metaKey,
    queryFn: () => fetchSubscriptionMeta(companyId),
    enabled: isAllowed && Boolean(companyId),
    refetchOnMount: 'always',
    refetchOnReconnect: true,
  });

  const accessState = useCompanyAccessState(companyId);
  const access = accessState.data;

  React.useLayoutEffect(() => {
    nav.setParams({
      headerTitle: t('routes.admin/companies/details') || t('admin_company_details_title'),
    });
  }, [nav, t]);

  const refreshAll = React.useCallback(async () => {
    await Promise.all([
      refetchCompany(),
      refetchMeta(),
      accessState.refresh?.(),
      queryClient.refetchQueries({ queryKey: companyKey, exact: true, type: 'active' }),
      queryClient.refetchQueries({ queryKey: metaKey, exact: true, type: 'active' }),
      queryClient.refetchQueries({ queryKey: accessKey, exact: true, type: 'active' }),
      queryClient.refetchQueries({ queryKey: ['adminCompanies'], type: 'active' }),
    ]);
  }, [accessState, accessKey, companyKey, metaKey, queryClient, refetchCompany, refetchMeta]);

  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshAll();
    } finally {
      setRefreshing(false);
    }
  }, [refreshAll]);

  const mutation = useMutation({
    mutationFn: async ({ periodEnd, periodEndIso: rawPeriodEndIso, paidSeatsTotal, applyPeriodEnd = true, applyPaidSeats = false }) => {
      const periodEndIso = applyPeriodEnd ? (rawPeriodEndIso || toPeriodEndIso(periodEnd)) : null;
      const isActive = applyPeriodEnd
        ? !!periodEndIso && new Date(periodEndIso).getTime() > Date.now()
        : !!periodEnd && parseDate(periodEnd)?.getTime() > Date.now();
      const normalizedPaidSeats = toSafeInt(paidSeatsTotal, 0);

      if (applyPaidSeats) {
        if (isActive && normalizedPaidSeats < 1) {
          throw new Error(t('admin_company_paid_seats_min_active'));
        }
        if (!isActive && normalizedPaidSeats !== 0) {
          throw new Error(t('admin_company_paid_seats_zero_when_expired'));
        }
      }

      const payload = {
        p_company_id: companyId,
        p_status: isActive ? 'active' : 'expired',
      };
      if (applyPeriodEnd) {
        payload.p_period_end = periodEndIso;
      }
      if (applyPaidSeats) {
        payload.p_extra_seats = isActive ? Math.max(0, normalizedPaidSeats - 1) : 0;
      }
      return saveSubscription(payload);
    },
    onMutate: async ({ periodEnd, periodEndIso: rawPeriodEndIso, paidSeatsTotal, applyPeriodEnd = true, applyPaidSeats = false }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: companyKey }),
        queryClient.cancelQueries({ queryKey: metaKey }),
        queryClient.cancelQueries({ queryKey: accessKey }),
      ]);

      const prevCompany = queryClient.getQueryData(companyKey);
      const prevMeta = queryClient.getQueryData(metaKey);
      const prevAccess = queryClient.getQueryData(accessKey);

      const nextPaidSeatsTotal = applyPaidSeats
        ? toSafeInt(paidSeatsTotal, 0)
        : toFiniteInt(prevAccess?.paid_seats_total, 0);
      const nextExtraSeats = Math.max(0, nextPaidSeatsTotal - 1);
      const nextPeriodEnd = applyPeriodEnd ? parseDate(periodEnd) : null;
      const nextPeriodEndIso = applyPeriodEnd
        ? (rawPeriodEndIso || (nextPeriodEnd ? toPeriodEndIso(nextPeriodEnd) : null))
        : null;

      queryClient.setQueryData(companyKey, (old) => {
        if (!old || typeof old !== 'object') return old;
        return {
          ...old,
          extra_seats: applyPaidSeats ? nextExtraSeats : old.extra_seats,
          subscription_status: applyPeriodEnd
            ? nextPeriodEndIso && new Date(nextPeriodEndIso).getTime() > Date.now()
              ? 'active'
              : 'expired'
            : old.subscription_status,
          current_period_end: applyPeriodEnd ? nextPeriodEndIso : old.current_period_end,
        };
      });

      queryClient.setQueryData(metaKey, (old) => {
        if (!old || typeof old !== 'object' || !applyPeriodEnd) return old;
        return {
          ...old,
          current_period_end: nextPeriodEndIso,
        };
      });

      queryClient.setQueryData(accessKey, (old) => {
        if (!old || typeof old !== 'object') return old;
        const used = toFiniteInt(old.used_seats, 0);
        return {
          ...old,
          paid_seats_total: applyPaidSeats ? nextPaidSeatsTotal : old.paid_seats_total,
          free_seats: applyPaidSeats ? Math.max(0, nextPaidSeatsTotal - used) : old.free_seats,
        };
      });

      return { prevCompany, prevMeta, prevAccess };
    },
    onSuccess: async () => {
      await refreshAll();
      toast.success(t('admin_company_saved'));
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prevCompany !== undefined) queryClient.setQueryData(companyKey, ctx.prevCompany);
      if (ctx?.prevMeta !== undefined) queryClient.setQueryData(metaKey, ctx.prevMeta);
      if (ctx?.prevAccess !== undefined) queryClient.setQueryData(accessKey, ctx.prevAccess);
      toast.error(String(e?.message || t('admin_unknown_error')));
    },
  });

  const periodEndRaw = meta?.current_period_end || data?.current_period_end || access?.period_end || null;
  const periodEnd = parseDate(periodEndRaw);
  const isSubscriptionActive = !!periodEnd && periodEnd.getTime() > Date.now();
  const companyTimeZone = normalizeTimeZone(data?.timezone);
  const periodEndPickerDate = toPickerDate(periodEnd);
  const createdAt = parseDate(data?.created_at);

  const addDaysBaseDate = React.useMemo(() => {
    const currentNow = new Date();
    if (!periodEnd) return currentNow;
    return periodEnd.getTime() > currentNow.getTime() ? periodEnd : currentNow;
  }, [periodEnd]);
  const maxSubtractDays = React.useMemo(() => {
    if (!addDaysBaseDate) return 0;
    return Math.max(0, preciseDayDiff(addDaysBaseDate, new Date()));
  }, [addDaysBaseDate]);

  const parsedDaysDelta = React.useMemo(() => {
    const rawDelta = toSignedInt(daysInput, 0);
    return clampNumber(rawDelta, -maxSubtractDays, 36500);
  }, [daysInput, maxSubtractDays]);

  const previewPeriodEnd = React.useMemo(() => {
    if (!addDaysBaseDate) return null;
    return addDays(addDaysBaseDate, parsedDaysDelta);
  }, [addDaysBaseDate, parsedDaysDelta]);

  const paidSeatsFromAccess = toFiniteInt(access?.paid_seats_total, NaN);
  const paidSeatsFromCompanyExtra = toFiniteInt(data?.extra_seats, NaN);
  const paidSeatsFromCompany = Number.isFinite(paidSeatsFromCompanyExtra)
    ? Math.max(0, 1 + paidSeatsFromCompanyExtra)
    : NaN;
  const paidSeatsRaw = Number.isFinite(paidSeatsFromAccess)
    ? paidSeatsFromAccess
    : Number.isFinite(paidSeatsFromCompany)
      ? paidSeatsFromCompany
      : 0;
  const paidSeatsRestoreValue = Math.max(
    1,
    Number.isFinite(paidSeatsFromCompany) ? paidSeatsFromCompany : paidSeatsRaw || 0,
  );
  const usedSeats = Number(access?.used_seats ?? 0);
  const paidSeatsTotal = isSubscriptionActive ? Math.max(1, paidSeatsRaw) : 0;
  const freeSeats = Math.max(0, paidSeatsTotal - usedSeats);
  const employeesCount = Number(data?.employees_count ?? access?.members?.length ?? 0);

  const members = Array.isArray(access?.members) ? access.members : [];
  const blockedByLicense = members.filter((m) => m.license_state === 'blocked_by_license').length;

  const openConfirm = React.useCallback((state) => {
    setConfirmState(state);
    setConfirmVisible(true);
  }, []);

  const setDaysDelta = React.useCallback(
    (next) => {
      const clamped = clampNumber(toSignedInt(next, 0), -maxSubtractDays, 36500);
      setDaysInput(String(clamped));
    },
    [maxSubtractDays],
  );

  const handlePickDate = React.useCallback(
    (nextDate) => {
      const next = parseDate(nextDate);
      if (!next) return;
      const draftPaid = isSubscriptionActive ? paidSeatsTotal : paidSeatsRestoreValue;
    openConfirm({
      title: t('admin_company_confirm_period_title'),
      message: t('admin_company_confirm_period_message'),
      periodEnd: next,
      paidSeatsTotal: draftPaid,
      applyPaidSeats: false,
    });
  },
    [isSubscriptionActive, openConfirm, paidSeatsRestoreValue, paidSeatsTotal, t],
  );

  const handleAddDaysRequest = React.useCallback(() => {
    const days = parsedDaysDelta;
    if (!days) {
      toast.info(t('admin_company_days_non_zero_required'));
      return false;
    }
    const nextPeriodEnd = previewPeriodEnd;
    if (!nextPeriodEnd) return false;
    const nextPaidSeats = isSubscriptionActive
      ? Math.max(1, paidSeatsTotal)
      : paidSeatsRestoreValue;
    openConfirm({
      title: t('admin_company_confirm_days_title'),
      message: `${t('admin_company_confirm_days_message')} ${days > 0 ? `+${days}` : days}`,
      periodEnd: nextPeriodEnd,
      paidSeatsTotal: nextPaidSeats,
      applyPaidSeats: false,
    });
    return true;
  }, [
    isSubscriptionActive,
    openConfirm,
    paidSeatsRestoreValue,
    paidSeatsTotal,
    parsedDaysDelta,
    previewPeriodEnd,
    t,
    toast,
  ]);

  const handleSavePaidSeatsRequest = React.useCallback(() => {
    const nextPaidSeats = toSafeInt(paidSeatsInput, 0);
    if (!isSubscriptionActive && nextPaidSeats !== 0) {
      toast.info(t('admin_company_paid_seats_zero_when_expired'));
      return false;
    }
    if (isSubscriptionActive && nextPaidSeats < 1) {
      toast.info(t('admin_company_paid_seats_min_active'));
      return false;
    }
    openConfirm({
      title: t('admin_company_confirm_seats_title'),
      message: `${t('admin_company_confirm_seats_message')} ${nextPaidSeats}`,
      periodEnd: periodEnd || new Date(),
      paidSeatsTotal: nextPaidSeats,
      applyPeriodEnd: false,
      applyPaidSeats: true,
    });
    return true;
  }, [isSubscriptionActive, openConfirm, paidSeatsInput, periodEnd, t, toast]);

  const handleCancelSubscriptionRequest = React.useCallback(() => {
    if (!isSubscriptionActive) {
      toast.info(t('billing_status_inactive'));
      return false;
    }

    openConfirm({
      title: t('admin_company_cancel_subscription_confirm_title'),
      message: t('admin_company_cancel_subscription_confirm_message'),
      periodEnd: new Date(),
      periodEndIso: new Date().toISOString(),
      paidSeatsTotal: 0,
      applyPeriodEnd: true,
      applyPaidSeats: false,
    });
    return true;
  }, [isSubscriptionActive, openConfirm, t, toast]);

  if (guardLoading || !isAllowed) return <Screen background="background" />;

  return (
    <Screen background="background">
      <ScrollView
        contentContainerStyle={styles(theme).content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
          />
        }
      >
        {isLoading ? <Text style={styles(theme).muted}>{t('admin_loading')}</Text> : null}
        {error ? <Text style={styles(theme).error}>{String(error?.message || t('admin_unknown_error'))}</Text> : null}

        {data ? (
          <>
            <SectionHeader>{t('admin_company_about_title')}</SectionHeader>
            <Card paddedXOnly>
              <LabelValueRow label={t('admin_companies_name')} value={data.name || ''} />
              <View style={base.sep} />
              <LabelValueRow label={t('admin_company_created_at')} value={createdAt ? formatDateTime(createdAt, companyTimeZone) : ''} />
              <View style={base.sep} />
              <LabelValueRow label={t('admin_companies_employees')} value={String(employeesCount)} />
            </Card>

            <SectionHeader>{t('admin_company_subscription_licenses_title')}</SectionHeader>
            <Card paddedXOnly>
              <LabelValueRow
                label={t('admin_company_license')}
                valueComponent={(
                  <Text
                    style={[
                      styles(theme).statusValue,
                      { color: isSubscriptionActive ? theme.colors.success : theme.colors.danger },
                    ]}
                  >
                    {isSubscriptionActive ? t('admin_company_status_active') : t('admin_company_status_inactive')}
                  </Text>
                )}
              />
              <View style={base.sep} />
              <LabelValueRow
                label={t('admin_company_period_end')}
                value={periodEnd ? formatDateTime(periodEnd, companyTimeZone) : ''}
              />
              <View style={base.sep} />
              <LabelValueRow label={t('billing_paid_seats_total')} value={String(paidSeatsTotal)} />
              <View style={base.sep} />
              <LabelValueRow label={t('admin_company_used_seats')} value={String(usedSeats)} />
              <View style={base.sep} />
              <LabelValueRow label={t('billing_free_seats')} value={String(freeSeats)} />
              <View style={base.sep} />
              <LabelValueRow label={t('admin_company_blocked_by_license')} value={String(blockedByLicense)} />
            </Card>

            <SectionHeader>{t('admin_company_subscription_manage_title')}</SectionHeader>
            <Card paddedXOnly>
              <ActionRow
                label={t('admin_company_period_end')}
                value=""
                onPress={() => setDatePickerVisible(true)}
                disabled={mutation.isPending}
                theme={theme}
              />
              <View style={base.sep} />
              <ActionRow
                label={t('admin_company_add_days')}
                value=""
                onPress={() => {
                  setDaysInput('0');
                  setAddDaysVisible(true);
                }}
                disabled={mutation.isPending}
                theme={theme}
              />
              <View style={base.sep} />
              <ActionRow
                label={t('admin_company_paid_seats_total')}
                value=""
                onPress={() => {
                  setPaidSeatsInput(String(paidSeatsTotal));
                  setPaidSeatsVisible(true);
                }}
                disabled={mutation.isPending}
                theme={theme}
              />
              <View style={base.sep} />
              <ActionRow
                label={t('admin_company_cancel_subscription')}
                value=""
                onPress={() => {
                  handleCancelSubscriptionRequest();
                }}
                disabled={mutation.isPending}
                theme={theme}
              />
            </Card>
          </>
        ) : null}
      </ScrollView>

      <DateTimeModal
        visible={datePickerVisible}
        onClose={() => setDatePickerVisible(false)}
        mode="datetime"
        initial={periodEndPickerDate || new Date()}
        onApply={(d) => {
          setDatePickerVisible(false);
          handlePickDate(d);
        }}
        allowFutureDates={true}
        allowPastDates={true}
      />

      <BaseModal
        visible={addDaysVisible}
        onClose={() => setAddDaysVisible(false)}
        title={t('admin_company_add_days_modal_title')}
        footer={
          <View style={styles(theme).modalFooter}>
            <Pressable
              onPress={() => setAddDaysVisible(false)}
              style={styles(theme).modalGhostBtn}
            >
              <Text style={styles(theme).modalGhostBtnText}>{t('btn_cancel')}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                const canProceed = handleAddDaysRequest();
                if (canProceed) setAddDaysVisible(false);
              }}
              style={styles(theme).modalPrimaryBtn}
            >
              <Text style={styles(theme).modalPrimaryBtnText}>{t('btn_apply')}</Text>
            </Pressable>
          </View>
        }
      >
        <LabelValueRow
          label={t('admin_company_period_end_preview')}
          value={previewPeriodEnd ? formatDateTime(previewPeriodEnd, companyTimeZone) : ''}
        />
        <View style={base.sep} />
        <TextField
          label={t('admin_company_add_days')}
          value={daysInput}
          onChangeText={(v) => {
            const raw = String(v || '').replace(/[^\d-]/g, '');
            const normalized = raw.startsWith('-')
              ? `-${raw.slice(1).replace(/-/g, '')}`
              : raw.replace(/-/g, '');
            setDaysDelta(normalized === '-' ? 0 : normalized || 0);
          }}
          keyboardType="numbers-and-punctuation"
          placeholder={t('admin_company_add_days_placeholder')}
        />
        <View style={styles(theme).quickActions}>
          {[1, 7, 30, 365].map((step) => (
            <Pressable
              key={step}
              onPress={() => setDaysDelta(parsedDaysDelta + step)}
              style={({ pressed }) => [
                styles(theme).quickBtn,
                pressed ? { opacity: theme.components.listItem.disabledOpacity } : null,
              ]}
            >
              <Text style={styles(theme).quickBtnText}>{`+${step}`}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles(theme).quickActions}>
          {[1, 7, 30, 365].map((step) => (
            <Pressable
              key={`minus-${step}`}
              onPress={() => setDaysDelta(parsedDaysDelta - step)}
              style={({ pressed }) => [
                styles(theme).quickBtn,
                pressed ? { opacity: theme.components.listItem.disabledOpacity } : null,
              ]}
            >
              <Text style={styles(theme).quickBtnText}>{`-${step}`}</Text>
            </Pressable>
          ))}
        </View>
      </BaseModal>

      <BaseModal
        visible={paidSeatsVisible}
        onClose={() => setPaidSeatsVisible(false)}
        title={t('admin_company_paid_seats_modal_title')}
        footer={
          <View style={styles(theme).modalFooter}>
            <Pressable
              onPress={() => setPaidSeatsVisible(false)}
              style={styles(theme).modalGhostBtn}
            >
              <Text style={styles(theme).modalGhostBtnText}>{t('btn_cancel')}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                const canProceed = handleSavePaidSeatsRequest();
                if (canProceed) setPaidSeatsVisible(false);
              }}
              style={styles(theme).modalPrimaryBtn}
            >
              <Text style={styles(theme).modalPrimaryBtnText}>{t('btn_save')}</Text>
            </Pressable>
          </View>
        }
      >
        {!isSubscriptionActive ? (
          <Text style={styles(theme).muted}>{t('admin_company_paid_seats_zero_when_expired')}</Text>
        ) : null}
        <View style={styles(theme).counterWrap}>
          <Pressable
            onPress={() => {
              if (!isSubscriptionActive) return;
              setPaidSeatsInput((prev) => String(Math.max(1, toSafeInt(prev, paidSeatsTotal) - 1)));
            }}
            style={styles(theme).counterBtn}
          >
            <Text style={styles(theme).counterBtnText}>-</Text>
          </Pressable>
          <View style={styles(theme).counterValueWrap}>
            <TextField
              label={t('admin_company_paid_seats_total')}
              value={paidSeatsInput}
              onChangeText={(v) => {
                const raw = String(v || '').replace(/[^\d]/g, '');
                if (!isSubscriptionActive) {
                  setPaidSeatsInput('0');
                  return;
                }
                setPaidSeatsInput(raw || '1');
              }}
              keyboardType="numeric"
            />
          </View>
          <Pressable
            onPress={() => {
              if (!isSubscriptionActive) return;
              setPaidSeatsInput((prev) => String(toSafeInt(prev, paidSeatsTotal) + 1));
            }}
            style={styles(theme).counterBtn}
          >
            <Text style={styles(theme).counterBtnText}>+</Text>
          </Pressable>
        </View>
      </BaseModal>

      <ConfirmModal
        visible={confirmVisible}
        title={confirmState?.title || t('admin_company_confirm_default_title')}
        message={confirmState?.message || t('admin_company_confirm_default_message')}
        confirmLabel={t('btn_apply')}
        loading={mutation.isPending}
        onClose={() => setConfirmVisible(false)}
        onConfirm={async () => {
          if (!confirmState) return;
          await mutation.mutateAsync({
            periodEnd: confirmState.periodEnd,
            periodEndIso: confirmState.periodEndIso,
            paidSeatsTotal: confirmState.paidSeatsTotal,
            applyPeriodEnd: confirmState.applyPeriodEnd !== false,
            applyPaidSeats: confirmState.applyPaidSeats === true,
          });
        }}
      />
    </Screen>
  );
}

const styles = (theme) =>
  StyleSheet.create({
    content: {
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.components?.scrollView?.paddingBottom ?? theme.spacing.xl,
    },
    muted: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      marginTop: theme.spacing.sm,
    },
    error: {
      color: theme.colors.danger,
      fontSize: theme.typography.sizes.sm,
      marginTop: theme.spacing.sm,
    },
    statusValue: {
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
    },
    modalFooter: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    modalGhostBtn: {
      flex: 1,
      borderWidth: theme.components.card.borderWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.md,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: theme.components.row.minHeight,
      backgroundColor: theme.colors.surface,
    },
    modalGhostBtnText: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.medium,
    },
    modalPrimaryBtn: {
      flex: 1,
      borderRadius: theme.radii.md,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: theme.components.row.minHeight,
      backgroundColor: theme.colors.primary,
    },
    modalPrimaryBtnText: {
      color: theme.colors.onPrimary,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
    },
    quickActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.md,
      marginBottom: theme.spacing.sm,
    },
    quickBtn: {
      borderWidth: theme.components.card.borderWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.sm,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: theme.spacing.md,
      minHeight: theme.components.input.height * 0.72,
      alignItems: 'center',
      justifyContent: 'center',
    },
    quickBtnText: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.semibold,
    },
    counterWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
    },
    counterValueWrap: {
      flex: 1,
    },
    counterBtn: {
      width: theme.components.input.height,
      height: theme.components.input.height,
      borderRadius: theme.radii.md,
      borderWidth: theme.components.card.borderWidth,
      borderColor: theme.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surface,
    },
    counterBtnText: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.lg,
      fontWeight: theme.typography.weight.semibold,
    },
  });
