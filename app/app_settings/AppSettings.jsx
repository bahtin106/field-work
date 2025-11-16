// app/app_settings/AppSettings.jsx
import { Feather } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useNavigation } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useQueryWithCache } from '../../components/hooks/useQueryWithCache';
import Screen from '../../components/layout/Screen';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { SelectField, SwitchField } from '../../components/ui/TextField';
import { useToast } from '../../components/ui/ToastProvider';
import { listItemStyles } from '../../components/ui/listItemStyles';
import { BaseModal, DateTimeModal, SelectModal } from '../../components/ui/modals';
import { ANDROID_CHANNEL_ID, ANDROID_CHANNEL_NAME, APP_DEFAULTS } from '../../config/notifications';
import { supabase } from '../../lib/supabase';
import {
  deletePushToken as deletePushTokenHelper,
  getUid,
  readProfile,
  readRolePerm,
  savePushToken as savePushTokenHelper,
} from '../../lib/supabaseHelpers';
import { devWarn as __devLog } from '../../src/utils/dev';
import { useTheme } from '../../theme';

import { PERM_KEYS, TBL } from '../../lib/constants';
import { saveUserLocale } from '../../lib/userLocale';
import { availableLocales, getLocale, setLocale, useI18nVersion } from '../../src/i18n';
import { useTranslation } from '../../src/i18n/useTranslation';

// Safer fallback for minute step (prevents ReferenceError if APP_DEFAULTS missing or timeStep is not a number)
const TIME_PICKER_MINUTE_STEP = Number(APP_DEFAULTS?.timeStep) || 5;

// Defaults for quiet hours (robust parsing with sane fallback)
const [DEFAULT_QUIET_HOUR, DEFAULT_QUIET_MINUTE] = (() => {
  const match = String(APP_DEFAULTS?.quietEnd ?? '09:00').match(/^(\d{2}):(\d{2})$/);
  const h = parseInt(match?.[1] ?? '9', 10);
  const m = parseInt(match?.[2] ?? '0', 10);
  return [h, m];
})();

let installEdgeToEdgeWarnFilter;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
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

async function ensurePushPermission() {
  try {
    // Web: expo-notifications не поддерживаются; не запускаем токен-флоу
    if (Platform.OS === 'web') {
      try {
        if (Linking?.openSettings) await Linking.openSettings();
      } catch (e) {}
      return { granted: false, token: null };
    }

    const isExpoGo = Constants?.appOwnership === 'expo';
    if (isExpoGo) {
      try {
        if (Linking?.openSettings) await Linking.openSettings();
      } catch (e) {
        __devLog('openSettings failed:', e?.message || e);
      }
      return { granted: false, token: null };
    }

    const Notifications = await getNotifications();
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    const granted = finalStatus === 'granted';

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
    try {
      const projectId =
        Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
      const resp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
      token = resp?.data || null;
    } catch (e) {
      __devLog('getExpoPushTokenAsync failed:', e?.message || e);
    }

    return { granted, token };
  } catch (e) {
    __devLog('ensurePushPermission failed:', e?.message || e);
    return { granted: false, token: null };
  }
}

// ---- Local wrappers to replace deprecated imports ----
function SingleSelectModal({ visible, title, options = [], selectedId, onSelect, onClose }) {
  const { theme } = useTheme();
  const mapped = (options || []).map((opt) => ({
    id: opt.id,
    label: opt.label,
    right:
      selectedId === opt.id ? (
        <Feather name="check" size={18} color={theme.colors.primary} />
      ) : null,
  }));
  return (
    <SelectModal
      visible={visible}
      title={title}
      items={mapped}
      onSelect={(it) => onSelect?.(it.id)}
      onClose={onClose}
      searchable={false}
    />
  );
}

