// app/settings/index.jsx
import React from 'react';
import { View, Text, Switch, StyleSheet, Platform } from 'react-native';
import { useRouter, useNavigation } from 'expo-router';
import { useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeProvider';
import Screen from '../../components/layout/Screen';
import SelectModal from '../../components/ui/SelectModal';
import TextField, { SelectField } from '../../components/ui/TextField';

/** Helpers (данные/логика — не стили) */
const getDeviceTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch { return 'UTC'; }
};
const getAllTimeZones = () => {
  try {
    const list = typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : [];
    const device = getDeviceTimeZone();
    return (list.length ? list : [device]).map(z => ({
      id: z, label: z, subtitle: z === device ? 'Текущий часовой пояс устройства' : undefined,
    }));
  } catch {
    const z = getDeviceTimeZone();
    return [{ id: z, label: z }];
  }
};

export default function CompanySettings() {
  const { theme } = useTheme();
  const nav = useNavigation();
  const route = useRoute();
  const router = useRouter();

  /** Состояния (заглушки под Supabase — подключишь позже) */
  const [timeZone, setTimeZone] = React.useState(getDeviceTimeZone());
  const [tzOpen, setTzOpen] = React.useState(false);

  // Включить время выезда (true => дата+время, false => только дата)
  const [useDepartureTime, setUseDepartureTime] = React.useState(false);

  // Режим показа телефона: 'always' | 'never' | 'window'
  const [phoneMode, setPhoneMode] = React.useState('always');
  const [phoneModeOpen, setPhoneModeOpen] = React.useState(false);
  const [windowBefore, setWindowBefore] = React.useState('12'); // часы до выезда
  const [windowAfter, setWindowAfter] = React.useState('6');    // часы после выезда

  React.useLayoutEffect(() => {
    try {
      nav?.setParams?.({ title: 'Настройки компании', headerTitle: 'Настройки компании' });
    } catch {}
  }, [nav, route?.key]);

  /** Стили ТОЛЬКО из темы */
  const s = React.useMemo(() => styles(theme), [theme]);

  /** Навигационные пункты */
  const go = (href) => () => router.push(href);

  /** Сохранение — заглушка (подключишь к Supabase) */
  const updateSetting = async (key, value) => {
    // TODO: заменить на реальный вызов Supabase (upsert в таблицу company_settings)
    // await supabase.from('company_settings').upsert({ company_id, [key]: value })
  };

  /** Обработчики */
  const onPickTimeZone = (it) => {
    setTimeZone(it.label);
    setTzOpen(false);
    updateSetting('timezone', it.label);
  };

  const onToggleDepartureTime = (val) => {
    setUseDepartureTime(val);
    updateSetting('use_departure_time', val);
  };

  const onPickPhoneMode = (it) => {
    setPhoneMode(it.id);
    setPhoneModeOpen(false);
    updateSetting('worker_phone_mode', it.id);
  };

  const phoneModeLabel = {
    always: 'Всегда',
    never: 'Никогда',
    window: 'Только в интервале',
  }[phoneMode];

  return (
    <Screen background="background" edges={['top', 'bottom']}>
      <View style={s.root}>

        {/* === Блок: Компания === */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Компания</Text>

          {/* Часовой пояс — модальное окно выбора */}
          <SelectField
            label="Часовой пояс"
            value={timeZone}
            onPress={() => setTzOpen(true)}
            style={s.row}
          />

          {/* Сотрудники */}
          <SelectField
            label="Сотрудники"
            showValue={false}
            onPress={go('/users')}
            style={[s.row, s.withDivider]}
          />

          {/* Подписка и оплата — как сейчас */}
          <SelectField
            label="Подписка и оплата"
            showValue={false}
            onPress={go('/billing')}
            style={[s.row, s.withDivider]}
          />
        </View>

        {/* === Блок: Управление и доступы === */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Управление</Text>

          <SelectField
            label="Уведомления"
            showValue={false}
            onPress={go('/settings/notifications')}
            style={s.row}
          />

          <SelectField
            label="Настройки доступа"
            showValue={false}
            onPress={go('/settings/access')}
            style={[s.row, s.withDivider]}
          />

          <SelectField
            label="Редактор полей"
            showValue={false}
            onPress={go('/settings/sections/form-builder')}
            style={[s.row, s.withDivider]}
          />

          <SelectField
            label="Виды работ"
            showValue={false}
            onPress={go('/settings/sections/WorkTypesSettings')}
            style={[s.row, s.withDivider]}
          />

          <SelectField
            label="Отделы"
            showValue={false}
            onPress={go('/settings/sections/DepartmentsSettings')}
            style={[s.row, s.withDivider]}
          />
        </View>

        {/* === Блок: Параметры выезда === */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Параметры выезда</Text>

          {/* Включить время выезда */}
          <View style={s.row}>
            <Text style={s.rowLabel}>Включить время выезда</Text>
            <Switch
              value={useDepartureTime}
              onValueChange={onToggleDepartureTime}
              trackColor={{ true: theme.colors.primary, false: theme.colors.inputBorder }}
              thumbColor={Platform.OS === 'android' ? theme.colors.surface : undefined}
            />
          </View>

          <Text style={s.caption}>
            {useDepartureTime ? 'Дата и время выезда' : 'Только дата выезда'}
          </Text>
        </View>

        {/* === Блок: Телефон для рабочих === */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Телефон для рабочих</Text>

          {/* Режим показа */}
          <SelectField
            label="Показывать номер"
            value={phoneModeLabel}
            onPress={() => setPhoneModeOpen(true)}
            style={s.row}
          />

          {/* Интервальное окно — при выборе "Только в интервале" */}
          {phoneMode === 'window' && (
            <>
              <View style={[s.row, s.withDivider]}>
                <Text style={s.rowLabel}>За сколько часов до выезда</Text>
                <View style={{ width: 96 }}>
                  <TextField
                    value={windowBefore}
                    onChangeText={setWindowBefore}
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <View style={[s.row, s.withDivider]}>
                <Text style={s.rowLabel}>Сколько часов после выезда</Text>
                <View style={{ width: 96 }}>
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

      {/* ====== Модалки ====== */}
      <SelectModal
        visible={tzOpen}
        title="Выберите часовой пояс"
        items={React.useMemo(getAllTimeZones, [])}
        onSelect={onPickTimeZone}
        onClose={() => setTzOpen(false)}
        searchable
      />

      <SelectModal
        visible={phoneModeOpen}
        title="Показ номера телефона"
        items={[
          { id: 'always', label: 'Всегда' },
          { id: 'never',  label: 'Никогда' },
          { id: 'window', label: 'Только в интервале' },
        ]}
        onSelect={onPickPhoneMode}
        onClose={() => setPhoneModeOpen(false)}
        searchable={false}
      />
    </Screen>
  );
}

/** Стилевые значения — ТОЛЬКО из theme */
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
