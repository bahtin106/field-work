import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import Screen from '../../components/layout/Screen';
import Card from '../../components/ui/Card';
import LabelValueRow from '../../components/ui/LabelValueRow';
import Button from '../../components/ui/Button';
import {
  ThemedRefreshControl,
  useManagedRefresh,
  usePullToRefreshFeedback,
} from '../../components/ui/PullToRefreshFeedback';
import SectionHeader from '../../components/ui/SectionHeader';
import BaseModal from '../../components/ui/modals/BaseModal';
import SelectModal from '../../components/ui/modals/SelectModal';
import { ConfirmModal } from '../../components/ui/modals';
import SearchFiltersBar from '../../components/filters/SearchFiltersBar';
import SortSelectModal from '../../components/filters/SortSelectModal';
import FiltersPanel from '../../components/filters/FiltersPanel';
import { useFilters } from '../../components/hooks/useFilters';
import { useToast } from '../../components/ui/ToastProvider';
import { useTheme } from '../../theme/ThemeProvider';
import { withAlpha } from '../../theme/colors';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useI18nVersion } from '../../src/i18n';
import { ROLE } from '../../constants/roles';
import { useAuthContext } from '../../providers/SimpleAuthProvider';
import { useCompanyEntitlements } from '../../hooks/useCompanyEntitlements';
import { useCompanyStorageUsage } from '../../hooks/useCompanyStorageUsage';
import { useCompanyAccessState } from '../../hooks/useCompanyAccessState';
import { useCompanySettings } from '../../hooks/useCompanySettings';
import { supabase } from '../../lib/supabase';
import { STORAGE_LIMITS } from '../../lib/constants';
import { listItemStyles } from '../../components/ui/listItemStyles';
import { useDepartmentsQuery, useEmployees } from '../../src/features/employees/queries';
import { joinFilterSummary, summarizeFilterPart } from '../../src/shared/filters/summary';
import { useScreenRefreshRegistration } from '../../src/shared/query/screenRefreshRegistry';
import { buildSearchIndex, matchesSearch } from '../../src/shared/search/matching';
import { TBL } from '../../lib/constants';
import { EMPLOYEE_SORT, employeeSortOptions, sortEmployees } from '../../src/shared/sorting/employeeSort';

const BILLING_PROFILE_FALLBACK_STALE_MS = 60 * 1000;
const BILLING_MEMBER_STATS_STALE_MS = 10 * 1000;
const { width: WINDOW_WIDTH } = Dimensions.get('window');

function StatusBadge({ theme, color, label }) {
  return (
    <View style={[styles(theme).badge, { borderColor: color }]}>
      <Text style={[styles(theme).badgeText, { color }]}>{label}</Text>
    </View>
  );
}

function roleOptions(t) {
  return [
    { value: ROLE.ADMIN, label: t('role_admin', ROLE.ADMIN) },
    { value: ROLE.DISPATCHER, label: t('role_dispatcher', ROLE.DISPATCHER) },
    { value: ROLE.WORKER, label: t('role_worker', ROLE.WORKER) },
  ];
}

function txt(v) {
  return String(v || '').trim().toLowerCase();
}

function asBool(value) {
  if (value === true || value === 1 || value === '1' || value === 'true' || value === 't') return true;
  if (value === false || value === 0 || value === '0' || value === 'false' || value === 'f' || value == null) return false;
  return Boolean(value);
}

function asIntOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
}

