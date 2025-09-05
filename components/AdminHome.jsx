// AdminHome.jsx
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  ActivityIndicator,
  Platform,
} from 'react-native';

import { supabase } from '../lib/supabase';
import { useTheme } from '../theme/ThemeProvider';
import { usePermissions } from '../lib/permissions';

/**
 * Обновления:
 * 1) Модалка TZ:
 *    — Фикс прозрачного фона на Android: добавлен statusBarTranslucent и плотный backdrop.
 *    — Карточка модалки теперь всегда имеет непрозрачный фон (theme.colors.card || '#fff').
 * 2) Часовой пояс компании:
 *    — Для админа читаем/пишем TZ компании, если у профиля есть company_id и в БД есть таблица companies с колонкой timezone.
 *    — Безопасный фолбэк: если companies/timezone недоступно — используем profiles.timezone (как раньше).
 */

// ---- Кэш как был ----
let __ADMIN_HOME_CACHE__ = {
  stats: { total: 0, inWork: 0, done: 0, free: 0 },
  ts: 0,
};

// Поддерживаемые TZ (можно расширять)
const SUPPORTED_TIMEZONES = [
  'UTC',
  'Europe/Moscow',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Kaliningrad',
  'Europe/Samara',
  'Asia/Yekaterinburg',
  'Asia/Novosibirsk',
  'Asia/Krasnoyarsk',
  'Asia/Irkutsk',
  'Asia/Yakutsk',
  'Asia/Vladivostok',
  'Asia/Magadan',
  'Asia/Kamchatka',
  'Asia/Tbilisi',
];

const DEFAULT_TZ = 'Europe/Moscow';

