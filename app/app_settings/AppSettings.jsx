// app/app_settings/AppSettings.jsx
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Screen from '../../components/layout/Screen';
import Card from '../../components/ui/Card';
import SectionHeader from '../../components/ui/SectionHeader';
import { SelectField, SwitchField } from '../../components/ui/TextField';
import { useToast } from '../../components/ui/ToastProvider';
import { listItemStyles } from '../../components/ui/listItemStyles';
import { DateTimeModal, SelectModal } from '../../components/ui/modals';
import { ANDROID_CHANNEL_ID, ANDROID_CHANNEL_NAME, APP_DEFAULTS } from '../../config/notifications';
import { useAuthContext } from '../../providers/SimpleAuthProvider';
import { supabase } from '../../lib/supabase';
import {
  deletePushToken as deletePushTokenHelper,
  getUid,
  setNotificationAllow as setNotificationAllowHelper,
  savePushToken as savePushTokenHelper,
} from '../../lib/supabaseHelpers';
import { devWarn as __devLog } from '../../src/utils/dev';
import { useTheme } from '../../theme';

import { TBL } from '../../lib/constants';
import { saveUserLocale } from '../../lib/userLocale';
import { availableLocales, getLocale, setLocale } from '../../src/i18n';
import { useTranslation } from '../../src/i18n/useTranslation';

// Safer fallback for minute step (prevents ReferenceError if APP_DEFAULTS missing or timeStep is not a number)
const TIME_PICKER_MINUTE_STEP = Number(APP_DEFAULTS?.timeStep) || 5;
const DEFAULT_REMINDER_DELAY_MINUTES = 20;
const DEFAULT_QUIET_TIMEZONE = 'UTC';

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

function isTransientPushSyncError(message) {
  const normalized = String(message || '').toLowerCase();
  return (
    normalized.includes('no_auth') ||
    normalized.includes('нет авторизации') ||
    normalized.includes('unauthorized') ||
    normalized.includes('jwt') ||
    normalized.includes('no session') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('fetch failed') ||
    normalized.includes('network')
  );
}

function resolveDeviceTimeZone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof tz === 'string' && tz.trim()) return tz.trim();
  } catch {}
  return DEFAULT_QUIET_TIMEZONE;
}