function diffPreciseDays(targetDate, now = new Date()) {
  if (!(targetDate instanceof Date) || Number.isNaN(targetDate.getTime())) return 0;
  return Math.max(0, Math.ceil((targetDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
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

function getTimeZoneOffsetMinutes(date, timeZone) {
  try {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return 0;
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

function formatPeriodEndLabel(date, timeZone) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const safeZone = normalizeTimeZone(timeZone);
  const locale = Intl.DateTimeFormat?.().resolvedOptions?.().locale;
  const datePart = new Intl.DateTimeFormat(locale, {
    timeZone: safeZone,
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
  const timePart = new Intl.DateTimeFormat(locale, {
    timeZone: safeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return `${datePart} ${String(locale || '').toLowerCase().startsWith('en') ? 'at' : 'в'} ${timePart} (${formatUtcOffset(getTimeZoneOffsetMinutes(date, safeZone))})`;
}

function formatRuUnit(value, forms) {
  const abs = Math.abs(Math.trunc(value));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function formatRemainingLabel(targetDate, now = new Date(), locale) {
  if (!(targetDate instanceof Date) || Number.isNaN(targetDate.getTime())) return '';
  const diffMs = targetDate.getTime() - now.getTime();
  if (diffMs <= 0) {
    return String(locale || '').toLowerCase().startsWith('en') ? 'Expired' : 'Истекла';
  }

  const totalMinutes = Math.ceil(diffMs / (60 * 1000));
  const totalHours = Math.ceil(diffMs / (60 * 60 * 1000));
  const totalDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  const isEn = String(locale || '').toLowerCase().startsWith('en');

  if (totalMinutes < 60) {
    if (isEn) return `${totalMinutes} min left`;
    return `Осталось ${totalMinutes} ${formatRuUnit(totalMinutes, ['минута', 'минуты', 'минут'])}`;
  }

  if (totalHours < 24) {
    if (isEn) return `${totalHours} h left`;
    return `Осталось ${totalHours} ${formatRuUnit(totalHours, ['час', 'часа', 'часов'])}`;
  }

  if (isEn) return `${totalDays} days left`;
  return `Осталось ${totalDays} ${formatRuUnit(totalDays, ['день', 'дня', 'дней'])}`;
}

function _formatStorage(valueBytes) {
  const bytes = Number(valueBytes || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const gb = 1024 * 1024 * 1024;
  const mb = 1024 * 1024;
  if (bytes >= gb) return `${(bytes / gb).toFixed(2)} GB`;
  if (bytes >= mb) return `${(bytes / mb).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export default function BillingScreen() {
  const nav = useNavigation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { theme } = useTheme();
  const toast = useToast();
  const { t } = useTranslation();
  const ver = useI18nVersion();
  const { profile } = useAuthContext();

  const profileCompanyId = profile?.company_id || null;
  const profileRole = String(profile?.role || '').toLowerCase();
  const currentUserId = profile?.id || profile?.user_id || null;

  const { data: profileFallback } = useQuery({
    queryKey: ['billingProfileFallback'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return null;
      const { data: p, error: pErr } = await supabase
        .from('profiles')
        .select('id, company_id, role')
        .eq('id', user.id)
        .maybeSingle();
      if (pErr) throw pErr;
      return p || null;
    },
    staleTime: BILLING_PROFILE_FALLBACK_STALE_MS,
  });
  const profileFallbackRole = String(profileFallback?.role || '').toLowerCase();

  const companyId = profileCompanyId || profileFallback?.company_id || null;
  const authUserId = profileFallback?.id || null;
  const normalizedCurrentUserId = String(currentUserId || authUserId || '').trim();
  const { data: entitlements, isLoading, error, refresh } = useCompanyEntitlements(companyId);
  const { settings: companySettings, useDepartments } = useCompanySettings(companyId || null);
  const {
    data: storageUsage,
    isLoading: storageLoading,
    isFetching: storageFetching,
    error: storageError,
    refresh: refreshStorageUsage,
  } = useCompanyStorageUsage(companyId);
  const resolvedRole = profileRole || profileFallbackRole;
  const isRoleResolved = Boolean(resolvedRole);
  const isAdmin = resolvedRole === 'admin';
  const isOwner = entitlements?.is_owner === true || isAdmin;

  const accessState = useCompanyAccessState(isOwner ? companyId : null);
  const access = accessState.data || null;
  const { data: paidSeatsRpc, refetch: refetchPaidSeatsRpc } = useQuery({
    queryKey: ['companyPaidSeatsTotal', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data: rpcData, error: rpcError } = await supabase.rpc('company_paid_seats_total', {
        p_company_id: companyId,
      });
      if (rpcError) throw rpcError;
      return asIntOrNull(Array.isArray(rpcData) ? rpcData?.[0] : rpcData) ?? 0;
    },
    staleTime: 60 * 1000,
    refetchOnMount: 'stale',
    refetchOnReconnect: true,
  });

  const { data: memberStatsFallback } = useQuery({
    queryKey: ['billingMemberStats', companyId],
    enabled: isOwner && !!companyId,
    queryFn: async () => {
      const { data, error: qErr } = await supabase.from('profiles').select('id, license_state').eq('company_id', companyId);
      if (qErr) throw qErr;
      const rows = Array.isArray(data) ? data : [];
      return {
        totalEmployees: rows.length,
        blockedByLicenseCount: rows.filter((r) => r.license_state === 'blocked_by_license').length,
      };
    },
    staleTime: BILLING_MEMBER_STATS_STALE_MS,
  });

  const manageFilters = useFilters({
    screenKey: `billing_license_manage_${companyId || 'none'}`,
    defaults: { departments: [], roles: [], suspended: null },
  });
  const revalidateManageFilters = manageFilters.revalidate;

  useFocusEffect(
    React.useCallback(() => {
      revalidateManageFilters({ extend: true });
    }, [revalidateManageFilters]),
  );

  const { data: departments = [] } = useDepartmentsQuery({
    companyId,
    onlyEnabled: true,
    enabled: isOwner && !!companyId && useDepartments,
  });
  const { data: employees = [] } = useEmployees(manageFilters.values, { enabled: isOwner && !!companyId });

  const members = React.useMemo(() => access?.members || [], [access?.members]);
  const [manageVisible, setManageVisible] = React.useState(false);
  const [manageSearch, setManageSearch] = React.useState('');
  const [manageSelection, setManageSelection] = React.useState(() => new Set());
  const [initialSelection, setInitialSelection] = React.useState(() => new Set());
  const [manageSortVisible, setManageSortVisible] = React.useState(false);
  const [manageSortKey, setManageSortKey] = React.useState(EMPLOYEE_SORT.NAME_ASC);
  const [savingChanges, setSavingChanges] = React.useState(false);
  const [screenError, setScreenError] = React.useState('');
  const [, setManageError] = React.useState('');
  const [confirmApplyVisible, setConfirmApplyVisible] = React.useState(false);
  const [orderConflictsVisible, setOrderConflictsVisible] = React.useState(false);
  const [orderConflicts, setOrderConflicts] = React.useState([]);
  const [selectUserForReassign, setSelectUserForReassign] = React.useState(null);
  const [bulkSuccessorModalVisible, setBulkSuccessorModalVisible] = React.useState(false);
  const [licensesExpanded, setLicensesExpanded] = React.useState(false);
  const [storageExpanded, setStorageExpanded] = React.useState(false);
  const [restoreManageAfterFilters, setRestoreManageAfterFilters] = React.useState(false);
  const manageInitDoneRef = React.useRef(false);
  const [manageModalToast, setManageModalToast] = React.useState(null);
  const manageToastAutoHideRef = React.useRef(null);
  const manageToastClearRef = React.useRef(null);
  const manageToastTy = useSharedValue(20);
  const manageToastOp = useSharedValue(0);
  const manageToastAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: manageToastTy.value }],
    opacity: manageToastOp.value,
  }));

  const isMemberLicenseActive = React.useCallback((member) => {
    if (member?.role === ROLE.ADMIN) return true;
    if (member?.admin_blocked) return false;
    return member?.license_state !== 'blocked_by_license';
  }, []);

  const mergedMembers = React.useMemo(() => {
    const byProfile = new Map();
    employees.forEach((e) => byProfile.set(e.id, e));
    const byAccess = new Map();
    members.forEach((m) => byAccess.set(m.user_id, m));
    const ids = new Set([...byProfile.keys(), ...byAccess.keys()]);

    const rows = [];
    ids.forEach((id) => {
      const p = byProfile.get(id) || null;
      const a = byAccess.get(id) || null;
      rows.push({
        user_id: id,
        name: a?.name || p?.display_name || p?.full_name || p?.email || String(id),
        role: String(a?.role || p?.role || ROLE.WORKER).toLowerCase(),
        department_id: p?.department_id || null,
        last_seen_at: p?.last_seen_at || a?.last_seen_at || null,
        admin_blocked: asBool(a?.admin_blocked) || asBool(p?.is_admin_blocked) || asBool(p?.is_suspended),
        license_state: a?.license_state || p?.license_state || 'active',
        has_seat: asBool(a?.has_seat),
      });
    });

    rows.sort((x, y) => String(x.name || '').localeCompare(String(y.name || ''), 'ru'));
    return rows;
  }, [employees, members]);

  React.useEffect(() => {
    if (!isRoleResolved) return;
    if (isAdmin) return;
    router.replace('/orders');
  }, [isAdmin, isRoleResolved, router]);

  React.useEffect(() => {
    if (!manageVisible) {
      manageInitDoneRef.current = false;
      return;
    }
    if (manageInitDoneRef.current) return;

    setManageSortKey(EMPLOYEE_SORT.NAME_ASC);
    const init = new Set(
      mergedMembers
        .filter((m) => isMemberLicenseActive(m))
        .map((m) => m.user_id),
    );
    setManageSelection(init);
    setInitialSelection(init);
    setManageSearch('');
    setManageError('');
    manageInitDoneRef.current = true;
  }, [isMemberLicenseActive, manageVisible, mergedMembers]);

  React.useLayoutEffect(() => {
    try {
      nav.setParams({ headerTitle: t('routes.billing/index') || t('routes.billing') || 'billing' });
    } catch {}
  }, [nav, ver, t]);

  React.useEffect(() => {
    const defaultOffset = theme.components?.toast?.anchorOffset ?? 120;
    const modalOffset = theme.components?.toast?.anchorOffsetModal ?? 420;
    const hasForegroundModal =
      manageVisible ||
      orderConflictsVisible ||
      !!selectUserForReassign ||
      bulkSuccessorModalVisible ||
      confirmApplyVisible ||
      manageFilters.visible;

    try {
      toast.setAnchorOffset(hasForegroundModal ? modalOffset : defaultOffset);
    } catch {}

    return () => {
      try {
        toast.setAnchorOffset(defaultOffset);
      } catch {}
    };
  }, [
    bulkSuccessorModalVisible,
    confirmApplyVisible,
    manageFilters.visible,
    manageVisible,
    orderConflictsVisible,
    selectUserForReassign,
    theme.components?.toast?.anchorOffset,
    theme.components?.toast?.anchorOffsetModal,
    toast,
  ]);

  const accessPaidSeats = asIntOrNull(access?.paid_seats_total);
  const entitlementsPaidSeats = asIntOrNull(entitlements?.allowed_seats);
  const paidSeatsTotal = Math.max(accessPaidSeats ?? 0, entitlementsPaidSeats ?? 0, asIntOrNull(paidSeatsRpc) ?? 0);
  const usedSeatsTotal = asIntOrNull(access?.used_seats) ?? asIntOrNull(entitlements?.used_seats) ?? 0;
  const freeSeatsFromAccess = asIntOrNull(access?.free_seats);
  const freeSeatsTotal = freeSeatsFromAccess ?? Math.max(0, paidSeatsTotal - usedSeatsTotal);
  const totalEmployees = mergedMembers.length || Number(memberStatsFallback?.totalEmployees || 0);
  const blockedByLicenseCount = mergedMembers.filter((m) => m.license_state === 'blocked_by_license').length || Number(memberStatsFallback?.blockedByLicenseCount || 0);
  const hasStorageUsage = !!storageUsage && typeof storageUsage === 'object';
  const storageLimitBytes = Number(storageUsage?.limit_bytes || STORAGE_LIMITS.COMPANY_TOTAL_BYTES);
  const usedStorageBytes = Number(storageUsage?.total_bytes ?? 0);
  const dataStorageBytes = Number(storageUsage?.data_bytes ?? 0);
  const mediaStorageBytes = Number(storageUsage?.media_bytes ?? 0);
  const mediaOrdersBytes = Number(storageUsage?.media_orders_bytes ?? 0);
  const combinedMediaBytes = Math.max(0, mediaStorageBytes + mediaOrdersBytes);
  const storageUsedPercent = Math.max(
    0,
    Math.min(
      100,
      Number(
        storageUsage?.used_percent != null
          ? storageUsage.used_percent
          : storageLimitBytes > 0
            ? (usedStorageBytes / storageLimitBytes) * 100
            : 0,
      ) || 0,
    ),
  );
  const storageProgress = Math.max(0, Math.min(1, storageUsedPercent / 100));
  const storageLeftBytes = Math.max(storageLimitBytes - usedStorageBytes, 0);
  const storageTone = storageUsedPercent >= 95
    ? theme.colors.danger
    : storageUsedPercent >= 80
      ? (theme.colors.warningStrong || theme.colors.warning)
      : theme.colors.success;

  const freeSeatsColor = freeSeatsTotal > 0 ? theme.colors.success : theme.colors.danger;
  const blockedByLicenseColor = blockedByLicenseCount === 0 ? theme.colors.success : theme.colors.danger;
  const base = React.useMemo(() => listItemStyles(theme), [theme]);

  const accessRefresh = accessState.refresh;
  const refreshAll = React.useCallback(async () => {
    await Promise.all([
      refresh(),
      refreshStorageUsage?.(),
      accessRefresh?.(),
      refetchPaidSeatsRpc?.(),
      queryClient.invalidateQueries({ queryKey: ['companyEntitlements', companyId] }),
      queryClient.invalidateQueries({ queryKey: ['companyStorageUsage', companyId] }),
      queryClient.invalidateQueries({ queryKey: ['companyAccessState', companyId] }),
      queryClient.invalidateQueries({ queryKey: ['companyPaidSeatsTotal', companyId] }),
      queryClient.invalidateQueries({ queryKey: ['billingMemberStats', companyId] }),
      queryClient.invalidateQueries({ queryKey: ['employees'] }),
      queryClient.refetchQueries({ queryKey: ['companyEntitlements', companyId], exact: true, type: 'active' }),
      queryClient.refetchQueries({ queryKey: ['companyStorageUsage', companyId], exact: true, type: 'active' }),
      queryClient.refetchQueries({ queryKey: ['companyAccessState', companyId], exact: true, type: 'active' }),
      queryClient.refetchQueries({ queryKey: ['companyPaidSeatsTotal', companyId], exact: true, type: 'active' }),
      queryClient.refetchQueries({ queryKey: ['billingMemberStats', companyId], exact: true, type: 'active' }),
    ]);
  }, [accessRefresh, companyId, queryClient, refetchPaidSeatsRpc, refresh, refreshStorageUsage]);

  useScreenRefreshRegistration('billing.screen', () => refreshAll(), !!companyId);

  const refreshWithMinDelay = React.useCallback(async () => {
    const startedAt = Date.now();
    await refreshAll();
    const elapsed = Date.now() - startedAt;
    const minSpinnerMs = 450;
    if (elapsed < minSpinnerMs) {
      await new Promise((resolve) => setTimeout(resolve, minSpinnerMs - elapsed));
    }
  }, [refreshAll]);
  const { refreshing, didSucceed, onRefresh } = useManagedRefresh(refreshWithMinDelay);
  const { indicator: refreshIndicator } = usePullToRefreshFeedback(refreshing, { didSucceed });

  const filteredManageMembers = React.useMemo(() => {
    const q = txt(manageSearch);
    return mergedMembers.filter((m) => {
      if (q) {
        if (
          !matchesSearch(
            buildSearchIndex({
              texts: [m?.name, m?.role, t(`role_${m?.role}`, m?.role), m?.license_state],
              phones: [m?.phone, m?.mobile_phone],
            }),
            q,
          )
        ) {
          return false;
        }
      }
      const deps = useDepartments && Array.isArray(manageFilters.values.departments)
        ? manageFilters.values.departments.map(String)
        : [];
      if (useDepartments && deps.length > 0) {
        const current = m.department_id != null ? String(m.department_id) : null;
        if (!current || !deps.includes(current)) return false;
      }
      const roles = Array.isArray(manageFilters.values.roles) ? manageFilters.values.roles : [];
      if (roles.length > 0 && !roles.includes(m.role)) return false;
      if (manageFilters.values.suspended === true && !m.admin_blocked) return false;
      if (manageFilters.values.suspended === false && m.admin_blocked) return false;
      return true;
    });
  }, [
    manageFilters.values.departments,
    manageFilters.values.roles,
    manageFilters.values.suspended,
    manageSearch,
    mergedMembers,
    t,
    useDepartments,
  ]);

  React.useEffect(() => {
    if (!useDepartments && Array.isArray(manageFilters.values.departments) && manageFilters.values.departments.length) {
      manageFilters.setValue('departments', []);
    }
  }, [manageFilters, useDepartments]);

  const departmentNameById = React.useMemo(() => {
    const map = new Map();
    (departments || []).forEach((d) => map.set(String(d.id), d.name));
    return map;
  }, [departments]);

  const manageSortOptions = React.useMemo(() => employeeSortOptions(t), [t]);

  const sortedManageMembers = React.useMemo(
    () =>
      sortEmployees(filteredManageMembers, {
        sortKey: manageSortKey,
        getName: (m) => m?.name || '',
        getDepartmentName: (m) => {
          if (!useDepartments) return '';
          if (m?.department_id == null) return t('placeholder_department');
          return departmentNameById.get(String(m.department_id)) || t('placeholder_department');
        },
        getRoleLabel: (m) => t(`role_${m?.role || ROLE.WORKER}`, m?.role || ROLE.WORKER),
        getLastSeenAt: (m) => m?.last_seen_at || null,
      }),
    [departmentNameById, filteredManageMembers, manageSortKey, t, useDepartments],
  );

  const getDiff = React.useCallback(() => {
    const toAssign = [];
    const toRevoke = [];
    manageSelection.forEach((id) => { if (!initialSelection.has(id)) toAssign.push(id); });
    initialSelection.forEach((id) => { if (!manageSelection.has(id)) toRevoke.push(id); });
    const protectedAdminIds = new Set(mergedMembers.filter((m) => m.role === ROLE.ADMIN).map((m) => m.user_id));
    return {
      toAssign,
      toRevoke: toRevoke.filter((id) => !protectedAdminIds.has(id)),
      blockedAdmins: toRevoke.filter((id) => protectedAdminIds.has(id)),
    };
  }, [initialSelection, manageSelection, mergedMembers]);

  const hasChanges = React.useMemo(() => {
    if (manageSelection.size !== initialSelection.size) return true;
    for (const id of manageSelection) if (!initialSelection.has(id)) return true;
    return false;
  }, [initialSelection, manageSelection]);
  const currentActiveCount = React.useMemo(
    () => mergedMembers.filter((m) => isMemberLicenseActive(m)).length,
    [isMemberLicenseActive, mergedMembers],
  );
  const displayedSelectedCount = hasChanges ? manageSelection.size : currentActiveCount;

  const handleRpcError = React.useCallback((rawErr) => {
    const msg = String(rawErr?.message || t('billing_unknown_error'));
    if (/no free paid seats|seat limit exceeded/i.test(msg)) return t('billing_no_free_seats');
    if (/license admin access required|42501|access denied/i.test(msg)) return t('billing_no_permissions');
    return msg;
  }, [t]);

  const closeManageModal = React.useCallback(() => {
    if (savingChanges) return;
    setScreenError('');
    setManageError('');
    manageInitDoneRef.current = false;
    setManageModalToast(null);
    if (manageToastAutoHideRef.current) clearTimeout(manageToastAutoHideRef.current);
    if (manageToastClearRef.current) clearTimeout(manageToastClearRef.current);
    manageToastAutoHideRef.current = null;
    manageToastClearRef.current = null;
    setManageVisible(false);
  }, [savingChanges]);

  React.useEffect(() => () => {
    if (manageToastAutoHideRef.current) clearTimeout(manageToastAutoHideRef.current);
    if (manageToastClearRef.current) clearTimeout(manageToastClearRef.current);
    manageToastAutoHideRef.current = null;
    manageToastClearRef.current = null;
  }, []);

  const hideManageModalToast = React.useCallback(() => {
    if (manageToastAutoHideRef.current) {
      clearTimeout(manageToastAutoHideRef.current);
      manageToastAutoHideRef.current = null;
    }
    manageToastTy.value = withTiming(20, { duration: 200, easing: Easing.in(Easing.quad) });
    manageToastOp.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.quad) });
    if (manageToastClearRef.current) clearTimeout(manageToastClearRef.current);
    manageToastClearRef.current = setTimeout(() => {
      setManageModalToast(null);
      manageToastClearRef.current = null;
    }, 220);
  }, [manageToastOp, manageToastTy]);

  const showManageModalToast = React.useCallback((text, type = 'warning') => {
    if (!text) return;
    setManageModalToast({ text: String(text), type });
    if (manageToastClearRef.current) {
      clearTimeout(manageToastClearRef.current);
      manageToastClearRef.current = null;
    }
    manageToastTy.value = 20;
    manageToastOp.value = 0;
    manageToastTy.value = withSpring(0, { mass: 0.7, damping: 16, stiffness: 180 });
    manageToastOp.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) });
    if (manageToastAutoHideRef.current) clearTimeout(manageToastAutoHideRef.current);
    manageToastAutoHideRef.current = setTimeout(() => {
      hideManageModalToast();
    }, 1800);
  }, [hideManageModalToast, manageToastOp, manageToastTy]);

  const openManageFilters = React.useCallback(() => {
    if (savingChanges) return;
    setRestoreManageAfterFilters(true);
    setManageVisible(false);
    manageFilters.open();
  }, [manageFilters, savingChanges]);

  const closeManageFilters = React.useCallback(() => {
    manageFilters.close();
    if (restoreManageAfterFilters) {
      setManageVisible(true);
      setRestoreManageAfterFilters(false);
    }
  }, [manageFilters, restoreManageAfterFilters]);

  const applyManageFilters = React.useCallback(async (nextValues) => {
    await manageFilters.apply(nextValues);
    if (restoreManageAfterFilters) {
      setManageVisible(true);
      setRestoreManageAfterFilters(false);
    }
  }, [manageFilters, restoreManageAfterFilters]);

  const toggleMember = React.useCallback((member) => {
    const memberId = String(member?.user_id || '').trim();
    if (normalizedCurrentUserId && memberId === normalizedCurrentUserId) {
      showManageModalToast(t('billing_manage_self_protected'), 'warning');
      return;
    }
    if (member.role === ROLE.ADMIN) {
      showManageModalToast(t('billing_manage_admin_protected'), 'warning');
      return;
    }
    setManageSelection((prev) => {
      const next = new Set(prev);
      if (next.has(member.user_id)) next.delete(member.user_id); else next.add(member.user_id);
      return next;
    });
    setManageError('');
  }, [normalizedCurrentUserId, showManageModalToast, t]);

  const fetchOrderConflicts = React.useCallback(async (toRevokeIds) => {
    const conflicts = [];
    for (const userId of toRevokeIds) {
      const { data, error: rpcError } = await supabase.rpc('check_employee_orders', { employee_id: userId });
      if (rpcError) throw rpcError;
      const activeOrdersCount = Number(data?.activeOrdersCount || 0);
      if (activeOrdersCount <= 0) continue;
      const member = mergedMembers.find((m) => m.user_id === userId);
      conflicts.push({
        userId,
        name: member?.name || String(userId),
        activeOrdersCount,
        availableEmployees: Array.isArray(data?.availableEmployees) ? data.availableEmployees : [],
        action: 'keep',
        successorId: null,
      });
    }
    return conflicts;
  }, [mergedMembers]);

  const askApplyChanges = React.useCallback(async () => {
    const selectedCount = manageSelection.size;
    if (selectedCount > paidSeatsTotal) {
      const msg = t('billing_manage_over_limit_error');
      showManageModalToast(msg, 'error');
      return;
    }
    setManageError('');

    const diff = getDiff();
    if (!diff.toAssign.length && !diff.toRevoke.length) {
      toast.info(t('billing_manage_nothing_to_apply'));
      return;
    }

    try {
      setSavingChanges(true);
      setScreenError('');
      setManageError('');
      const conflicts = await fetchOrderConflicts(diff.toRevoke);
      setOrderConflicts(conflicts);
      if (conflicts.length > 0) {
        setOrderConflictsVisible(true);
        return;
      }
      setConfirmApplyVisible(true);
    } catch (e) {
      const msg = handleRpcError(e);
      setScreenError(msg);
      setManageError(msg);
      toast.error(msg);
    } finally {
      setSavingChanges(false);
    }
  }, [fetchOrderConflicts, getDiff, handleRpcError, manageSelection.size, paidSeatsTotal, showManageModalToast, t, toast]);

  const saveConflict = React.useCallback((userId, patch) => {
    setOrderConflicts((prev) => prev.map((x) => (x.userId === userId ? { ...x, ...patch } : x)));
  }, []);

  const continueAfterConflicts = React.useCallback(() => {
    const invalid = orderConflicts.some((x) => x.action === 'reassign' && !x.successorId);
    if (invalid) {
      toast.error(t('billing_manage_choose_successor_error'));
      return;
    }
    setOrderConflictsVisible(false);
    setConfirmApplyVisible(true);
  }, [orderConflicts, t, toast]);

  const applySeatChanges = React.useCallback(async () => {
    const diff = getDiff();
    if (diff.blockedAdmins.length) toast.info(t('billing_manage_admin_protected'));

    try {
      setSavingChanges(true);
      setScreenError('');
      setConfirmApplyVisible(false);

      for (const c of orderConflicts) {
        if (c.action === 'reassign' && c.successorId && c.successorId !== c.userId) {
          const { error: updateError } = await supabase
            .from(TBL.ORDERS || 'orders')
            .update({ assigned_to: c.successorId })
            .eq('assigned_to', c.userId);
          if (updateError) throw updateError;
        }
      }

      for (const userId of diff.toRevoke) {
        const { error: rpcError } = await supabase.rpc('revoke_seat', {
          p_company_id: companyId,
          p_user_id: userId,
          p_reason: 'manual',
        });
        if (rpcError) throw rpcError;
      }

      for (const userId of diff.toAssign) {
        const { error: rpcError } = await supabase.rpc('assign_seat', {
          p_company_id: companyId,
          p_user_id: userId,
        });
        if (rpcError) throw rpcError;
      }

      await refreshAll();
      setInitialSelection(new Set(manageSelection));
      setOrderConflicts([]);
      setManageVisible(false);
      toast.success(t('billing_manage_apply_success'));
    } catch (e) {
      const msg = handleRpcError(e);
      setScreenError(msg);
      toast.error(msg);
    } finally {
      setSavingChanges(false);
    }
  }, [companyId, getDiff, handleRpcError, manageSelection, orderConflicts, refreshAll, t, toast]);

  const isSubscriptionActive = entitlements?.status === 'active';
  const statusLabel = isSubscriptionActive ? t('billing_status_active') : t('billing_status_inactive', t('billing_status_expired'));
  const statusColor = isSubscriptionActive ? theme.colors.success : theme.colors.danger;
  const periodEndDate = React.useMemo(
    () => (entitlements?.current_period_end ? new Date(entitlements.current_period_end) : null),
    [entitlements?.current_period_end],
  );
  const companyTimeZone = React.useMemo(
    () => normalizeTimeZone(companySettings?.timezone),
    [companySettings?.timezone],
  );
  const locale = Intl.DateTimeFormat?.().resolvedOptions?.().locale;
  const periodEndLabel = React.useMemo(
    () => formatPeriodEndLabel(periodEndDate, companyTimeZone),
    [companyTimeZone, periodEndDate],
  );
  const remainingLabel = React.useMemo(
    () => formatRemainingLabel(periodEndDate, new Date(), locale),
    [locale, periodEndDate],
  );
  const daysLeft = React.useMemo(() => {
    const backendDaysLeft = Number(entitlements?.days_left);
    if (Number.isFinite(backendDaysLeft)) return Math.max(0, Math.floor(backendDaysLeft));
    return diffPreciseDays(periodEndDate);
  }, [entitlements?.days_left, periodEndDate]);
  const daysLeftColor = React.useMemo(() => {
    if (!periodEndDate || daysLeft <= 0) return theme.colors.danger;
    if (daysLeft > 14) return theme.colors.success;
    if (daysLeft >= 7) return theme.colors.warning;
    return theme.colors.warningStrong || theme.colors.warning;
  }, [daysLeft, periodEndDate, theme.colors.danger, theme.colors.success, theme.colors.warning, theme.colors.warningStrong]);

  const filterSummary = React.useMemo(() => {
    const parts = [];
    if (useDepartments && (manageFilters.values.departments || []).length > 0) {
      parts.push(
        summarizeFilterPart({
          label: t('users_department'),
          values: manageFilters.values.departments,
        }),
      );
    }
    if ((manageFilters.values.roles || []).length > 0) {
      parts.push(
        summarizeFilterPart({
          label: t('users_role'),
          values: manageFilters.values.roles,
        }),
      );
    }
    if (manageFilters.values.suspended === true) parts.push(t('status_suspended'));
    if (manageFilters.values.suspended === false) parts.push(t('status_active'));
    return joinFilterSummary(parts, t('common_bullet'));
  }, [manageFilters.values.departments, manageFilters.values.roles, manageFilters.values.suspended, t, useDepartments]);

  if (isRoleResolved && !isAdmin) {
    return null;
  }

  return (
    <Screen
      background="background"
      headerOptions={{ headerShown: !manageFilters.visible }}
    >
      <View style={{ flex: 1 }}>
        {refreshIndicator}
        <ScrollView
          contentContainerStyle={styles(theme).content}
          refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {isLoading && !entitlements ? (
          <Card>
            <Text style={styles(theme).title}>{t('billing_loading_title')}</Text>
            <Text style={styles(theme).muted}>{t('billing_loading_subtitle')}</Text>
          </Card>
        ) : null}

        {!isLoading && !companyId ? (
          <Card>
            <Text style={styles(theme).title}>{t('billing_no_company_title')}</Text>
            <Text style={styles(theme).muted}>{t('billing_no_company_subtitle')}</Text>
          </Card>
        ) : null}

        {error && !entitlements ? (
          <Card>
            <Text style={styles(theme).title}>{t('billing_error_title')}</Text>
            <Text style={styles(theme).muted}>{String(error?.message || t('billing_unknown_error'))}</Text>
          </Card>
        ) : null}

        {screenError ? <Card><Text style={styles(theme).error}>{screenError}</Text></Card> : null}

        {entitlements ? (
          <>
            <SectionHeader>{t('billing_section_status')}</SectionHeader>
            <Card paddedXOnly>
              <LabelValueRow
                label={t('billing_subscription_status')}
                valueComponent={<Text style={[base.value, styles(theme).lineValueStrong, { color: statusColor }]}>{statusLabel}</Text>}
              />
              <View style={base.sep} />
              <LabelValueRow
                label={t('billing_period_end')}
                valueComponent={<Text style={[base.value, styles(theme).lineValueStrong, { color: daysLeftColor }]}>{periodEndLabel}</Text>}
              />
              <View style={base.sep} />
              <LabelValueRow
                label={t('settings_company_timezone')}
                value={companyTimeZone}
              />
              <View style={base.sep} />
              <LabelValueRow
                label={t('billing_remaining_label', 'Осталось')}
                valueComponent={<Text style={[base.value, styles(theme).lineValueStrong, { color: daysLeftColor }]}>{remainingLabel || `${daysLeft} ${t('billing_days_left_unit')}`}</Text>}
              />
            </Card>
            {isOwner ? (
              <>
                <SectionHeader>{t('billing_license_pool_title')}</SectionHeader>
                <Card paddedXOnly>
                  <Pressable
                    onPress={() => setLicensesExpanded((v) => !v)}
                    style={({ pressed }) => [base.row, pressed ? styles(theme).pressed : null]}
                  >
                    <Text style={base.label}>{t('billing_issued_licenses')}</Text>
                    <View style={[base.rightWrap, styles(theme).issuedWrap]}>
                      <Text style={[base.value, styles(theme).lineValueStrong]}>{`${currentActiveCount}/${paidSeatsTotal}`}</Text>
                      <Feather
                        name={licensesExpanded ? 'chevron-up' : 'chevron-down'}
                        size={18}
                        color={theme.colors.textSecondary}
                      />
                    </View>
                  </Pressable>
                  {licensesExpanded ? (
                    <>
                      <View style={base.sep} />
                      <LabelValueRow label={t('billing_paid_seats_total')} value={String(paidSeatsTotal)} />
                      <View style={base.sep} />
                      <LabelValueRow label={t('billing_used_seats')} value={String(usedSeatsTotal)} />
                      <View style={base.sep} />
                      <LabelValueRow label={t('billing_free_seats')} valueComponent={<Text style={[base.value, styles(theme).lineValueStrong, { color: freeSeatsColor }]}>{freeSeatsTotal}</Text>} />
                      <View style={base.sep} />
                      <LabelValueRow label={t('billing_total_employees')} value={String(totalEmployees)} />
                      <View style={base.sep} />
                      <LabelValueRow label={t('billing_blocked_by_license_count')} valueComponent={<Text style={[base.value, styles(theme).lineValueStrong, { color: blockedByLicenseColor }]}>{blockedByLicenseCount}</Text>} />
                    </>
                  ) : null}
                </Card>
                <SectionHeader>{t('billing_storage_title')}</SectionHeader>
                <Card paddedXOnly>
                  <Pressable
                    onPress={() => setStorageExpanded((v) => !v)}
                    style={({ pressed }) => [base.row, pressed ? styles(theme).pressed : null]}
                  >
                    <Text style={base.label}>{t('billing_storage_used_space_label')}</Text>
                    <View style={[base.rightWrap, styles(theme).issuedWrap]}>
                      <Text style={[base.value, styles(theme).lineValueStrong, { color: storageTone }]}>
                          {hasStorageUsage
                            ? `${storageUsedPercent.toFixed(2)}%`
                            : ''}
                      </Text>
                      <Feather
                        name={storageExpanded ? 'chevron-up' : 'chevron-down'}
                        size={18}
                        color={theme.colors.textSecondary}
                      />
                    </View>
                  </Pressable>
                  <View style={base.sep} />
                  <Pressable
                    onPress={() => setStorageExpanded((v) => !v)}
                    style={({ pressed }) => [styles(theme).storageBarWrap, pressed ? styles(theme).pressed : null]}
                  >
                    <View style={styles(theme).storageBarTrack}>
                      <View
                        style={[
                          styles(theme).storageBarFill,
                          {
                            width: `${Math.max(0, Math.min(100, storageProgress * 100))}%`,
                            backgroundColor: storageTone,
                          },
                        ]}
                      />
                    </View>
                    <View style={styles(theme).storageScaleRow}>
                      <Text style={styles(theme).storageScaleText}>0%</Text>
                      <Text style={styles(theme).storageScaleText}>100%</Text>
                    </View>
                    <Text style={[styles(theme).muted, styles(theme).storageUsageCaption]}>
                      {(storageLoading && !hasStorageUsage) || (storageFetching && !hasStorageUsage)
                        ? t('billing_storage_loading')
                        : hasStorageUsage
                          ? `${t('billing_storage_used')}: ${storageUsedPercent.toFixed(2)}%`
                          : t('billing_storage_no_data')}
                    </Text>
                  </Pressable>
                  {storageError ? (
                    <>
                      <View style={base.sep} />
                      <Text style={styles(theme).error}>
                        {String(storageError?.message || t('billing_unknown_error'))}
                      </Text>
                    </>
                  ) : null}
                  {storageExpanded ? (
                    <>
                      <View style={base.sep} />
                      <LabelValueRow label={t('billing_storage_total_used')} value={`${storageUsedPercent.toFixed(2)}%`} />
                      <View style={base.sep} />
                      <LabelValueRow label={t('billing_storage_remaining')} valueComponent={<Text style={[base.value, styles(theme).lineValueStrong, { color: storageTone }]}>{`${Math.max(0, storageLimitBytes > 0 ? ((storageLeftBytes / storageLimitBytes) * 100) : 0).toFixed(2)}%`}</Text>} />
                      <View style={base.sep} />
                      <LabelValueRow label={t('billing_storage_data')} value={`${(storageLimitBytes > 0 ? (dataStorageBytes / storageLimitBytes) * 100 : 0).toFixed(2)}%`} />
                      <View style={base.sep} />
                      <LabelValueRow label={t('billing_storage_media')} value={`${(storageLimitBytes > 0 ? (combinedMediaBytes / storageLimitBytes) * 100 : 0).toFixed(2)}%`} />
                    </>
                  ) : null}
                </Card>
                <View style={styles(theme).billingActions}>
                  <Button title={t('billing_manage_button')} onPress={() => { setScreenError(''); setManageVisible(true); }} variant="primary" disabled={savingChanges} />
                  <Button title={t('company_web_cabinet_button')} onPress={() => {}} variant="secondary" disabled={savingChanges} />
                </View>
              </>
            ) : (
              <Card>
                <View style={styles(theme).sectionGapLg}>
                  <Text style={styles(theme).title}>{t('billing_section_access_status')}</Text>
                  <LabelValueRow label={t('billing_section_access_status')} value={entitlements.can_edit ? t('billing_access_active') : t('billing_access_restricted')} />
                  <Text style={styles(theme).muted}>{t('billing_owner_contact_hint')}</Text>
                </View>
              </Card>
            )}
          </>
        ) : null}
        </ScrollView>
      </View>

      <BaseModal
        visible={manageVisible}
        onClose={closeManageModal}
        title={t('billing_manage_title')}
        maxHeightRatio={0.96}
        footer={
          <View style={styles(theme).modalFooterRow}>
            <View style={styles(theme).footerBtnWrap}>
              <Button title={t('btn_cancel')} variant="secondary" onPress={closeManageModal} style={styles(theme).footerBtn} />
            </View>
            <View style={styles(theme).footerBtnWrap}>
              <Button title={savingChanges ? t('btn_applying') : t('btn_apply')} onPress={askApplyChanges} loading={savingChanges} disabled={savingChanges || !hasChanges} style={styles(theme).footerBtn} />
            </View>
          </View>
        }
      >
        <View style={styles(theme).manageSummaryWrap}>
          <LabelValueRow label={t('billing_paid_seats_total')} value={String(paidSeatsTotal)} />
          <View style={base.sep} />
          <LabelValueRow label={t('billing_manage_selected_count')} valueComponent={<Text style={[base.value, styles(theme).lineValueStrong, { color: displayedSelectedCount <= paidSeatsTotal ? theme.colors.success : theme.colors.danger }]}>{displayedSelectedCount}</Text>} />
        </View>
        <SearchFiltersBar
          value={manageSearch}
          onChangeText={setManageSearch}
          onClear={() => setManageSearch('')}
          onOpenSort={() => setManageSortVisible(true)}
          onOpenFilters={openManageFilters}
          filterSummary={filterSummary}
          onResetFilters={manageFilters.reset}
          style={styles(theme).manageSearchBar}
        />

        <ScrollView
          style={styles(theme).manageList}
          contentContainerStyle={styles(theme).manageListContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {sortedManageMembers.map((m) => {
            const selected = manageSelection.has(m.user_id);
            const effectiveSelected = hasChanges ? selected : isMemberLicenseActive(m);
            const blockedVisual = !effectiveSelected || m.admin_blocked;
            const rowBg = blockedVisual ? withAlpha(theme.colors.danger, theme.components?.pill?.backgroundAlpha ?? 0.08) : withAlpha(theme.colors.success, theme.components?.pill?.backgroundAlpha ?? 0.08);
            const rowBorder = blockedVisual ? withAlpha(theme.colors.danger, theme.components?.pill?.borderAlpha ?? 0.18) : withAlpha(theme.colors.success, theme.components?.pill?.borderAlpha ?? 0.18);
            const badgeLabel = blockedVisual
              ? t('status_blocked', t('billing_manage_status_blocked'))
              : t('billing_manage_status_active');
            const badgeColor = blockedVisual ? theme.colors.danger : theme.colors.success;
            const roleLabel = t(`role_${m.role || ROLE.WORKER}`, m.role || ROLE.WORKER);
            const departmentLabel = useDepartments
              ? (
                  m?.department_id == null
                    ? t('placeholder_department')
                    : departmentNameById.get(String(m.department_id)) || t('placeholder_department')
                )
              : '';
            const roleDepartmentLabel = useDepartments ? `${roleLabel} • ${departmentLabel}` : roleLabel;
            return (
              <Pressable key={m.user_id} onPress={() => toggleMember(m)} style={({ pressed }) => [styles(theme).manageRow, { backgroundColor: rowBg, borderColor: rowBorder }, pressed ? styles(theme).pressed : null]} disabled={savingChanges}>
                <View style={styles(theme).fill}>
                  <Text style={styles(theme).memberName} numberOfLines={1} ellipsizeMode="tail">
                    {m.name || m.email || String(m.user_id || '')}
                  </Text>
                  <Text style={styles(theme).memberMeta} numberOfLines={1} ellipsizeMode="tail">
                    {roleDepartmentLabel}
                  </Text>
                </View>
                <StatusBadge theme={theme} color={badgeColor} label={badgeLabel} />
              </Pressable>
            );
          })}
        </ScrollView>

        {manageModalToast ? (
          <View pointerEvents="none" style={styles(theme).manageToastOverlay}>
            <Animated.View
              style={[
                manageToastAnimatedStyle,
                styles(theme).manageToast,
                manageModalToast.type === 'error'
                  ? styles(theme).manageToastError
                  : manageModalToast.type === 'warning'
                    ? styles(theme).manageToastWarning
                    : styles(theme).manageToastInfo,
              ]}
            >
              <Text
                style={[
                  styles(theme).manageToastText,
                  {
                    color:
                      manageModalToast.type === 'error'
                        ? theme.colors.danger
                        : manageModalToast.type === 'warning'
                          ? (theme.colors.warningStrong || theme.colors.warning)
                          : theme.colors.text,
                  },
                ]}
              >
                {manageModalToast.text}
              </Text>
            </Animated.View>
          </View>
        ) : null}
      </BaseModal>

      <SortSelectModal
        visible={manageSortVisible}
        onClose={() => setManageSortVisible(false)}
        options={manageSortOptions}
        value={manageSortKey}
        onChange={(nextSort) => {
          if (nextSort) setManageSortKey(nextSort);
        }}
      />

      <BaseModal
        visible={orderConflictsVisible}
        onClose={() => setOrderConflictsVisible(false)}
        title={t('billing_manage_orders_modal_title')}
        maxHeightRatio={theme?.components?.filtersPanel?.maxHeightRatio ?? 0.92}
        footer={
          <View style={styles(theme).modalFooterRow}>
            <View style={styles(theme).footerBtnWrap}>
              <Button title={t('btn_cancel')} variant="secondary" onPress={() => setOrderConflictsVisible(false)} style={styles(theme).footerBtn} />
            </View>
            <View style={styles(theme).footerBtnWrap}>
              <Button title={t('billing_manage_continue')} onPress={continueAfterConflicts} style={styles(theme).footerBtn} />
            </View>
          </View>
        }
      >
        <Text style={styles(theme).muted}>{t('billing_manage_orders_modal_hint')}</Text>
        <Pressable onPress={() => setBulkSuccessorModalVisible(true)} style={({ pressed }) => [styles(theme).bulkBtn, pressed ? styles(theme).pressed : null]}>
          <Text style={styles(theme).bulkBtnText}>{t('billing_manage_bulk_reassign')}</Text>
        </Pressable>

        <ScrollView
          style={styles(theme).manageList}
          contentContainerStyle={styles(theme).manageListContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {orderConflicts.map((item) => {
            const successor = item.availableEmployees.find((emp) => emp.id === item.successorId);
            return (
              <View key={item.userId} style={styles(theme).conflictCard}>
                <Text style={styles(theme).memberName}>{item.name}</Text>
                <Text style={styles(theme).memberMeta}>{t('billing_manage_orders_count_prefix')} {item.activeOrdersCount}</Text>
                <View style={styles(theme).toggleRow}>
                  <Pressable onPress={() => saveConflict(item.userId, { action: 'keep', successorId: null })} style={({ pressed }) => [styles(theme).toggleOption, item.action === 'keep' ? styles(theme).toggleOptionSelected : null, pressed ? styles(theme).pressed : null]}><Text style={styles(theme).toggleOptionText}>{t('billing_manage_orders_keep')}</Text></Pressable>
                  <Pressable onPress={() => saveConflict(item.userId, { action: 'reassign' })} style={({ pressed }) => [styles(theme).toggleOption, item.action === 'reassign' ? styles(theme).toggleOptionSelected : null, pressed ? styles(theme).pressed : null]}><Text style={styles(theme).toggleOptionText}>{t('billing_manage_orders_reassign')}</Text></Pressable>
                </View>
                {item.action === 'reassign' ? (
                  <Pressable onPress={() => setSelectUserForReassign(item.userId)} style={({ pressed }) => [styles(theme).selectSuccessorBtn, pressed ? styles(theme).pressed : null]}>
                    <Text style={styles(theme).selectSuccessorText}>{successor ? `${t('billing_manage_successor')}: ${successor.full_name || `${successor.first_name || ''} ${successor.last_name || ''}`.trim()}` : t('billing_manage_choose_successor')}</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      </BaseModal>

      <SelectModal
        visible={!!selectUserForReassign}
        onClose={() => setSelectUserForReassign(null)}
        title={t('billing_manage_choose_successor')}
        searchable={true}
        items={(() => {
          const conflict = orderConflicts.find((c) => c.userId === selectUserForReassign);
          if (!conflict) return [];
          return (conflict.availableEmployees || []).map((emp) => ({
            id: emp.id,
            label: emp.full_name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.email || String(emp.id),
            subtitle: t(`role_${emp.role || ROLE.WORKER}`, emp.role || ROLE.WORKER),
          }));
        })()}
        onSelect={(item) => {
          if (!selectUserForReassign) return;
          saveConflict(selectUserForReassign, { successorId: item.id, action: 'reassign' });
          setSelectUserForReassign(null);
        }}
      />

      <SelectModal
        visible={bulkSuccessorModalVisible}
        onClose={() => setBulkSuccessorModalVisible(false)}
        title={t('billing_manage_bulk_reassign')}
        searchable={true}
        items={(() => {
          const available = new Map();
          orderConflicts.forEach((item) => {
            (item.availableEmployees || []).forEach((emp) => { if (!available.has(emp.id)) available.set(emp.id, emp); });
          });
          return Array.from(available.values()).map((emp) => ({
            id: emp.id,
            label: emp.full_name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.email || String(emp.id),
            subtitle: t(`role_${emp.role || ROLE.WORKER}`, emp.role || ROLE.WORKER),
          }));
        })()}
        onSelect={(item) => {
          setOrderConflicts((prev) => prev.map((x) => ({ ...x, action: 'reassign', successorId: item.id })));
          setBulkSuccessorModalVisible(false);
        }}
      />

      <ConfirmModal
        visible={confirmApplyVisible}
        title={t('billing_manage_confirm_title')}
        message={t('billing_manage_confirm_message')}
        confirmLabel={t('btn_apply')}
        cancelLabel={t('btn_cancel')}
        onClose={() => setConfirmApplyVisible(false)}
        onConfirm={applySeatChanges}
      />

      <FiltersPanel
        visible={manageFilters.visible}
        onClose={closeManageFilters}
        departments={useDepartments ? departments : []}
        rolesOptions={roleOptions(t)}
        showSearchCategory={false}
        values={manageFilters.values}
        defaults={{ departments: [], roles: [], suspended: null }}
        setValue={manageFilters.setValue}
        onApply={applyManageFilters}
      />
    </Screen>
  );
}

const styles = (theme) => StyleSheet.create({
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.components?.scrollView?.paddingBottom ?? theme.spacing.xl,
  },
  billingActions: { marginTop: theme.spacing.sm, gap: theme.spacing.sm },
  sectionGapLg: { gap: theme.spacing.sm },
  sectionGapMd: { gap: theme.spacing.xs },
  fill: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.text, fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weight.bold },
  lineValueStrong: { fontWeight: theme.typography.weight.bold },
  muted: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm },
  error: { color: theme.colors.danger, fontWeight: theme.typography.weight.semibold },
  badge: { alignSelf: 'flex-start', borderRadius: theme.radii.pill, borderWidth: theme.components.card.borderWidth, paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs, backgroundColor: theme.colors.surface },
  badgeText: { fontSize: theme.typography.sizes.xs, fontWeight: theme.typography.weight.bold },
  pressed: { opacity: theme.components.listItem.disabledOpacity },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderWidth: theme.components.card.borderWidth, borderColor: theme.colors.border, borderRadius: theme.radii.lg, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, backgroundColor: theme.colors.surface },
  memberName: { color: theme.colors.text, fontWeight: theme.typography.weight.bold, fontSize: theme.typography.sizes.md },
  memberMeta: { marginTop: theme.spacing.xs, color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm },
  modalFooterRow: { flexDirection: 'row', gap: theme.spacing.sm, width: '100%' },
  footerBtnWrap: { flex: 1 },
  footerBtn: { width: '100%' },
  manageSummaryWrap: { borderWidth: theme.components.card.borderWidth, borderColor: theme.colors.border, borderRadius: theme.radii.lg, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, backgroundColor: theme.colors.surface, marginBottom: theme.spacing.sm },
  manageErrorWrap: {
    borderWidth: theme.components.card.borderWidth,
    borderColor: withAlpha(theme.colors.danger, theme.components?.pill?.borderAlpha ?? 0.18),
    borderRadius: theme.radii.md,
    backgroundColor: withAlpha(theme.colors.danger, theme.components?.pill?.backgroundAlpha ?? 0.08),
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  manageToastOverlay: {
    position: 'absolute',
    left: theme.spacing.md,
    right: theme.spacing.md,
    bottom: theme.spacing.sm,
    alignItems: 'center',
  },
  manageToast: {
    width: '100%',
    maxWidth: Math.min(560, WINDOW_WIDTH - 24),
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: theme.colors.surface,
  },
  manageToastWarning: {
    borderColor: theme.colors.warningStrong || theme.colors.warning,
  },
  manageToastError: {
    borderColor: theme.colors.danger,
  },
  manageToastInfo: {
    borderColor: theme.colors.border,
  },
  manageToastText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  manageSearchBar: { paddingHorizontal: 0, paddingBottom: theme.spacing.sm },
  manageList: { minHeight: 220 },
  manageListContent: { gap: theme.spacing.sm, paddingBottom: theme.spacing.sm },
  manageRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderWidth: theme.components.card.borderWidth, borderRadius: theme.radii.lg, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  bulkBtn: { marginTop: theme.spacing.sm, marginBottom: theme.spacing.sm, borderWidth: theme.components.card.borderWidth, borderColor: theme.colors.border, borderRadius: theme.radii.md, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, backgroundColor: theme.colors.surface },
  bulkBtnText: { color: theme.colors.text, fontWeight: theme.typography.weight.semibold, fontSize: theme.typography.sizes.sm },
  conflictCard: { borderWidth: theme.components.card.borderWidth, borderColor: theme.colors.border, borderRadius: theme.radii.lg, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, backgroundColor: theme.colors.surface, gap: theme.spacing.sm },
  toggleRow: { flexDirection: 'row', gap: theme.spacing.sm },
  toggleOption: { flex: 1, borderWidth: theme.components.card.borderWidth, borderColor: theme.colors.border, borderRadius: theme.radii.md, paddingVertical: theme.spacing.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  toggleOptionSelected: { borderColor: theme.colors.primary, backgroundColor: withAlpha(theme.colors.primary, theme.components?.pill?.backgroundAlpha ?? 0.08) },
  toggleOptionText: { color: theme.colors.text, fontWeight: theme.typography.weight.semibold, fontSize: theme.typography.sizes.sm },
  selectSuccessorBtn: { borderWidth: theme.components.card.borderWidth, borderColor: theme.colors.border, borderRadius: theme.radii.md, paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.md, backgroundColor: theme.colors.surface },
  selectSuccessorText: { color: theme.colors.text, fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weight.semibold },
  issuedWrap: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
  storageBarWrap: { paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.sm },
  storageBarTrack: {
    width: '100%',
    height: theme.components?.progress?.height ?? 12,
    borderRadius: theme.radii.pill,
    backgroundColor: withAlpha(theme.colors.textSecondary, 0.2),
    overflow: 'hidden',
  },
  storageBarFill: {
    height: '100%',
    borderRadius: theme.radii.pill,
    minWidth: 2,
  },
  storageScaleRow: { marginTop: theme.spacing.xs, flexDirection: 'row', justifyContent: 'space-between' },
  storageScaleText: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.xs, fontWeight: theme.typography.weight.semibold },
  storageUsageCaption: { marginTop: theme.spacing.xs },
});

