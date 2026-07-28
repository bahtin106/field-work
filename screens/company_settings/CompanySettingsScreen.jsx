// app/company_settings/index.jsx
import { usePathname, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  InteractionManager,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Screen from '../../components/layout/Screen';
import UIButton from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Checkbox from '../../components/ui/Checkbox';
import SectionHeader from '../../components/ui/SectionHeader';
import { BaseModal, SelectModal } from '../../components/ui/modals';
import ModalActionsRow from '../../components/ui/modals/ModalActionsRow';
import TextField, { SelectField } from '../../components/ui/TextField';
import { useToast } from '../../components/ui/ToastProvider';
import { PHONE_MODE_OPTIONS, SETTINGS_SECTIONS } from '../../constants/settings';
import { EXCHANGE_RATE_ENDPOINTS } from '../../config/externalUrls';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme/ThemeProvider';
import { KeyboardAwareScrollView } from '../../lib/keyboardControllerCompat';

import Feather from '@expo/vector-icons/Feather';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { COMPANY_SETTINGS_QUERY_KEY, fetchCompanySettingsByCompanyId } from '../../lib/companySettingsQuery';
import { normalizeCompanyName, validateCompanyName } from '../../lib/companyName';
import { FUNCTIONS } from '../../lib/constants';
import { getCurrencySymbol } from '../../lib/currency';
import { supabase } from '../../lib/supabase';
import { saveUserLocale } from '../../lib/userLocale';
import { useAuthContext } from '../../providers/SimpleAuthProvider';
import { availableLocales, getLocale, setLocale } from '../../src/i18n';
import HelpInfoButton from '../../src/features/helpCenter/HelpInfoButton';

/* Helpers */
const getDeviceTimeZone = () => {
  try {
    return Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/** Fallback list if Intl.supportedValuesOf('timeZone') is unavailable */
const FALLBACK_TZ = [
  'Etc/UTC',
  'Pacific/Midway',
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Phoenix',
  'America/Chicago',
  'America/New_York',
  'America/Toronto',
  'America/Mexico_City',
  'America/Bogota',
  'America/Lima',
  'America/Caracas',
  'America/Santiago',
  'America/Sao_Paulo',
  'Atlantic/Azores',
  'Atlantic/Reykjavik',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Prague',
  'Europe/Vienna',
  'Europe/Zurich',
  'Europe/Warsaw',
  'Europe/Budapest',
  'Europe/Rome',
  'Europe/Stockholm',
  'Europe/Helsinki',
  'Europe/Athens',
  'Europe/Bucharest',
  'Europe/Chisinau',
  'Europe/Kiev',
  'Europe/Istanbul',
  'Europe/Minsk',
  'Europe/Kaliningrad',
  'Europe/Moscow',
  'Europe/Samara',
  'Europe/Saratov',
  'Asia/Yekaterinburg',
  'Asia/Omsk',
  'Asia/Novosibirsk',
  'Asia/Barnaul',
  'Asia/Tomsk',
  'Asia/Krasnoyarsk',
  'Asia/Irkutsk',
  'Asia/Yakutsk',
  'Asia/Vladivostok',
  'Asia/Sakhalin',
  'Asia/Magadan',
  'Asia/Kamchatka',
  'Asia/Tbilisi',
  'Asia/Yerevan',
  'Asia/Baku',
  'Asia/Tashkent',
  'Asia/Samarkand',
  'Asia/Bishkek',
  'Asia/Dushanbe',
  'Asia/Almaty',
  'Asia/Qostanay',
  'Asia/Aqtau',
  'Asia/Aqtobe',
  'Asia/Atyrau',
  'Asia/Oral',
  'Asia/Tehran',
  'Asia/Baghdad',
  'Asia/Jerusalem',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Asia/Colombo',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Ho_Chi_Minh',
  'Asia/Jakarta',
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Asia/Hong_Kong',
  'Asia/Taipei',
  'Asia/Shanghai',
  'Asia/Seoul',
  'Asia/Tokyo',
  'Australia/Perth',
  'Australia/Darwin',
  'Australia/Adelaide',
  'Australia/Brisbane',
  'Australia/Sydney',
  'Pacific/Port_Moresby',
  'Pacific/Guadalcanal',
  'Pacific/Fiji',
  'Pacific/Auckland',
  'Pacific/Chatham',
  'Pacific/Tongatapu',
];
const IOS_MODAL_TRANSITION_MS = 320;
const ANDROID_MODAL_TRANSITION_MS = 180;

function isZoneSupported(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format();
    return true;
  } catch {
    return false;
  }
}

function getAllTimeZones() {
  if (typeof Intl?.supportedValuesOf === 'function') {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {}
  }
  return FALLBACK_TZ.filter(isZoneSupported);
}

/** Locale-friendly city names; falls back to the last time-zone segment. */

function getOffsetMinutes(zone) {
  if (__tzOffsetCache.has(zone)) return __tzOffsetCache.get(zone);
  try {
    const now = new Date();
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = dtf.formatToParts(now);
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const asUTC = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour),
      Number(map.minute),
      Number(map.second),
    );
    const diffMin = Math.round((asUTC - now.getTime()) / 60000);
    __tzOffsetCache.set(zone, diffMin);
    return diffMin;
  } catch {
    try {
      const now = new Date();
      const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
      const tz = new Date(now.toLocaleString('en-US', { timeZone: zone }));
      if (!isNaN(tz.getTime()) && !isNaN(utc.getTime())) {
        const diffMin = Math.round((tz - utc) / 60000);
        __tzOffsetCache.set(zone, diffMin);
        return diffMin;
      }
    } catch {}
    __tzOffsetCache.set(zone, 0);
    return 0;
  }
}

function formatUtcOffset(totalMinutes) {
  const mins = Number.isFinite(totalMinutes) ? Math.trunc(totalMinutes) : 0;
  const sign = mins >= 0 ? '+' : '-';
  const abs = Math.abs(mins);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `UTC ${sign}${hh}:${mm}`;
}

/** Build simple label while keeping IANA id for DB storage */
function zoneToItem(zone) {
  const offsetMin = getOffsetMinutes(zone);
  return { id: zone, label: formatUtcOffset(offsetMin), offsetMin };
}

let __tzItemsCache = null;
const __tzOffsetCache = new Map();
function getCachedTimeZoneItems() {
  if (__tzItemsCache) return __tzItemsCache;
  const list = getAllTimeZones();
  const uniqueByOffset = new Map();

  list.forEach((zone) => {
    const item = zoneToItem(zone);
    const current = uniqueByOffset.get(item.offsetMin);
    if (!current || current.id === 'Etc/UTC') {
      uniqueByOffset.set(item.offsetMin, { ...item, id: zone });
    }
  });

  __tzItemsCache = Array.from(uniqueByOffset.values()).sort((a, b) => a.offsetMin - b.offsetMin);
  return __tzItemsCache;
}

