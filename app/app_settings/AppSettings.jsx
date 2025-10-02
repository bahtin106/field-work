import React, { useMemo, useState , useEffect} from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Switch,
  ScrollView,
  Platform,
  Linking,
} from "react-native";
import Constants from "expo-constants";
import DateTimePicker from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";
import AppHeader from "../../components/navigation/AppHeader";
import { useNavigation } from "expo-router";
import { useRoute } from "@react-navigation/native";
import FeatherIcon from "@expo/vector-icons/Feather";
import { useTheme } from "../../theme";
import { useToast } from "../../components/ui/ToastProvider";
import SelectModal from "../../components/ui/SelectModal";
import Button from "../../components/ui/Button";
import { supabase } from "../../lib/supabase";
import { strings as STRINGS } from "../../constants/strings";

// --- Edge-to-edge warning filter (expo-navigation-bar) ---
// Скрывает только два известных WARN'а про edge-to-edge, не трогая остальные предупреждения.
function useFilterEdgeToEdgeWarnings() {
  React.useEffect(() => {
    const originalWarn = console.warn;
    const edgeToEdgeRegex = /`setBehaviorAsync` is not supported with edge-to-edge enabled\.|`setBackgroundColorAsync` is not supported with edge-to-edge enabled\./;
    console.warn = (...args) => {
      try {
        const first = args && args.length ? String(args[0]) : "";
        if (edgeToEdgeRegex.test(first)) {
          return; // тихо игнорируем только эти конкретные варнинги
        }
      } catch {}
      originalWarn(...args);
    };
    return () => {
      console.warn = originalWarn;
    };
  }, []);
}

