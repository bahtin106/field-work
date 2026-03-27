import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import Screen from '../../../components/layout/Screen';
import UIButton from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import TextField from '../../../components/ui/TextField';
import { useCompanyAccessState } from '../../../hooks/useCompanyAccessState';
import { useRequireSuperAdmin } from '../../../hooks/useRequireSuperAdmin';
import { isCompanyNameAvailable, normalizeCompanyName, validateCompanyName } from '../../../lib/companyName';
import { supabase } from '../../../lib/supabase';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

const EMPTY_DATE = '';

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

async function saveCompany(payload) {
  const { data, error } = await supabase.rpc('admin_update_company_super', payload);
  if (error) throw error;
  return data;
}

async function saveSubscription(payload) {
  const { data, error } = await supabase.rpc('admin_set_company_subscription_super', payload);
  if (error) throw error;
  return data;
}

function toDateInput(iso) {
  if (!iso) return EMPTY_DATE;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY_DATE;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeDateInput(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  return `${v}T23:59:59Z`;
}

function parseNonNegativeInt(raw, fallback = 0) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

export default function AdminCompanyEditScreen() {
  const { companyId: companyIdParam, id: idParam } = useLocalSearchParams();
  const companyIdRaw = companyIdParam ?? idParam;
  const companyId = Array.isArray(companyIdRaw) ? companyIdRaw[0] : companyIdRaw;
  const { theme } = useTheme();
  const { t } = useTranslation();
  const nav = useNavigation();
  const queryClient = useQueryClient();
  const { isAllowed, isLoading: guardLoading } = useRequireSuperAdmin();

  const [name, setName] = React.useState('');
  const [timezone, setTimezone] = React.useState('');
  const [currency, setCurrency] = React.useState('');
  const [periodEndDate, setPeriodEndDate] = React.useState(EMPTY_DATE);
  const [extraSeats, setExtraSeats] = React.useState('0');
  const [initialExtraSeats, setInitialExtraSeats] = React.useState('0');

  const { data, isLoading, error } = useQuery({
    queryKey: ['adminCompany', companyId],
    queryFn: () => fetchCompany(companyId),
    enabled: isAllowed && Boolean(companyId),
  });

  const { data: meta } = useQuery({
    queryKey: ['adminCompanySubscriptionMeta', companyId],
    queryFn: () => fetchSubscriptionMeta(companyId),
    enabled: isAllowed && Boolean(companyId),
  });
  const accessState = useCompanyAccessState(companyId);
  const access = accessState.data;

  React.useEffect(() => {
    if (!data) return;
    setName(data.name || '');
    setTimezone(data.timezone || '');
    setCurrency(data.currency || '');
    const extraSeatsValue = String(data.extra_seats ?? 0);
    setExtraSeats(extraSeatsValue);
    setInitialExtraSeats(extraSeatsValue);
  }, [data]);

  React.useEffect(() => {
    if (!meta) return;
    setPeriodEndDate(toDateInput(meta.current_period_end));
  }, [meta]);

  React.useLayoutEffect(() => {
    nav.setParams({ headerTitle: t('routes.admin/companies/edit') });
  }, [nav, t]);

  const companyMutation = useMutation({
    mutationFn: async () => {
      const normalizedName = normalizeCompanyName(name);
      const nameError = validateCompanyName(normalizedName, t);
      if (nameError) throw new Error(nameError);
      const isAvailable = await isCompanyNameAvailable(normalizedName, companyId);
      if (!isAvailable) throw new Error(t('errors_companyName_duplicate'));
      return saveCompany({
        p_company_id: companyId,
        p_name: normalizedName,
        p_timezone: timezone || null,
        p_currency: currency || null,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['adminCompany', companyId] }),
        queryClient.invalidateQueries({ queryKey: ['adminCompanies'] }),
      ]);
    },
  });

  const subscriptionMutation = useMutation({
    mutationFn: () => {
      const p_period_end = normalizeDateInput(periodEndDate);
      const computedStatus = p_period_end && new Date(p_period_end).getTime() > Date.now() ? 'active' : 'expired';
      const parsedExtraSeats = parseNonNegativeInt(extraSeats, 0);
      const parsedInitialExtraSeats = parseNonNegativeInt(initialExtraSeats, 0);
      const p_extra_seats =
        parsedExtraSeats === parsedInitialExtraSeats ? null : parsedExtraSeats;
      return saveSubscription({
        p_company_id: companyId,
        p_status: computedStatus,
        p_period_end,
        p_extra_seats,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['adminCompany', companyId] }),
        queryClient.invalidateQueries({ queryKey: ['adminCompanySubscriptionMeta', companyId] }),
        queryClient.invalidateQueries({ queryKey: ['adminCompanies'] }),
        queryClient.invalidateQueries({ queryKey: ['companyAccessState', companyId] }),
      ]);
    },
  });

  if (guardLoading || !isAllowed) return <Screen background="background" />;

  const effectiveStatus = meta?.subscription_status || data?.subscription_status || 'expired';
  const statusLabel = effectiveStatus === 'active' ? t('billing_status_active') : t('billing_status_expired');
  const isSaving = companyMutation.isPending || subscriptionMutation.isPending;

  const totalEmployees = Number(data?.employees_count ?? access?.members?.length ?? 0);
  const usedSeats = Number(access?.used_seats ?? 0);
  const allowedSeats = Number(access?.paid_seats_total ?? (1 + parseNonNegativeInt(extraSeats, 0)));
  const freeSeats = Math.max(0, allowedSeats - usedSeats);
  const overLimitBy = Math.max(0, totalEmployees - allowedSeats);
  const canAddMembers = freeSeats > 0;
  const members = Array.isArray(access?.members) ? access.members : [];
  const blockedByLicense = members.filter((m) => m.license_state === 'blocked_by_license').length;
  const blockedByAdmin = members.filter((m) => m.admin_blocked).length;

  return (
    <Screen background="background">
      <ScrollView contentContainerStyle={styles(theme).content}>
        {isLoading ? <Text style={styles(theme).muted}>{t('admin_loading')}</Text> : null}
        {error ? <Text style={styles(theme).error}>{String(error?.message || t('admin_unknown_error'))}</Text> : null}

        <Card style={styles(theme).card}>
          <Text style={styles(theme).sectionTitle}>{t('admin_company_section_company')}</Text>
          <TextField label={t('admin_companies_name')} value={name} onChangeText={setName} />
          <TextField label={t('admin_companies_timezone')} value={timezone} onChangeText={setTimezone} />
          <TextField label={t('admin_companies_currency')} value={currency} onChangeText={setCurrency} />
          {companyMutation.error ? (
            <Text style={styles(theme).error}>{String(companyMutation.error?.message || t('admin_unknown_error'))}</Text>
          ) : null}
          <UIButton title={t('admin_save_company')} onPress={() => companyMutation.mutate()} disabled={isSaving || !companyId} />
        </Card>

        <Card style={styles(theme).card}>
          <Text style={styles(theme).sectionTitle}>{t('admin_company_subscription_title')}</Text>
          <Text style={styles(theme).line}>{t('label_status')}: {statusLabel}</Text>
          <TextField
            label={t('admin_company_period_end')}
            value={periodEndDate}
            onChangeText={setPeriodEndDate}
            placeholder={t('admin_company_period_end_placeholder')}
          />
          <TextField
            label={t('admin_company_extra_seats')}
            value={extraSeats}
            onChangeText={setExtraSeats}
            keyboardType="numeric"
          />
          {subscriptionMutation.error ? (
            <Text style={styles(theme).error}>{String(subscriptionMutation.error?.message || t('admin_unknown_error'))}</Text>
          ) : null}
          <UIButton title={t('admin_save_subscription')} onPress={() => subscriptionMutation.mutate()} disabled={isSaving || !companyId} />
        </Card>

        <Card style={styles(theme).card}>
          <Text style={styles(theme).sectionTitle}>{t('admin_company_seat_state_title')}</Text>
          <Text style={styles(theme).line}>{t('admin_company_total_employees')}: {totalEmployees}</Text>
          <Text style={styles(theme).line}>{t('admin_company_allowed_seats')}: {allowedSeats}</Text>
          <Text style={styles(theme).line}>{t('admin_company_used_seats')}: {usedSeats}</Text>
          <Text style={styles(theme).line}>{t('billing_free_seats')}: {freeSeats}</Text>
          <Text style={styles(theme).line}>{t('admin_company_blocked_by_license')}: {blockedByLicense}</Text>
          <Text style={styles(theme).line}>{t('admin_company_blocked_by_admin')}: {blockedByAdmin}</Text>
          <Text style={[styles(theme).line, overLimitBy > 0 ? styles(theme).danger : null]}>
            {t('admin_company_over_limit_by')}: {overLimitBy}
          </Text>
          <Text style={[styles(theme).line, canAddMembers ? styles(theme).ok : styles(theme).warning]}>
            {canAddMembers ? t('admin_company_can_add_members_yes') : t('admin_company_can_add_members_no')}
          </Text>
          {overLimitBy > 0 ? (
            <Text style={styles(theme).warning}>
              {t('admin_company_license_warning')} {overLimitBy}
            </Text>
          ) : null}
        </Card>

      </ScrollView>
    </Screen>
  );
}

const styles = (theme) =>
  StyleSheet.create({
    content: {
      padding: theme.spacing.lg,
      gap: theme.spacing.md,
    },
    card: {
      borderRadius: theme.radii.md,
      borderWidth: theme.components.card.borderWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      gap: theme.spacing.sm,
    },
    sectionTitle: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.bold,
    },
    line: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
    },
    hint: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
    muted: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
    error: {
      color: theme.colors.danger,
      fontSize: theme.typography.sizes.sm,
    },
    warning: {
      color: '#9A5A00',
      fontWeight: theme.typography.weight.semibold,
    },
    ok: {
      color: '#1E7A3C',
      fontWeight: theme.typography.weight.semibold,
    },
    danger: {
      color: theme.colors.danger,
      fontWeight: theme.typography.weight.semibold,
    },
  });
