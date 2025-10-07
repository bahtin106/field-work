// app/company_settings/sections/RoleAccessSettings.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useTheme } from '../../../theme/ThemeProvider';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, ScrollView, Platform } from 'react-native';
import Screen from '../../../components/layout/Screen';

import { router } from 'expo-router';
import { supabase } from '../../../lib/supabase';

// Роли
const ROLES = ['admin', 'dispatcher', 'worker'];

// Минимально необходимые флаги
const PERM_DEF = [
  { key: 'canCreateOrders',   label: 'Создание заявок' },
  { key: 'canEditOrders',     label: 'Редактирование заявок' },
  { key: 'canViewAllOrders',  label: 'Видит все заявки' },
  { key: 'canDeleteOrders',   label: 'Удаление заявок' },
];

// Стартовый пресет (без назначения исполнителей и телефонных флагов)
const START_PRESET = {
  admin: {
    canCreateOrders: true,
    canEditOrders: true,
    canViewAllOrders: true,
    canDeleteOrders: true,
  },
  dispatcher: {
    canCreateOrders: true,
    canEditOrders: true,
    canViewAllOrders: true,
    canDeleteOrders: false,
  },
  worker: {
    canCreateOrders: false,
    canEditOrders: false,
    canViewAllOrders: false,
    canDeleteOrders: false,
  },
};

const deepClone = (obj) => JSON.parse(JSON.stringify(obj));

