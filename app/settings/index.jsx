// app/settings/index.jsx
import React from 'react';
import { View, Text, Switch, StyleSheet, Platform } from 'react-native';
import { useRouter, useNavigation } from 'expo-router';
import { useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeProvider';
import Screen from '../../components/layout/Screen';
import SelectModal from '../../components/ui/SelectModal';
import TextField, { SelectField } from '../../components/ui/TextField';
import { SETTINGS_SECTIONS, UI_TEXT, PHONE_MODE_OPTIONS } from '../../constants/settings';

/* Helpers */
const getDeviceTimeZone = () => {
  try {
    return Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const getAllTimeZones = React.useCallback(() => {
  try {
    const list = typeof Intl?.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : [];
    const device = getDeviceTimeZone();
    const final = (list.length ? list : [device]).map((z) => ({
      id: z,
      label: z,
      subtitle: z === device ? UI_TEXT.modals.timezone.subtitleDevice : undefined,
    }));
    return final;
  } catch {
    const z = getDeviceTimeZone();
    return [{ id: z, label: z }];
  }
}, []);

export default function CompanySettings() {
  const { theme } = useTheme();
  const nav = useNavigation();
  const route = useRoute();
  const router = useRouter();

  const s = React.useMemo(() => styles(theme), [theme]);

  const [timeZone, setTimeZone] = React.useState(() => getDeviceTimeZone());
  const [tzOpen, setTzOpen] = React.useState(false);

  const [useDepartureTime, setUseDepartureTime] = React.useState(false);
  const [phoneMode, setPhoneMode] = React.useState('always');
  const [phoneModeOpen, setPhoneModeOpen] = React.useState(false);
  const [windowBefore, setWindowBefore] = React.useState('12');
  const [windowAfter, setWindowAfter] = React.useState('6');

  React.useLayoutEffect(() => {
    nav?.setParams?.({ title: UI_TEXT.settingsTitle, headerTitle: UI_TEXT.settingsTitle });
  }, [nav, route?.key]);

  const updateSetting = React.useCallback(async (key, value) => {
    // TODO: integrate Supabase/Backend upsert here
    return Promise.resolve();
  }, []);

  const onPickTimeZone = React.useCallback((it) => {
    setTimeZone(it.label);
    setTzOpen(false);
    updateSetting('timezone', it.label);
  }, [updateSetting]);

  const onToggleDepartureTime = React.useCallback((val) => {
    setUseDepartureTime(Boolean(val));
    updateSetting('use_departure_time', Boolean(val));
  }, [updateSetting]);

  const onPickPhoneMode = React.useCallback((it) => {
    setPhoneMode(it.id);
    setPhoneModeOpen(false);
    updateSetting('worker_phone_mode', it.id);
  }, [updateSetting]);

  const phoneModeLabel = React.useMemo(() => {
    const map = Object.fromEntries(PHONE_MODE_OPTIONS.map(o => [o.id, o.label]));
    return map[phoneMode] || '';
  }, [phoneMode]);

  const go = React.useCallback((href) => () => router.push(href), [router]);

  return (
    <Screen background="background" edges={['top', 'bottom']}>
      <View style={s.root}>
        <View style={s.card}>
          <Text style={s.cardTitle}>{SETTINGS_SECTIONS.COMPANY.title}</Text>
          <SelectField
            label={SETTINGS_SECTIONS.COMPANY.items[0].label}
            value={timeZone}
            onPress={() => setTzOpen(true)}
            style={s.row}
          />
          <SelectField
            label={SETTINGS_SECTIONS.COMPANY.items[1].label}
            showValue={false}
            onPress={go(SETTINGS_SECTIONS.COMPANY.items[1].route)}
            style={[s.row, s.withDivider]}
          />
          <SelectField
            label={SETTINGS_SECTIONS.COMPANY.items[2].label}
            showValue={false}
            onPress={go(SETTINGS_SECTIONS.COMPANY.items[2].route)}
            style={[s.row, s.withDivider]}
          />
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>{SETTINGS_SECTIONS.MANAGEMENT.title}</Text>
          {SETTINGS_SECTIONS.MANAGEMENT.items.map((it, idx) => (
            <SelectField
              key={it.key}
              label={it.label}
              showValue={false}
              onPress={go(it.route)}
              style={[s.row, idx === 0 ? null : s.withDivider]}
            />
          ))}
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>{SETTINGS_SECTIONS.DEPARTURE.title}</Text>
          <View style={s.row}>
            <Text style={s.rowLabel}>{UI_TEXT.toggles.useDepartureTime}</Text>
            <Switch
              value={useDepartureTime}
              onValueChange={onToggleDepartureTime}
              trackColor={{ true: theme.colors.primary, false: theme.colors.inputBorder }}
              thumbColor={Platform.OS === 'android' ? theme.colors.surface : undefined}
            />
          </View>
          <Text style={s.caption}>
            {useDepartureTime ? UI_TEXT.helperText.departureOn : UI_TEXT.helperText.departureOff}
          </Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>{SETTINGS_SECTIONS.PHONE.title}</Text>
          <SelectField
            label={UI_TEXT.phone.mode}
            value={phoneModeLabel}
            onPress={() => setPhoneModeOpen(true)}
            style={s.row}
          />
          {phoneMode === 'window' && (
            <>
              <View style={[s.row, s.withDivider]}>
                <Text style={s.rowLabel}>{UI_TEXT.phone.windowBefore}</Text>
                <View style={{ width: theme.spacing.xxl }}>
                  <TextField
                    value={windowBefore}
                    onChangeText={setWindowBefore}
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <View style={[s.row, s.withDivider]}>
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

      <SelectModal
        visible={tzOpen}
        title={UI_TEXT.modals.timezone.title}
        items={React.useMemo(getAllTimeZones, [])}
        onSelect={onPickTimeZone}
        onClose={() => setTzOpen(false)}
        searchable={UI_TEXT.modals.timezone.searchable}
      />

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
  root: {
    flex: 1,
    paddingHorizontal: t.spacing.md,
    paddingTop: t.spacing.sm,
    paddingBottom: t.spacing.lg,
  },
  card: {
    backgroundColor: t.colors.surface,
    borderRadius: t.radii.xl,
    borderWidth: t.components.card.borderWidth,
    borderColor: t.colors.border,
    marginTop: t.spacing.sm,
    ...(Platform.OS === 'ios' ? t.shadows.card.ios : t.shadows.card.android),
  },
  cardTitle: {
    fontSize: t.typography.sizes.lg,
    fontWeight: t.typography.weight.bold,
    color: t.colors.text,
    paddingHorizontal: t.spacing.lg,
    paddingTop: t.spacing.lg,
    paddingBottom: t.spacing.sm,
  },
  row: {
    minHeight: t.components.listItem.height,
    paddingLeft: t.spacing.lg,
    paddingRight: t.spacing.lg,
    alignItems: 'center',
    justifyContent: 'space-between',
    flexDirection: 'row',
    backgroundColor: t.colors.card ?? t.colors.surface,
  },
  withDivider: {
    borderTopWidth: t.components.listItem.dividerWidth,
    borderTopColor: t.colors.border,
  },
  rowLabel: {
    flex: 1,
    color: t.colors.text,
    fontSize: t.typography.sizes.md,
    fontWeight: t.typography.weight.medium,
    paddingRight: t.spacing.md,
  },
  caption: {
    color: t.colors.textSecondary,
    fontSize: t.typography.sizes.sm,
    paddingHorizontal: t.spacing.lg,
    paddingBottom: t.spacing.lg,
    paddingTop: t.spacing.xs,
  },
});
