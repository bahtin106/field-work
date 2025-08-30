// app/admin/form-builder.jsx
// Expo Router screen for Admin-only Dynamic Form Builder
// SafeArea + KeyboardAvoiding; dark-mode aware; Apple-like minimalist styling.
// Works with Supabase: RPC get_form_schema + table app_form_fields.
// NOTE: file is under app/admin/, so supabase import is ../../lib/supabase

import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Switch,
} from 'react-native';
import { useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import supabaseDefault, { supabase as supabaseNamed } from '../../lib/supabase';

// Support both default and named exports from lib/supabase
const supabase = (typeof supabaseNamed !== 'undefined' && supabaseNamed) || supabaseDefault;
if (!supabase) {
  throw new Error(
    'Supabase client import failed: check lib/supabase export (default or named) and import path.',
  );
}

const PRIMARY = '#007AFF';

const TYPE_PRESETS = [
  'text',
  'textarea',
  'number',
  'phone',
  'date',
  'datetime',
  'select',
  'multiselect',
  'address_region',
  'address_city',
  'address_street',
  'address_building',
  'custom',
];

const CORE_KEYS = new Set([
  'title',
  'customer_name',
  'phone',
  'datetime',
  'address_region',
  'address_city',
  'address_street',
  'address_building',
]);

function useTheme() {
  const scheme = useColorScheme?.() || 'light';
  const dark = scheme === 'dark';
  return {
    scheme,
    dark,
    colors: dark
      ? {
          bg: '#000000',
          card: '#111111',
          card2: '#1A1A1A',
          text: '#FFFFFF',
          sub: '#9CA3AF',
          border: '#2C2C2E',
          tint: PRIMARY,
          danger: '#FF453A',
          success: '#30D158',
          inputBg: '#0F0F10',
        }
      : {
          bg: '#F2F2F7',
          card: '#FFFFFF',
          card2: '#F8F9FB',
          text: '#111111',
          sub: '#6B7280',
          border: '#E5E7EB',
          tint: PRIMARY,
          danger: '#FF3B30',
          success: '#34C759',
          inputBg: '#F5F6F8',
        },
  };
}

export default function FormBuilderScreen() {
  const theme = useTheme();
  const { colors } = theme;
  const router = useRouter();

  const [roleChecked, setRoleChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [contextTab, setContextTab] = useState('create'); // 'create' | 'edit'
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fields, setFields] = useState([]);
  const [editor, setEditor] = useState({ visible: false, index: -1, field: null });
  const [deleting, setDeleting] = useState({ visible: false, index: -1 });

  useEffect(() => {
    (async () => {
      try {
        const { data: userData, error: userErr } = await supabase.auth.getUser();
        if (userErr || !userData?.user) {
          setIsAdmin(false);
          setRoleChecked(true);
          return;
        }
        const uid = userData.user.id;
        const { data: prof, error: profErr } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', uid)
          .single();
        if (profErr) {
          setIsAdmin(false);
        } else {
          setIsAdmin(['admin', 'dispatcher'].includes(prof?.role));
        }
      } catch (e) {
        setIsAdmin(false);
      } finally {
        setRoleChecked(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!isAdmin || !roleChecked) return;
    loadFields(contextTab);
  }, [isAdmin, roleChecked, contextTab]);

  async function loadFields(ctx) {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      let data = null;
      const attempts = [
        { payload: { context: ctx } },
        { payload: { mode: ctx } },
        { payload: { ctx } },
      ];
      for (const a of attempts) {
        const { data: d, error: e } = await supabase.rpc('get_form_schema', a.payload);
        if (!e && d) {
          data = d;
          break;
        }
      }
      if (!data) {
        // Fallback: read directly from app_form_fields WITHOUT .order() on a potentially missing column.
        const r = await supabase.from('app_form_fields').select('*'); // avoid server-side order by non-existent column
        if (r.error) throw r.error;
        data = (r.data || []).filter((row) => {
          // If table has no 'context' column, keep all; if it has, filter by ctx
          if (typeof row.context === 'undefined' || row.context === null) return true;
          return String(row.context) === String(ctx);
        });
      }

      // Normalize
      const normalized = (data || []).map((f, idx) => ({
        id: f.id || null,
        context: f.context ?? ctx,
        key: f.key || f.field_key || `field_${idx + 1}`,
        label: f.label || f.title || f.name || '',
        type: f.type || 'text',
        required: !!(f.required ?? false),
        order_index:
          typeof f.order_index === 'number'
            ? f.order_index
            : typeof f.order === 'number'
              ? f.order
              : idx,
        placeholder: f.placeholder || '',
        options: Array.isArray(f.options)
          ? f.options
          : typeof f.options === 'string'
            ? safeParseArray(f.options)
            : [],
        is_active: f.is_active ?? true,
      }));
      // Client-side sort by whichever order field exists
      normalized.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
      setFields(normalized);
    } catch (e) {
      setError(prettyErr(e));
    } finally {
      setLoading(false);
    }
  }

  function safeParseArray(s) {
    try {
      const j = JSON.parse(s);
      return Array.isArray(j) ? j : [];
    } catch {
      return String(s || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    }
  }

  function prettyErr(e) {
    const msg = (e?.message || e?.toString?.() || 'Ошибка').replace('SupabaseClientError: ', '');
    return msg;
  }

  function showNotice(n) {
    setNotice(n);
    setTimeout(() => setNotice(''), 3500);
  }

  function move(index, dir) {
    setFields((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      const a = next[index];
      const b = next[target];
      next[index] = b;
      next[target] = a;
      return next.map((f, i) => ({ ...f, order_index: i }));
    });
  }

  function onEdit(index) {
    const f = fields[index];
    setEditor({ visible: true, index, field: { ...f } });
  }

  function onDeleteAsk(index) {
    setDeleting({ visible: true, index });
  }

  async function onDeleteConfirm() {
    const index = deleting.index;
    const f = fields[index];
    setDeleting({ visible: false, index: -1 });
    if (!f) return;
    try {
      if (f.id) {
        const { error: delErr } = await supabase.from('app_form_fields').delete().eq('id', f.id);
        if (delErr) throw delErr;
      }
      setFields((prev) =>
        prev.filter((_, i) => i !== index).map((x, i) => ({ ...x, order_index: i })),
      );
      showNotice('Поле удалено');
    } catch (e) {
      setError(prettyErr(e));
    }
  }

  function onEditorSave(field) {
    setFields((prev) => {
      const next = [...prev];
      next[editor.index] = { ...field, order_index: prev[editor.index].order_index };
      return next;
    });
    setEditor({ visible: false, index: -1, field: null });
  }

  function addField() {
    const idx = fields.length;
    setFields((prev) => [
      ...prev,
      {
        id: null,
        context: contextTab,
        key: `field_${idx + 1}`,
        label: 'Новое поле',
        type: 'text',
        required: false,
        order_index: idx,
        placeholder: '',
        options: [],
        is_active: true,
      },
    ]);
    showNotice('Поле добавлено');
  }

  async function saveAll() {
    setSaving(true);
    setError('');
    try {
      const payload = fields.map((f) => ({
        id: f.id || undefined,
        context: f.context || contextTab,
        key: f.key,
        label: f.label,
        type: f.type,
        required: !!f.required,
        order_index: Number(f.order_index) || 0,
        options: f.options && Array.isArray(f.options) ? f.options : [],
        placeholder: f.placeholder || '',
        is_active: f.is_active ?? true,
      }));

      // Helper builders for fallback payloads
      const mapOrderIndexToOrder = (arr) =>
        arr.map(({ order_index, ...rest }) => ({ ...rest, order: Number(order_index) || 0 }));
      const stripContext = (arr) => arr.map(({ context, ...rest }) => rest);

      // Try a sequence of upserts to adapt to schema differences (context/order_index may be absent)
      const candidates = [
        { transform: (x) => x }, // as-is
        { transform: mapOrderIndexToOrder }, // order_index -> order
        { transform: stripContext }, // no context
        { transform: (x) => stripContext(mapOrderIndexToOrder(x)) }, // no context + order_index->order
      ];

      let data = null;
      let lastErr = null;
      for (const { transform } of candidates) {
        const p = transform(payload);
        const { data: d, error: e } = await supabase
          .from('app_form_fields')
          .upsert(p, { onConflict: 'id' })
          .select();
        if (!e) {
          data = d;
          lastErr = null;
          break;
        }
        // Only continue fallback if error hints missing column(s)
        const msg = String(e.message || '');
        if (/(column|does not exist|unknown)/i.test(msg)) {
          lastErr = e;
          continue;
        } else {
          lastErr = e;
          break;
        }
      }
      if (lastErr) throw lastErr;

      const byKey = new Map();
      for (const row of data || [])
        byKey.set((row.key || row.field_key) + '|' + (row.context || contextTab), row);
      setFields((prev) =>
        prev.map((f) => {
          const r = byKey.get(f.key + '|' + (f.context || contextTab));
          return r ? { ...f, id: r.id } : f;
        }),
      );
      showNotice('Схема сохранена');
    } catch (e) {
      setError(prettyErr(e));
    } finally {
      setSaving(false);
    }
  }

  if (!roleChecked) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
          <Text style={{ marginTop: 12, color: colors.sub }}>Загрузка…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!isAdmin) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <Header title="Конструктор формы" onBack={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: colors.sub, fontSize: 16 }}>Только для администратора</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={8}
      >
        <Header title="Конструктор формы" onBack={() => router.back()} />
        <Tabs value={contextTab} onChange={setContextTab} colors={colors} />
        {notice ? <Banner text={notice} colors={colors} /> : null}
        {error ? <Banner text={error} colors={colors} danger /> : null}

        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator />
            <Text style={{ marginTop: 12, color: colors.sub }}>Загрузка полей…</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
            keyboardShouldPersistTaps="handled"
          >
            <View style={{ gap: 12 }}>
              {fields.map((f, i) => (
                <FieldCard
                  key={f.id || f.key + '_' + i}
                  f={f}
                  index={i}
                  colors={colors}
                  onUp={() => move(i, -1)}
                  onDown={() => move(i, +1)}
                  onEdit={() => onEdit(i)}
                  onDelete={() => onDeleteAsk(i)}
                />
              ))}
            </View>

            <Pressable
              onPress={addField}
              style={({ pressed }) => ({
                marginTop: 16,
                backgroundColor: colors.card,
                borderRadius: 16,
                paddingVertical: 14,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: colors.border,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text style={{ color: colors.tint, fontSize: 16, fontWeight: '600' }}>
                + Добавить поле
              </Text>
            </Pressable>
          </ScrollView>
        )}

        <SaveBar onSave={saveAll} saving={saving} colors={colors} />
      </KeyboardAvoidingView>

      {editor.visible ? (
        <FieldEditorModal
          visible={editor.visible}
          field={editor.field}
          onClose={() => setEditor({ visible: false, index: -1, field: null })}
          onSave={onEditorSave}
          colors={colors}
        />
      ) : null}

      {deleting.visible ? (
        <ConfirmModal
          visible={deleting.visible}
          title="Удалить поле?"
          subtitle="Действие необратимо."
          confirmText="Удалить"
          cancelText="Отмена"
          onCancel={() => setDeleting({ visible: false, index: -1 })}
          onConfirm={onDeleteConfirm}
          colors={colors}
          danger
        />
      ) : null}
    </SafeAreaView>
  );
}

function Header({ title, onBack }) {
  const theme = useTheme();
  const { colors } = theme;
  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 12,
        backgroundColor: colors.bg,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <Pressable
        onPress={onBack}
        style={({ pressed }) => ({
          paddingVertical: 8,
          paddingHorizontal: 8,
          borderRadius: 10,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text style={{ color: colors.tint, fontSize: 16 }}>Назад</Text>
      </Pressable>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>{title}</Text>
      <View style={{ width: 56 }} />
    </View>
  );
}

function Tabs({ value, onChange, colors }) {
  return (
    <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: 14,
          padding: 4,
          borderWidth: 1,
          borderColor: colors.border,
          flexDirection: 'row',
        }}
      >
        {['create', 'edit'].map((v) => {
          const active = value === v;
          return (
            <Pressable
              key={v}
              onPress={() => onChange(v)}
              style={({ pressed }) => ({
                flex: 1,
                backgroundColor: active ? colors.tint : 'transparent',
                borderRadius: 10,
                paddingVertical: 8,
                alignItems: 'center',
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text
                style={{
                  color: active ? '#fff' : colors.text,
                  fontWeight: '600',
                  fontSize: 15,
                }}
              >
                {v === 'create' ? 'Создание' : 'Редактирование'}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Banner({ text, colors, danger }) {
  return (
    <View
      style={{
        marginHorizontal: 16,
        marginTop: 12,
        backgroundColor: danger ? colors.danger + '20' : colors.success + '20',
        borderColor: danger ? colors.danger : colors.success,
        borderWidth: 1,
        borderRadius: 12,
        padding: 12,
      }}
    >
      <Text style={{ color: danger ? colors.danger : colors.text, fontSize: 14 }}>{text}</Text>
    </View>
  );
}

function FieldCard({ f, colors, onUp, onDown, onEdit, onDelete }) {
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 14,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>
          {f.label || f.key}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip text={f.type} colors={colors} />
          {f.required ? <Chip text="обязательное" colors={colors} /> : null}
        </View>
      </View>
      <Text style={{ color: colors.sub, marginTop: 4, fontSize: 13 }}>key: {f.key}</Text>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 12,
        }}
      >
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <RoundBtn label="↑" onPress={onUp} colors={colors} />
          <RoundBtn label="↓" onPress={onDown} colors={colors} />
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Btn title="Редактировать" onPress={onEdit} colors={colors} />
          <Btn
            title="Удалить"
            onPress={onDelete}
            colors={colors}
            outline
            danger
            disabled={CORE_KEYS.has(f.key)}
          />
        </View>
      </View>
    </View>
  );
}

function RoundBtn({ label, onPress, colors }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.card2,
        borderWidth: 1,
        borderColor: colors.border,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ color: PRIMARY, fontSize: 16, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function Chip({ text, colors }) {
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: colors.card2,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text style={{ color: colors.text, fontSize: 12 }}>{text}</Text>
    </View>
  );
}

function Btn({ title, onPress, colors, outline, danger, disabled }) {
  const bg = outline ? 'transparent' : danger ? colors.danger : colors.tint;
  const color = outline ? (danger ? colors.danger : colors.tint) : '#fff';
  const borderColor = danger ? colors.danger : colors.tint;
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 12,
        backgroundColor: disabled ? '#9CA3AF50' : bg,
        borderWidth: outline ? 1 : 0,
        borderColor: outline ? borderColor : 'transparent',
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text style={{ color: disabled ? '#ffffff' : color, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}

function FieldEditorModal({ visible, onClose, onSave, field, colors }) {
  const [state, setState] = useState(field);

  useEffect(() => {
    setState(field);
  }, [field]);

  // FIX: remove TypeScript generic from JS. Use plain function.
  function setValue(k, v) {
    setState((s) => ({ ...s, [k]: v }));
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: '#00000080',
          alignItems: 'center',
          justifyContent: 'flex-end',
        }}
      >
        <View
          style={{
            width: '100%',
            backgroundColor: colors.card,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            padding: 16,
            borderTopWidth: 1,
            borderColor: colors.border,
            maxHeight: '88%',
          }}
        >
          <View style={{ alignItems: 'center', marginBottom: 8 }}>
            <View
              style={{
                width: 36,
                height: 5,
                backgroundColor: colors.border,
                borderRadius: 999,
              }}
            />
          </View>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 12 }}>
            Редактирование поля
          </Text>

          <Input
            label="Метка (label)"
            value={state.label}
            onChangeText={(t) => setValue('label', t)}
            colors={colors}
          />
          <Input
            label="Ключ (key)"
            value={state.key}
            onChangeText={(t) => setValue('key', t)}
            colors={colors}
            disabled={false}
          />
          <TypeSelector value={state.type} onChange={(v) => setValue('type', v)} colors={colors} />
          <Input
            label="Placeholder (необязательно)"
            value={state.placeholder || ''}
            onChangeText={(t) => setValue('placeholder', t)}
            colors={colors}
          />
          {(state.type === 'select' || state.type === 'multiselect') && (
            <Input
              label="Опции (через запятую)"
              value={(state.options || []).join(', ')}
              onChangeText={(t) =>
                setValue(
                  'options',
                  String(t)
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean),
                )
              }
              colors={colors}
            />
          )}

          <Row style={{ marginTop: 8 }}>
            <Text style={{ color: colors.text, fontSize: 16 }}>Обязательное поле</Text>
            <Switch
              value={!!state.required}
              onValueChange={(v) => setValue('required', v)}
              trackColor={{ true: PRIMARY }}
              thumbColor={undefined}
            />
          </Row>

          <Row style={{ marginTop: 12 }}>
            <Btn title="Отмена" onPress={onClose} colors={colors} outline />
            <Btn title="Сохранить" onPress={() => onSave(state)} colors={colors} />
          </Row>
        </View>
      </View>
    </Modal>
  );
}

function ConfirmModal({
  visible,
  onCancel,
  onConfirm,
  title,
  subtitle,
  confirmText = 'OK',
  cancelText = 'Отмена',
  colors,
  danger,
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View
        style={{
          flex: 1,
          backgroundColor: '#00000080',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: '86%',
            backgroundColor: colors.card,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: colors.border,
            padding: 16,
          }}
        >
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>{title}</Text>
          {subtitle ? (
            <Text style={{ color: colors.sub, fontSize: 14, marginTop: 6 }}>{subtitle}</Text>
          ) : null}
          <Row style={{ justifyContent: 'flex-end', marginTop: 16 }}>
            <Btn title={cancelText} onPress={onCancel} colors={colors} outline />
            <View style={{ width: 8 }} />
            <Btn title={confirmText} onPress={onConfirm} colors={colors} danger={danger} />
          </Row>
        </View>
      </View>
    </Modal>
  );
}

function SaveBar({ onSave, saving, colors }) {
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        padding: 12,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.card,
      }}
    >
      <Pressable
        onPress={onSave}
        disabled={saving}
        style={({ pressed }) => ({
          backgroundColor: saving ? '#9CA3AF' : colors.tint,
          borderRadius: 14,
          paddingVertical: 14,
          alignItems: 'center',
          opacity: pressed ? 0.9 : 1,
        })}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>
            Сохранить изменения
          </Text>
        )}
      </Pressable>
    </View>
  );
}