export default function CompanySettings() {
  const toast = useToast();
  const { theme, mode, setMode } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const { user, profile, isInitializing, mergeAuthUserMetadata } = useAuthContext();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const companyId = profile?.company_id || null;
  const companyQueryKey = React.useMemo(
    () => [...COMPANY_SETTINGS_QUERY_KEY, companyId || 'no-company'],
    [companyId],
  );
  const normalizedProfileRole = String(profile?.role || '').toLowerCase();
  const canAccessCompanySettings = normalizedProfileRole === 'admin';
  const isAdmin = normalizedProfileRole === 'admin';
  const authAccountType = String(user?.user_metadata?.account_type || '').toLowerCase();
  const isSoloAdmin = isAdmin && authAccountType === 'solo';
  const lastNavigationAtRef = React.useRef(0);
  const accessRedirectInFlightRef = React.useRef(false);
  const modalTransitionTimerRef = React.useRef(null);
  const workModeConfirmTransitionTargetRef = React.useRef(null);
  const NAV_GUARD_MS = 0;

  React.useEffect(
    () => () => {
      if (modalTransitionTimerRef.current) clearTimeout(modalTransitionTimerRef.current);
    },
    [],
  );

  const openModalAfterNativeClose = React.useCallback((openNext) => {
    if (modalTransitionTimerRef.current) {
      clearTimeout(modalTransitionTimerRef.current);
      modalTransitionTimerRef.current = null;
    }
    const transitionDelayMs =
      Platform.OS === 'ios' ? IOS_MODAL_TRANSITION_MS : Platform.OS === 'android' ? ANDROID_MODAL_TRANSITION_MS : 0;
    if (!transitionDelayMs) {
      InteractionManager.runAfterInteractions(() => requestAnimationFrame(() => openNext?.()));
      return;
    }
    modalTransitionTimerRef.current = setTimeout(() => {
      modalTransitionTimerRef.current = null;
      InteractionManager.runAfterInteractions(() => requestAnimationFrame(() => openNext?.()));
    }, transitionDelayMs);
  }, []);

  const runSingleNavigation = React.useCallback((navigate) => {
    const now = Date.now();
    if (now - lastNavigationAtRef.current < NAV_GUARD_MS) return;
    lastNavigationAtRef.current = now;
    navigate?.();
  }, []);

  React.useEffect(() => {
    if (isInitializing) return;
    if (canAccessCompanySettings) {
      accessRedirectInFlightRef.current = false;
      return;
    }
    if (accessRedirectInFlightRef.current) return;
    if (typeof pathname === 'string' && !pathname.startsWith('/company_settings')) return;
    accessRedirectInFlightRef.current = true;
    const rafId = requestAnimationFrame(() => {
      try {
        router.replace('/orders');
      } catch {
        accessRedirectInFlightRef.current = false;
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [canAccessCompanySettings, isInitializing, pathname, router]);

  // Load company settings via shared query cache.
  const {
    data: companyData,
    isLoading: _isLoadingCompany,
    refetch: refreshCompany,
  } = useQuery({
    queryKey: companyQueryKey,
    queryFn: () => fetchCompanySettingsByCompanyId(companyId),
    enabled: !!companyId,
    gcTime: 30 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    placeholderData: (prev) => prev ?? null,
  });

  // Intentionally avoid broad realtime subscription here.
  // Company settings are updated via explicit saves and targeted query invalidation/refetch.


  const UNIT_ITEMS = React.useMemo(
    () => [
      { id: 'min', label: t('time_unit_minutes'), mul: 1 },
      { id: 'hour', label: t('time_unit_hours'), mul: 60 },
      { id: 'day', label: t('time_unit_days'), mul: 1440 },
    ],
    [t],
  );

  const decomposeMinutes = React.useCallback((total) => {
    const n = Math.max(0, Number(total) || 0);
    if (n % 1440 === 0) return { val: String(n / 1440), unit: 'day' };
    if (n % 60 === 0) return { val: String(n / 60), unit: 'hour' };
    return { val: String(n), unit: 'min' };
  }, []);

  const toMinutes = React.useCallback(
    (valStr, unitId) => {
      const v = Math.max(0, Number(valStr) || 0);
      const mul = UNIT_ITEMS.find((u) => u.id === unitId)?.mul || 1;
      return Math.min(43200, Math.round(v * mul));
    },
    [UNIT_ITEMS],
  );


  const updateSettings = React.useCallback(
    async (patch) => {
      if (!supabase) throw new Error(t('errors_noDb'));
      if (!companyId) throw new Error(t('errors_companyNotFound'));
      const { error } = await supabase.from('companies').update(patch).eq('id', companyId);
      if (error) throw error;


      await refreshCompany();

      return true;
    },
    [companyId, t, refreshCompany],
  );

  const s = React.useMemo(() => styles(theme), [theme]);


  const [timeZone, setTimeZone] = React.useState(
    () => companyData?.timezone || getDeviceTimeZone(),
  );
  const [financeOpen, setFinanceOpen] = React.useState(false);
  const [currency, setCurrency] = React.useState(null);
  const [currencyRate, setCurrencyRate] = React.useState('');
  const [fetchRateError, setFetchRateError] = React.useState(null);
  const [_currencyModalKey, _setCurrencyModalKey] = React.useState(0);
  const [fetchingRate, setFetchingRate] = React.useState(false);
  const [rateDisplayDirection, setRateDisplayDirection] = React.useState('old_to_new');
  const [companyName, setCompanyName] = React.useState('');
  const [companyNameInitial, setCompanyNameInitial] = React.useState('');
  const [companyNameOpen, setCompanyNameOpen] = React.useState(false);
  const [companyModalKey, setCompanyModalKey] = React.useState(0);
  const [companyNameDraft, setCompanyNameDraft] = React.useState('');
  const [companyNameError, setCompanyNameError] = React.useState('');
  const [savingCompany, setSavingCompany] = React.useState(false);

  const closeCompanyEditor = React.useCallback(() => {
    try {
      Keyboard.dismiss();
    } catch {}
    setCompanyNameOpen(false);
    setCompanyNameError('');
    setSavingCompany(false);
    // Force re-create modal instance to avoid any stale RN Modal overlays
    setTimeout(() => {
      try {
        setCompanyModalKey((k) => k + 1);
      } catch {}
    }, 0);
  }, []);

  const [phoneMode, setPhoneMode] = React.useState('always');
  const [phoneModeOpen, setPhoneModeOpen] = React.useState(false);
  const [windowBefore, setWindowBefore] = React.useState('12');
  const [windowAfter, setWindowAfter] = React.useState('6');
  const [windowModalOpen, setWindowModalOpen] = React.useState(false);
  const [beforeUnitOpen, setBeforeUnitOpen] = React.useState(false);
  const [afterUnitOpen, setAfterUnitOpen] = React.useState(false);
  const [beforeUnit, setBeforeUnit] = React.useState('min');
  const [afterUnit, setAfterUnit] = React.useState('min');
  const [tzOpen, setTzOpen] = React.useState(false);
  const [themeOpen, setThemeOpen] = React.useState(false);
  const [langOpen, setLangOpen] = React.useState(false);
  const [workModeOpen, setWorkModeOpen] = React.useState(false);
  const [workModeConfirmOpen, setWorkModeConfirmOpen] = React.useState(false);
  const [workModeConsentOpen, setWorkModeConsentOpen] = React.useState(false);
  const [pendingWorkMode, setPendingWorkMode] = React.useState(null);
  const [switchingWorkMode, setSwitchingWorkMode] = React.useState(false);
  const [localWorkModeOverride, setLocalWorkModeOverride] = React.useState(null);
  const [workModeSwitchFeedback, setWorkModeSwitchFeedback] = React.useState(null);
  const [workModeConsents, setWorkModeConsents] = React.useState({
    blockMembers: false,
    reassignOrders: false,
    keepLicensesIdle: false,
  });
  const [currentLocale, setCurrentLocale] = React.useState(() => getLocale());


  React.useEffect(() => {
    if (!companyData) return;

    if (companyData.timezone) setTimeZone(companyData.timezone);
    if (typeof companyData.name === 'string') {
      setCompanyName(companyData.name);
      setCompanyNameInitial(companyData.name);
    }
    if (typeof companyData.worker_phone_mode === 'string')
      setPhoneMode(companyData.worker_phone_mode);

    const _b = companyData.worker_phone_window_before_mins ?? null;
    const _a = companyData.worker_phone_window_after_mins ?? null;
    if (_b != null) setWindowBefore(String(_b));
    if (_a != null) setWindowAfter(String(_a));
    if (companyData.currency) setCurrency(companyData.currency);
    if (companyData.currency_rate != null) setCurrencyRate(String(companyData.currency_rate));
  }, [companyData]);

  const updateSetting = React.useCallback(
    async (key, value) => {
      if (!supabase) throw new Error(t('errors_noDb'));
      if (!companyId) throw new Error(t('errors_companyNotFound'));
      const payload = { [key]: value };
      const { error: upErr } = await supabase.from('companies').update(payload).eq('id', companyId);
      if (upErr) throw upErr;


      await refreshCompany();


      await queryClient.invalidateQueries({ queryKey: COMPANY_SETTINGS_QUERY_KEY });

      return true;
    },
    [companyId, t, refreshCompany, queryClient],
  );

  const _onSubmitCompanyName = React.useCallback(() => {
    const name = String(companyName || '').trim();
    if (!name || name === companyNameInitial) return;
    toast
      .promise(() => updateSetting('name', name), {
        loading: t('toast_loading'),
        success: t('toast_companyNameSaved'),
        error: (e) => e?.message || t('toast_error'),
      })
      .then(() => {
        setCompanyNameInitial(name);
      });
  }, [companyName, companyNameInitial, updateSetting, t, toast]);

  const saveCompanyNameDraft = React.useCallback(async () => {
    const normalizedName = normalizeCompanyName(companyNameDraft);
    const validationError = validateCompanyName(normalizedName, t);
    if (validationError) {
      setCompanyNameError(validationError);
      return;
    }
    if (normalizedName === normalizeCompanyName(companyNameInitial)) {
      setCompanyName(normalizedName);
      closeCompanyEditor();
      return;
    }
    setSavingCompany(true);
    try {
      await toast.promise(() => updateSetting('name', normalizedName), {
        loading: t('toast_loading'),
        success: t('toast_companyNameSaved'),
        error: (e) => e?.message || t('toast_error'),
      });
      setCompanyName(normalizedName);
      setCompanyNameInitial(normalizedName);
      closeCompanyEditor();
    } catch (e) {
      setCompanyNameError(e?.message || t('toast_error'));
    } finally {
      setSavingCompany(false);
    }
  }, [closeCompanyEditor, companyNameDraft, companyNameInitial, t, toast, updateSetting]);

  // Time zones list
  const tzItems = React.useMemo(() => {
    const selectedZone = timeZone || getDeviceTimeZone();
    if (!tzOpen) {
      return [zoneToItem(selectedZone)];
    }

    try {
      const cached = getCachedTimeZoneItems();
      const selectedItem = zoneToItem(selectedZone);
      const hasSelected = cached.some((it) => it.id === selectedZone);
      if (hasSelected) return cached;
      return [...cached, { ...selectedItem, id: selectedZone }].sort((a, b) => a.offsetMin - b.offsetMin);
    } catch {
      return [zoneToItem(selectedZone)];
    }
  }, [timeZone, tzOpen]);
  const tzMap = React.useMemo(() => {
    const m = new Map();
    tzItems.forEach((it) => m.set(it.id, it));
    return m;
  }, [tzItems]);

  const selectedZoneItem = React.useMemo(
    () => tzMap.get(timeZone) || zoneToItem(timeZone),
    [tzMap, timeZone],
  );
  const timeZoneLabel = selectedZoneItem.label;
  const selectedTimeZoneOffset = selectedZoneItem.offsetMin;
  const tzInitialIndex = React.useMemo(
    () => tzItems.findIndex((item) => item.offsetMin === selectedTimeZoneOffset),
    [tzItems, selectedTimeZoneOffset],
  );


  const parsedDisplayed = React.useMemo(() => {
    const n = Number(currencyRate);
    return Number.isFinite(n) ? n : null;
  }, [currencyRate]);

  const normalizedRate = React.useMemo(() => {
    if (!parsedDisplayed) return null;
    return rateDisplayDirection === 'old_to_new'
      ? parsedDisplayed
      : parsedDisplayed
        ? 1 / parsedDisplayed
        : null;
  }, [parsedDisplayed, rateDisplayDirection]);

  const invertedRate = React.useMemo(
    () => (normalizedRate ? 1 / normalizedRate : null),
    [normalizedRate],
  );

  const onPickTimeZone = React.useCallback(
    (it) => {
      setTimeZone(it.id);
      setTzOpen(false);
      toast.promise(() => updateSetting('timezone', it.id), {
        loading: t('toast_loading'),
        success: t('toast_timezoneSaved'),
        error: (e) => e?.message || t('toast_error'),
      });
    },
    [updateSetting, t, toast],
  );

  // Currency options (use i18n keys for labels)
  const CURRENCY_OPTIONS = React.useMemo(
    () => [
      { id: 'RUB', label: t('finance_currency_RUB') },
      { id: 'USD', label: t('finance_currency_USD') },
      { id: 'EUR', label: t('finance_currency_EUR') },
    ],
    [t],
  );

  // Methods for changing currency: user must pick one in modal
  const MODAL_RECALC_METHODS = React.useMemo(
    () => [
      { id: 'no_recalc', label: t('modal_currency_no_recalc') },
      { id: 'recalc', label: t('modal_currency_yes_recalc') },
    ],
    [t],
  );

  const fixedCurrencyLabel = React.useMemo(
    () => `${getCurrencySymbol('RUB')} ${t('finance_currency_RUB')}`,
    [t],
  );

  // Try multiple public exchange rate providers in sequence and return first successful rate
  const fetchRateFromApi = React.useCallback(async (base, target) => {
    setFetchingRate(true);
    setFetchRateError(null);
    const providers = [
      // exchangerate.host
      async () => {
        const url = `${EXCHANGE_RATE_ENDPOINTS.exchangerateHost}?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(
          target,
        )}`;
        const r = await fetch(url);
        const j = await r.json();
        return j?.rates?.[target] ?? null;
      },
      // ER-API (open.er-api.com)
      async () => {
        const url = `${EXCHANGE_RATE_ENDPOINTS.openErApi}/${encodeURIComponent(base)}`;
        const r = await fetch(url);
        const j = await r.json();
        return j?.rates?.[target] ?? null;
      },
      // exchangerate-api.com (another free endpoint)
      async () => {
        const url = `${EXCHANGE_RATE_ENDPOINTS.exchangerateApi}/${encodeURIComponent(base)}`;
        const r = await fetch(url);
        const j = await r.json();
        return j?.rates?.[target] ?? null;
      },
    ];

    try {
      for (const prov of providers) {
        try {
          const rate = await prov();
          if (rate && !Number.isNaN(Number(rate)) && Number(rate) > 0) return Number(rate);
        } catch {
          // try next provider
        }
      }

      // As a last resort, if both currencies are same, return 1
      if (String(base).toUpperCase() === String(target).toUpperCase()) return 1;

      setFetchRateError(t('modal_currency_rate_fetch_failed'));
      return null;
    } finally {
      setFetchingRate(false);
    }
  }, [t]);

  const [currencyConfirmOpen, setCurrencyConfirmOpen] = React.useState(false);
  const [pendingCurrency, setPendingCurrency] = React.useState(null);
  const [confirmLoading, setConfirmLoading] = React.useState(false);
  const [recalcMethod, setRecalcMethod] = React.useState(
    MODAL_RECALC_METHODS[0]?.id || 'no_recalc',
  );
  const autoFetchedRef = React.useRef(false);
  const prevCurrencyRateRef = React.useRef(null);

  const onPickCurrency = React.useCallback(
    async (it) => {
      setFinanceOpen(false);
      const prev = currency;
      setPendingCurrency(it.id);
      // reset recalc method to default when opening modal
      try {
        setRecalcMethod(MODAL_RECALC_METHODS[0]?.id || 'no_recalc');
        autoFetchedRef.current = false;
      } catch {}
      // try fetching approximate rate (prev -> it)
      if (prev && prev !== it.id) {
        const rate = await fetchRateFromApi(prev, it.id);
        if (rate) {
          // display as old -> new by default (1 old = X new)
          setCurrencyRate(String(rate));
          setRateDisplayDirection('old_to_new');
        }
      }
      // open confirm modal where admin can edit rate and choose recalc mode
      openModalAfterNativeClose(() => setCurrencyConfirmOpen(true));
    },
    [currency, fetchRateFromApi, MODAL_RECALC_METHODS, openModalAfterNativeClose],
  );

  // Auto-fetch rate helper used both by button and when modal opens
  const autoFetchRate = React.useCallback(async () => {
    if (!pendingCurrency) return null;
    setFetchRateError(null);
    setFetchingRate(true);
    try {
      // prefer companyData if available to avoid extra DB call
      let base = companyData?.currency;
      if (!base && companyId) {
        base = (
          await supabase
            .from('companies')
            .select('currency')
            .eq('id', companyId)
            .maybeSingle()
        ).data?.currency;
      }
      const target = pendingCurrency;
      const rate = await fetchRateFromApi(base, target);
      if (rate) {
        setCurrencyRate(String(rate));
        setRateDisplayDirection('old_to_new');
        autoFetchedRef.current = true;
        return rate;
      }
      setFetchRateError(t('modal_currency_rate_fetch_failed'));
      autoFetchedRef.current = true;
      return null;
    } catch {
      setFetchRateError(t('modal_currency_rate_fetch_failed'));
      autoFetchedRef.current = true;
      return null;
    } finally {
      setFetchingRate(false);
    }
  }, [pendingCurrency, companyData, companyId, fetchRateFromApi, t]);

  // When confirm modal opens, auto-load rate (if not already set)
  React.useEffect(() => {
    (async () => {
      if (!currencyConfirmOpen || !pendingCurrency) return;
      // only auto-fetch once per modal open; do not auto-fetch on user clearing the field
      if (autoFetchedRef.current) return;
      if (currencyRate && String(currencyRate).trim() !== '') {
        autoFetchedRef.current = true;
        return;
      }
      try {
        await autoFetchRate();
      } catch {
        autoFetchedRef.current = true;
      }
    })();
    return () => {
      // no-op cleanup
    };
  }, [currencyConfirmOpen, pendingCurrency, currencyRate, autoFetchRate]);

  // Improved perform: invalidate orders cache and optionally wait for background job
  const performCurrencyChange = React.useCallback(
    async (recalc) => {
      if (!pendingCurrency) return;
      setConfirmLoading(true);
      try {
        if (!companyId) throw new Error(t('errors_companyNotFound'));

        // normalize displayed rate to 'new per old' (p_currency_rate expects new_per_old)
        const displayedVal = currencyRate ? Number(currencyRate) : null;
        const normalizedRate = displayedVal
          ? rateDisplayDirection === 'old_to_new'
            ? displayedVal
            : 1 / displayedVal
          : null;

        // Call RPC
        const { error: rpcErr } = await supabase.rpc('company_set_currency', {
          p_company_id: companyId,
          p_new_currency: pendingCurrency,
          p_rate: normalizedRate,
          p_recalc_existing: recalc,
        });
        if (rpcErr) throw rpcErr;

        // Refresh company row immediately
        await refreshCompany();

        // Invalidate companySettings and any orders queries for this company
        try {
          await queryClient.invalidateQueries({ queryKey: COMPANY_SETTINGS_QUERY_KEY });
          await queryClient.invalidateQueries({
            predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'orders',
          });
        } catch {}

        setCurrencyConfirmOpen(false);
        setPendingCurrency(null);
        setCurrencyRate('');
        toast.show(t('toast_settingsSaved'), 'success');
      } catch (e) {
        toast.show(e?.message || t('toast_error'), 'error');
      } finally {
        setConfirmLoading(false);
      }
    },
    [companyId, pendingCurrency, currencyRate, rateDisplayDirection, t, toast, refreshCompany, queryClient],
  );

  const phoneModeOptions = React.useMemo(() => {
    try {
      return (PHONE_MODE_OPTIONS || []).map((o) => ({
        ...o,
        label: t(`settings_phone_mode_${o.id}`),
      }));
    } catch {
      return [
        { id: 'always', label: t('settings_phone_mode_always') },
        { id: 'window', label: t('settings_phone_mode_window') },
        { id: 'off', label: t('settings_phone_mode_off') },
      ];
    }
  }, [t]);

  const onPickPhoneMode = React.useCallback(
    (it) => {
      setPhoneModeOpen(false);
      if (it.id === 'window') {

        try {
          const b = decomposeMinutes(windowBefore);
          const a = decomposeMinutes(windowAfter);
          setBeforeUnit(b.unit);
          setWindowBefore(b.val);
          setAfterUnit(a.unit);
          setWindowAfter(a.val);
        } catch {}
        setPhoneMode('window');
        openModalAfterNativeClose(() => setWindowModalOpen(true));
        return;
      }
      setPhoneMode(it.id);
      toast.promise(() => updateSetting('worker_phone_mode', it.id), {
        loading: t('toast_loading'),
        success: t('toast_settingsSaved'),
        error: (e) => e?.message || t('toast_error'),
      });
    },
    [updateSetting, t, toast, windowBefore, windowAfter, decomposeMinutes, openModalAfterNativeClose],
  );

  const currentThemeLabel = React.useMemo(
    () => t(`settings_theme_${mode || 'system'}`),
    [mode, t],
  );
  const currentWorkMode = React.useMemo(
    () => localWorkModeOverride || (authAccountType === 'solo' ? 'solo' : 'company'),
    [authAccountType, localWorkModeOverride],
  );
  React.useEffect(() => {
    const metadataMode = authAccountType === 'solo' ? 'solo' : 'company';
    if (localWorkModeOverride && localWorkModeOverride === metadataMode) {
      setLocalWorkModeOverride(null);
    }
  }, [authAccountType, localWorkModeOverride]);
  const workModeItems = React.useMemo(
    () => [
      {
        id: 'solo',
        label: t('settings_work_mode_option_solo'),
        subtitle: t('settings_work_mode_option_solo_desc'),
      },
      {
        id: 'company',
        label: t('settings_work_mode_option_company'),
        subtitle: t('settings_work_mode_option_company_desc'),
      },
    ],
    [t],
  );
  const currentWorkModeLabel = React.useMemo(
    () =>
      currentWorkMode === 'solo' ? t('settings_work_mode_option_solo') : t('settings_work_mode_option_company'),
    [currentWorkMode, t],
  );
  const pendingWorkModeLabel = React.useMemo(
    () => (
      pendingWorkMode === 'solo'
        ? t('settings_work_mode_option_solo')
        : pendingWorkMode === 'company'
          ? t('settings_work_mode_option_company')
          : ''
    ),
    [pendingWorkMode, t],
  );
  const workModeConsentItems = React.useMemo(
    () => [
      { id: 'blockMembers', label: t('settings_work_mode_consent_block_members') },
      { id: 'reassignOrders', label: t('settings_work_mode_consent_reassign_orders') },
      { id: 'keepLicensesIdle', label: t('settings_work_mode_consent_keep_licenses_idle') },
    ],
    [t],
  );
  const allWorkModeConsentsAccepted = React.useMemo(
    () => workModeConsentItems.every((item) => !!workModeConsents[item.id]),
    [workModeConsentItems, workModeConsents],
  );
  const resolveWorkModeSwitchError = React.useCallback(
    (message, code) => {
      const normalizedCode = String(code || '').trim();
      if (normalizedCode === 'CONSENT_REQUIRED') {
        return t('settings_work_mode_consent_required');
      }
      return String(message || '').trim() || t('toast_error');
    },
    [t],
  );
  const unwrapEdgeFunctionError = React.useCallback(async (error) => {
    const fallback = {
      message: String(error?.message || '').trim(),
      code: String(error?.code || '').trim(),
    };
    try {
      const responseLike = error?.context;
      if (!responseLike || typeof responseLike.json !== 'function') return fallback;
      const payload = await responseLike.json().catch(() => null);
      if (!payload || typeof payload !== 'object') return fallback;
      return {
        message: String(payload?.message || fallback.message || '').trim(),
        code: String(payload?.code || fallback.code || '').trim(),
      };
    } catch {
      return fallback;
    }
  }, []);
  const onSelectWorkMode = React.useCallback(
    (item) => {
      const modeId = String(item?.id || '').trim();
      if (!modeId || modeId === currentWorkMode) {
        setWorkModeOpen(false);
        return;
      }
      setWorkModeSwitchFeedback(null);
      setPendingWorkMode(modeId);
      setWorkModeOpen(false);
      openModalAfterNativeClose(() => setWorkModeConfirmOpen(true));
    },
    [currentWorkMode, openModalAfterNativeClose],
  );
  const invokeWorkModeSwitch = React.useCallback(async () => {
    const targetMode = String(pendingWorkMode || '').trim();
    if (!targetMode) {
      const message = t('toast_error');
      setWorkModeSwitchFeedback({ message, type: 'error' });
      toast.show(message, 'error');
      return;
    }
    if (targetMode === currentWorkMode) {
      setWorkModeConfirmOpen(false);
      setWorkModeConsentOpen(false);
      setPendingWorkMode(null);
      workModeConfirmTransitionTargetRef.current = null;
      setWorkModeSwitchFeedback(null);
      setWorkModeConsents({ blockMembers: false, reassignOrders: false, keepLicensesIdle: false });
      return;
    }
    const isSwitchingCompanyToSolo = currentWorkMode === 'company' && targetMode === 'solo';
    if (isSwitchingCompanyToSolo && !allWorkModeConsentsAccepted) {
      const message = t('settings_work_mode_consent_required');
      setWorkModeSwitchFeedback({ message, type: 'warning' });
      toast.show(message, 'error');
      return;
    }
    setSwitchingWorkMode(true);
    setWorkModeSwitchFeedback(null);
    const loadingToast =
      t('settings_work_mode_saving');
    try {
      toast.show(loadingToast, 'info');
    } catch {}
    try {
      const { data, error } = await supabase.functions.invoke(FUNCTIONS.SWITCH_ACCOUNT_MODE, {
        body: {
          target_mode: targetMode,
          confirm_block_members: isSwitchingCompanyToSolo ? !!workModeConsents.blockMembers : true,
          confirm_reassign_orders: isSwitchingCompanyToSolo ? !!workModeConsents.reassignOrders : true,
          confirm_keep_licenses_idle: isSwitchingCompanyToSolo ? !!workModeConsents.keepLicensesIdle : true,
        },
      });
      if (error) throw error;
      if (data?.success === false) {
        const mapped = resolveWorkModeSwitchError(data?.message, data?.code);
        throw new Error(mapped);
      }
      const savedMode = String(data?.account_type || targetMode).toLowerCase() === 'solo' ? 'solo' : 'company';
      setLocalWorkModeOverride(savedMode);
      mergeAuthUserMetadata?.({ account_type: savedMode });
      let latestMetadata = user?.user_metadata || {};
      try {
        const { data: refreshed } = await supabase.auth.refreshSession();
        latestMetadata =
          refreshed?.session?.user?.user_metadata ||
          refreshed?.user?.user_metadata ||
          latestMetadata;
      } catch {}
      const refreshedMode = String(latestMetadata?.account_type || '').toLowerCase();
      if (data?.details?.metadata_sync_failed || refreshedMode !== savedMode) {
        const { error: metadataError } = await supabase.auth.updateUser({
          data: {
            ...latestMetadata,
            account_type: savedMode,
          },
        });
        if (metadataError) {
          console.warn('[CompanySettings] account mode metadata sync failed', metadataError?.message || metadataError);
        } else {
          mergeAuthUserMetadata?.({ account_type: savedMode });
        }
      }
      try {
        await supabase.auth.refreshSession();
      } catch {}
      toast.show(t('settings_work_mode_saved'), 'success');
      setWorkModeConfirmOpen(false);
      setWorkModeConsentOpen(false);
      setPendingWorkMode(null);
      workModeConfirmTransitionTargetRef.current = null;
      setWorkModeSwitchFeedback(null);
      setWorkModeConsents({ blockMembers: false, reassignOrders: false, keepLicensesIdle: false });
      try {
        await Promise.allSettled([
          queryClient.invalidateQueries({ queryKey: COMPANY_SETTINGS_QUERY_KEY }),
          queryClient.invalidateQueries({ queryKey: ['profile'] }),
          queryClient.invalidateQueries({ queryKey: ['employees'] }),
          queryClient.invalidateQueries({ queryKey: ['requests'] }),
        ]);
      } catch {}
    } catch (e) {
      const edgeError = await unwrapEdgeFunctionError(e);
      const message = resolveWorkModeSwitchError(edgeError?.message || e?.message, edgeError?.code || e?.code);
      setWorkModeSwitchFeedback({ message, type: 'error' });
      toast.show(message, 'error');
    } finally {
      setSwitchingWorkMode(false);
    }
  }, [
    currentWorkMode,
    allWorkModeConsentsAccepted,
    mergeAuthUserMetadata,
    pendingWorkMode,
    queryClient,
    resolveWorkModeSwitchError,
    t,
    toast,
    unwrapEdgeFunctionError,
    user?.user_metadata,
    workModeConsents.blockMembers,
    workModeConsents.keepLicensesIdle,
    workModeConsents.reassignOrders,
  ]);
  const confirmWorkModeSwitch = React.useCallback(() => {
    const targetMode = String(pendingWorkMode || '').trim();
    const requiresConsent = currentWorkMode === 'company' && targetMode === 'solo';
    if (requiresConsent) {
      workModeConfirmTransitionTargetRef.current = 'consent';
      setWorkModeSwitchFeedback(null);
      setWorkModeConfirmOpen(false);
      return;
    }
    invokeWorkModeSwitch();
  }, [currentWorkMode, invokeWorkModeSwitch, pendingWorkMode]);
  const applyWorkModeConsent = React.useCallback(() => {
    if (switchingWorkMode) return;
    if (!allWorkModeConsentsAccepted) {
      const message = t('settings_work_mode_consent_required');
      setWorkModeSwitchFeedback({ message, type: 'warning' });
      toast.show(message, 'error');
      return;
    }
    invokeWorkModeSwitch();
  }, [allWorkModeConsentsAccepted, invokeWorkModeSwitch, switchingWorkMode, t, toast]);
  React.useEffect(() => {
    setCurrentLocale(getLocale());
  }, [t]);
  const phoneModeItems = React.useMemo(() => {
    try {
      return (phoneModeOptions || []).map((o) => ({
        id: o.id,
        label: o.label,
        right:
          o.id === phoneMode ? (
            <Feather name="check" size={18} color={theme.colors.primary} />
          ) : null,
      }));
    } catch {
      return [];
    }
  }, [phoneModeOptions, phoneMode, theme.colors.primary]);
  const go = React.useCallback(
    (href) => () => {
      if (!href) return;
      runSingleNavigation(() => router.push(href));
    },
    [router, runSingleNavigation],
  );
  const findRoute = React.useCallback((key) => {
    try {
      for (const sec of Object.values(SETTINGS_SECTIONS)) {
        if (!sec || !Array.isArray(sec.items)) continue;
        const it = sec.items.find((i) => i && String(i.key) === String(key));
        if (it && it.route) return it.route;
      }
    } catch {}
    return undefined;
  }, []);

  const billingRoute = React.useMemo(() => findRoute('billing'), [findRoute]);

  // Section titles from i18n (do not trust constants' labels)
  const sectionTitles = React.useMemo(
    () => ({
      GENERAL: t('settings_sections_general_title'),
      APPEARANCE: t('settings_sections_appearance_title'),
      INTEGRATIONS: t('settings_sections_integrations_title'),
      MANAGEMENT: t('settings_sections_management_title'),
      DEPARTURE: t('settings_sections_departure_title'),
      PHONE: t('settings_sections_phone_title'),
    }),
    [t],
  );
  const disabledManagementKeys = React.useMemo(
    () => new Set(['notifications']),
    [],
  );
  const onSoonPress = React.useCallback(() => {
    toast.info(t('feature_future'));
  }, [t, toast]);

  if (isInitializing) {
    return (
      <Screen
        background="background"
        headerOptions={{
          title: isSoloAdmin
            ? t('settings_title')
            : t('company_settings_title', t('settings')),
          helpTopic: 'company_settings',
        }}
      >
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
        </View>
      </Screen>
    );
  }

  if (!canAccessCompanySettings) return null;

  return (
    <Screen
      background="background"
      headerOptions={{
        title: isSoloAdmin
          ? t('settings_title')
          : t('company_settings_title', t('settings')),
        helpTopic: 'company_settings',
      }}
    >
      <ScrollView
        contentContainerStyle={s.contentWrap}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* COMPANY */}
        <View style={s.sectionWrap}>
          <SectionHeader>{sectionTitles.GENERAL}</SectionHeader>
          <Card paddedXOnly separated>
            {!isSoloAdmin ? (
              <>
                <SelectField
                  label={t('fields_company_name')}
                  value={companyName || t('common_specify')}
                  onPress={() => {
                    setCompanyNameDraft(companyName);
                    setCompanyNameError('');
                    setCompanyNameOpen(true);
                  }}
                />
              </>
            ) : null}
            <SelectField
              label={t('settings_company_timezone')}
              labelAccessory={<HelpInfoButton topicId="timezone" size={22} />}
              value={timeZoneLabel}
              onPress={() => setTzOpen(true)}
            />

            <SelectField
              label={t('settings_company_work_mode')}
              labelAccessory={<HelpInfoButton topicId="work_mode" size={22} />}
              value={currentWorkModeLabel}
              onPress={() => setWorkModeOpen(true)}
            />

            {isAdmin ? (
              <>
                <SelectField
                  label={
                    isSoloAdmin
                      ? t('settings_company_billing_solo')
                      : t('settings_company_billing')
                  }
                  labelAccessory={<HelpInfoButton topicId="billing" size={22} />}
                  showValue={false}
                  onPress={billingRoute ? go(billingRoute) : undefined}
                  disabled={!billingRoute}
                  onDisabledPress={!billingRoute ? onSoonPress : undefined}
                />
              </>
            ) : null}

            <SelectField
              label={t('settings_company_exchange_orders')}
              showValue={false}
              disabled
              onDisabledPress={onSoonPress}
            />
            {/* moved: work types / departments now live in reference section */}
          </Card>
        </View>


        {isSoloAdmin ? (
          <View style={s.sectionWrap}>
            <SectionHeader>{sectionTitles.APPEARANCE}</SectionHeader>
            <Card paddedXOnly separated>
              <SelectField
                label={t('settings_sections_appearance_items_theme')}
                value={currentThemeLabel}
                onPress={() => setThemeOpen(true)}
              />
              <SelectField
                label={t('settings_sections_appearance_items_language')}
                value={t(`language_${currentLocale}`)}
                onPress={() => setLangOpen(true)}
              />
            </Card>
          </View>
        ) : null}

        {isSoloAdmin ? (
          <View style={s.sectionWrap}>
            <SectionHeader>{t('settings_sections_data_title')}</SectionHeader>
            <Card paddedXOnly separated>
              <SelectField
                label={t('settings_sections_data_items_trash')}
                showValue={false}
                onPress={go('/app_settings/trash')}
              />
            </Card>
          </View>
        ) : null}

        <View style={s.sectionWrap}>
          <SectionHeader>{t('settings_sections_reference_title')}</SectionHeader>
          <Card paddedXOnly separated>
            {SETTINGS_SECTIONS.REFERENCE.items
              .filter((it) => !(isSoloAdmin && ['employees', 'departments'].includes(String(it?.key || ''))))
              .map((it) => (
              <React.Fragment key={it.key}>
                <SelectField
                  label={t(it.labelKey)}
                  labelAccessory={it.helpTopic ? <HelpInfoButton topicId={it.helpTopic} size={22} /> : null}
                  showValue={false}
                  onPress={it.route ? go(it.route) : undefined}
                  disabled={!it.route}
                  onDisabledPress={!it.route ? onSoonPress : undefined}
                />
              </React.Fragment>
            ))}
          </Card>
        </View>

        {/* INTEGRATIONS */}
        <View style={s.sectionWrap}>
          <SectionHeader>{sectionTitles.INTEGRATIONS}</SectionHeader>
          <Card paddedXOnly separated>
            {SETTINGS_SECTIONS.INTEGRATIONS.items.map((it) => (
              <React.Fragment key={it.key}>
                <SelectField
                  label={t(`settings_integrations_${it.key}`)}
                  labelAccessory={it.helpTopic ? <HelpInfoButton topicId={it.helpTopic} size={22} /> : null}
                  showValue={false}
                  onPress={it.route ? go(it.route) : undefined}
                  disabled={!it.route}
                  onDisabledPress={!it.route ? onSoonPress : undefined}
                />
              </React.Fragment>
            ))}
          </Card>
        </View>

        {/* MANAGEMENT */}
        <View style={s.sectionWrap}>
          <SectionHeader>{sectionTitles.MANAGEMENT}</SectionHeader>
          <Card paddedXOnly separated>
            {SETTINGS_SECTIONS.MANAGEMENT.items
              .filter((it) =>
                !['work_types', 'departments'].includes(it.key) &&
                !(isSoloAdmin && it?.companyOnly === true),
              )
              .map((it) => (
                <React.Fragment key={it.key}>
                  <SelectField
                    label={t(`settings_management_${it.key}`)}
                    labelAccessory={it.helpTopic ? <HelpInfoButton topicId={it.helpTopic} size={22} /> : null}
                    showValue={false}
                    onPress={go(it.route)}
                    disabled={disabledManagementKeys.has(it.key)}
                    onDisabledPress={onSoonPress}
                  />
                </React.Fragment>
              ))}
          </Card>
        </View>

        {/* DEPARTURE */}
        {!isSoloAdmin ? (
          <View style={s.sectionWrap}>
            <SectionHeader>{sectionTitles.DEPARTURE}</SectionHeader>
            <Card paddedXOnly separated>
              <SelectField
                label={t('settings_phone_mode')}
                labelAccessory={<HelpInfoButton topicId="phone_visibility" size={22} />}
                showValue={false}
                onPress={go('/company_settings/sections/phone')}
              />
            </Card>
          </View>
        ) : null}

        {/* FINANCES */}
        <View style={s.sectionWrap}>
          <SectionHeader>{t('company_settings_sections_finances_title')}</SectionHeader>
          <Card paddedXOnly separated>
            <SelectField
              label={t('settings_company_currency_label')}
              value={fixedCurrencyLabel}
              valueNumberOfLines={3}
              disabled
              onDisabledPress={onSoonPress}
            />
          </Card>
        </View>
      </ScrollView>

      {/* Company name editor */}
      <BaseModal
        key={`company-${companyModalKey}`}
        visible={companyNameOpen}
        onClose={closeCompanyEditor}
        title={t('modal_company_title')}
        maxHeightRatio={0.5}
        footer={
          <View style={{ flexDirection: 'row', gap: theme.components.button.groupGap }}>
            <View style={{ flex: 1 }}>
              <UIButton title={t('btn_cancel')} variant="secondary" onPress={() => setCompanyNameOpen(false)} />
            </View>
            <View style={{ flex: 1 }}>
              <UIButton
                variant="primary"
                size="md"
                onPress={saveCompanyNameDraft}
                title={savingCompany ? t('btn_saving') : t('btn_save')}
                formSubmit
              />
            </View>
          </View>
        }
      >
        <View style={{ marginBottom: theme.spacing.sm }}>
          <TextField
            value={companyNameDraft}
            onChangeText={(txt) => {
              setCompanyNameDraft(txt);
              if (companyNameError) setCompanyNameError('');
            }}
            placeholder={t('placeholders.company_name_example')}
            autoFocus
            returnKeyType="done"
            maxLength={64}
            onSubmitEditing={() => {
              saveCompanyNameDraft();
            }}
          />
          {companyNameError ? (
            <Text
              style={{
                color: theme.colors.danger,
                fontSize: theme.typography.sizes.xs,
                marginTop: theme.spacing.xs,
                marginLeft: theme.spacing.md,
              }}
            >
              {companyNameError}
            </Text>
          ) : (
            <Text
              style={{
                color: theme.colors.textSecondary,
                fontSize: theme.typography.sizes.xs,
                marginTop: theme.spacing.xs,
                marginLeft: theme.spacing.md,
              }}
            >
              {t('hints_company_name_visible')}
            </Text>
          )}
        </View>
      </BaseModal>

      {/* Timezone picker */}
      <SelectModal
        visible={tzOpen}
        title={t('modal_timezone_title')}
        items={tzItems}
        selectedId={timeZone}
        initialScrollIndex={tzInitialIndex >= 0 ? tzInitialIndex : undefined}
        listBottomInset={theme.spacing.lg}
        isItemSelected={(item, id) => String(item?.id) === String(id)}
        onSelect={onPickTimeZone}
        onClose={() => setTzOpen(false)}
        searchable={false}
      />

      <SelectModal
        visible={themeOpen}
        title={t('settings_theme_title')}
        items={[
          { id: 'light', label: t('settings_theme_light') },
          { id: 'dark', label: t('settings_theme_dark') },
          { id: 'system', label: t('settings_theme_system') },
        ]}
        searchable={false}
        selectedId={mode}
        onSelect={(item) => {
          setMode(item?.id || 'system');
          setThemeOpen(false);
        }}
        onClose={() => setThemeOpen(false)}
      />

      <SelectModal
        visible={langOpen}
        title={t('settings_language_title')}
        items={availableLocales.map((id) => ({ id, label: t(`language_${id}`) }))}
        searchable={false}
        selectedId={currentLocale}
        onSelect={async (item) => {
          const selectedLocale = String(item?.id || '').trim();
          if (!selectedLocale) {
            setLangOpen(false);
            return;
          }
          try {
            await setLocale(selectedLocale);
            setCurrentLocale(selectedLocale);
            try {
              await saveUserLocale(selectedLocale);
            } catch {}
            toast.info(t('lang_changed'));
          } finally {
            setLangOpen(false);
          }
        }}
        onClose={() => setLangOpen(false)}
      />

      <BaseModal
        visible={workModeOpen}
        title={t('settings_work_mode_modal_title')}
        onClose={() => setWorkModeOpen(false)}
      >
        <View style={{ gap: theme.spacing.sm, paddingBottom: theme.spacing.md }}>
          {workModeItems.map((item) => {
            const selected = String(item.id) === String(currentWorkMode);
            return (
              <Pressable
                key={item.id}
                onPress={() => onSelectWorkMode(item)}
                style={({ pressed }) => [
                  {
                    minHeight: theme.components?.listItem?.height ?? 52,
                    paddingHorizontal: theme.spacing.lg,
                    paddingVertical: theme.spacing.sm,
                    borderRadius: theme.radii.md,
                    borderWidth: selected ? 2 : theme.components.card.borderWidth,
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                    backgroundColor: theme.colors.surface,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: theme.spacing.sm,
                  },
                  pressed && Platform.OS === 'ios' ? { backgroundColor: theme.colors.ripple } : null,
                ]}
                accessibilityRole="button"
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={{
                      color: theme.colors.text,
                      fontSize: theme.typography.sizes.md,
                      fontWeight: '600',
                    }}
                  >
                    {item.label}
                  </Text>
                  {item.subtitle ? (
                    <Text
                      style={{
                        color: theme.colors.textSecondary,
                        fontSize: theme.typography.sizes.sm,
                        marginTop: 2,
                        lineHeight: Math.round((theme.typography.sizes.sm || 14) * 1.35),
                      }}
                    >
                      {item.subtitle}
                    </Text>
                  ) : null}
                </View>
                <View
                  style={{
                    width: theme.components?.radio?.size ?? theme.icons?.md ?? 22,
                    height: theme.components?.radio?.size ?? theme.icons?.md ?? 22,
                    borderRadius: (theme.components?.radio?.size ?? theme.icons?.md ?? 22) / 2,
                    borderWidth: theme.components?.radio?.borderWidth ?? 1.5,
                    borderColor: selected ? theme.colors.primary : theme.colors.inputBorder,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {selected ? (
                    <View
                      style={{
                        width: theme.components?.radio?.dot ?? 8,
                        height: theme.components?.radio?.dot ?? 8,
                        borderRadius: (theme.components?.radio?.dot ?? 8) / 2,
                        backgroundColor: theme.colors.primary,
                      }}
                    />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </BaseModal>

      <BaseModal
        visible={workModeConfirmOpen}
        onClose={() => {
          if (switchingWorkMode) return;
          if (workModeConfirmTransitionTargetRef.current === 'consent') return;
          workModeConfirmTransitionTargetRef.current = null;
          setWorkModeConfirmOpen(false);
          setPendingWorkMode(null);
          setWorkModeSwitchFeedback(null);
          setWorkModeConsents({ blockMembers: false, reassignOrders: false, keepLicensesIdle: false });
        }}
        onDismiss={() => {
          if (workModeConfirmTransitionTargetRef.current !== 'consent') return;
          workModeConfirmTransitionTargetRef.current = null;
          setWorkModeConsentOpen(true);
        }}
        title={t('settings_work_mode_confirm_title')}
        feedback={workModeSwitchFeedback}
        footer={(
          <ModalActionsRow
            actions={[
              {
                key: 'cancel',
                title: t('btn_cancel'),
                variant: 'secondary',
                disabled: switchingWorkMode,
                onPress: () => {
                  workModeConfirmTransitionTargetRef.current = null;
                  setWorkModeConfirmOpen(false);
                  setPendingWorkMode(null);
                  setWorkModeSwitchFeedback(null);
                  setWorkModeConsents({ blockMembers: false, reassignOrders: false, keepLicensesIdle: false });
                },
              },
              {
                key: 'continue',
                title: t('btn_continue'),
                variant: 'primary',
                loading: switchingWorkMode,
                disabled: switchingWorkMode,
                onPress: confirmWorkModeSwitch,
              },
            ]}
          />
        )}
      >
        <View style={{ gap: theme.spacing.sm }}>
          <View style={{ gap: theme.spacing.sm }}>
            <Text style={{ color: theme.colors.text }}>
              {`${t('settings_work_mode_confirm_message_prefix')} ${pendingWorkModeLabel}?`}
            </Text>
            <Text style={{ color: theme.colors.textSecondary }}>
              {t('settings_work_mode_confirm_message_hint')}
            </Text>
          </View>
        </View>
      </BaseModal>

      <BaseModal
        visible={workModeConsentOpen}
        onClose={() => {
          if (switchingWorkMode) return;
          workModeConfirmTransitionTargetRef.current = null;
          setWorkModeConsentOpen(false);
          setPendingWorkMode(null);
          setWorkModeSwitchFeedback(null);
          setWorkModeConsents({ blockMembers: false, reassignOrders: false, keepLicensesIdle: false });
        }}
        title={t('settings_work_mode_apply_title')}
        feedback={workModeSwitchFeedback}
        footer={(
          <ModalActionsRow
            actions={[
              {
                key: 'cancel',
                title: t('btn_cancel'),
                variant: 'secondary',
                disabled: switchingWorkMode,
                onPress: () => {
                  workModeConfirmTransitionTargetRef.current = null;
                  setWorkModeConsentOpen(false);
                  setPendingWorkMode(null);
                  setWorkModeSwitchFeedback(null);
                  setWorkModeConsents({ blockMembers: false, reassignOrders: false, keepLicensesIdle: false });
                },
              },
              {
                key: 'apply',
                title: t('btn_apply'),
                variant: 'primary',
                loading: switchingWorkMode,
                disabled: switchingWorkMode || !allWorkModeConsentsAccepted,
                onPress: applyWorkModeConsent,
              },
            ]}
          />
        )}
      >
        <View style={{ gap: theme.spacing.md }}>
          <Text style={{ color: theme.colors.textSecondary }}>
            {t('settings_work_mode_apply_description')}
          </Text>
          {workModeConsentItems.map((item) => {
            const checked = !!workModeConsents[item.id];
            return (
              <Pressable
                key={item.id}
                onPress={() =>
                  setWorkModeConsents((prev) => ({
                    ...prev,
                    [item.id]: !prev[item.id],
                  }))}
                style={({ pressed }) => [
                  {
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: theme.spacing.sm,
                    paddingVertical: theme.spacing.sm,
                    paddingHorizontal: theme.spacing.sm,
                    borderRadius: theme.radii.md,
                    borderWidth: theme.components.card.borderWidth,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surface,
                  },
                  pressed && Platform.OS === 'ios' ? { backgroundColor: theme.colors.ripple } : null,
                ]}
              >
                <Checkbox
                  value={checked}
                  onValueChange={(value) =>
                    setWorkModeConsents((prev) => ({
                      ...prev,
                      [item.id]: !!value,
                    }))}
                />
                <Text
                  style={{
                    color: theme.colors.text,
                    flex: 1,
                    fontSize: theme.typography.sizes.md,
                    lineHeight: Math.round(
                      (theme.typography.sizes.md || 16) * (theme.typography.lineHeights?.normal || 1.35),
                    ),
                  }}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </BaseModal>

      {/* Currency picker */}
      <SelectModal
        visible={financeOpen}
        title={t('modal_currency_title')}
        items={CURRENCY_OPTIONS.map((c) => ({
          id: c.id,
          label: `${getCurrencySymbol(c.id)} ${c.label}`,
          right:
            c.id === currency ? (
              <Feather name="check" size={18} color={theme.colors.primary} />
            ) : null,
        }))}
        onSelect={onPickCurrency}
        onClose={() => setFinanceOpen(false)}
        searchable={false}
      />

      {/* Confirm currency change modal with editable rate and recalc option */}
      <BaseModal
        visible={currencyConfirmOpen}
        onClose={() => {
          setCurrencyConfirmOpen(false);
          setPendingCurrency(null);
          setCurrencyRate('');
          setFetchRateError(null);
          setRecalcMethod(MODAL_RECALC_METHODS[0]?.id || 'no_recalc');
        }}
        title={t('modal_currency_title')}
        footer={
          <View style={{ flexDirection: 'row', gap: theme.components.button.groupGap }}>
            <View style={{ flex: 1 }}>
              <UIButton
                title={t('btn_cancel')}
                variant="secondary"
                onPress={() => {
                  setCurrencyConfirmOpen(false);
                  setPendingCurrency(null);
                  setFetchRateError(null);
                  setRecalcMethod(MODAL_RECALC_METHODS[0]?.id || 'no_recalc');
                }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <UIButton
                title={t('btn_ok')}
                loading={confirmLoading}
                disabled={confirmLoading}
                onPress={async () => {
                  const needsRecalc =
                    recalcMethod === MODAL_RECALC_METHODS.find((m) => m.id === 'recalc')?.id ||
                    recalcMethod === 'recalc';
                  if (needsRecalc && (!currencyRate || Number.isNaN(Number(currencyRate)))) {
                    toast.show(t('modal_currency_rate_required'), 'info');
                    return;
                  }
                  try {
                    setConfirmLoading(true);
                    await performCurrencyChange(needsRecalc);
                  } catch {
                    toast.show(err?.message || t('toast_error'), 'error');
                  } finally {
                    setConfirmLoading(false);
                  }
                }}
              />
            </View>
          </View>
        }
      >
        <KeyboardAwareScrollView contentContainerStyle={{ gap: theme.spacing.md }}>
          <Text style={{ color: theme.colors.textSecondary }}>
            {t('modal_currency_confirm_recalc')}
          </Text>

          {/* Two selectable rows: no recalc / recalc */}
          <View style={{ gap: 8, marginTop: 8 }}>
            {MODAL_RECALC_METHODS.map((m) => {
              const selected = recalcMethod === m.id;
              return (
                <Pressable
                  key={m.id}
                  onPress={() => setRecalcMethod(m.id)}
                  style={({ pressed }) => [
                    {
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: theme.spacing.md,
                      borderRadius: theme.radii.md,
                      backgroundColor: theme.colors.surface,
                      borderWidth: 1,
                      borderColor: selected ? theme.colors.primary : theme.colors.border,
                    },
                    pressed && Platform.OS === 'ios'
                      ? { backgroundColor: theme.colors.ripple }
                      : null,
                  ]}
                >
                  <Text style={{ color: theme.colors.text }}>{m.label}</Text>
                  {selected ? (
                    <Feather name="check" size={18} color={theme.colors.primary} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          {/* If user chose recalc, show rate picker/edit controls */}
          {recalcMethod === MODAL_RECALC_METHODS.find((mm) => mm.id === 'recalc')?.id ? (
            <View style={{ gap: theme.spacing.md }}>
              {/* Two inline editable rows: 1 old = X new  and 1 new = Y old */}
              {(() => {
                const baseLabel =
                  t(`finance_currency_${companyData?.currency || ''}`) ||
                  companyData?.currency ||
                  '';
                const newLabel =
                  t(`finance_currency_${pendingCurrency || ''}`) || pendingCurrency || '';
                const fmt = (n) =>
                  typeof n === 'number' && Number.isFinite(n)
                    ? new Intl.NumberFormat(undefined, { maximumSignificantDigits: 6 }).format(n)
                    : '';

                const displayOldToNew =
                  rateDisplayDirection === 'old_to_new'
                    ? currencyRate || (normalizedRate ? String(normalizedRate) : '')
                    : normalizedRate
                      ? fmt(normalizedRate)
                      : currencyRate || '';

                const displayNewToOld =
                  rateDisplayDirection === 'new_to_old'
                    ? currencyRate || (invertedRate ? String(invertedRate) : '')
                    : invertedRate
                      ? fmt(invertedRate)
                      : currencyRate || '';

                return (
                  <>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <Text
                        style={{ color: theme.colors.text, marginRight: 6, flexShrink: 1 }}
                      >{`1 ${baseLabel} =`}</Text>
                      <View style={{ maxWidth: 160, flex: 1, minWidth: 96 }}>
                        <TextField
                          value={displayOldToNew}
                          onFocus={() => {
                            // remember previous non-empty value so we can restore if user leaves empty
                            prevCurrencyRateRef.current = currencyRate;
                          }}
                          onBlur={() => {
                            if (!String(currencyRate || '').trim()) {
                              // restore previous value when keyboard closed with empty field
                              setCurrencyRate(prevCurrencyRateRef.current ?? '');
                            }
                          }}
                          onChangeText={(txt) => {
                            setCurrencyRate(txt);
                            setRateDisplayDirection('old_to_new');
                            if (fetchRateError) setFetchRateError(null);
                          }}
                          placeholder={t('modal_currency_rate_placeholder')}
                          keyboardType="numeric"
                          numericInput={{ allowNegative: false }}
                        />
                      </View>
                      <Text style={{ color: theme.colors.text, marginLeft: 6, flexShrink: 1 }}>
                        {newLabel}
                      </Text>
                      <View style={{ flex: 1, minWidth: 8 }} />
                      <Pressable
                        onPress={async () => {
                          await autoFetchRate();
                        }}
                        style={({ pressed }) => [
                          {
                            paddingVertical: 8,
                            paddingHorizontal: 12,
                            borderRadius: 8,
                            backgroundColor: theme.colors.surface,
                            borderWidth: 1,
                            borderColor: theme.colors.border,
                          },
                          pressed && Platform.OS === 'ios'
                            ? { backgroundColor: theme.colors.ripple }
                            : null,
                        ]}
                      >
                        {fetchingRate ? (
                          <ActivityIndicator size="small" color={theme.colors.text} />
                        ) : (
                          <Text style={{ color: theme.colors.text }}>
                            {t('modal_currency_rate_autofill')}
                          </Text>
                        )}
                      </Pressable>
                    </View>

                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <Text
                        style={{ color: theme.colors.text, marginRight: 6, flexShrink: 1 }}
                      >{`1 ${newLabel} =`}</Text>
                      <View style={{ maxWidth: 160, flex: 1, minWidth: 96 }}>
                        <TextField
                          value={displayNewToOld}
                          onFocus={() => {
                            prevCurrencyRateRef.current = currencyRate;
                          }}
                          onBlur={() => {
                            if (!String(currencyRate || '').trim()) {
                              setCurrencyRate(prevCurrencyRateRef.current ?? '');
                            }
                          }}
                          onChangeText={(txt) => {
                            setCurrencyRate(txt);
                            setRateDisplayDirection('new_to_old');
                            if (fetchRateError) setFetchRateError(null);
                          }}
                          placeholder={t('modal_currency_rate_placeholder')}
                          keyboardType="numeric"
                          numericInput={{ allowNegative: false }}
                        />
                      </View>
                      <Text style={{ color: theme.colors.text, marginLeft: 6, flexShrink: 1 }}>
                        {baseLabel}
                      </Text>
                    </View>
                  </>
                );
              })()}

              {fetchRateError ? (
                <Text style={{ color: theme.colors.danger }}>{fetchRateError}</Text>
              ) : null}
            </View>
          ) : null}
        </KeyboardAwareScrollView>
      </BaseModal>


      <BaseModal
        visible={windowModalOpen}
        onClose={() => setWindowModalOpen(false)}
        title={t('modal_phoneWindow_title')}
        maxHeightRatio={0.6}
        footer={
          <View style={{ flexDirection: 'row', gap: theme.components.button.groupGap }}>
            <View style={{ flex: 1 }}>
              <UIButton
                title={t('btn_cancel')}
                variant="secondary"
                onPress={() => {
                  setWindowModalOpen(false);
                  openModalAfterNativeClose(() => setPhoneModeOpen(true));
                }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <UIButton
                variant="primary"
                size="md"
                title={t('btn_apply')}
                formSubmit
                disabled={!String(windowBefore).trim() || !String(windowAfter).trim()}
                onPress={() => {
                const beforeM = toMinutes(windowBefore, beforeUnit);
                const afterM = toMinutes(windowAfter, afterUnit);
                toast
                  .promise(
                    () =>
                      updateSettings({
                        worker_phone_mode: 'window',
                        worker_phone_window_before_mins: beforeM,
                        worker_phone_window_after_mins: afterM,
                      }),
                    {
                      loading: t('toast_loading'),
                      success: t('toast_settingsSaved'),
                      error: (e) => e?.message || t('toast_error'),
                    },
                  )
                  .then(() => {
                    setWindowBefore(String(beforeM));
                    setWindowAfter(String(afterM));
                    setPhoneMode('window');
                    setWindowModalOpen(false);
                  });
                }}
              />
            </View>
          </View>
        }
      >
        <KeyboardAwareScrollView contentContainerStyle={{ gap: theme.spacing.lg }}>

          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.lg,
              borderWidth: 1,
              borderColor: theme.colors.border,
              padding: theme.spacing.md,
            }}
          >
            <Text
              style={{
                color: theme.colors.text,
                fontWeight: '700',
                marginBottom: theme.spacing.xs,
              }}
            >
              {t('phone_window_before')}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.spacing.sm }}>
              <View style={{ flex: 1 }}>
                <TextField
                  label={t('common_value')}
                  value={windowBefore}
                  onChangeText={setWindowBefore}
                  keyboardType="numeric"
                  numericInput={{ allowDecimal: false, allowNegative: false }}
                  returnKeyType="done"
                />
              </View>
              <View style={{ width: 160 }}>
                <SelectField
                  label={t('common_unit')}
                  value={UNIT_ITEMS.find((u) => u.id === beforeUnit)?.label}
                  onPress={() => setBeforeUnitOpen(true)}
                />
              </View>
            </View>
          </View>


          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.lg,
              borderWidth: 1,
              borderColor: theme.colors.border,
              padding: theme.spacing.md,
            }}
          >
            <Text
              style={{
                color: theme.colors.text,
                fontWeight: '700',
                marginBottom: theme.spacing.xs,
              }}
            >
              {t('phone_window_after')}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.spacing.sm }}>
              <View style={{ flex: 1 }}>
                <TextField
                  label={t('common_value')}
                  value={windowAfter}
                  onChangeText={setWindowAfter}
                  keyboardType="numeric"
                  numericInput={{ allowDecimal: false, allowNegative: false }}
                  returnKeyType="done"
                />
              </View>
              <View style={{ width: 160 }}>
                <SelectField
                  label={t('common_unit')}
                  value={UNIT_ITEMS.find((u) => u.id === afterUnit)?.label}
                  onPress={() => setAfterUnitOpen(true)}
                />
              </View>
            </View>
          </View>

          {/* Hint */}
          <View style={{ paddingHorizontal: 4 }}>
            <Text
              style={{ color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm }}
            >
              {t('phone_window_hint_with_time')}{' '}
              {t('phone_window_hint_tz')}
            </Text>
          </View>


          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: theme.spacing.sm,
              paddingHorizontal: 4,
            }}
          >
            <View
              style={{
                paddingVertical: 6,
                paddingHorizontal: 10,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface,
              }}
            >
              <Text style={{ color: theme.colors.textSecondary }}>
                {windowBefore} {UNIT_ITEMS.find((u) => u.id === beforeUnit)?.label}
              </Text>
            </View>
            <View
              style={{
                paddingVertical: 6,
                paddingHorizontal: 10,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface,
              }}
            >
              <Text style={{ color: theme.colors.textSecondary }}>
                {windowAfter} {UNIT_ITEMS.find((u) => u.id === afterUnit)?.label}
              </Text>
            </View>
          </View>
        </KeyboardAwareScrollView>
      </BaseModal>


      <SelectModal
        visible={beforeUnitOpen}
        title={t('modal_pick_unit')}
        items={UNIT_ITEMS.map((u) => ({ id: u.id, label: u.label }))}
        onSelect={(it) => {
          setBeforeUnit(it.id);
          setBeforeUnitOpen(false);
        }}
        onClose={() => setBeforeUnitOpen(false)}
        searchable={false}
      />


      <SelectModal
        visible={afterUnitOpen}
        title={t('modal_pick_unit')}
        items={UNIT_ITEMS.map((u) => ({ id: u.id, label: u.label }))}
        onSelect={(it) => {
          setAfterUnit(it.id);
          setAfterUnitOpen(false);
        }}
        onClose={() => setAfterUnitOpen(false)}
        searchable={false}
      />

      {/* Phone mode picker */}
      <SelectModal
        visible={phoneModeOpen}
        title={t('modal_phoneMode_title')}
        items={phoneModeItems}
        onSelect={onPickPhoneMode}
        onClose={() => setPhoneModeOpen(false)}
        searchable={false}
      />
    </Screen>
  );
}

const styles = (t) =>
  StyleSheet.create({
    contentWrap: {
      paddingHorizontal: t.components.screenLayout.contentPaddingX,
      paddingBottom: t.components.screenLayout.contentPaddingBottom,
    },
    sectionWrap: { marginBottom: 0 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: t.components.row.minHeight,
      paddingVertical: t.components.row.py ? t.spacing[t.components.row.py] : 0,
    },
    rowLabel: { color: t.colors.textStrong ?? t.colors.text },
    itemLabel: {
      color: t.colors.textStrong ?? t.colors.text,
      fontWeight: t.typography.weight.regular,
    },
    captionWrap: {
      paddingHorizontal: t.spacing[t.components.card.padX || 'md'],
      paddingBottom: t.spacing.md,
      paddingTop: t.spacing.xs,
    },
    caption: { color: t.colors.textSecondary, fontSize: t.typography.sizes.sm },
  });