export default function AdminHome({ fullName }) {
  const { theme, setMode, mode } = useTheme();
  // --- safe fallbacks for missing theme slots ---
  const textTitle = (theme?.text?.title) || { fontSize: 18, fontWeight: '700', color: theme?.colors?.text || '#111' };
  const textBody  = (theme?.text?.body)  || { fontSize: 16, color: theme?.colors?.text || '#111' };
  const textMuted = (theme?.text?.muted) || { color: theme.colors.textSecondary };
  const cardStyle = theme?.cardStyle || { backgroundColor: theme?.colors?.surface || '#FFFFFF', borderRadius: 12 };
  const shadowStyle = theme?.shadow || {};

  const { has, role } = usePermissions();
  const params = useLocalSearchParams();

  // мгновенный рендер из кэша/параметров
  const initial = (() => {
    if (params?.stats) {
      try {
        const parsed = JSON.parse(params.stats);
        if (parsed && typeof parsed === 'object') {
          __ADMIN_HOME_CACHE__ = { stats: parsed, ts: Date.now() };
        }
      } catch {}
    }
    return __ADMIN_HOME_CACHE__.stats;
  })();

  const [stats] = useState(initial);

  // --- TZ ---
  const [timezone, setTimezone] = useState(DEFAULT_TZ);
  const [tzLoading, setTzLoading] = useState(false);
  const [tzSaving, setTzSaving] = useState(false);
  const [tzModal, setTzModal] = useState(false);
  const [tzError, setTzError] = useState(null);
  const [companyInfo, setCompanyInfo] = useState({ id: null, tzSource: 'profiles' }); // tzSource: 'companies' | 'profiles'

  // Получаем timezone на уровне КОМПАНИИ, если доступно
  useEffect(() => {
    let isActive = true;
    (async () => {
      try {
        setTzLoading(true);
        setTzError(null);

        const { data: authResp, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;
        const user = authResp?.user;
        if (!user?.id) throw new Error('No auth user');

        // 1) Читаем профиль чтобы узнать company_id и роль
        const { data: prof, error: profErr } = await supabase
          .from('profiles')
          .select('id, role, company_id, timezone')
          .eq('id', user.id)
          .maybeSingle();
        if (profErr) throw profErr;

        let tz = prof?.timezone || DEFAULT_TZ;
        let tzSource = 'profiles';
        let companyId = prof?.company_id ?? null;

        // 2) Если у пользователя есть company_id — пробуем прочитать companies.timezone
        if (companyId) {
          const { data: comp, error: compErr, status } = await supabase
            .from('companies')
            .select('id, timezone')
            .eq('id', companyId)
            .maybeSingle();

          if (!compErr && comp?.id) {
            tz = comp?.timezone || tz;
            tzSource = 'companies';
          } else {
            // Если таблицы/колонки нет или нет прав — просто остаёмся на profiles
            // (ничего не делаем, не падаем)
          }
        }

        if (isActive) {
          setCompanyInfo({ id: companyId, tzSource });
          setTimezone(tz);
        }
      } catch (e) {
        if (isActive) setTzError('Не удалось загрузить часовой пояс');
        console.error('TZ load error:', e);
      } finally {
        if (isActive) setTzLoading(false);
      }
    })();
    return () => { isActive = false; };
  }, [role]);

  const saveTimezone = async () => {
    try {
      setTzSaving(true);
      setTzError(null);

      // Если у нас есть company_id и доступна таблица companies — пишем в неё.
      if (role === 'admin' && companyInfo?.id && companyInfo.tzSource === 'companies') {
        const { error } = await supabase
          .from('companies')
          .update({ timezone })
          .eq('id', companyInfo.id);
        if (error) throw error;
      } else {
        // Фолбэк: сохраняем в profiles.timezone
        const { data: authResp, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;
        const user = authResp?.user;
        if (!user?.id) throw new Error('No auth user');

        const { error } = await supabase
          .from('profiles')
          .update({ timezone })
          .eq('id', user.id);
        if (error) throw error;
      }
    } catch (e) {
      setTzError('Не удалось сохранить часовой пояс');
      console.error('TZ save error:', e);
    } finally {
      setTzSaving(false);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors?.background || '#F2F2F7' }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.header, { color: theme.colors.text }]}>Здравствуйте, {fullName}</Text>

      {/* Переключатель темы */}
      <View style={[cardStyle, shadowStyle, { padding: 16, marginBottom: 16 }]}>
        <Text style={[textTitle, { marginBottom: 8 }]}>Тема</Text>
        <Text style={textMuted}>Выберите оформление приложения</Text>
        <View style={{ height: 12 }} />
        <View style={{ flexDirection: 'row' }}>
          {['light', 'dark', 'system'].map((opt) => (
            <TouchableOpacity
              key={opt}
              onPress={() => setMode(opt)}
              style={[
                styles.modeBtn,
                {
                  borderColor: mode === opt ? theme.colors.accent : theme.colors.border,
                  backgroundColor: mode === opt ? theme.colors.tint : 'transparent',
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Тема: ${opt}`}
            >
              <Text
                style={[
                  textBody,
                  { color: mode === opt ? theme.colors.accent : theme.colors.text },
                ]}
              >
                {opt === 'light' ? 'Светлая' : opt === 'dark' ? 'Тёмная' : 'Системная'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Карточка: Часовой пояс (только админ видит управление) */}
      {role === 'admin' && (
        <View style={[cardStyle, shadowStyle, { padding: 16, marginBottom: 16 }]}>
          <Text style={[textTitle, { marginBottom: 8 }]}>Часовой пояс</Text>
          <Text style={textMuted}>
            Применяется ко всей компании и политикам отображения телефона.
          </Text>

          <View style={{ height: 12 }} />

          {tzLoading ? (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <ActivityIndicator />
              <Text style={[textBody, { marginLeft: 10 }]}>Загрузка…</Text>
            </View>
          ) : (
            <>
              <View
                style={[
                  styles.tzRow,
                  {
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.card,
                  },
                ]}
              >
                <Text style={[textBody, { flex: 1 }]}>
                  Текущий TZ ({companyInfo.tzSource === 'companies' ? 'company' : 'profile'})
                </Text>
                <Text style={[textBody, { fontWeight: '700' }]}>{timezone}</Text>
              </View>

              {tzError ? (
                <Text style={[textBody, { color: '#dc3545', marginTop: 8 }]}>{tzError}</Text>
              ) : null}

              <View style={{ height: 12 }} />
              <View style={{ flexDirection: 'row' }}>
                <SecondaryButton
                  title="Выбрать"
                  onPress={() => setTzModal(true)}
                  style={{ marginRight: 8 }}
                />
                <PrimaryButton
                  title={tzSaving ? 'Сохранение…' : 'Сохранить'}
                  onPress={tzSaving ? null : saveTimezone}
                  style={styles.buttonSave}
                />
              </View>
            </>
          )}
        </View>
      )}

      {/* Статистика */}
      <View style={styles.statsContainer}>
        <StatCard
          theme={theme}
          cardStyle={cardStyle}
          shadowStyle={shadowStyle}
          textMuted={textMuted}
          label="Всего заявок"
          value={stats.total}
          onPress={() => router.push({ pathname: '/all-orders', params: { filter: 'all' } })}
        />
        <StatCard
          theme={theme}
          cardStyle={cardStyle}
          shadowStyle={shadowStyle}
          textMuted={textMuted}
          label="В работе"
          value={stats.inWork}
          onPress={() =>
            router.push({ pathname: '/all-orders', params: { filter: 'in_progress' } })
          }
        />
        <StatCard
          theme={theme}
          cardStyle={cardStyle}
          shadowStyle={shadowStyle}
          textMuted={textMuted}
          label="Завершено"
          value={stats.done}
          onPress={() => router.push({ pathname: '/all-orders', params: { filter: 'done' } })}
        />
        <StatCard
          theme={theme}
          cardStyle={cardStyle}
          shadowStyle={shadowStyle}
          textMuted={textMuted}
          label="Свободные"
          value={stats.free}
          onPress={() => router.push({ pathname: '/all-orders', params: { filter: 'free' } })}
        />
      </View>

      {has('canViewAllOrders') && (
        <PrimaryButton
          title="Все заявки"
          style={styles.buttonPrimary}
          onPress={() => router.push('orders/all-orders')}
        />
      )}
      <PrimaryButton
        title="Статистика"
        style={styles.buttonPrimary}
        onPress={() => router.push('/stats')}
      />
      {role === 'admin' && (
        <PrimaryButton
          title="Сотрудники"
          style={styles.buttonPrimary}
          onPress={() => router.push('/users')}
        />
      )}
      {role === 'admin' && (
        <PrimaryButton
          title="Настройки"
          style={styles.buttonPrimary}
          onPress={() => router.push('/settings')}
        />
      )}
      {has('canCreateOrders') && (
        <PrimaryButton
          title="Создать заявку"
          style={styles.buttonPrimary}
          onPress={() => router.push('/orders/create-order')}
        />
      )}
      <PrimaryButton title="Выйти из профиля" style={styles.buttonLogout} onPress={logout} />

      {/* Модалка выбора TZ */}
      <Modal
        visible={tzModal}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setTzModal(false)}
      >
        <View style={[styles.modalBackdrop, { backgroundColor: theme.colors.overlay }]}>
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: theme.colors?.card || '#FFFFFF',
                ...theme.shadows.level1,
              },
            ]}
          >
            <Text style={[textTitle, { marginBottom: 8 }]}>Выберите часовой пояс</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {SUPPORTED_TIMEZONES.map((tz) => {
                const active = tz === timezone;
                return (
                  <TouchableOpacity
                    key={tz}
                    onPress={() => setTimezone(tz)}
                    style={[
                      styles.tzItem,
                      {
                        borderColor: active ? theme.colors.accent : theme.colors.border,
                        backgroundColor: active ? theme.colors.tint : 'transparent',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        textBody,
                        { fontWeight: active ? '700' : '400', color: theme.colors.text },
                      ]}
                    >
                      {tz}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={{ height: 12 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <SecondaryButton
                title="Закрыть"
                onPress={() => setTzModal(false)}
                style={{ marginRight: 8 }}
              />
              <PrimaryButton title="Готово" onPress={() => setTzModal(false)} />
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function StatCard({ theme, label, value, onPress, cardStyle, shadowStyle, textMuted }) {
  return (
    <TouchableOpacity style={[styles.statBox, cardStyle, shadowStyle]} onPress={onPress}>
      <Text style={[styles.statLabel, { color: textMuted?.color || '#666' }]}>{label}</Text>
      <Text style={[styles.statValue, { color: theme.colors.text }]}>{value}</Text>
    </TouchableOpacity>
  );
}

function PrimaryButton({ title, onPress, style }) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity style={[styles.button, { backgroundColor: theme.colors.primary }, style]} onPress={onPress}>
      <Text style={[styles.buttonText, { color: theme.colors?.primaryTextOn || '#FFFFFF' }]}>{title}</Text>
    </TouchableOpacity>
  );
}

function SecondaryButton({ title, onPress, style }) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      style={[
        styles.secondaryBtn,
        { borderColor: theme.colors.border, backgroundColor: 'transparent' },
        style,
      ]}
      onPress={onPress}
    >
      <Text style={[styles.secondaryBtnText, { color: theme.colors.text }]}>{title}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    paddingTop: 54,
    paddingBottom: 40,
  },
  header: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 30,
  },
  statsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  statBox: {
    width: '48%',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 14,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    marginTop: 8,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 16,
    alignItems: 'center',
  },
  buttonText: {
    fontWeight: '600',
    fontSize: 16,
  },
  modeBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginRight: 8,
  },

  // TZ UI
  tzRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  secondaryBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
  },
  secondaryBtnText: {
    fontWeight: '600',
    fontSize: 16,
  },
  buttonSave: {
    marginLeft: 8,
  },
  // Modal
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    borderRadius: 16,
    padding: 16,
  },
  tzItem: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
});