function TypeSelector({ value, onChange, colors }) {
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={{ color: colors.sub, marginBottom: 8, fontSize: 13 }}>Тип поля</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {TYPE_PRESETS.map((t) => {
          const active = value === t;
          return (
            <Pressable
              key={t}
              onPress={() => onChange(t)}
              style={({ pressed }) => ({
                paddingHorizontal: 10,
                paddingVertical: 8,
                borderRadius: 999,
                backgroundColor: active ? colors.tint : colors.card2,
                borderWidth: 1,
                borderColor: active ? colors.tint : colors.border,
                marginRight: 8,
                marginBottom: 8,
                opacity: pressed ? 0.86 : 1,
              })}
            >
              <Text style={{ color: active ? '#fff' : colors.text, fontSize: 13 }}>{t}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Input({ label, value, onChangeText, colors, disabled, multiline, style }) {
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={{ color: colors.sub, marginBottom: 6, fontSize: 13 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        editable={!disabled}
        multiline={!!multiline}
        placeholderTextColor={colors.sub}
        style={[
          {
            backgroundColor: colors.inputBg,
            color: colors.text,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            paddingHorizontal: 12,
            paddingVertical: multiline ? 10 : 10,
            minHeight: multiline ? 80 : 44,
          },
          style,
        ]}
      />
    </View>
  );
}

function Row({ children, style }) {
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
        style,
      ]}
    >
      {children}
    </View>
  );
}
