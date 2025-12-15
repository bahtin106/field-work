// app/company_settings/index.jsx
import { useRoute } from '@react-navigation/native';
import { useNavigation, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import Screen from '../../components/layout/Screen';
import UIButton from '../../components/ui/Button';
import { BaseModal, SelectModal } from '../../components/ui/modals';
import TextField, { SelectField } from '../../components/ui/TextField';
import { useToast } from '../../components/ui/ToastProvider';
import { PHONE_MODE_OPTIONS, SETTINGS_SECTIONS } from '../../constants/settings';
import { useI18nVersion } from '../../src/i18n';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme/ThemeProvider';

import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useQueryWithCache } from '../../components/hooks/useQueryWithCache';
import { getCurrencySymbol } from '../../lib/currency';
import { supabase } from '../../lib/supabase';

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
  'Asia/Magадан',
  'Asia/Кamчатка',
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

/** RU-friendly city names; fallback → last segment */
const RU_CITY = {
  'Europe/Moscow': 'Москва',
  'Europe/Kaliningrad': 'Калининград',
  'Europe/Samara': 'Самара',
  'Europe/Saratov': 'Саратов',
  'Asia/Yekaterinburg': 'Екатеринбург',
  'Asia/Omsk': 'Омск',
  'Asia/Novosibirsk': 'Новосибирск',
  'Asia/Krasnoyarsk': 'Красноярск',
  'Asia/Irkutsk': 'Иркутск',
  'Asia/Yakutsk': 'Якутск',
  'Asia/Vladivostok': 'Владивосток',
  'Asia/Magadan': 'Магадан',
  'Asia/Sakhalin': 'Сахалин',
  'Asia/Кamчатка': 'Камчатка',
  'Asia/Almaty': 'Алматы',
  'Asia/Aqtau': 'Актау',
  'Asia/Aqtobe': 'Актобе',
  'Asia/Atyrau': 'Атырау',
  'Asia/Oral': 'Орал',
  'Asia/Qostanay': 'Костанай',
  'Asia/Qyzylorda': 'Кызылорда',
};