function parseTimeMinutes(value) {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function minutesToHHMM(totalMinutes) {
  const m = ((Number(totalMinutes) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function _localTimeToUtcHHMM(localHHMM) {
  const localMinutes = parseTimeMinutes(localHHMM);
  if (localMinutes == null) return null;
  const offsetMinutes = new Date().getTimezoneOffset();
  return minutesToHHMM(localMinutes + offsetMinutes);
}

function utcTimeToLocalHHMM(utcHHMM) {
  const utcMinutes = parseTimeMinutes(utcHHMM);
  if (utcMinutes == null) return null;
  const offsetMinutes = new Date().getTimezoneOffset();
  return minutesToHHMM(utcMinutes - offsetMinutes);
}

// Defaults for quiet hours (robust parsing with sane fallback)
const [DEFAULT_QUIET_HOUR, DEFAULT_QUIET_MINUTE] = (() => {
  const match = String(APP_DEFAULTS?.quietEnd ?? '09:00').match(/^(\d{2}):(\d{2})$/);
  const h = parseInt(match?.[1] ?? '9', 10);
  const m = parseInt(match?.[2] ?? '0', 10);
  return [h, m];
})();

const SETTINGS_SECTIONS = Object.freeze([
  {
    key: 'appearance',
    items: [
      { key: 'theme', type: 'select' },
      { key: 'language', type: 'select' },
    ],
  },
  {
    key: 'notifications',
    items: [
      { key: 'allow', switch: true },
      { key: 'sounds', type: 'select', comingSoon: true },
      { key: 'events', type: 'select' },
    ],
  },
  {
    key: 'quiet',
    items: [
      { key: 'quiet_start', type: 'select' },
      { key: 'quiet_end', type: 'select' },
      { key: 'quiet_reset', type: 'select' },
    ],
  },
  {
    key: 'privacy',
    items: [
      { key: 'geo', type: 'select', comingSoon: true },
      { key: 'analytics', type: 'select', comingSoon: true },
      { key: 'private-search', type: 'select', comingSoon: true },
    ],
  },
]);

let installEdgeToEdgeWarnFilter;
try {
  installEdgeToEdgeWarnFilter =
    require('../../src/utils/devWarnFilter')?.installEdgeToEdgeWarnFilter;
} catch (e) {
  __devLog('devWarnFilter import failed:', e?.message || e);
}

if (__DEV__ && typeof installEdgeToEdgeWarnFilter === 'function') {
  installEdgeToEdgeWarnFilter();
}

// Cache expo-notifications dynamic import to avoid repeated module loads
let __NotificationsMod = null;

async function getNotifications() {
  if (!__NotificationsMod) {
    __NotificationsMod = await import('expo-notifications');
  }
  return __NotificationsMod;
}

async function getSystemPushPermission() {
  try {
    if (Platform.OS === 'web') {
      return { granted: false, canAskAgain: false, reason: 'web_no_push_token' };
    }

    const isExpoGo = Constants?.appOwnership === 'expo';
    if (isExpoGo) {
      return { granted: false, canAskAgain: false, reason: 'expo_go_no_push_token' };
    }

    const Notifications = await getNotifications();
    const current = await Notifications.getPermissionsAsync();
    return {
      granted: current?.status === 'granted',
      canAskAgain: current?.canAskAgain !== false,
      reason: null,
    };
  } catch (e) {
    __devLog('getSystemPushPermission failed:', e?.message || e);
    return {
      granted: false,
      canAskAgain: false,
      reason: String(e?.message || e || 'push_permission_check_failed'),
    };
  }
}

async function getPushTokenIfGranted() {
  try {
    if (Platform.OS === 'web') {
      return { token: null, reason: 'web_no_push_token' };
    }
    const isExpoGo = Constants?.appOwnership === 'expo';
    if (isExpoGo) {
      return { token: null, reason: 'expo_go_no_push_token' };
    }

    const Notifications = await getNotifications();
    if (Platform.OS === 'android') {
      try {
        await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
          name: ANDROID_CHANNEL_NAME,
          importance: Notifications.AndroidImportance.MAX,
          sound: 'default',
        });
      } catch (e) {
        __devLog('setNotificationChannelAsync failed:', e?.message || e);
      }
    }

    let token = null;
    let reason = null;
    try {
      const projectId =
        Constants?.expoConfig?.extra?.eas?.projectId ??
        Constants?.expoConfig?.extra?.easProjectId ??
        Constants?.manifest2?.extra?.expoClient?.extra?.eas?.projectId ??
        Constants?.manifest?.extra?.eas?.projectId ??
        Constants?.easConfig?.projectId;
      const resp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
      token = resp?.data || null;
    } catch (e) {
      __devLog('getExpoPushTokenAsync failed:', e?.message || e);
      reason = String(e?.message || e || 'push_token_fetch_failed');
    }

    if (!token && !reason) reason = 'push_token_not_returned';
    return { token, reason };
  } catch (e) {
    __devLog('getPushTokenIfGranted failed:', e?.message || e);
    return { token: null, reason: String(e?.message || e || 'push_token_fetch_failed') };
  }
}

async function ensurePushPermission() {
  try {
    const permission = await getSystemPushPermission();
    if (!permission.granted) {
      let canAskAgain = permission.canAskAgain;
      if (canAskAgain) {
        const Notifications = await getNotifications();
        const requested = await Notifications.requestPermissionsAsync();
        const grantedAfterRequest = requested?.status === 'granted';
        canAskAgain = requested?.canAskAgain !== false;
        if (!grantedAfterRequest) {
          return { granted: false, token: null, canAskAgain, reason: 'push_permission_denied' };
        }
      } else {
        return { granted: false, token: null, canAskAgain: false, reason: 'push_permission_denied' };
      }
    }

    const { token, reason } = await getPushTokenIfGranted();
    if (!token) {
      return { granted: true, token: null, canAskAgain: true, reason: reason || 'push_token_not_returned' };
    }
    return { granted: true, token, canAskAgain: true, reason: null };
  } catch (e) {
    __devLog('ensurePushPermission failed:', e?.message || e);
    return {
      granted: false,
      token: null,
      canAskAgain: false,
      reason: String(e?.message || e || 'push_permission_failed'),
    };
  }
}

export default function AppSettings() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user: authUser, profile: authProfile } = useAuthContext();
  const authAccountType = String(authUser?.user_metadata?.account_type || '').toLowerCase();
  const isSoloAdmin =
    String(authProfile?.role || '').toLowerCase() === 'admin' && authAccountType === 'solo';

  const { theme, mode, setMode } = useTheme();
  const toast = useToast();
  const [themeOpen, setThemeOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const currentLocale = (() => {
    try {
      return getLocale();
    } catch {
      return availableLocales[0] || 'ru';
    }
  })();
  const currentThemeLabel = t(`settings_theme_${mode || 'system'}`);
  const s = useMemo(() => styles(theme), [theme]);
  const base = useMemo(() => listItemStyles(theme), [theme]);
  const futureFeature = useCallback(() => toast.info(t('feature_future')), [t, toast]);
  const [prefs, setPrefs] = useState({
    allow: true,
    new_orders: true,
    feed_orders: true,
    reminders: true,
    reminder_delay_minutes: 20,
    quiet_start: null,
    quiet_end: null,
    quiet_timezone: DEFAULT_QUIET_TIMEZONE,
  });
  const [timePickerOpen, setTimePickerOpen] = useState(null);
  const [timeValue, setTimeValue] = useState(new Date());

  // Prevent setState on unmounted component
  const mounted = useRef(false);
  const reopenTimer = useRef(null);
  const quietPickerAppliedRef = useRef(false);
  const unsupportedColsRef = useRef(new Set());
  const lastPrefsErrorMessageRef = useRef(null);
  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      if (reopenTimer.current) {
        clearTimeout(reopenTimer.current);
        reopenTimer.current = null;
      }
    };
  }, []);

  const {
    data: prefsData,
    isLoading: isLoadingPrefs,
    refetch: refreshPrefs,
    error: prefsError,
  } = useQuery({
    queryKey: ['appSettings', 'notifPrefs'],
    queryFn: async () => {
      let uid = null;
      try {
        uid = await getUid();
      } catch (e) {
        const m = String(e?.message || e || '').toLowerCase();
        if (m.includes('no_auth')) return null;
        throw e;
      }

      const { data, error: prefsErr } = await supabase
        .from(TBL.NOTIF_PREFS)
        .select('*')
        .eq('user_id', uid)
        .maybeSingle();

      if (prefsErr) {
        const rawMessage = String(prefsErr?.message || prefsErr || '').toLowerCase();
        const isPermissionDenied =
          rawMessage.includes('permission denied') ||
          rawMessage.includes('row level security') ||
          rawMessage.includes('rls');
        if (isPermissionDenied) {
          return {
            allow: true,
            new_orders: true,
            feed_orders: true,
            reminders: true,
            reminder_delay_minutes: DEFAULT_REMINDER_DELAY_MINUTES,
            quiet_start: null,
            quiet_end: null,
            quiet_timezone: resolveDeviceTimeZone(),
          };
        }
        __devLog('NOTIF_PREFS load error:', prefsErr.message || prefsErr);
        throw prefsErr;
      }

      if (!data) {
        return {
          allow: true,
          new_orders: true,
          feed_orders: true,
          reminders: true,
          reminder_delay_minutes: DEFAULT_REMINDER_DELAY_MINUTES,
          quiet_start: null,
          quiet_end: null,
          quiet_timezone: resolveDeviceTimeZone(),
        };
      }

      const storedTz =
        typeof data.quiet_timezone === 'string' && data.quiet_timezone.trim()
          ? data.quiet_timezone.trim()
          : DEFAULT_QUIET_TIMEZONE;
      const qsRaw = typeof data.quiet_start === 'string' ? (data.quiet_start.trim() || null) : (data.quiet_start ?? null);
      const qeRaw = typeof data.quiet_end === 'string' ? (data.quiet_end.trim() || null) : (data.quiet_end ?? null);
      // Legacy: if times were stored as UTC, convert them to local for display.
      // New saves use the device IANA timezone and store times as local — no conversion needed.
      const isLegacyUtc = storedTz === 'UTC';
      const qs = isLegacyUtc ? (utcTimeToLocalHHMM(qsRaw) || qsRaw) : qsRaw;
      const qe = isLegacyUtc ? (utcTimeToLocalHHMM(qeRaw) || qeRaw) : qeRaw;
      return {
        allow: data.allow !== false,
        new_orders: data.new_orders !== false,
        feed_orders: data.feed_orders !== false,
        reminders: data.reminders !== false,
        reminder_delay_minutes: Number.isFinite(data.reminder_delay_minutes)
          ? data.reminder_delay_minutes
          : DEFAULT_REMINDER_DELAY_MINUTES,
        quiet_start: qs,
        quiet_end: qe,
        quiet_timezone: storedTz,
      };
    },
    gcTime: 5 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
  });

  useEffect(() => {
    if (!prefsError) return;
    const message = String(prefsError?.message || prefsError || '');
    if (lastPrefsErrorMessageRef.current === message) return;
    lastPrefsErrorMessageRef.current = message;
    __devLog('loadPrefs error:', prefsError?.message || prefsError);
    toast.error(t('errors_loadSettings'));
  }, [prefsError, t, toast]);

  useEffect(() => {
    let active = true;
    let channel = null;

    (async () => {
      try {
        const uid = await getUid();
        if (!active || !uid) return;

        channel = supabase
          .channel(`app-settings:notif-prefs:${uid}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: TBL.NOTIF_PREFS,
              filter: `user_id=eq.${uid}`,
            },
            () => {
              refreshPrefs().catch(() => {});
            },
          )
          .subscribe();
      } catch {}
    })();

    return () => {
      active = false;
      if (!channel) return;
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [refreshPrefs]);

  useEffect(() => {
    if (prefsData && mounted.current) {
      setPrefs((p) => ({ ...p, ...prefsData }));
    }
  }, [prefsData]);

  const currentPrefsRef = useRef(prefs);
  useEffect(() => {
    currentPrefsRef.current = prefs;
  }, [prefs]);

  const savePrefs = useCallback(async (patch) => {
    try {
      const uid = await getUid();
      let error = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const snapshot = currentPrefsRef.current || {};
        const basePayload = {
          allow: snapshot.allow !== false,
          new_orders: snapshot.new_orders !== false,
          feed_orders: snapshot.feed_orders !== false,
          reminders: snapshot.reminders !== false,
          reminder_delay_minutes: Number(snapshot.reminder_delay_minutes) || DEFAULT_REMINDER_DELAY_MINUTES,
        };
        const payload = { ...patch };
        unsupportedColsRef.current.forEach((col) => {
          delete payload[col];
        });

        const result = await supabase
          .from(TBL.NOTIF_PREFS)
          .upsert({ user_id: uid, ...basePayload, ...payload }, { onConflict: 'user_id', returning: 'minimal' });
        error = result.error || null;
        if (!error) break;

        const missingCol = parseMissingNotifPrefsColumn(error);
        if (!missingCol) break;
        unsupportedColsRef.current.add(missingCol);
      }

      if (error) {
        let msg = t('errors_saveGeneric');
        if (/permission denied/i.test(error.message)) msg = t('errors_noSettingsAccess');
        else if (/row level security|rls/i.test(error.message)) msg = t('errors_rls');
        else if (/timeout|network|failed to fetch/i.test(error.message)) msg = t('errors_network');
        return {
          ok: false,
          message: msg,
          rawMessage: String(error?.message || ''),
          rawCode: error?.code ? String(error.code) : null,
          rawDetails: error?.details ? String(error.details) : null,
          rawHint: error?.hint ? String(error.hint) : null,
        };
      }
      await refreshPrefs();
      return { ok: true };
    } catch (e) {
      const m = String(e?.message || e || '').toLowerCase();
      let msg = t('errors_saveShort');
      if (m.includes('no_auth')) msg = t('errors_noAuth');
      else if (m.includes('failed to fetch') || m.includes('network')) msg = t('errors_network');
      return {
        ok: false,
        message: msg,
        rawMessage: String(e?.message || e || ''),
        rawCode: e?.code ? String(e.code) : null,
        rawDetails: e?.details ? String(e.details) : null,
        rawHint: e?.hint ? String(e.hint) : null,
      };
    }
  }, [refreshPrefs, t]);

  function toTimeStr(v) {
    if (!v) return null;
    if (typeof v === 'string') {
      const m = v.match(/^(\d{2}):(\d{2})/);
      if (m) return `${m[1]}:${m[2]}`;
      return null;
    }
    if (v instanceof Date) {
      const hh = String(v.getHours()).padStart(2, '0');
      const mm = String(v.getMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    }
    return null;
  }

  function toDateFromStr(s) {
    try {
      const now = new Date();
      if (!s || typeof s !== 'string' || !s.includes(':')) {
        return new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          DEFAULT_QUIET_HOUR,
          DEFAULT_QUIET_MINUTE,
          0,
          0,
        );
      }
      const [hs, ms] = s.split(':');
      const hh = parseInt(hs, 10);
      const mm = parseInt(ms, 10);
      const H = Number.isFinite(hh) ? hh : DEFAULT_QUIET_HOUR;
      const M = Number.isFinite(mm) ? mm : DEFAULT_QUIET_MINUTE;
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), H, M, 0, 0);
    } catch (e) {
      __devLog('toDateFromStr parse failed:', e?.message || e);
      const now = new Date();
      return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        DEFAULT_QUIET_HOUR,
        DEFAULT_QUIET_MINUTE,
        0,
        0,
      );
    }
  }

  const bothQuietSet = (obj) => !!toTimeStr(obj.quiet_start) && !!toTimeStr(obj.quiet_end);
  const resetIncompleteQuietLocal = useCallback(() => {
    const snapshot = currentPrefsRef.current;
    const isPartial =
      (toTimeStr(snapshot.quiet_start) && !toTimeStr(snapshot.quiet_end)) ||
      (!toTimeStr(snapshot.quiet_start) && toTimeStr(snapshot.quiet_end));
    if (!isPartial) return;
    const resetPatch = { quiet_start: null, quiet_end: null };
    setPrefs((p) => ({ ...p, ...resetPatch }));
    currentPrefsRef.current = { ...snapshot, ...resetPatch };
  }, []);

  const openTimePicker = useCallback(
    (which) => () => {
      const bothNull = !toTimeStr(prefs.quiet_start) && !toTimeStr(prefs.quiet_end);
      const fallback = which === 'start' ? APP_DEFAULTS?.quietStart : APP_DEFAULTS?.quietEnd;
      const base =
        which === 'start'
          ? (prefs.quiet_start ?? (bothNull ? fallback : null))
          : (prefs.quiet_end ?? (bothNull ? fallback : null));
      const d = toDateFromStr(toTimeStr(base));
      setTimeValue(d);
      setTimePickerOpen(which);
    },
    [prefs.quiet_end, prefs.quiet_start],
  );

  const onTimePicked = async (maybeDate, maybeMetaOrDate) => {
    if (!timePickerOpen) return;
    const pickedDate =
      maybeMetaOrDate instanceof Date ? maybeMetaOrDate : (maybeDate instanceof Date ? maybeDate : null);
    if (!pickedDate) {
      resetIncompleteQuietLocal();
      setTimePickerOpen(null);
      return;
    }

    const hhmm = toTimeStr(pickedDate);
    const patch = timePickerOpen === 'start' ? { quiet_start: hhmm } : { quiet_end: hhmm };

    const prevPrefs = prefs;
    const next = { ...prefs, ...patch };

    quietPickerAppliedRef.current = true;
    setPrefs(next);
    currentPrefsRef.current = next;
    setTimePickerOpen(null);

    if (!bothQuietSet(next)) {
      const missing = next.quiet_start ? 'end' : 'start';
      const d = toDateFromStr(toTimeStr(next[missing]));
      setTimeValue(d);

      if (mounted.current) {
        if (reopenTimer.current) clearTimeout(reopenTimer.current);
        reopenTimer.current = setTimeout(() => {
          if (mounted.current) setTimePickerOpen(missing);
        }, 0);
      }

      toast.info(missing === 'end' ? t('quiet_pickEnd') : t('quiet_pickStart'));
      return;
    }

    if (toTimeStr(next.quiet_start) === toTimeStr(next.quiet_end)) {
      const resetPatch = { quiet_start: null, quiet_end: null };
      setPrefs((p) => ({ ...p, ...resetPatch }));
      const { ok, message } = await setQuietHours(null, null, resolveDeviceTimeZone());
      if (!ok) {
        setPrefs(prevPrefs);
        toast.error(message || t('quiet_saveFail'));
      } else {
        toast.info(t('quiet_off'));
      }
      return;
    }

    const deviceTz = resolveDeviceTimeZone();
    const baseQuietPatch = {
      quiet_start: toTimeStr(next.quiet_start),
      quiet_end: toTimeStr(next.quiet_end),
    };

    const saveResult = await setQuietHours(baseQuietPatch.quiet_start, baseQuietPatch.quiet_end, deviceTz);

    if (!saveResult.ok) {
      __devLog('notification_prefs quiet save error:', {
        message: saveResult.message || 'unknown_save_error',
        rawMessage: saveResult.rawMessage || null,
        rawCode: saveResult.rawCode || null,
        rawDetails: saveResult.rawDetails || null,
        rawHint: saveResult.rawHint || null,
        patch: baseQuietPatch,
        timezone: deviceTz,
      });
      setPrefs(prevPrefs);
      toast.error(saveResult.message || t('quiet_saveFail'));
    } else {
      toast.info(
        `${t('quiet_range')}${toTimeStr(next.quiet_start)} ${t('common_to')} ${toTimeStr(next.quiet_end)}`,
      );
    }
  };

  const closeTimePicker = useCallback(() => {
    // DateTimeModal calls onClose right after onApply.
    // In this path we must not reset partially-selected values nor cancel auto-open timer.
    if (quietPickerAppliedRef.current) {
      quietPickerAppliedRef.current = false;
      setTimePickerOpen(null);
      return;
    }

    if (reopenTimer.current) {
      clearTimeout(reopenTimer.current);
      reopenTimer.current = null;
    }
    resetIncompleteQuietLocal();
    setTimePickerOpen(null);
  }, [resetIncompleteQuietLocal]);

  const savePushToken = useCallback(async (token) => {
    try {
      const uid = await getUid();
      if (!token) throw new Error('NO_TOKEN');
      const platform = Platform.OS === 'ios' ? 'ios' : 'android';
      await savePushTokenHelper(uid, token, platform);
      return { ok: true, rawMessage: null };
    } catch (e) {
      let msg = t('push_saveTokenFail');
      const rawMessage = String(e?.message || e || '');
      const m = rawMessage.toLowerCase();
      if (m.includes('no_auth')) msg = t('errors_noAuthShort');
      if (m.includes('permission denied') || m.includes('rls')) msg = t('errors_rls');
      return { ok: false, message: msg, rawMessage };
    }
  }, [t]);

  const removePushToken = useCallback(async () => {
    try {
      const uid = await getUid();
      await deletePushTokenHelper(uid);
      return { ok: true };
    } catch (e) {
      __devLog('removePushToken failed:', e?.message || e);
      return { ok: false };
    }
  }, []);

  const setNotificationAllow = useCallback(async (allow) => {
    try {
      const uid = await getUid();
      await setNotificationAllowHelper(uid, !!allow);
      return { ok: true };
    } catch (e) {
      let msg = t('errors_saveGeneric');
      const m = String(e?.message || e).toLowerCase();
      if (m.includes('no_auth')) msg = t('errors_noAuth');
      else if (m.includes('permission denied') || m.includes('rls')) msg = t('errors_rls');
      else if (m.includes('failed to fetch') || m.includes('network')) msg = t('errors_network');
      __devLog('setNotificationAllow failed', m, e);
      return { ok: false, message: msg };
    }
  }, [t]);

  const setQuietHours = useCallback(async (quietStart, quietEnd, quietTimezone = null) => {
    try {
      const patchStart = quietStart ?? null;
      const patchEnd = quietEnd ?? null;
      const patchTz = (typeof quietTimezone === 'string' && quietTimezone.trim())
        ? quietTimezone.trim()
        : null;

      // Primary path: DB-side SECURITY DEFINER RPC (no edge relay).
      let { error: rpcErr } = await supabase.rpc('set_quiet_hours_self', {
        p_quiet_start: patchStart,
        p_quiet_end: patchEnd,
        p_quiet_timezone: patchTz,
      });
      if (rpcErr && /quiet_timezone/i.test(String(rpcErr?.message || ''))) {
        ({ error: rpcErr } = await supabase.rpc('set_quiet_hours_self', {
          p_quiet_start: patchStart,
          p_quiet_end: patchEnd,
          p_quiet_timezone: null,
        }));
      }
      if (rpcErr) {
        // Fallback: update existing row only (still no edge calls).
        const uid = await getUid();
        let patch = { quiet_start: patchStart, quiet_end: patchEnd };
        if (patchTz) patch = { ...patch, quiet_timezone: patchTz };
        let { error: updateErr } = await supabase.from(TBL.NOTIF_PREFS).update(patch).eq('user_id', uid);
        if (updateErr && /quiet_timezone/i.test(String(updateErr?.message || ''))) {
          ({ error: updateErr } = await supabase
            .from(TBL.NOTIF_PREFS)
            .update({ quiet_start: patchStart, quiet_end: patchEnd })
            .eq('user_id', uid));
        }
        if (updateErr) throw updateErr;
      }

      await refreshPrefs();
      return { ok: true };
    } catch (e) {
      let msg = t('quiet_saveFail');
      const rawMessage = String(e?.message || e || '');
      const m = rawMessage.toLowerCase();
      if (m.includes('no_auth') || m.includes('unauthorized')) msg = t('errors_noAuth');
      else if (m.includes('permission denied') || m.includes('rls')) msg = t('errors_rls');
      else if (m.includes('failed to fetch') || m.includes('network')) msg = t('errors_network');
      return { ok: false, message: msg, rawMessage };
    }
  }, [refreshPrefs, t]);

  useEffect(() => {
    if (!isSoloAdmin || isLoadingPrefs) return;
    if (prefs.allow === true) return;

    setPrefs((prev) => ({ ...prev, allow: true }));
    setNotificationAllow(true).catch(() => {});
  }, [isLoadingPrefs, isSoloAdmin, prefs.allow, setNotificationAllow]);

  // Self-heal: re-register token only when server prefs explicitly allow notifications.
  useEffect(() => {
    let alive = true;
    if (isLoadingPrefs) return undefined;
    if (prefsData?.allow !== true) return undefined;
    if (Platform.OS === 'web') return undefined;
    if (Constants?.appOwnership === 'expo') return undefined;

    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!alive || !session?.access_token) return;

        const permission = await getSystemPushPermission();
        if (!alive || !permission.granted) return;
        const { token } = await getPushTokenIfGranted();
        if (!alive || !token) return;
        const r = await savePushToken(token);
        if (!r.ok && !isTransientPushSyncError(r.rawMessage || r.message)) {
          __devLog('auto push token sync failed:', r.rawMessage || r.message || 'unknown');
        }
      } catch (e) {
        if (!isTransientPushSyncError(e?.message || e)) {
          __devLog('auto push token sync exception:', e?.message || e);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [isLoadingPrefs, prefsData?.allow, savePushToken]);

  const onToggleAllow = useCallback(async (val) => {
    const prev = prefs.allow;
    setPrefs((p) => ({ ...p, allow: val }));

    const isExpoGo = Constants?.appOwnership === 'expo';
    if (isExpoGo) {
      const { ok, message } = await setNotificationAllow(val);
      if (!ok) {
        setPrefs((p) => ({ ...p, allow: prev }));
        toast.error(message || t('errors_saveGeneric'));
      } else {
        toast.info(val ? t('push_onStandalone') : t('push_off'));
      }
      return;
    }

    if (val) {
      // Enabling: request permission, save token, then save prefs
      const { granted, token, reason, canAskAgain } = await ensurePushPermission();
      if (!granted) {
        setPrefs((p) => ({ ...p, allow: prev }));
        toast.error(t(canAskAgain ? 'push_noPermission' : 'push_noPermissionSettings'));
        if (!canAskAgain) {
          try {
            if (Linking?.openSettings) await Linking.openSettings();
          } catch (e) {
            __devLog('openSettings failed:', e?.message || e);
          }
        }
        return;
      }
      if (!token) {
        setPrefs((p) => ({ ...p, allow: prev }));
        const details = reason ? ` (${reason})` : '';
        toast.error(`${t('push_saveTokenFail')}${details}`);
        return;
      }
      {
        const r = await savePushToken(token);
        if (!r.ok) {
          setPrefs((p) => ({ ...p, allow: prev }));
          toast.error(r.message || t('push_saveTokenFail'));
          return;
        }
      }
      const { ok, message } = await setNotificationAllow(true);
      if (!ok) {
        setPrefs((p) => ({ ...p, allow: prev }));
        toast.error(message || t('errors_saveGeneric'));
        __devLog('notification_prefs save error:', message);
      } else {
        queryClient.invalidateQueries({ queryKey: ['appSettings', 'notifPrefs'] }).catch(() => {});
        toast.info(t('push_on'));
      }
      return;
    } else {
      // Disabling: save prefs first, then remove token if save succeeded
      const { ok, message } = await setNotificationAllow(false);
      if (!ok) {
        setPrefs((p) => ({ ...p, allow: prev }));
        toast.error(message || t('errors_saveGeneric'));
        __devLog('notification_prefs save error (disable):', message);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['appSettings', 'notifPrefs'] }).catch(() => {});
      const r = await removePushToken();
      if (!r.ok) {
        __devLog('removePushToken after disable returned not ok');
      }
      toast.info(t('push_off'));
      return;
    }
  }, [prefs.allow, queryClient, removePushToken, savePushToken, setNotificationAllow, t, toast]);

  const onToggleEvent = useCallback(
    (key) => async (val) => {
      const prev = prefs[key];
      setPrefs((p) => ({ ...p, [key]: val }));
      const { ok, message } = await savePrefs({ [key]: val });
      if (!ok) {
        setPrefs((p) => ({ ...p, [key]: prev }));
        toast.error(message || t('errors_saveGeneric'));
        __devLog('notification_prefs save error:', message);
      }
    },
    [prefs, savePrefs, t, toast],
  );

  const onResetQuietTimes = useCallback(async () => {
    const prev = { quiet_start: prefs.quiet_start, quiet_end: prefs.quiet_end };
    const patch = { quiet_start: null, quiet_end: null };
    setPrefs((p) => ({ ...p, ...patch }));
    const { ok, message } = await setQuietHours(null, null, resolveDeviceTimeZone());
    if (!ok) {
      setPrefs((p) => ({ ...p, ...prev }));
      toast.error(message || t('quiet_saveFail'));
    } else {
      toast.info(t('quiet_off'));
    }
  }, [prefs.quiet_end, prefs.quiet_start, setQuietHours, t, toast]);

  const sectionBase = useMemo(() => {
    const resolvePressHandler = (sectionKey, itemKey) => {
      if (sectionKey === 'appearance' && itemKey === 'theme') return () => setThemeOpen(true);
      if (sectionKey === 'appearance' && itemKey === 'language') return () => setLangOpen(true);
      if (sectionKey === 'notifications' && itemKey === 'events') return () => router.push('/app_settings/sections/events');
      if (sectionKey === 'quiet' && itemKey === 'quiet_start') return openTimePicker('start');
      if (sectionKey === 'quiet' && itemKey === 'quiet_end') return openTimePicker('end');
      if (sectionKey === 'quiet' && itemKey === 'quiet_reset') return onResetQuietTimes;
      return undefined;
    };

    const resolveToggleHandler = (sectionKey, itemKey) => {
      if (sectionKey === 'notifications' && itemKey === 'allow') return onToggleAllow;
      if (sectionKey === 'notifications') return onToggleEvent(itemKey);
      return futureFeature;
    };

    return SETTINGS_SECTIONS.map((section) => ({
      ...section,
      title: t(`settings_sections_${section.key}_title`),
      items: section.items.map((item) => {
        const mapped = {
          ...item,
          label: t(`settings_sections_${section.key}_items_${item.key}`),
          onPress: item.switch ? undefined : resolvePressHandler(section.key, item.key),
          onValueChange: item.switch ? resolveToggleHandler(section.key, item.key) : undefined,
        };
        // Mark language row as a future feature (no hardcoded locale here)
        if (section.key === 'appearance' && item.key === 'language') {
          mapped.comingSoon = true;
        }
        return mapped;
      }),
    }));
  }, [futureFeature, onResetQuietTimes, onToggleAllow, onToggleEvent, openTimePicker, router, t]);

  // Inject dynamic values derived from current prefs without recalculating labels on every prefs change
  const visibleSectionBase = useMemo(() => {
    if (!isSoloAdmin) return sectionBase;
    return sectionBase.filter(
      (sec) => !['appearance', 'notifications', 'quiet', 'privacy'].includes(String(sec?.key || '')),
    );
  }, [isSoloAdmin, sectionBase]);

  const sections = useMemo(
    () =>
      visibleSectionBase.map((sec) => ({
        ...sec,
        items: sec.items.map((it) => {
          if (sec.key === 'notifications' && it.key === 'allow') {
            return { ...it, value: !!prefs.allow, disabled: !!isLoadingPrefs };
          }
          if (sec.key === 'notifications' && (it.key === 'sounds' || it.key === 'events')) {
            return { ...it, disabled: !prefs.allow || !!isLoadingPrefs };
          }
          if (sec.key === 'quiet' && it.key === 'quiet_start') {
            return { ...it, value: toTimeStr(prefs.quiet_start) || t('common_off') };
          }
          if (sec.key === 'quiet' && it.key === 'quiet_end') {
            return { ...it, value: toTimeStr(prefs.quiet_end) || t('common_off') };
          }
          if (sec.key === 'appearance' && it.key === 'language') {
            // Show first available locale as the default (no hardcoded 'ru')
            return { ...it, value: t(`language_${availableLocales[0]}`), disabled: true };
          }
          if (sec.key === 'appearance' && it.key === 'theme') {
            return { ...it, value: currentThemeLabel };
          }
          return it;
        }),
      })),
    [visibleSectionBase, prefs, isLoadingPrefs, currentThemeLabel, t],
  );

  return (
    <Screen
      scroll={false}
      headerOptions={{ title: t('routes.app_settings/AppSettings', 'Настройки приложения') }}
    >
      <ScrollView
        contentContainerStyle={s.contentWrap}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {isLoadingPrefs && (
          <View style={s.loadingWrap}>
            <ActivityIndicator />
          </View>
        )}
        {sections.map((sec, idx) => (
          <View key={sec.key} style={s.sectionWrap}>
            <SectionHeader topSpacing={idx === 0 ? 0 : undefined}>
              {sec.title}
            </SectionHeader>
            <Card paddedXOnly>
              {sec.items.map((it, idx) => {
                const last = idx === sec.items.length - 1;
                return (
                  <React.Fragment key={it.key}>
                    {it.switch ? (
                      <SwitchField
                        label={it.label}
                        value={!!it.value}
                        onValueChange={it.onValueChange}
                        disabled={!!it.disabled || !!it.comingSoon}
                        pressable={!!it.comingSoon}
                        onPress={it.comingSoon ? futureFeature : undefined}
                        accessibilityLabel={it.label}
                      />
                    ) : (
                      <SelectField
                        label={it.label}
                        value={it.value}
                        onPress={it.comingSoon ? futureFeature : it.onPress}
                        disabled={!!it.disabled || !!it.comingSoon}
                        onDisabledPress={it.comingSoon ? futureFeature : undefined}
                        accessibilityLabel={it.label}
                      />
                    )}
                    {!last && <View style={base.sep} />}
                  </React.Fragment>
                );
              })}
            </Card>
          </View>
        ))}
      </ScrollView>

      {/* Time Picker */}
      {timePickerOpen ? (
        <DateTimeModal
          visible={!!timePickerOpen}
          mode="time"
          initial={timeValue}
          minuteStep={TIME_PICKER_MINUTE_STEP}
          onApply={(d) => onTimePicked(null, d)}
          onClose={closeTimePicker}
        />
      ) : null}

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
          setMode(item?.id);
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
          const selectedLocale = item?.id;
          if (!selectedLocale) {
            setLangOpen(false);
            return;
          }
          try {
            await setLocale(selectedLocale);
            try {
              await saveUserLocale(selectedLocale);
            } catch (e) {
              __devLog('saveUserLocale failed:', e?.message || e);
            }
            toast.info(t('lang_changed'));
          } finally {
            setLangOpen(false);
          }
        }}
        onClose={() => setLangOpen(false)}
      />
    </Screen>
  );
}

const styles = (t) =>
  StyleSheet.create({
    contentWrap: { paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.xl },
    sectionWrap: { marginBottom: t.spacing.sm },
    loadingWrap: { paddingVertical: t.spacing.sm },
  });