export default function AppSettings() {
  useFilterEdgeToEdgeWarnings();
  const nav = useNavigation();
  const route = useRoute();
  const { theme, mode, setMode } = useTheme();
  const toast = useToast();
  const [themeOpen, setThemeOpen] = useState(false);
  // Centralized strings with safe fallbacks
  const STR = {
    screenTitle: STRINGS?.appSettings?.title ?? "Настройки приложения",
    sections: {
      appearance: STRINGS?.appSettings?.sections?.appearance ?? "ВНЕШНИЙ ВИД",
      notifications: STRINGS?.appSettings?.sections?.notifications ?? "УВЕДОМЛЕНИЯ",
      quiet: STRINGS?.appSettings?.sections?.quiet ?? "ТИХИЕ ЧАСЫ",
      privacy: STRINGS?.appSettings?.sections?.privacy ?? "ПРИВАТНОСТЬ",
      ai: STRINGS?.appSettings?.sections?.ai ?? "AI",
    },
    labels: {
      theme: STRINGS?.appSettings?.labels?.theme ?? "Тема",
      textSize: STRINGS?.appSettings?.labels?.textSize ?? "Размер текста",
      boldText: STRINGS?.appSettings?.labels?.boldText ?? "Жирный текст",
      allowNotifications: STRINGS?.appSettings?.labels?.allowNotifications ?? "Допускать уведомления",
      notificationSounds: STRINGS?.appSettings?.labels?.notificationSounds ?? "Звуки уведомлений",
      enabledEvents: STRINGS?.appSettings?.labels?.enabledEvents ?? "Включённые события",
      quietStart: STRINGS?.appSettings?.labels?.quietStart ?? "Начало",
      quietEnd: STRINGS?.appSettings?.labels?.quietEnd ?? "Конец",
      quietReset: STRINGS?.appSettings?.labels?.quietReset ?? "Сбросить время (Всегда уведомлять)",
      privacyGeo: STRINGS?.appSettings?.labels?.privacyGeo ?? "Сервисы геолокации",
      privacyAnalytics: STRINGS?.appSettings?.labels?.privacyAnalytics ?? "Анализ функционала",
      privacySearch: STRINGS?.appSettings?.labels?.privacySearch ?? "Конфиденциальный поиск",
      aiSuggestions: STRINGS?.appSettings?.labels?.aiSuggestions ?? "Персональные предложения",
      aiAvatars: STRINGS?.appSettings?.labels?.aiAvatars ?? "Аватарки AI",
      eventNewOrders: STRINGS?.appSettings?.labels?.eventNewOrders ?? "Новые заявки",
      eventFeedOrders: STRINGS?.appSettings?.labels?.eventFeedOrders ?? "Заявки в ленте",
      eventReminders: STRINGS?.appSettings?.labels?.eventReminders ?? "Напоминать о незабранных",
    },
    options: {
      themeLight: STRINGS?.appSettings?.options?.themeLight ?? "Светлая",
      themeDark: STRINGS?.appSettings?.options?.themeDark ?? "Тёмная",
      themeSystem: STRINGS?.appSettings?.options?.themeSystem ?? "Системная",
      off: STRINGS?.common?.off ?? "Выкл.",
      done: STRINGS?.common?.done ?? "Готово",
      pickTheme: STRINGS?.appSettings?.modals?.pickTheme ?? "Выберите тему",
      pickEvents: STRINGS?.appSettings?.modals?.pickEvents ?? "Включённые события",
    },
    messages: {
      future: STRINGS?.messages?.future ?? "Будет добавлено в будущем",
      chooseQuietStart: STRINGS?.messages?.chooseQuietStart ?? "Выберите начало тихих часов",
      chooseQuietEnd: STRINGS?.messages?.chooseQuietEnd ?? "Выберите конец тихих часов",
      quietOff: STRINGS?.messages?.quietOff ?? "Тихие часы выключены",
      quietRange: (a,b) => (STRINGS?.messages?.quietRange ? STRINGS.messages.quietRange(a,b) : `Тихие часы: ${a}–${b}`),
      notifOn: STRINGS?.messages?.notifOn ?? "Уведомления включены",
      notifOff: STRINGS?.messages?.notifOff ?? "Уведомления выключены",
      notifOnStandalone: STRINGS?.messages?.notifOnStandalone ?? "Уведомления включены (только для standalone версии)",
      noPermission: STRINGS?.messages?.noPermission ?? "Нет разрешения на уведомления. Разрешите в настройках.",
      permissionGrantedNoToken: STRINGS?.messages?.permissionGrantedNoToken ?? "Разрешение дано. Токен будет получен в dev/прод билде.",
      saveError: STRINGS?.messages?.saveError ?? "Не удалось сохранить изменения",
      saveErrorGeneric: STRINGS?.messages?.saveErrorGeneric ?? "Не удалось сохранить",
      noAuth: STRINGS?.messages?.noAuth ?? "Нет авторизации. Войдите снова.",
      noConnection: STRINGS?.messages?.noConnection ?? "Нет соединения с сервером",
      openSoundSettingsHint: STRINGS?.messages?.openSoundSettingsHint ?? "Откройте настройки звука вручную: Уведомления → Звук.",
      tokenSaveFailed: STRINGS?.messages?.tokenSaveFailed ?? "Не удалось сохранить токен",
    }
  };


  const s = useMemo(() => styles(theme), [theme]);
  const futureFeature = () => toast.info(STR.messages.future);

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
  const [timePickerOpen, setTimePickerOpen] = useState(null); // "start" | "end" | null
  const [timeValue, setTimeValue] = useState(new Date());

  const [canCreateOrders, setCanCreateOrders] = useState(false);

  // Запрос разрешений на уведомления + создание Android-канала, возврат токена (если получилось)
  async function ensurePushPermission() {
    try {
      // Expo Go: полностью пропускаем импорт expo-notifications, чтобы не срабатывала авто-регистрация токена
      const isExpoGo = Constants?.appOwnership === 'expo';
      
      // Для Expo Go показываем системные настройки уведомлений
      if (isExpoGo) {
        try {
          await Linking.openSettings();
        } catch (error) {
          toast.error(STR.messages.openSoundSettingsHint);
        }
        return { granted: false, token: null };
      }
      
      // Динамически импортируем модуль (без сайд-эффектов на старте приложения)
      const Notifications = await import('expo-notifications');
      // 1) Запрос/проверка прав
      const { status: existing } = await Notifications.getPermissionsAsync();
      let finalStatus = existing;
      if (existing !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      const granted = finalStatus === 'granted';
      // 2) Android: канал
      if (Platform.OS === 'android') {
        try {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.MAX,
            sound: 'default',
          });
        } catch {}
      }
      // 3) Получаем Expo push token (в dev/прод билде)
      let token = null;
      try {
        const resp = await Notifications.getExpoPushTokenAsync();
        token = resp?.data || null;
      } catch {}
      return { granted, token };
    } catch {
      return { granted: false, token: null };
    }
  }

  async function loadPrefs() {
    setLoadingPrefs(true);
    try {
      const { data: ures } = await supabase.auth.getUser();
      const uid = ures?.user?.id;
      if (!uid) return;

      const { data } = await supabase
        .from("notification_prefs")
        .select("allow, new_orders, feed_orders, reminders, quiet_start, quiet_end")
        .eq("user_id", uid)
        .maybeSingle();
      if (data) setPrefs((p) => ({ ...p, ...data }));

      const { data: prof } = await supabase
        .from("profiles")
        .select("role, company_id")
        .eq("id", uid)
        .maybeSingle();

      if (prof?.company_id && prof?.role) {
        const { data: perm } = await supabase
          .from("app_role_permissions")
          .select("value")
          .eq("company_id", prof.company_id)
          .eq("role", prof.role)
          .eq("key", "canCreateOrders")
          .maybeSingle();
        const v = (perm?.value ?? "").toString().trim().toLowerCase();
        setCanCreateOrders(v in { "1":1, "true":1, "t":1, "yes":1, "y":1 });
      } else {
        setCanCreateOrders(false);
      }
    } catch (e) {
      toast.error(STR.messages.saveError);
    } finally {
      setLoadingPrefs(false);
    }
  }

  useEffect(() => {
    loadPrefs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function savePrefs(patch) {
    try {
      const { data: ures, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const uid = ures?.user?.id;
      if (!uid) throw new Error("NO_AUTH");
      const next = { ...prefs, ...patch };
      const { error } = await supabase
        .from("notification_prefs")
        .upsert({ user_id: uid, ...next }, { onConflict: "user_id" });
      if (error) {
        let msg = STR.messages.saveError;
        if (/permission denied/i.test(error.message)) msg = STR.messages.noPermission ?? "Нет прав доступа к настройкам";
        else if (/row level security|rls/i.test(error.message)) msg = "Недостаточно прав (RLS)";
        else if (/timeout|network|failed to fetch/i.test(error.message)) msg = STR.messages.noConnection;
        console.warn('savePrefs supabase error:', error);
        return { ok: false, message: msg };
      }
      return { ok: true };
    } catch (e) {
      const m = String(e?.message || e || "").toLowerCase();
      let msg = STR.messages.saveErrorGeneric;
      if (m.includes("no_auth")) msg = STR.messages.noAuth;
      else if (m.includes("failed to fetch") || m.includes("network")) msg = STR.messages.noConnection;
      return { ok: false, message: msg };
    }
  }

  function toTimeStr(v) {
    if (!v) return null;
    if (typeof v === "string") {
      // "HH:MM:SS" or "HH:MM"
      const m = v.match(/^(\d{2}):(\d{2})/);
      if (m) return `${m[1]}:${m[2]}`;
      return null;
    }
    if (v instanceof Date) {
      const hh = String(v.getHours()).padStart(2, "0");
      const mm = String(v.getMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    }
    return null;
  }

  // FIX: не используем "1900-й год", чтобы не ловить исторические таймзоны (дрейф ~55 мин).
  function toDateFromStr(s) {
    try {
      const now = new Date();
      const baseY = now.getFullYear();
      const baseM = now.getMonth();
      const baseD = now.getDate();
      if (!s) return new Date(baseY, baseM, baseD, 9, 0, 0, 0); // 09:00 default
      const [hh, mm] = s.split(":").map((n)=>parseInt(n,10));
      return new Date(baseY, baseM, baseD, isNaN(hh)?9:hh, isNaN(mm)?0:mm, 0, 0);
    } catch {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0);
    }
  }
  // helper: оба времени заданы?
  const bothQuietSet = (obj) => !!toTimeStr(obj.quiet_start) && !!toTimeStr(obj.quiet_end);


  const openTimePicker = (which) => () => {
    const base = which === "start" ? prefs.quiet_start : prefs.quiet_end;
    const d = toDateFromStr(toTimeStr(base));
    setTimeValue(d);
    setTimePickerOpen(which);
  };

  
  // Обновлённая логика выбора времени «Тихих часов»
  const onTimePicked = async (_ev, dateOrUndefined) => {
    if (!timePickerOpen) return;
    // Android: dismiss -> undefined
    if (!dateOrUndefined) { setTimePickerOpen(null); return; }

    const hhmm = toTimeStr(dateOrUndefined);
    const patch = timePickerOpen === "start" ? { quiet_start: hhmm } : { quiet_end: hhmm };

    const prevPrefs = prefs;
    const next = { ...prefs, ...patch };

    // Сразу закрываем текущий пикер и обновляем локально
    setPrefs(next);
    setTimePickerOpen(null);

    // Если второе время ещё не задано — просим выбрать его и НИЧЕГО не сохраняем в базу
    if (!bothQuietSet(next)) {
      const missing = next.quiet_start ? "end" : "start";
      const d = toDateFromStr(toTimeStr(next[missing]));
      setTimeValue(d);
      setTimeout(() => setTimePickerOpen(missing), 0);
      toast.info(missing === "end" ? STR.messages.chooseQuietEnd : STR.messages.chooseQuietStart);
      return;
    }

    // Если начало и конец совпали — считаем, что тихие часы выключены
    if (toTimeStr(next.quiet_start) === toTimeStr(next.quiet_end)) {
      const resetPatch = { quiet_start: null, quiet_end: null };
      setPrefs((p) => ({ ...p, ...resetPatch }));
      const { ok, message } = await savePrefs(resetPatch);
      if (!ok) {
        setPrefs(prevPrefs);
        toast.error(message || STR.messages.saveErrorGeneric);
      } else {
        toast.info(STR.messages.quietOff);
      }
      return;
    }

    // Оба времени заданы и они разные — сохраняем пару атомарно
    const { ok, message } = await savePrefs({
      quiet_start: next.quiet_start,
      quiet_end: next.quiet_end,
    });
    if (!ok) {
      setPrefs(prevPrefs);
      toast.error(message || STR.messages.saveErrorGeneric);
    } else {
      toast.info(STR.messages.quietRange(toTimeStr(next.quiet_start), toTimeStr(next.quiet_end)));
    }
  };


  
  async function savePushToken(token) {
    try {
      const { data: ures, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const uid = ures?.user?.id;
      if (!uid) throw new Error('NO_AUTH');
      if (!token) throw new Error('NO_TOKEN');
      const platform = Platform.OS === 'ios' ? 'ios' : 'android';
      // гарантируем одну запись на пользователя: delete -> insert
      const { error } = await supabase
        .from('push_tokens')
        .upsert({ user_id: uid, token, platform }, { onConflict: 'user_id' });
      if (error) throw error;
      return { ok: true };
    } catch (e) {
      let msg = STR.messages.tokenSaveFailed;
      const m = String(e?.message || e).toLowerCase();
      if (m.includes('no_auth')) msg = STR.messages.noAuth;
      if (m.includes('permission denied') || m.includes('rls')) msg = 'Недостаточно прав (RLS)';
      return { ok: false, message: msg };
    }
  }

  async function removePushToken() {
    try {
      const { data: ures, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const uid = ures?.user?.id;
      if (!uid) throw new Error('NO_AUTH');
      await supabase.from('push_tokens').delete().eq('user_id', uid);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }
const onToggleAllow = async (val) => {
  const prev = prefs.allow;
  setPrefs((p) => ({ ...p, allow: val }));

  // Для Expo Go просто сохраняем настройку без запроса разрешений
  const isExpoGo = Constants?.appOwnership === 'expo';
  if (isExpoGo) {
    const { ok, message } = await savePrefs({ allow: val });
    if (!ok) {
      setPrefs((p) => ({ ...p, allow: prev }));
      toast.error(message || STR.messages.saveError);
    } else {
      toast.info(val ? STR.messages.notifOnStandalone : STR.messages.notifOff);
    }
    return;
  }

  if (val) {
    // Включаем: запрашиваем разрешение и сохраняем токен
    const { granted, token } = await ensurePushPermission();
    if (!granted) {
      setPrefs((p) => ({ ...p, allow: prev }));
      toast.error(STR.messages.noPermission);
      return;
    }
    if (token) {
      const r = await savePushToken(token);
      if (!r.ok) {
        setPrefs((p) => ({ ...p, allow: prev }));
        toast.error(r.message || STR.messages.tokenSaveFailed);
        return;
      }
    } else {
      // Expo Go или ошибка получения токена — предупреждаем, но не валим
      toast.info(STR.messages.permissionGrantedNoToken);
    }
  } else {
    // Выключаем: удаляем токен
    await removePushToken();
  }

  const { ok, message } = await savePrefs({ allow: val });
  if (!ok) {
    setPrefs((p) => ({ ...p, allow: prev }));
    toast.error(message || STR.messages.saveError);
    console.warn("notification_prefs save error:", message);
  } else {
    toast.info(val ? STR.messages.notifOn : STR.messages.notifOff);
  }
};

  // Улучшили UX открытия настроек звука/уведомлений
  const onOpenSystemSounds = async () => {
    try {
      if (Platform.OS === "android") {
        // Пробуем открыть экран уведомлений системы
        const intentUrl = "intent:#Intent;action=android.settings.APP_NOTIFICATION_SETTINGS;end";
        await Linking.openURL(intentUrl);
        return;
      }
      // iOS: открываем настройки приложения
      await Linking.openURL("app-settings:");
    } catch {
      try {
        await Linking.openSettings();
      } catch {
        toast.info(STR.messages.openSoundSettingsHint);
      }
    }
  };

  const onToggleEvent = (key) => async (val) => {
    const prev = prefs[key];
    setPrefs((p) => ({ ...p, [key]: val }));
    const { ok, message } = await savePrefs({ [key]: val });
    if (!ok) {
      setPrefs((p) => ({ ...p, [key]: prev }));
      toast.error(message || STR.messages.saveError);
      console.warn("notification_prefs save error:", message);
    }
  };

  // Кнопка «Сбросить»: обнуляем quiet_start/quiet_end
  const onResetQuietTimes = async () => {
    const prev = { quiet_start: prefs.quiet_start, quiet_end: prefs.quiet_end };
    const patch = { quiet_start: null, quiet_end: null };
    setPrefs((p) => ({ ...p, ...patch }));
    const { ok, message } = await savePrefs(patch);
    if (!ok) {
      setPrefs((p) => ({ ...p, ...prev }));
      toast.error(message || STR.messages.saveErrorGeneric);
    } else {
      toast.info(STR.messages.quietOff);
    }
  };

  const sections = [
    {
      key: "appearance",
      title: STR.sections.appearance,
      items: [
        {
          key: "theme",
          label: STR.labels.theme,
          right: <Text style={[s.value, { color: theme.colors.text }]}>{mode === "system" ? STR.options.themeSystem : mode === "light" ? STR.options.themeLight : STR.options.themeDark}</Text>,
          chevron: true,
          onPress: () => setThemeOpen(true),
        },
        { key: "text-size", label: STR.labels.textSize, chevron: true, disabled: true, onPress: futureFeature },
        { key: "bold-text", label: STR.labels.boldText, switch: true, disabled: true, onPress: futureFeature },
      ],
    },
    {
      key: "notifications",
      title: STR.sections.notifications,
      items: [
        {
          key: "allow",
          label: STR.labels.allowNotifications,
          switch: true,
          value: prefs.allow,
          onValueChange: onToggleAllow,
          disabled: loadingPrefs,
        },
        {
          key: "sounds",
          label: STR.labels.notificationSounds,
          chevron: true,
          onPress: () => toast.info(STR.messages.future),
          disabled: true,
        },
        {
          key: "events",
          label: STR.labels.enabledEvents,
          chevron: true,
          onPress: () => setEventsOpen(true),
          disabled: false,
        },
      ],
    },
    {
      key: "quiet",
      title: STR.sections.quiet,
      items: [
        {
          key: "quiet_start",
          label: STR.labels.quietStart,
          right: <Text style={[s.value, { color: theme.colors.text }]}>{toTimeStr(prefs.quiet_start) || STR.options.off}</Text>,
          chevron: true,
          onPress: openTimePicker("start"),
        },
        {
          key: "quiet_end",
          label: STR.labels.quietEnd,
          right: <Text style={[s.value, { color: theme.colors.text }]}>{toTimeStr(prefs.quiet_end) || STR.options.off}</Text>,
          chevron: true,
          onPress: openTimePicker("end"),
        },
        {
          key: "quiet_reset",
          label: STR.labels.quietReset,
          chevron: true,
          onPress: onResetQuietTimes,
        },
      ],
    },
    {
      key: "privacy",
      title: STR.sections.privacy,
      items: [
        { key: "geo", label: STR.labels.privacyGeo, chevron: true, disabled: true, onPress: futureFeature },
        { key: "analytics", label: STR.labels.privacyAnalytics, chevron: true, disabled: true, onPress: futureFeature },
        { key: "private-search", label: STR.labels.privacySearch, switch: true, disabled: true, onPress: futureFeature },
      ],
    },
    {
      key: "ai",
      title: STR.sections.ai,
      items: [
        { key: "suggestions", label: STR.labels.aiSuggestions, chevron: true, disabled: true, onPress: futureFeature },
        { key: "avatars", label: STR.labels.aiAvatars, switch: true, disabled: true, onPress: futureFeature },
      ],
    },
  ];

  return (
    <SafeAreaView edges={['left','right']} style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <AppHeader options={{ title: STR.screenTitle }} back={nav.canGoBack()} route={route} />
        {sections.map((sec) => (
          <View key={sec.key} style={s.sectionWrap}>
            <Text style={[s.sectionTitle, { color: theme.colors.textSecondary }]}>{sec.title}</Text>
            <View style={[s.card, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
              {sec.items.map((it, idx) => {
                const last = idx === sec.items.length - 1;
                const row = (
                  <View style={[s.row, !last && [s.rowDivider, { borderColor: theme.colors.border }], it.disabled && s.disabled]}>
                    <Text style={[s.label, { color: theme.colors.text }]}>{it.label}</Text>
                    <View style={s.rightWrap}>
                      {it.switch ? (
                        <>
                          <Switch
                            value={!!it.value}
                            onValueChange={it.onValueChange}
                            disabled={!!it.disabled}
                            trackColor={{ true: theme.colors.primary }}
                          />
                          <View style={s.chevronSpacer} />
                        </>
                      ) : it.right ? (
                        it.right
                      ) : null}
                      {(it.chevron || !it.switch) && (
                        <FeatherIcon name="chevron-right" size={theme.components.listItem.chevronSize} color={theme.colors.textSecondary} style={s.chevron} />
                      )}
                    </View>
                  </View>
                );
                return (
                  <Pressable
  key={it.key}
  onPress={() => {
    if (it.disabled) {
      toast.info(STR.messages.future);
    } else {
      it.onPress && it.onPress();
    }
  }}
  android_ripple={it.disabled ? undefined : { color: theme.colors.ripple, borderless: false }}
>
  {row}
</Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Time Picker (native) */}
      {timePickerOpen ? (
        <DateTimePicker
          mode="time"
          value={timeValue}
          is24Hour
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={onTimePicked}
        />
      ) : null}

      {/* Events SelectModal */}
<SelectModal
  visible={eventsOpen}
  title={STR.options.pickEvents}
  searchable={false}
  items={[
    { id: "new_orders", label: STR.labels.eventNewOrders, right: <Switch value={!!prefs.new_orders} onValueChange={onToggleEvent("new_orders")} /> },
    { id: "feed_orders", label: STR.labels.eventFeedOrders, right: <Switch value={!!prefs.feed_orders} onValueChange={onToggleEvent("feed_orders")} /> },
    ...(canCreateOrders ? [{ id: "reminders", label: STR.labels.eventReminders, right: <Switch value={!!prefs.reminders} onValueChange={onToggleEvent("reminders")} /> }] : [])
  ]}
  footer={<Button variant="secondary" title={STR.options.done} onPress={() => setEventsOpen(false)} />}
  onClose={() => setEventsOpen(false)}
/>


      {/* Theme SelectModal */}
<SelectModal
  visible={themeOpen}
  title={STR.options.pickTheme}
  searchable={false}
  items={[
    { id: "light", label: STR.options.themeLight, right: (mode === 'light' ? <FeatherIcon name="check" size={theme.components.listItem.chevronSize} color={theme.colors.primary} /> : null) },
    { id: "dark", label: STR.options.themeDark, right: (mode === 'dark' ? <FeatherIcon name="check" size={theme.components.listItem.chevronSize} color={theme.colors.primary} /> : null) },
    { id: "system", label: STR.options.themeSystem, right: (mode === 'system' ? <FeatherIcon name="check" size={theme.components.listItem.chevronSize} color={theme.colors.primary} /> : null) },
  ]}
  onSelect={(it) => { setMode(it.id); setThemeOpen(false); }}
  onClose={() => setThemeOpen(false)}
/>

    </SafeAreaView>
  );
}

const styles = (t) => StyleSheet.create({
  sectionWrap: { marginBottom: t.spacing.lg },
  sectionTitle: {
    fontSize: t.typography.sizes.xs,
    fontWeight: t.typography.weight.bold,
    marginBottom: t.spacing.sm,
    paddingLeft: t.spacing.xl,
    paddingRight: t.spacing.lg,
    textTransform: "uppercase",
  },
  card: {
    marginHorizontal: t.spacing.lg,
    marginTop: 0,
    marginBottom: 0,
    borderRadius: t.radii.xl,
    overflow: "hidden",
    borderWidth: t.components.card.borderWidth,
    ...(Platform.OS === "ios" ? t.shadows.card.ios : t.shadows.card.android),
  },
  row: {
    height: t.components.listItem.height,
    paddingLeft: t.spacing.xl,
    paddingRight: t.spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: t.colors.card,
  },
  rowDivider: { borderBottomWidth: t.components.listItem.dividerWidth },
  disabled: { opacity: t.components.listItem.disabledOpacity },
  label: { fontSize: t.typography.sizes.md, fontWeight: t.typography.weight.medium },
  value: { fontSize: t.typography.sizes.md },
  rightWrap: { flexDirection: "row", alignItems: "center" },

  // Modal bottom-sheet

});