function getOffsetMinutes(zone) {
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
    return diffMin;
  } catch (e) {
    try {
      const now = new Date();
      const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
      const tz = new Date(now.toLocaleString('en-US', { timeZone: zone }));
      if (!isNaN(tz.getTime()) && !isNaN(utc.getTime())) {
        return Math.round((tz - utc) / 60000);
      }
    } catch {}
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

/** Build label "Город — UTC+03:00" */
function zoneToItem(zone, deviceZone, t) {
  const offsetMin = getOffsetMinutes(zone);
  const offset = formatUtcOffset(offsetMin);
  const city = RU_CITY[zone] ?? zone.split('/').pop().replace(/_/g, ' ');
  const isDevice = zone === deviceZone;
  const label = `${city} — ${offset}`;
  const basic = [
    zone,
    offset,
    offset.replace(':00', ''),
    offset.replace('UTC', '').trim(),
    offset.replace('UTC', '').replace(':00', '').trim(),
    `${offsetMin >= 0 ? '+' : ''}${Math.floor(offsetMin / 60)}`,
  ].join(' ');
  const subtitle = isDevice ? `${basic} · ${t('timezone_subtitle_device')}` : basic;
  return { id: zone, label, subtitle, offsetMin, city };
}

export default function CompanySettings() {
  const toast = useToast();
  const { theme } = useTheme();
  const nav = useNavigation();
  const route = useRoute();
  const router = useRouter();
  const { t } = useTranslation();
  const ver = useI18nVersion();
  const queryClient = useQueryClient();

  // Загружаем настройки компании с кешем
  const {
    data: companyData,
    isLoading: isLoadingCompany,
    refresh: refreshCompany,
  } = useQueryWithCache({
    queryKey: 'companySettings',
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: profile } = await supabase
        .from('profiles')
        .select('company_id, timezone')
        .eq('id', user.id)
        .single();

      const companyId = profile?.company_id;
      if (!companyId) return null;

      const { data: companyRow } = await supabase
        .from('companies')
        .select(
          'name, timezone, use_departure_time, worker_phone_mode, worker_phone_window_before_mins, worker_phone_window_after_mins, currency, currency_rate, currency_rate_updated_at, recalc_in_progress',
        )
        .eq('id', companyId)
        .single();

      return companyRow;
    },
    ttl: 5 * 60 * 1000, // 5 минут
    staleTime: 2 * 60 * 1000, // 2 минуты
    placeholderData: null,
    enableRealtime: true,
    realtimeTable: 'companies',
    supabaseClient: supabase,
  });

  // Единицы времени и преобразователи — зависят от t, поэтому внутри компонента
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

  // Батч-обновление нескольких полей компаний
  const updateSettings = React.useCallback(
    async (patch) => {
      if (!supabase) throw new Error(t('errors_noDb'));
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error(t('errors_noAuth'));
      const { data: profile } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', user.id)
        .single();
      const companyId = profile?.company_id;
      if (!companyId) throw new Error(t('errors_companyNotFound'));
      const { error } = await supabase.from('companies').update(patch).eq('id', companyId);
      if (error) throw error;

      // Обновляем кеш после успешного сохранения
      await refreshCompany();

      return true;
    },
    [t, refreshCompany],
  );

  const s = React.useMemo(() => styles(theme), [theme]);

  // Инициализация state из кеша
  const [timeZone, setTimeZone] = React.useState(
    () => companyData?.timezone || getDeviceTimeZone(),
  );
  const [financeOpen, setFinanceOpen] = React.useState(false);
  const [currency, setCurrency] = React.useState(null);
  const [currencyRate, setCurrencyRate] = React.useState('');
  const [fetchRateError, setFetchRateError] = React.useState(null);
  const [currencyModalKey, setCurrencyModalKey] = React.useState(0);
  const [fetchingRate, setFetchingRate] = React.useState(false);
  const [rateDisplayDirection, setRateDisplayDirection] = React.useState('old_to_new');
  const [isAdmin, setIsAdmin] = React.useState(false);
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
    } catch (_) {}
    setCompanyNameOpen(false);
    setCompanyNameError('');
    setSavingCompany(false);
    // Force re-create modal instance to avoid any stale RN Modal overlays
    setTimeout(() => {
      try {
        setCompanyModalKey((k) => k + 1);
      } catch (_) {}
    }, 0);
  }, []);

  const [useDepartureTime, setUseDepartureTime] = React.useState(false);
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

  React.useLayoutEffect(() => {
    try {
      const titleKeyPrimary = 'routes.settings/index';
      const titleKeyFallback = 'routes.settings';
      const title = t(titleKeyPrimary) || t(titleKeyFallback) || titleKeyFallback;
      nav.setParams({ headerTitle: title });
    } catch {}
  }, [ver, t]);

  // Обновляем state когда приходят данные из кеша
  React.useEffect(() => {
    if (!companyData) return;

    if (companyData.timezone) setTimeZone(companyData.timezone);
    if (typeof companyData.name === 'string') {
      setCompanyName(companyData.name);
      setCompanyNameInitial(companyData.name);
    }
    if (typeof companyData.use_departure_time === 'boolean')
      setUseDepartureTime(companyData.use_departure_time);
    if (typeof companyData.worker_phone_mode === 'string')
      setPhoneMode(companyData.worker_phone_mode);

    const _b = companyData.worker_phone_window_before_mins ?? null;
    const _a = companyData.worker_phone_window_after_mins ?? null;
    if (_b != null) setWindowBefore(String(_b));
    if (_a != null) setWindowAfter(String(_a));
    if (companyData.currency) setCurrency(companyData.currency);
    if (companyData.currency_rate != null) setCurrencyRate(String(companyData.currency_rate));
  }, [companyData]);

  // Get current user's role to determine admin rights
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { user } = {} } = await supabase.auth.getUser();
        if (!user) return;
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();
        if (!alive) return;
        setIsAdmin(String(profile?.role || '').toLowerCase() === 'admin');
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, []);

  const updateSetting = React.useCallback(
    async (key, value) => {
      if (!supabase) throw new Error(t('errors_noDb'));
      const {
        data: { user },
        error: authErr,
      } = await supabase.auth.getUser();
      if (authErr || !user) throw new Error(t('errors_noAuth'));
      const { data: profile, error: profErr } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', user.id)
        .single();
      if (profErr) throw profErr;
      const companyId = profile?.company_id;
      if (!companyId) throw new Error(t('errors_companyNotFound'));
      const payload = { [key]: value };
      const { error: upErr } = await supabase.from('companies').update(payload).eq('id', companyId);
      if (upErr) throw upErr;

      // Обновляем кеш после успешного сохранения
      await refreshCompany();

      // Инвалидируем кеш настроек компании для немедленного обновления UI
      await queryClient.invalidateQueries({ queryKey: ['companySettings'] });

      return true;
    },
    [t, refreshCompany, queryClient],
  );

  const onSubmitCompanyName = React.useCallback(() => {
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
  }, [companyName, companyNameInitial, updateSetting, t]);

  // Time zones list
  const tzItems = React.useMemo(() => {
    try {
      const list = getAllTimeZones();
      const device = getDeviceTimeZone();
      const items = list.map((z) => zoneToItem(z, device, t));
      items.sort((a, b) => a.offsetMin - b.offsetMin || a.city.localeCompare(b.city, 'ru'));
      return items;
    } catch {
      const z = getDeviceTimeZone();
      return [zoneToItem(z, z, t)];
    }
  }, [t]);

  const tzMap = React.useMemo(() => {
    const m = new Map();
    tzItems.forEach((it) => m.set(it.id, it));
    return m;
  }, [tzItems]);

  const timeZoneLabel = tzMap.get(timeZone)?.label || timeZone;

  // Нормализованный курс для передачи на сервер и отображения
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
    [updateSetting, t],
  );

  const onToggleDepartureTime = React.useCallback(
    (val) => {
      setUseDepartureTime(Boolean(val));
      toast.promise(() => updateSetting('use_departure_time', Boolean(val)), {
        loading: t('toast_loading'),
        success: t('toast_settingsSaved'),
        error: (e) => e?.message || t('toast_error'),
      });
    },
    [updateSetting, t],
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

  const currencyLabel = React.useMemo(() => {
    const found = CURRENCY_OPTIONS.find((c) => c.id === currency);
    return found ? `${getCurrencySymbol(found.id)} ${found.label}` : t('finance_no_currency');
  }, [currency, CURRENCY_OPTIONS, t]);

  // Try multiple public exchange rate providers in sequence and return first successful rate
  const fetchRateFromApi = React.useCallback(async (base, target) => {
    setFetchingRate(true);
    setFetchRateError(null);
    const providers = [
      // exchangerate.host
      async () => {
        const url = `https://api.exchangerate.host/latest?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(
          target,
        )}`;
        const r = await fetch(url);
        const j = await r.json();
        return j?.rates?.[target] ?? null;
      },
      // ER-API (open.er-api.com)
      async () => {
        const url = `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`;
        const r = await fetch(url);
        const j = await r.json();
        return j?.rates?.[target] ?? null;
      },
      // exchangerate-api.com (another free endpoint)
      async () => {
        const url = `https://api.exchangerate-api.com/v4/latest/${encodeURIComponent(base)}`;
        const r = await fetch(url);
        const j = await r.json();
        return j?.rates?.[target] ?? null;
      },
    ];

    try {
      for (const prov of providers) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const rate = await prov();
          if (rate && !Number.isNaN(Number(rate)) && Number(rate) > 0) return Number(rate);
        } catch (_e) {
          // try next provider
        }
      }

      // As a last resort, if both currencies are same, return 1
      if (String(base).toUpperCase() === String(target).toUpperCase()) return 1;

      setFetchRateError('Не удалось загрузить курс с внешних сервисов');
      return null;
    } finally {
      setFetchingRate(false);
    }
  }, []);

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
      setCurrencyConfirmOpen(true);
    },
    [currency, fetchRateFromApi],
  );

  // Auto-fetch rate helper used both by button and when modal opens
  const autoFetchRate = React.useCallback(async () => {
    if (!pendingCurrency) return null;
    setFetchRateError(null);
    setFetchingRate(true);
    try {
      // prefer companyData if available to avoid extra DB call
      let base = companyData?.currency;
      if (!base) {
        const { data: { user } = {} } = await supabase.auth.getUser();
        const { data: profile } = await supabase
          .from('profiles')
          .select('company_id')
          .eq('id', user.id)
          .single();
        base = (
          await supabase
            .from('companies')
            .select('currency')
            .eq('id', profile.company_id)
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
      setFetchRateError(t('modal_currency_rate_fetch_failed') || 'Не удалось загрузить курс');
      autoFetchedRef.current = true;
      return null;
    } catch (err) {
      setFetchRateError(t('modal_currency_rate_fetch_failed') || 'Не удалось загрузить курс');
      autoFetchedRef.current = true;
      return null;
    } finally {
      setFetchingRate(false);
    }
  }, [pendingCurrency, companyData, fetchRateFromApi, t]);

  // When confirm modal opens, auto-load rate (if not already set)
  React.useEffect(() => {
    let alive = true;
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
      } catch (_) {
        autoFetchedRef.current = true;
      }
    })();
    return () => {
      alive = false;
    };
  }, [currencyConfirmOpen, pendingCurrency, currencyRate, autoFetchRate]);

  // Improved perform: invalidate orders cache and optionally wait for background job
  const performCurrencyChange = React.useCallback(
    async (recalc) => {
      if (!pendingCurrency) return;
      setConfirmLoading(true);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error(t('errors_noAuth'));
        const { data: profile } = await supabase
          .from('profiles')
          .select('company_id')
          .eq('id', user.id)
          .single();
        const companyId = profile?.company_id;
        if (!companyId) throw new Error(t('errors_companyNotFound'));

        // normalize displayed rate to 'new per old' (p_currency_rate expects new_per_old)
        const displayedVal = currencyRate ? Number(currencyRate) : null;
        const normalizedRate = displayedVal
          ? rateDisplayDirection === 'old_to_new'
            ? displayedVal
            : 1 / displayedVal
          : null;

        // Call RPC
        const { data: rpcData, error: rpcErr } = await supabase.rpc('company_set_currency', {
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
          await queryClient.invalidateQueries({ queryKey: ['companySettings'] });
          await queryClient.invalidateQueries({
            predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'orders',
          });
        } catch (_) {}

        // If recalc requested, try to detect enqueued job and wait for it (best-effort)
        if (recalc) {
          // read company to get recalc_job_id
          const { data: companyRow } = await supabase
            .from('companies')
            .select('recalc_in_progress,recalc_job_id')
            .eq('id', companyId)
            .maybeSingle();
          const jobId = companyRow?.recalc_job_id;
          if (companyRow?.recalc_in_progress && jobId) {
            // poll job status until done or timeout
            const start = Date.now();
            const timeout = 2 * 60 * 1000; // 2 minutes
            let jobDone = false;
            while (Date.now() - start < timeout) {
              // check job
              const { data: j } = await supabase
                .from('finance_currency_recalc_jobs')
                .select('status')
                .eq('id', jobId)
                .maybeSingle();
              if (!j) break;
              if (j.status === 'done') {
                jobDone = true;
                break;
              }
              if (j.status === 'failed') break;
              // wait before next poll
              // eslint-disable-next-line no-await-in-loop
              await new Promise((r) => setTimeout(r, 2500));
            }
            // final cache invalidation after job
            await queryClient.invalidateQueries({
              predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'orders',
            });
            await refreshCompany();
            if (!jobDone) {
              // non-fatal: job may run later; let user know
              toast.show(t('toast_recalc_started'), 'info');
            }
          }
        }

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
    [pendingCurrency, currencyRate, rateDisplayDirection, t, toast, refreshCompany, queryClient],
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
  }, [ver, t]);

  const onPickPhoneMode = React.useCallback(
    (it) => {
      setPhoneModeOpen(false);
      if (it.id === 'window') {
        // Откроем модалку настройки интервала.
        try {
          const b = decomposeMinutes(windowBefore);
          const a = decomposeMinutes(windowAfter);
          setBeforeUnit(b.unit);
          setWindowBefore(b.val);
          setAfterUnit(a.unit);
          setWindowAfter(a.val);
        } catch {}
        setPhoneMode('window');
        setWindowModalOpen(true);
        return;
      }
      setPhoneMode(it.id);
      toast.promise(() => updateSetting('worker_phone_mode', it.id), {
        loading: t('toast_loading'),
        success: t('toast_settingsSaved'),
        error: (e) => e?.message || t('toast_error'),
      });
    },
    [updateSetting, t, windowBefore, windowAfter, decomposeMinutes],
  );

  const phoneModeLabel = React.useMemo(() => {
    const map = Object.fromEntries(phoneModeOptions.map((o) => [o.id, o.label]));
    return map[phoneMode] || '';
  }, [phoneMode, phoneModeOptions]);

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
  const go = React.useCallback((href) => () => router.push(href), [router]);

  // Section titles from i18n (do not trust constants' labels)
  const sectionTitles = React.useMemo(
    () => ({
      COMPANY: t('settings_sections_company_title'),
      MANAGEMENT: t('settings_sections_management_title'),
      DEPARTURE: t('settings_sections_departure_title'),
      PHONE: t('settings_sections_phone_title'),
    }),
    [ver, t],
  );

  return (
    <Screen background="background">
      <ScrollView
        contentContainerStyle={s.contentWrap}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* COMPANY */}
        <View style={s.sectionWrap}>
          <Text style={s.sectionTitle}>{sectionTitles.COMPANY}</Text>
          <View style={s.card}>
            <SelectField
              label={t('fields_company_name')}
              value={companyName || t('common_specify')}
              onPress={() => {
                setCompanyNameDraft(companyName);
                setCompanyNameError('');
                setCompanyNameOpen(true);
              }}
            />

            <View style={s.sep} />
            <SelectField
              label={<Text style={s.itemLabel}>{t('settings_company_timezone')}</Text>}
              value={timeZoneLabel}
              onPress={() => setTzOpen(true)}
            />

            <View style={s.sep} />
            <SelectField
              label={<Text style={s.itemLabel}>{t('settings_company_users')}</Text>}
              showValue={false}
              onPress={go(SETTINGS_SECTIONS.COMPANY.items.find((i) => i.key === 'employees').route)}
            />

            <View style={s.sep} />

            <SelectField
              label={<Text style={s.itemLabel}>{t('settings_company_billing')}</Text>}
              showValue={false}
              onPress={go(SETTINGS_SECTIONS.COMPANY.items.find((i) => i.key === 'billing').route)}
            />

            <View style={s.sep} />
            <SelectField
              label={<Text style={s.itemLabel}>{t('settings_management_work_types')}</Text>}
              showValue={false}
              onPress={go(
                SETTINGS_SECTIONS.MANAGEMENT.items.find((i) => i.key === 'work_types').route,
              )}
            />

            <View style={s.sep} />
            <SelectField
              label={<Text style={s.itemLabel}>{t('settings_management_departments')}</Text>}
              showValue={false}
              onPress={go(
                SETTINGS_SECTIONS.MANAGEMENT.items.find((i) => i.key === 'departments').route,
              )}
            />
          </View>
        </View>

        {/* MANAGEMENT */}
        <View style={s.sectionWrap}>
          <Text style={s.sectionTitle}>{sectionTitles.MANAGEMENT}</Text>
          <View style={s.card}>
            {SETTINGS_SECTIONS.MANAGEMENT.items
              .filter((it) => !['work_types', 'departments'].includes(it.key))
              .map((it, idx) => (
                <React.Fragment key={it.key}>
                  {idx > 0 ? <View style={s.sep} /> : null}
                  <SelectField
                    label={<Text style={s.itemLabel}>{t(`settings_management_${it.key}`)}</Text>}
                    showValue={false}
                    onPress={go(it.route)}
                  />
                </React.Fragment>
              ))}
          </View>
        </View>

        {/* DEPARTURE */}
        <View style={s.sectionWrap}>
          <Text style={s.sectionTitle}>{sectionTitles.DEPARTURE}</Text>
          <View style={s.card}>
            <View style={s.row}>
              <Text style={s.rowLabel}>{t('settings_departure_useDepartureTime')}</Text>
              <Switch
                value={useDepartureTime}
                onValueChange={onToggleDepartureTime}
                trackColor={{ true: theme.colors.primary, false: theme.colors.inputBorder }}
                thumbColor={Platform.OS === 'android' ? theme.colors.surface : undefined}
              />
            </View>
            <View style={s.sep} />
            <SelectField
              label={<Text style={s.itemLabel}>{t('settings_phone_mode')}</Text>}
              value={phoneModeLabel}
              onPress={() => setPhoneModeOpen(true)}
            />
          </View>
        </View>

        {/* FINANCES */}
        <View style={s.sectionWrap}>
          <Text style={s.sectionTitle}>{t('company_settings_sections_finances_title')}</Text>
          <View style={s.card}>
            <SelectField
              label={
                <Text style={s.itemLabel}>
                  {t('settings_company_currency_label') || 'Валюта компании'}
                </Text>
              }
              value={
                companyData?.recalc_in_progress ? t('settings_recalc_in_progress') : currencyLabel
              }
              disabled={Boolean(companyData?.recalc_in_progress)}
              onPress={() => {
                // Only admins can change currency in UI
                if (!isAdmin) {
                  toast.show(t('errors_only_admin_currency'), 'info');
                  return;
                }
                setFinanceOpen(true);
              }}
            />
          </View>
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
          <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
            <Pressable
              onPress={() => setCompanyNameOpen(false)}
              style={({ pressed }) => [
                {
                  paddingVertical: theme.spacing.sm,
                  paddingHorizontal: theme.spacing.md,
                  borderRadius: theme.radii.md,
                  alignItems: 'center',
                  borderWidth: theme.components.card.borderWidth,
                  borderColor: theme.colors.border,
                  backgroundColor: 'transparent',
                  flex: 1,
                },
                pressed && Platform.OS === 'ios' ? { backgroundColor: theme.colors.ripple } : null,
              ]}
            >
              <Text
                style={{
                  color: theme.colors.text,
                  fontSize: theme.typography.sizes.md,
                  fontWeight: theme.typography.weight.medium,
                }}
              >
                {t('btn_cancel')}
              </Text>
            </Pressable>
            <UIButton
              variant="primary"
              size="md"
              onPress={async () => {
                const name = String(companyNameDraft || '').trim();
                if (!name) {
                  setCompanyNameError(t('errors_companyName_required'));
                  return;
                }
                if (name.length > 64) {
                  setCompanyNameError(t('errors_companyName_tooLong'));
                  return;
                }
                if (name === companyNameInitial) {
                  setCompanyName(name);
                  closeCompanyEditor();
                  return;
                }
                setSavingCompany(true);
                try {
                  await toast.promise(() => updateSetting('name', name), {
                    loading: t('toast_loading'),
                    success: t('toast_companyNameSaved'),
                    error: (e) => e?.message || t('toast_error'),
                  });
                  setCompanyName(name);
                  setCompanyNameInitial(name);
                  closeCompanyEditor();
                } catch (e) {
                  setCompanyNameError(e?.message || t('toast_error'));
                } finally {
                  setSavingCompany(false);
                }
              }}
              title={savingCompany ? t('btn_saving') : t('btn_save')}
            />
          </View>
        }
      >
        <View style={{ marginBottom: theme.spacing.sm }}>
          <TextField
            label={t('fields_company_name')}
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
              const name = String(companyNameDraft || '').trim();
              if (!name) {
                setCompanyNameError(t('errors_companyName_required'));
                return;
              }
              if (name.length > 64) {
                setCompanyNameError(t('errors_companyName_tooLong'));
                return;
              }
              if (name === companyNameInitial) {
                setCompanyName(name);
                closeCompanyEditor();
                return;
              }
              (async () => {
                setSavingCompany(true);
                try {
                  await toast.promise(() => updateSetting('name', name), {
                    loading: t('toast_loading'),
                    success: t('toast_companyNameSaved'),
                    error: (e) => e?.message || t('toast_error'),
                  });
                  setCompanyName(name);
                  setCompanyNameInitial(name);
                  closeCompanyEditor();
                } catch (e) {
                  setCompanyNameError(e?.message || t('toast_error'));
                } finally {
                  setSavingCompany(false);
                }
              })();
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
        onSelect={onPickTimeZone}
        onClose={() => setTzOpen(false)}
        searchable={true}
      />

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
          <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
            <Pressable
              onPress={() => {
                setCurrencyConfirmOpen(false);
                setPendingCurrency(null);
                setFetchRateError(null);
                setRecalcMethod(MODAL_RECALC_METHODS[0]?.id || 'no_recalc');
              }}
              style={({ pressed }) => [
                {
                  paddingVertical: theme.spacing.sm,
                  paddingHorizontal: theme.spacing.md,
                  borderRadius: theme.radii.md,
                  alignItems: 'center',
                  borderWidth: theme.components.card.borderWidth,
                  borderColor: theme.colors.border,
                  backgroundColor: 'transparent',
                  flex: 1,
                },
                pressed && Platform.OS === 'ios' ? { backgroundColor: theme.colors.ripple } : null,
              ]}
            >
              <Text
                style={{
                  color: theme.colors.text,
                  fontSize: theme.typography.sizes.md,
                  fontWeight: theme.typography.weight.medium,
                }}
              >
                {t('btn_cancel')}
              </Text>
            </Pressable>
            <Pressable
              onPress={async () => {
                const needsRecalc =
                  recalcMethod === MODAL_RECALC_METHODS.find((m) => m.id === 'recalc')?.id ||
                  recalcMethod === 'recalc';
                if (needsRecalc) {
                  if (!currencyRate || Number.isNaN(Number(currencyRate))) {
                    toast.show(
                      t('modal_currency_rate_required') || 'Введите курс для пересчёта',
                      'info',
                    );
                    return;
                  }
                }
                try {
                  setConfirmLoading(true);
                  await performCurrencyChange(needsRecalc);
                } catch (err) {
                  toast.show(err?.message || t('toast_error'), 'error');
                } finally {
                  setConfirmLoading(false);
                }
              }}
              disabled={confirmLoading}
              style={({ pressed }) => [
                {
                  paddingVertical: theme.spacing.sm,
                  paddingHorizontal: theme.spacing.md,
                  borderRadius: theme.radii.md,
                  alignItems: 'center',
                  backgroundColor: theme.colors.primary,
                  flex: 1,
                },
                pressed && Platform.OS === 'ios' ? { opacity: 0.9 } : null,
              ]}
            >
              <Text style={{ color: theme.colors.onPrimary }}>{t('btn_ok')}</Text>
            </Pressable>
          </View>
        }
      >
        <View style={{ gap: theme.spacing.md }}>
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
                            const v = txt.replace(/[^0-9.,]/g, '').replace(',', '.');
                            setCurrencyRate(v);
                            setRateDisplayDirection('old_to_new');
                            if (fetchRateError) setFetchRateError(null);
                          }}
                          placeholder={t('modal_currency_rate_placeholder')}
                          keyboardType="numeric"
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
                            const v = txt.replace(/[^0-9.,]/g, '').replace(',', '.');
                            setCurrencyRate(v);
                            setRateDisplayDirection('new_to_old');
                            if (fetchRateError) setFetchRateError(null);
                          }}
                          placeholder={t('modal_currency_rate_placeholder')}
                          keyboardType="numeric"
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
        </View>
      </BaseModal>

      {/* Настройка интервала показа телефона */}
      <BaseModal
        visible={windowModalOpen}
        onClose={() => setWindowModalOpen(false)}
        title={t('modal_phoneWindow_title')}
        maxHeightRatio={0.6}
        footer={
          <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
            <Pressable
              onPress={() => {
                setWindowModalOpen(false);
                setTimeout(() => setPhoneModeOpen(true), 200);
              }}
              style={({ pressed }) => [
                {
                  paddingVertical: theme.spacing.sm,
                  paddingHorizontal: theme.spacing.md,
                  borderRadius: theme.radii.md,
                  alignItems: 'center',
                  borderWidth: theme.components.card.borderWidth,
                  borderColor: theme.colors.border,
                  backgroundColor: 'transparent',
                  flex: 1,
                },
                pressed && Platform.OS === 'ios' ? { backgroundColor: theme.colors.ripple } : null,
              ]}
            >
              <Text
                style={{
                  color: theme.colors.text,
                  fontSize: theme.typography.sizes.md,
                  fontWeight: theme.typography.weight.medium,
                }}
              >
                {t('btn_cancel')}
              </Text>
            </Pressable>
            <UIButton
              variant="primary"
              size="md"
              title={t('btn_apply')}
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
        }
      >
        <View style={{ gap: theme.spacing.lg }}>
          {/* Группа: До выезда */}
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
                  onChangeText={(v) => setWindowBefore(v.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
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

          {/* Группа: После выезда */}
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
                  onChangeText={(v) => setWindowAfter(v.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
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
              {useDepartureTime
                ? t('phone_window_hint_with_time')
                : t('phone_window_hint_date_only')}{' '}
              {t('phone_window_hint_tz')}
            </Text>
          </View>

          {/* Сводка текущего выбора */}
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
        </View>
      </BaseModal>

      {/* Выбор единицы для "за" */}
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

      {/* Выбор единицы для "после" */}
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
    contentWrap: { paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.xl },
    sectionWrap: { marginBottom: 0 },
    sectionTitle: {
      fontWeight: t.typography.weight.bold,
      marginBottom: t.spacing[t.components.sectionTitle.mb],
      marginLeft: t.spacing[t.components.sectionTitle.ml],
      color: t.colors.text,
    },
    card: {
      backgroundColor: t.colors.surface,
      borderRadius: t.radii.md,
      borderWidth: t.components.card.borderWidth,
      borderColor: t.colors.border,
      paddingHorizontal: t.spacing[t.components.card.padX || 'md'],
      paddingVertical: 0,
      marginBottom: t.spacing.md,
    },
    sep: { height: t.components.listItem.dividerWidth, backgroundColor: t.colors.border },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: t.components.row.minHeight,
      paddingVertical: t.components.row.py ? t.spacing[t.components.row.py] : 0,
    },
    rowLabel: { color: t.colors.textSecondary },
    itemLabel: { color: t.colors.textSecondary, fontWeight: t.typography.weight.regular },
    captionWrap: {
      paddingHorizontal: t.spacing[t.components.card.padX || 'md'],
      paddingBottom: t.spacing.md,
      paddingTop: t.spacing.xs,
    },
    caption: { color: t.colors.textSecondary, fontSize: t.typography.sizes.sm },
  });
