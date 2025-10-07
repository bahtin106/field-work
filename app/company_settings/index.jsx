// app/company_settings/index.jsx
import React from 'react';
import { View, Text, Switch, StyleSheet, Platform, Pressable, Keyboard, ScrollView } from 'react-native';
import { useRouter, useNavigation } from 'expo-router';
import { useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeProvider';
import Screen from '../../components/layout/Screen';
import { SelectModal, BaseModal } from '../../components/ui/modals';
import TextField, { SelectField } from '../../components/ui/TextField';
import { SETTINGS_SECTIONS, UI_TEXT, PHONE_MODE_OPTIONS } from '../../constants/settings';
import { useToast } from '../../components/ui/ToastProvider';
import UIButton from '../../components/ui/Button';

// Lazy-load Supabase client to avoid breaking other screens if path differs.
let __sbClient = null;
async function getSupabase() {
  if (__sbClient) return __sbClient;
  try {
    const mod = await import('../../lib/supabase');
    __sbClient = mod.supabase || mod.default || null;
  } catch (e) {
    // keep silent; UI remains functional without backend
  }
  return __sbClient;
}

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
  'Pacific/Midway','Pacific/Honolulu','America/Anchorage','America/Los_Angeles','America/Denver','America/Phoenix','America/Chicago','America/New_York','America/Toronto','America/Mexico_City',
  'America/Bogota','America/Lima','America/Caracas','America/Santiago','America/Sao_Paulo','Atlantic/Azores','Atlantic/Reykjavik',
  'Europe/Lisbon','Europe/London','Europe/Dublin','Europe/Madrid','Europe/Paris','Europe/Berlin','Europe/Amsterdam','Europe/Prague','Europe/Vienna','Europe/Zurich','Europe/Warsaw','Europe/Budapest',
  'Europe/Rome','Europe/Stockholm','Europe/Helsinki','Europe/Athens','Europe/Bucharest','Europe/Chisinau','Europe/Kiev','Europe/Istanbul','Europe/Minsk',
  'Europe/Kaliningrad','Europe/Moscow','Europe/Samara','Europe/Saratov',
  'Asia/Yekaterinburg','Asia/Omsk','Asia/Novosibirsk','Asia/Barnaul','Asia/Tomsk','Asia/Krasnoyarsk','Asia/Irkutsk','Asia/Yakutsk','Asia/Vladivostok','Asia/Sakhalin','Asia/Magadan','Asia/Kamchatka',
  'Asia/Tbilisi','Asia/Yerevan','Asia/Baku','Asia/Tashkent','Asia/Samarkand','Asia/Bishkek','Asia/Dushanbe',
  'Asia/Almaty','Asia/Qostanay','Asia/Aqtau','Asia/Aqtobe','Asia/Atyrau','Asia/Oral',
  'Asia/Tehran','Asia/Baghdad','Asia/Jerusalem','Asia/Dubai','Asia/Karachi','Asia/Kolkata','Asia/Kathmandu','Asia/Colombo',
  'Asia/Dhaka','Asia/Bangkok','Asia/Ho_Chi_Minh','Asia/Jakarta','Asia/Singapore','Asia/Kuala_Lumpur','Asia/Hong_Kong','Asia/Taipei','Asia/Shanghai','Asia/Seoul','Asia/Tokyo',
  'Australia/Perth','Australia/Darwin','Australia/Adelaide','Australia/Brisbane','Australia/Sydney',
  'Pacific/Port_Moresby','Pacific/Guadalcanal','Pacific/Fiji','Pacific/Auckland','Pacific/Chatham','Pacific/Tongatapu'
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
  'Asia/Kamчатка': 'Камчатка',
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
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    const asUTC = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour),
      Number(map.minute),
      Number(map.second)
    );
    const diffMin = Math.round((asUTC - now.getTime()) / 60000);
    return diffMin;
  } catch (e) {
    try {
      const now = new Date();
      const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
      const tz  = new Date(now.toLocaleString('en-US', { timeZone: zone }));
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
function zoneToItem(zone, deviceZone) {
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
    offset.replace('UTC', '').replace(':00','').trim(),
    `${offsetMin >= 0 ? '+' : ''}${Math.floor(offsetMin/60)}`,
  ].join(' ');
  const subtitle = isDevice
    ? `${basic} · ${UI_TEXT.modals.timezone.subtitleDevice}`
    : basic;
  return { id: zone, label, subtitle, offsetMin, city };
}

export default function CompanySettings() {
  const toast = useToast();
  const { theme } = useTheme();
  const nav = useNavigation();
  const route = useRoute();
  const router = useRouter();

  const s = React.useMemo(() => styles(theme), [theme]);

  const [timeZone, setTimeZone] = React.useState(() => getDeviceTimeZone());
  const [tzOpen, setTzOpen] = React.useState(false);
  const [companyName, setCompanyName] = React.useState('');
  const [companyNameInitial, setCompanyNameInitial] = React.useState('');
  const [companyNameOpen, setCompanyNameOpen] = React.useState(false);
  const [companyModalKey, setCompanyModalKey] = React.useState(0);
  const [companyNameDraft, setCompanyNameDraft] = React.useState('');
  const [companyNameError, setCompanyNameError] = React.useState('');
  const [savingCompany, setSavingCompany] = React.useState(false);

  const closeCompanyEditor = React.useCallback(() => {
    try { Keyboard.dismiss(); } catch (_) {}
    setCompanyNameOpen(false);
    setCompanyNameError('');
    setSavingCompany(false);
    // Force re-create modal instance to avoid any stale RN Modal overlays
    setTimeout(() => { try { setCompanyModalKey((k) => k + 1); } catch (_) {} }, 0);
  }, []);

  const [useDepartureTime, setUseDepartureTime] = React.useState(false);
  const [phoneMode, setPhoneMode] = React.useState('always');
  const [phoneModeOpen, setPhoneModeOpen] = React.useState(false);
  const [windowBefore, setWindowBefore] = React.useState('12');
  const [windowAfter, setWindowAfter] = React.useState('6');

  React.useLayoutEffect(() => {
    nav?.setParams?.({ title: UI_TEXT.settingsTitle, headerTitle: UI_TEXT.settingsTitle });
  }, [nav, route?.key]);

  // Load current company settings
  React.useEffect(() => {
    (async () => {
      try {
        const supabase = await getSupabase();
        if (!supabase) return;
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: profile } = await supabase
          .from('profiles')
          .select('company_id, timezone')
          .eq('id', user.id)
          .single();
        const companyId = profile?.company_id;
        if (!companyId) return;
        const { data: companyRow } = await supabase
          .from('companies')
          .select('name, timezone')
          .eq('id', companyId)
          .single();
        if (companyRow?.timezone) setTimeZone(companyRow.timezone);
        if (typeof companyRow?.name === 'string') {
          setCompanyName(companyRow.name);
          setCompanyNameInitial(companyRow.name);
        }
      } catch (e) {
        // silent
      }
    })();
  }, []);

  const updateSetting = React.useCallback(async (key, value) => {
    const supabase = await getSupabase();
    if (!supabase) throw new Error('Нет подключения к базе');
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) throw new Error('Не авторизован');
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('company_id')
      .eq('id', user.id)
      .single();
    if (profErr) throw profErr;
    const companyId = profile?.company_id;
    if (!companyId) throw new Error('Компания не найдена');
    const payload = { [key]: value };
    const { error: upErr } = await supabase
      .from('companies')
      .update(payload)
      .eq('id', companyId);
    if (upErr) throw upErr;
    return true;
  }, []);

  const onSubmitCompanyName = React.useCallback(() => {
    const name = String(companyName || '').trim();
    if (!name || name === companyNameInitial) return;
    toast.promise(() => updateSetting('name', name), {
      loading: 'Сохраняю…',
      success: 'Название компании сохранено',
      error: (e) => e?.message || 'Ошибка сохранения'
    }).then(() => {
      setCompanyNameInitial(name);
    });
  }, [companyName, companyNameInitial, updateSetting]);

  // Time zones list
  const tzItems = React.useMemo(() => {
    try {
      const list = getAllTimeZones();
      const device = getDeviceTimeZone();
      const items = list.map((z) => zoneToItem(z, device));
      items.sort((a, b) => (a.offsetMin - b.offsetMin) || a.city.localeCompare(b.city, 'ru'));
      return items;
    } catch {
      const z = getDeviceTimeZone();
      return [zoneToItem(z, z)];
    }
  }, []);

  const tzMap = React.useMemo(() => {
    const m = new Map();
    tzItems.forEach((it) => m.set(it.id, it));
    return m;
  }, [tzItems]);

  const timeZoneLabel = tzMap.get(timeZone)?.label || timeZone;

  const onPickTimeZone = React.useCallback((it) => {
    setTimeZone(it.id);
    setTzOpen(false);
    toast.promise(() => updateSetting('timezone', it.id), { loading: 'Сохраняю…', success: 'Часовой пояс сохранён', error: (e) => e?.message || 'Ошибка сохранения' });
  }, [updateSetting]);

  const onToggleDepartureTime = React.useCallback((val) => {
    setUseDepartureTime(Boolean(val));
    toast.promise(() => updateSetting('use_departure_time', Boolean(val)), { loading: 'Сохраняю…', success: 'Настройки сохранены', error: (e) => e?.message || 'Ошибка сохранения' });
  }, [updateSetting]);

  const onPickPhoneMode = React.useCallback((it) => {
    setPhoneMode(it.id);
    setPhoneModeOpen(false);
    toast.promise(() => updateSetting('worker_phone_mode', it.id), { loading: 'Сохраняю…', success: 'Настройки сохранены', error: (e) => e?.message || 'Ошибка сохранения' });
  }, [updateSetting]);

  const phoneModeLabel = React.useMemo(() => {
    const map = Object.fromEntries(PHONE_MODE_OPTIONS.map(o => [o.id, o.label]));
    return map[phoneMode] || '';
  }, [phoneMode]);

  const go = React.useCallback((href) => () => router.push(href), [router]);

  return (
    <Screen background="background">
      <ScrollView contentContainerStyle={s.contentWrap} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* COMPANY */}
        <View style={s.sectionWrap}>
          <Text style={s.sectionTitle}>{SETTINGS_SECTIONS.COMPANY.title}</Text>
          <View style={s.card}>
            <SelectField
              label={<Text style={s.itemLabel}>Название компании</Text>}
              value={companyName || 'Укажите'}
              onPress={() => {
                setCompanyNameDraft(companyName);
                setCompanyNameError('');
                setCompanyNameOpen(true);
              }}
            />

            <View style={s.sep} />
            <SelectField
              label={<Text style={s.itemLabel}>{SETTINGS_SECTIONS.COMPANY.items[0].label}</Text>}
              value={timeZoneLabel}
              onPress={() => setTzOpen(true)}
            />

            <View style={s.sep} />
            <SelectField
              label={<Text style={s.itemLabel}>{SETTINGS_SECTIONS.COMPANY.items[1].label}</Text>}
              showValue={false}
              onPress={go(SETTINGS_SECTIONS.COMPANY.items[1].route)}
            />

            <View style={s.sep} />
            <SelectField
              label={<Text style={s.itemLabel}>{SETTINGS_SECTIONS.COMPANY.items[2].label}</Text>}
              showValue={false}
              onPress={go(SETTINGS_SECTIONS.COMPANY.items[2].route)}
            />
          </View>
        </View>

        {/* MANAGEMENT */}
        <View style={s.sectionWrap}>
          <Text style={s.sectionTitle}>{SETTINGS_SECTIONS.MANAGEMENT.title}</Text>
          <View style={s.card}>
            {SETTINGS_SECTIONS.MANAGEMENT.items.map((it, idx) => (
              <React.Fragment key={it.key}>
                {idx > 0 ? <View style={s.sep} /> : null}
                <SelectField
                  label={<Text style={s.itemLabel}>{it.label}</Text>}
                  showValue={false}
                  onPress={go(it.route)}
                />
              </React.Fragment>
            ))}
          </View>
        </View>

        {/* DEPARTURE */}
        <View style={s.sectionWrap}>
          <Text style={s.sectionTitle}>{SETTINGS_SECTIONS.DEPARTURE.title}</Text>
          <View style={s.card}>
            <View style={s.row}>
              <Text style={s.rowLabel}>{UI_TEXT.toggles.useDepartureTime}</Text>
              <Switch
                value={useDepartureTime}
                onValueChange={onToggleDepartureTime}
                trackColor={{ true: theme.colors.primary, false: theme.colors.inputBorder }}
                thumbColor={Platform.OS === 'android' ? theme.colors.surface : undefined}
              />
            </View>
            <View style={s.captionWrap}><Text style={s.caption}>
              {useDepartureTime ? UI_TEXT.helperText.departureOn : UI_TEXT.helperText.departureOff}
            </Text></View>
          </View>
        </View>

        {/* PHONE */}
        <View style={s.sectionWrap}>
          <Text style={s.sectionTitle}>{SETTINGS_SECTIONS.PHONE.title}</Text>
          <View style={s.card}>
            <SelectField
              label={<Text style={s.itemLabel}>{UI_TEXT.phone.mode}</Text>}
              value={phoneModeLabel}
              onPress={() => setPhoneModeOpen(true)}
            />

            {phoneMode === 'window' && (
              <>
                <View style={s.sep} />
                <View style={s.row}>
                  <Text style={s.rowLabel}>{UI_TEXT.phone.windowBefore}</Text>
                  <View style={{ width: theme.spacing.xxl }}>
                    <TextField
                      value={windowBefore}
                      onChangeText={setWindowBefore}
                      keyboardType="numeric"
                    />
                  </View>
                </View>

                <View style={s.sep} />
                <View style={s.row}>
                  <Text style={s.rowLabel}>{UI_TEXT.phone.windowAfter}</Text>
                  <View style={{ width: theme.spacing.xxl }}>
                    <TextField
                      value={windowAfter}
                      onChangeText={setWindowAfter}
                      keyboardType="numeric"
                    />
                  </View>
                </View>
              </>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Company name editor */}
      <BaseModal
        key={`company-${companyModalKey}`}
        visible={companyNameOpen}
        onClose={closeCompanyEditor}
        title="Название компании"
        maxHeightRatio={0.5}
        footer={(
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
              <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weight.medium }}>Отмена</Text>
            </Pressable>
            <UIButton
              variant="primary"
              size="md"
              onPress={async () => {
                const name = String(companyNameDraft || '').trim();
                if (!name) { setCompanyNameError('Введите название компании'); return; }
                if (name.length > 64) { setCompanyNameError('Слишком длинное название (макс. 64)'); return; }
                if (name === companyNameInitial) { setCompanyName(name); closeCompanyEditor(); return; }
                setSavingCompany(true);
                try {
                  await toast.promise(() => updateSetting('name', name), {
                    loading: 'Сохраняю…',
                    success: 'Название компании сохранено',
                    error: (e) => e?.message || 'Ошибка сохранения',
                  });
                  setCompanyName(name);
                  setCompanyNameInitial(name);
                  closeCompanyEditor();
                } catch (e) {
                  setCompanyNameError(e?.message || 'Ошибка сохранения');
                } finally {
                  setSavingCompany(false);
                }
              }}
              title={savingCompany ? 'Сохраняю…' : 'Сохранить'}
            />
          </View>
        )}
      >
        <View style={{ marginBottom: theme.spacing.sm }}>
          <TextField
            label="Название компании"
            value={companyNameDraft}
            onChangeText={(t) => {
              setCompanyNameDraft(t);
              if (companyNameError) setCompanyNameError('');
            }}
            placeholder="Например, ООО «Ромашка»"
            autoFocus
            returnKeyType="done"
            maxLength={64}
            onSubmitEditing={() => {
              const name = String(companyNameDraft || '').trim();
              if (!name) { setCompanyNameError('Введите название компании'); return; }
              if (name.length > 64) { setCompanyNameError('Слишком длинное название (макс. 64)'); return; }
              if (name === companyNameInitial) { setCompanyName(name); closeCompanyEditor(); return; }
              (async () => {
                setSavingCompany(true);
                try {
                  await toast.promise(() => updateSetting('name', name), {
                    loading: 'Сохраняю…',
                    success: 'Название компании сохранено',
                    error: (e) => e?.message || 'Ошибка сохранения',
                  });
                  setCompanyName(name);
                  setCompanyNameInitial(name);
                  closeCompanyEditor();
                } catch (e) {
                  setCompanyNameError(e?.message || 'Ошибка сохранения');
                } finally {
                  setSavingCompany(false);
                }
              })();
            }}
          />
          {companyNameError ? (
            <Text style={{ color: theme.colors.danger, fontSize: theme.typography.sizes.xs, marginTop: theme.spacing.xs, marginLeft: theme.spacing.md }}>
              {companyNameError}
            </Text>
          ) : (
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.typography.sizes.xs, marginTop: theme.spacing.xs, marginLeft: theme.spacing.md }}>
              Это имя увидят сотрудники и клиенты в документах и уведомлениях
            </Text>
          )}
        </View>
      </BaseModal>

      {/* Timezone picker */}
      <SelectModal
        visible={tzOpen}
        title={UI_TEXT.modals.timezone.title}
        items={tzItems}
        onSelect={onPickTimeZone}
        onClose={() => setTzOpen(false)}
        searchable={UI_TEXT.modals.timezone.searchable}
      />

      {/* Phone mode picker */}
      <SelectModal
        visible={phoneModeOpen}
        title={UI_TEXT.modals.phoneMode.title}
        items={PHONE_MODE_OPTIONS}
        onSelect={onPickPhoneMode}
        onClose={() => setPhoneModeOpen(false)}
        searchable={UI_TEXT.modals.phoneMode.searchable}
      />
    </Screen>
  );
}

const styles = (t) => StyleSheet.create({
  contentWrap: { padding: t.spacing.lg, paddingBottom: t.spacing.xl },
  sectionWrap: { marginBottom: 0 },
  sectionTitle: {
    fontWeight: t.typography.weight.bold,
    marginBottom: t.spacing[t.components.sectionTitle.mb],
    marginLeft: t.spacing[t.components.sectionTitle.ml],
    color: t.colors.text
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
  captionWrap: { paddingHorizontal: t.spacing[t.components.card.padX || 'md'], paddingBottom: t.spacing.md, paddingTop: t.spacing.xs },
  caption: { color: t.colors.textSecondary, fontSize: t.typography.sizes.sm },
});