export default function RoleAccessSettings() {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [role, setRole]       = useState(null);
  const [companyId, setCompanyId] = useState(null);
  const [fullName, setFullName] = useState('');
  const [permMatrix, setPermMatrix] = useState(deepClone(START_PRESET));
  const [cloudReady, setCloudReady] = useState(false); // есть ли таблица в БД

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Текущий пользователь
        const { data: userRes, error: userErr } = await supabase.auth.getUser();
        if (userErr) throw userErr;
        const user = userRes?.user;
        if (!user) throw new Error('Пользователь не найден');

        // Роль и компания
        const { data: prof, error: profErr } = await supabase
          .from('profiles')
          .select('role, full_name, company_id')
          .eq('id', user.id)
          .maybeSingle();
        if (profErr) throw profErr;

        if (mounted) {
          setRole(prof?.role ?? null);
          setFullName(prof?.full_name ?? '');
          setCompanyId(prof?.company_id ?? null);
        }

        // Пробуем прочитать права из БД (app_role_permissions)
        const { data: rows, error } = await supabase
          .from('app_role_permissions')
          .select('role, key, value')
          .eq('company_id', prof?.company_id ?? null);

        if (error) {
          // relation does not exist (42P01) или нет прав — выключаем облако
          setCloudReady(false);
        } else {
          setCloudReady(true);
          if (rows && rows.length > 0) {
            const acc = { admin: {}, dispatcher: {}, worker: {} };
            for (const r of rows) {
              if (!acc[r.role]) acc[r.role] = {};
              const toBool = (v) => v === true || v === 1 || v === '1' || v === 'true' || v === 't';
acc[r.role][r.key] = toBool(r.value);
            }
            setPermMatrix(mergeWithDefaults(acc));
          } else {
            // нет записей — используем START_PRESET
            setPermMatrix(deepClone(START_PRESET));
          }
        }
      } catch (e) {
        // не падаем, показываем START_PRESET
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const mergeWithDefaults = (data) => {
    const merged = deepClone(START_PRESET);
    for (const r of ROLES) {
      merged[r] = { ...merged[r], ...(data?.[r] || {}) };
    }
    // лишние ключи из БД (например, canAssignExecutors/phone*) игнорируются UI,
    // так как их нет в PERM_DEF и не уйдут в сохранение.
    return merged;
  };

  const toggle = (roleName, permKey) => {
    setPermMatrix((prev) => ({
      ...prev,
      [roleName]: { ...prev[roleName], [permKey]: !prev[roleName][permKey] },
    }));
  };

  const applyPreset = () => setPermMatrix(deepClone(START_PRESET));

  const save = async () => {
    if (!companyId) {
      Alert.alert('Ошибка', 'Не найден company_id текущего пользователя.');
      return;
    }
    if (!cloudReady) {
      Alert.alert('Нет таблицы', 'В БД не найдена таблица app_role_permissions. Создайте её и повторите.');
      return;
    }

    setSaving(true);
    try {
      const flat = [];
      for (const r of ROLES) {
        for (const p of PERM_DEF) {
          flat.push({
            company_id: companyId,
            role: r,
            key: p.key,
            value: !!permMatrix[r][p.key],
          });
        }
      }
      const { error } = await supabase
        .from('app_role_permissions')
        .upsert(flat, { onConflict: 'company_id,role,key' });
      if (error) throw error;

      
      // Realtime: notify all clients that permissions changed
      try {
        const ch = supabase.channel('permissions');
        await ch.subscribe();
        await ch.send({ type: 'broadcast', event: 'perm_changed', payload: { company_id: companyId, ts: Date.now() } });
        setTimeout(() => { try { supabase.removeChannel(ch); } catch(_){} }, 250);
      } catch (_) {}
    Alert.alert('Сохранено', 'Права обновлены в базе данных.');
    } catch (e) {
      Alert.alert('Ошибка сохранения', e?.message || 'Не удалось сохранить права.');
    } finally {
      setSaving(false);
    }
  };

  const Header = () => (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: '700', color: theme.colors.text }}>Доступы и роли</Text>
      <Text style={{ color: theme.colors.textSecondary, marginTop: 6 }}>
        Текущий пользователь: {fullName || '—'}
      </Text>
      <Text style={{ color: theme.colors.textSecondary, marginTop: 2 }}>
        Ваша роль: <Text style={{ fontWeight: '600', color: theme.colors.text }}>{role || '—'}</Text>
      </Text>
    </View>
  );

  const Pill = ({ active, onPress, children }) => (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: active ? theme.colors.primary : theme.colors.border,
        backgroundColor: active ? (theme.colors.chipBg || theme.colors.inputBg || theme.colors.surface) : theme.colors.onPrimary,
      }}
    >
      <Text style={{ fontSize: 13, color: active ? theme.colors.primary : theme.colors.text }}>{children}</Text>
    </TouchableOpacity>
  );

  const Toggle = ({ checked, onPress }) => (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked }}
      style={{
        width: 52,
        height: 32,
        borderRadius: 16,
        backgroundColor: checked ? (theme.colors.success || theme.colors.primary) : theme.colors.border,
        alignItems: checked ? 'flex-end' : 'flex-start',
        padding: 3,
      }}
    >
      <View
        style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: theme.colors.onPrimary, ...(theme?.shadows?.level1?.[Platform.OS] || {}) }}
      />
    </TouchableOpacity>
  );

  const Matrix = useMemo(() => {
    return (
      <View style={{ backgroundColor: theme.colors.onPrimary, borderRadius: 16, overflow: 'hidden' }}>
        {/* Header row */}
        <View style={{ flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 12, backgroundColor: theme.colors.surface }}>
          <Text style={{ flex: 1.4, fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary }}>Права</Text>
          {ROLES.map((r) => (
            <Text key={r} style={{ flex: 0.8, fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary, textTransform: 'capitalize' }}>
              {r}
            </Text>
          ))}
        </View>

        {PERM_DEF.map((perm, idx) => (
          <View
            key={perm.key}
            style={{
              flexDirection: 'row',
              paddingVertical: 12,
              paddingHorizontal: 12,
              borderTopWidth: idx === 0 ? 0 : 1,
              borderTopColor: theme.colors.border,
              alignItems: 'center',
            }}
          >
            <Text style={{ flex: 1.4, fontSize: 15, color: theme.colors.text }}>{perm.label}</Text>
            {ROLES.map((r) => (
              <View key={`${r}-${perm.key}`} style={{ flex: 0.8, alignItems: 'center' }}>
                <Toggle
                  checked={!!permMatrix[r][perm.key]}
                  onPress={() => toggle(r, perm.key)}
                />
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  }, [permMatrix]);

  return (
    <Screen background="background" edges={['top','bottom']} edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
        {/* Card: header */}
        <View style={{ backgroundColor: theme.colors.onPrimary, borderRadius: 16, padding: 16, marginBottom: 12 }}>
          {loading ? (
            <View style={{ alignItems: 'center' }}>
              <ActivityIndicator />
              <Text style={{ marginTop: 8, color: theme.colors.textSecondary }}>Загружаем…</Text>
            </View>
          ) : (
            <Header />
          )}

          {/* Быстрые действия */}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <Pill active={false} onPress={applyPreset}>Стартовая настройка</Pill>
            <Pill active={false} onPress={() => router.push('/users')}>Сотрудники</Pill>
            {role === 'admin' && (
              <Pill active={false} onPress={() => router.push('/admin/form-builder')}>
                Редактор форм
              </Pill>
            )}
          </View>
        </View>

        {/* Matrix */}
        {Matrix}

        {/* Save */}
        <TouchableOpacity
          onPress={save}
          disabled={saving}
          style={{
            marginTop: 16,
            backgroundColor: saving ? (theme.colors.primaryDisabled || theme.colors.primary) : theme.colors.primary,
            borderRadius: 14,
            paddingVertical: 16,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: theme.colors.onPrimary, fontWeight: '700', fontSize: 16 }}>
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </Text>
        </TouchableOpacity>

        {/* Подсказка про БД */}
        {!cloudReady && (
          <View style={{ marginTop: 10 }}>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
              В БД не найдена таблица <Text style={{ fontWeight: '700' }}>app_role_permissions</Text>.
              Создайте её миграцией, чтобы включить облачное хранение.
            </Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}