function SwitchListModal({ visible, title, toggles = [], footer = null, onClose }) {
  const { theme } = useTheme();
  return (
    <BaseModal visible={visible} title={title} onClose={onClose}>
      <View style={{ gap: theme.spacing.sm }}>
        {toggles.map((t) => (
          <SwitchField
            key={t.id}
            label={t.label}
            value={!!t.value}
            onValueChange={t.onChange}
            accessibilityRole="switch"
            accessibilityLabel={t.label}
          />
        ))}
      </View>
      {footer ? (
        <View style={{ marginTop: theme.spacing.md, marginBottom: theme.spacing.lg }}>
          {footer}
        </View>
      ) : null}
    </BaseModal>
  );
}
// ---- end wrappers ----
export default function AppSettings() {
  const nav = useNavigation();
  const ver = useI18nVersion();
  const { t } = useTranslation();

  useEffect(() => {
    try {
      nav.setParams({ headerTitle: t('routes.app_settings/AppSettings') });
    } catch (e) {
      __devLog('nav.setParams failed:', e?.message || e);
    }
  }, [ver]);

  const { theme, mode, setMode } = useTheme();
  const toast = useToast();
  const [themeOpen, setThemeOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const _curLocale = (() => {
    try {
      return getLocale();
    } catch {
      return 'ru';
    }
  })();
  const _curLangLabel = t(`language_${_curLocale}`);
  const s = useMemo(() => styles(theme), [theme]);
  const base = useMemo(() => listItemStyles(theme), [theme]);
  const futureFeature = () => toast.info(t('settings_soon'));
  const [prefs, setPrefs] = useState({
    allow: true,
    new_orders: true,
    feed_orders: true,
    reminders: true,
    quiet_start: null,
    quiet_end: null,
  });
  const [loadingPrefs, setLoadingPrefs] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(null);
  const [timeValue, setTimeValue] = useState(new Date());
  const [canCreateOrders, setCanCreateOrders] = useState(false);

  // Prevent setState on unmounted component
  const mounted = useRef(false);
  const reopenTimer = useRef(null);
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

  // Кеширование настроек уведомлений с Realtime
  const {
    data: prefsData,
    isLoading: isLoadingPrefs,
    refresh: refreshPrefs,
  } = useQueryWithCache({
    queryKey: 'appSettings:notifPrefs',
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
        .select('allow, new_orders, feed_orders, reminders, quiet_start, quiet_end')
        .eq('user_id', uid)
        .maybeSingle();

      if (prefsErr) {
        __devLog('NOTIF_PREFS load error:', prefsErr.message || prefsErr);
        throw prefsErr;
      }

      // default quiet hours, если пусто
      const qs = data?.quiet_start,
        qe = data?.quiet_end;
      const bothEmpty = (!qs || String(qs).trim() === '') && (!qe || String(qe).trim() === '');
      if (!data || bothEmpty) {
        const defaultPatch = {
          quiet_start: APP_DEFAULTS?.quietStart,
          quiet_end: APP_DEFAULTS?.quietEnd,
        };
        return { ...(data || {}), ...defaultPatch };
      }

      return data;
    },
    ttl: 5 * 60 * 1000, // 5 минут
    staleTime: 2 * 60 * 1000, // 2 минуты
    placeholderData: null,
    enableRealtime: true,
    realtimeTable: TBL.NOTIF_PREFS,
    supabaseClient: supabase,
    onError: (e) => {
      __devLog('loadPrefs error:', e?.message || e);
      toast.error(t('errors_loadSettings'));
    },
  });

  // Обновляем local state когда приходят данные из кеша
  useEffect(() => {
    if (prefsData && mounted.current) {
      setPrefs((p) => ({ ...p, ...prefsData }));
    }
  }, [prefsData]);

  // Загрузка разрешений пользователя с кешем
  const { data: permData } = useQueryWithCache({
    queryKey: 'appSettings:userPerm',
    queryFn: async () => {
      try {
        const uid = await getUid();
        const prof = await readProfile(uid);
        if (prof?.company_id && prof?.role) {
          const permValue = await readRolePerm(
            prof.company_id,
            prof.role,
            PERM_KEYS.CAN_CREATE_ORDERS,
          );
          const v = (permValue ?? '').toString().trim().toLowerCase();
          return v in { 1: 1, true: 1, t: 1, yes: 1, y: 1 };
        }
        return false;
      } catch (e) {
        __devLog('readRolePerm failed:', e?.message || e);
        return false;
      }
    },
    ttl: 5 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
    placeholderData: false,
  });

  useEffect(() => {
    if (permData !== undefined && mounted.current) {
      setCanCreateOrders(permData);
    }
  }, [permData]);

  async function savePrefs(patch) {
    try {
      const uid = await getUid();
      const next = { ...prefs, ...patch };
      const { error } = await supabase
        .from(TBL.NOTIF_PREFS)
        .upsert({ user_id: uid, ...next }, { onConflict: 'user_id', returning: 'minimal' });
      if (error) {
        let msg = t('errors_saveGeneric');
        if (/permission denied/i.test(error.message)) msg = t('errors_noSettingsAccess');
        else if (/row level security|rls/i.test(error.message)) msg = t('errors_rls');
        else if (/timeout|network|failed to fetch/i.test(error.message)) msg = t('errors_network');
        return { ok: false, message: msg };
      }
      // Обновляем кеш после сохранения
      await refreshPrefs();
      return { ok: true };
    } catch (e) {
      const m = String(e?.message || e || '').toLowerCase();
      let msg = t('errors_saveShort');
      if (m.includes('no_auth')) msg = t('errors_noAuth');
      else if (m.includes('failed to fetch') || m.includes('network')) msg = t('errors_network');
      return { ok: false, message: msg };
    }
  }

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

  const openTimePicker = (which) => () => {
    const bothNull = !toTimeStr(prefs.quiet_start) && !toTimeStr(prefs.quiet_end);
    const fallback = which === 'start' ? APP_DEFAULTS?.quietStart : APP_DEFAULTS?.quietEnd;
    const base =
      which === 'start'
        ? (prefs.quiet_start ?? (bothNull ? fallback : null))
        : (prefs.quiet_end ?? (bothNull ? fallback : null));
    const d = toDateFromStr(toTimeStr(base));
    setTimeValue(d);
    setTimePickerOpen(which);
  };

  const onTimePicked = async (_ev, dateOrUndefined) => {
    if (!timePickerOpen) return;
    if (!dateOrUndefined) {
      setTimePickerOpen(null);
      return;
    }

    const hhmm = toTimeStr(dateOrUndefined);
    const patch = timePickerOpen === 'start' ? { quiet_start: hhmm } : { quiet_end: hhmm };

    const prevPrefs = prefs;
    const next = { ...prefs, ...patch };

    setPrefs(next);
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
      const { ok, message } = await savePrefs(resetPatch);
      if (!ok) {
        setPrefs(prevPrefs);
        toast.error(message || t('quiet_saveFail'));
      } else {
        toast.info(t('quiet_off'));
      }
      return;
    }

    const { ok, message } = await savePrefs({
      quiet_start: next.quiet_start,
      quiet_end: next.quiet_end,
    });
    if (!ok) {
      setPrefs(prevPrefs);
      toast.error(message || t('quiet_saveFail'));
    } else {
      toast.info(t('quiet_range') + `${toTimeStr(next.quiet_start)}–${toTimeStr(next.quiet_end)}`);
    }
  };

  async function savePushToken(token) {
    try {
      const uid = await getUid();
      if (!token) throw new Error('NO_TOKEN');
      const platform = Platform.OS === 'ios' ? 'ios' : 'android';
      await savePushTokenHelper(uid, token, platform);
      return { ok: true };
    } catch (e) {
      let msg = t('push_saveTokenFail');
      const m = String(e?.message || e).toLowerCase();
      if (m.includes('no_auth')) msg = t('errors_noAuthShort');
      if (m.includes('permission denied') || m.includes('rls')) msg = t('errors_rls');
      return { ok: false, message: msg };
    }
  }

  async function removePushToken() {
    try {
      const uid = await getUid();
      await deletePushTokenHelper(uid);
      return { ok: true };
    } catch (e) {
      __devLog('removePushToken failed:', e?.message || e);
      return { ok: false };
    }
  }

  const onToggleAllow = async (val) => {
    const prev = prefs.allow;
    setPrefs((p) => ({ ...p, allow: val }));

    const isExpoGo = Constants?.appOwnership === 'expo';
    if (isExpoGo) {
      const { ok, message } = await savePrefs({ allow: val });
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
      const { granted, token } = await ensurePushPermission();
      if (!granted) {
        setPrefs((p) => ({ ...p, allow: prev }));
        toast.error(t('push_noPermission'));
        return;
      }
      if (token) {
        const r = await savePushToken(token);
        if (!r.ok) {
          setPrefs((p) => ({ ...p, allow: prev }));
          toast.error(r.message || t('push_saveTokenFail'));
          return;
        }
      } else {
        toast.info(t('push_permissionGranted'));
      }
      const { ok, message } = await savePrefs({ allow: true });
      if (!ok) {
        setPrefs((p) => ({ ...p, allow: prev }));
        toast.error(message || t('errors_saveGeneric'));
        __devLog('notification_prefs save error:', message);
      } else {
        toast.info(t('push_on'));
      }
      return;
    } else {
      // Disabling: save prefs first, then remove token if save succeeded
      const { ok, message } = await savePrefs({ allow: false });
      if (!ok) {
        setPrefs((p) => ({ ...p, allow: prev }));
        toast.error(message || t('errors_saveGeneric'));
        __devLog('notification_prefs save error (disable):', message);
        return;
      }
      const r = await removePushToken();
      if (!r.ok) {
        __devLog('removePushToken after disable returned not ok');
      }
      toast.info(t('push_off'));
      return;
    }
  };

  const onToggleEvent = (key) => async (val) => {
    const prev = prefs[key];
    setPrefs((p) => ({ ...p, [key]: val }));
    const { ok, message } = await savePrefs({ [key]: val });
    if (!ok) {
      setPrefs((p) => ({ ...p, [key]: prev }));
      toast.error(message || t('errors_saveGeneric'));
      console.warn('notification_prefs save error:', message);
    }
  };

  const onResetQuietTimes = async () => {
    const prev = { quiet_start: prefs.quiet_start, quiet_end: prefs.quiet_end };
    const patch = { quiet_start: null, quiet_end: null };
    setPrefs((p) => ({ ...p, ...patch }));
    const { ok, message } = await savePrefs(patch);
    if (!ok) {
      setPrefs((p) => ({ ...p, ...prev }));
      toast.error(message || t('quiet_saveFail'));
    } else {
      toast.info(t('quiet_off'));
    }
  };

  // --- UI sections (structure without hardcoded texts; titles/labels come from i18n) ---
  const sectionBase = useMemo(
    () =>
      [
        {
          key: 'appearance',
          items: [
            { key: 'theme', type: 'select', onPress: () => setThemeOpen(true) },
            {
              key: 'language',
              type: 'select',
              value: _curLangLabel,
              onPress: () => setLangOpen(true),
            },
            { key: 'bold-text', switch: true, disabled: true, onValueChange: futureFeature },
          ],
        },
        {
          key: 'notifications',
          items: [
            { key: 'allow', switch: true, onValueChange: onToggleAllow },
            { key: 'sounds', type: 'select', disabled: true, onPress: futureFeature },
            { key: 'events', type: 'select', onPress: () => setEventsOpen(true) },
          ],
        },
        {
          key: 'quiet',
          items: [
            { key: 'quiet_start', type: 'select', onPress: openTimePicker('start') },
            { key: 'quiet_end', type: 'select', onPress: openTimePicker('end') },
            { key: 'quiet_reset', type: 'select', onPress: onResetQuietTimes },
          ],
        },
        {
          key: 'privacy',
          items: [
            { key: 'geo', type: 'select', disabled: true, onPress: futureFeature },
            { key: 'analytics', type: 'select', disabled: true, onPress: futureFeature },
            { key: 'private-search', switch: true, disabled: true, onValueChange: futureFeature },
          ],
        },
        {
          key: 'ai',
          items: [
            { key: 'suggestions', type: 'select', disabled: true, onPress: futureFeature },
            { key: 'avatars', switch: true, disabled: true, onValueChange: futureFeature },
          ],
        },
      ].map((sec) => ({
        ...sec,
        title: t(`settings_sections_${sec.key}_title`),
        items: sec.items.map((it) => ({
          ...it,
          label: t(`settings_sections_${sec.key}_items_${it.key}`, it.label),
        })),
      })),
    [_curLocale, theme, canCreateOrders, ver],
  );

  // Inject dynamic values derived from current prefs without recalculating labels on every prefs change
  const sections = useMemo(
    () =>
      sectionBase.map((sec) => ({
        ...sec,
        items: sec.items.map((it) => {
          if (sec.key === 'notifications' && it.key === 'allow') {
            return { ...it, value: !!prefs.allow, disabled: !!isLoadingPrefs };
          }
          if (sec.key === 'quiet' && it.key === 'quiet_start') {
            return { ...it, value: toTimeStr(prefs.quiet_start) || t('common_off') };
          }
          if (sec.key === 'quiet' && it.key === 'quiet_end') {
            return { ...it, value: toTimeStr(prefs.quiet_end) || t('common_off') };
          }
          if (sec.key === 'appearance' && it.key === 'language') {
            return { ...it, value: _curLangLabel };
          }
          return it;
        }),
      })),
    [sectionBase, prefs, isLoadingPrefs, _curLangLabel],
  );

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={s.contentWrap}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {isLoadingPrefs && (
          <View style={{ paddingVertical: 8 }}>
            <ActivityIndicator />
          </View>
        )}
        {sections.map((sec, idx) => (
          <View key={sec.key} style={s.sectionWrap}>
            <Text style={[base.sectionTitle, idx === 0 && { marginTop: 0 }]}>{sec.title}</Text>
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
                        disabled={!!it.disabled}
                        accessibilityRole="switch"
                        accessibilityLabel={it.label}
                      />
                    ) : (
                      <SelectField
                        label={it.label}
                        value={it.value}
                        onPress={() => {
                          if (it.disabled) futureFeature();
                          else it.onPress && it.onPress();
                        }}
                        disabled={!!it.disabled}
                        accessibilityRole="button"
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
          onClose={() => setTimePickerOpen(null)}
        />
      ) : null}

      {/* Events */}
      <SwitchListModal
        visible={eventsOpen}
        title={t('settings_events_title')}
        toggles={[
          {
            id: 'new_orders',
            label: t('settings_events_newOrders'),
            value: !!prefs.new_orders,
            onChange: onToggleEvent('new_orders'),
          },
          {
            id: 'feed_orders',
            label: t('settings_events_feedOrders'),
            value: !!prefs.feed_orders,
            onChange: onToggleEvent('feed_orders'),
          },
          ...(canCreateOrders
            ? [
                {
                  id: 'reminders',
                  label: t('settings_events_reminders'),
                  value: !!prefs.reminders,
                  onChange: onToggleEvent('reminders'),
                },
              ]
            : []),
        ]}
        footer={
          <Button variant="secondary" title={t('btn_apply')} onPress={() => setEventsOpen(false)} />
        }
        onClose={() => setEventsOpen(false)}
      />

      {/* Theme */}
      <SingleSelectModal
        visible={themeOpen}
        title={t('settings_theme_title')}
        options={[
          { id: 'light', label: t('settings_theme_light') },
          { id: 'dark', label: t('settings_theme_dark') },
          { id: 'system', label: t('settings_theme_system') },
        ]}
        selectedId={mode}
        onSelect={(id) => {
          setMode(id);
          setThemeOpen(false);
        }}
        onClose={() => setThemeOpen(false)}
      />

      {/* Language */}
      <SingleSelectModal
        visible={langOpen}
        title={t('settings_language_title')}
        options={availableLocales.map((id) => ({ id, label: t(`language_${id}`) }))}
        selectedId={_curLocale}
        onSelect={async (id) => {
          try {
            await setLocale(id);
            try {
              await saveUserLocale(id);
            } catch (e) {
              console.warn('saveUserLocale:', e?.message || e);
            }
            toast.info(t('lang_changed') ?? 'Language changed');
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
    sectionWrap: { marginBottom: 0 },
  });
