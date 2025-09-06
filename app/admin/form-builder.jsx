// app/admin/form-builder.jsx

import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
// Unified theme & UI components
import { useTheme } from '../../theme/ThemeProvider';
import Screen from '../../components/layout/Screen';
import Button from '../../components/ui/Button';
import TextField from '../../components/ui/TextField';
import {View, Text, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform, Modal, Switch} from 'react-native';
import { useColorScheme } from 'react-native';


// If you have ThemeProvider — we use it. Otherwise, we fall back to system scheme.
let useAppTheme;
try {
  // optional import; avoid crash if file/path missing
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  useAppTheme = require('../../theme/ThemeProvider').useTheme;
} catch {}

let supabaseDefault, supabaseNamed;
try {
  const mod = require('../../lib/supabase');
  supabaseDefault = mod.default;
  supabaseNamed = mod.supabase;
} catch (e) {
  // keep undefined — we'll throw below if both missing
}

const supabase = (typeof supabaseNamed !== 'undefined' && supabaseNamed) || supabaseDefault;
if (!supabase) {
  throw new Error('Supabase client import failed: check ../../lib/supabase export (default or named).');
}

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


function sanitizeKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export default function FormBuilderScreen() {
  const { theme } = useTheme();
  const colors = {
    bg: theme?.colors?.background,
    card: theme?.colors?.surface ?? theme?.colors?.card,
    card2: theme?.colors?.surfaceAlt ?? theme?.colors?.card2,
    text: theme?.colors?.text,
    sub: theme?.colors?.textSecondary ?? theme?.text?.muted?.color,
    border: theme?.colors?.border,
    tint: theme?.colors?.primary,
    onPrimary: theme?.colors?.primaryTextOn ?? theme?.colors?.onPrimary,
    danger: theme?.colors?.danger,
    success: theme?.colors?.success,
    inputBg: theme?.colors?.inputBg ?? theme?.colors?.surfaceAlt,
    overlay: theme?.colors?.overlay,
    textSecondary: theme?.colors?.textSecondary,
  };
  const router = useRouter();

  const [roleChecked, setRoleChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [companyId, setCompanyId] = useState(null);

  const [contextTab, setContextTab] = useState('create'); // 'create' | 'edit'
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fields, setFields] = useState([]);
  const [editor, setEditor] = useState({ visible: false, index: -1, field: null });
  const [deleting, setDeleting] = useState({ visible: false, index: -1 });

  // role check
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
          .select('role, company_id')
          .eq('id', uid)
          .single();
        if (profErr) {
          setIsAdmin(false);
        } else {
          setIsAdmin(['admin', 'dispatcher'].includes(prof?.role));
          setCompanyId(prof?.company_id ?? null);
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
  }, [isAdmin, roleChecked, contextTab, companyId]);

  // ===== Phone visibility helpers (for field_key='phone') =====
  const PHONE_ROLES = ['admin','dispatcher','worker'];
  const PHONE_DEFAULTS = {
    admin: { mode: 'always', offset_minutes: 0 },
    dispatcher: { mode: 'always', offset_minutes: 0 },
    worker: { mode: 'offset', offset_minutes: 24*60 },
  };

  async function loadPhoneVisibility() {
    try {
      const cid = companyId;
      const { data, error } = await supabase
        .from('app_field_visibility')
        .select('role, mode, offset_minutes')
        .eq('field_key', 'phone')
        .eq('company_id', cid);
      if (error) throw error;
      const map = { ...PHONE_DEFAULTS };
      (data || []).forEach(r => {
        map[r.role] = { mode: r.mode, offset_minutes: r.offset_minutes ?? 0 };
      });
      return map;
    } catch (e) {
      return { ...PHONE_DEFAULTS };
    }
  }

  async function savePhoneVisibility(map) {
    try {
      const cid = companyId;
      if (!cid) return { ok: false, msg: 'company_id пуст' };
      const rows = PHONE_ROLES.map(role => ({
        company_id: cid,
        field_key: 'phone',
        role,
        mode: map?.[role]?.mode ?? PHONE_DEFAULTS[role].mode,
        offset_minutes: map?.[role]?.offset_minutes ?? PHONE_DEFAULTS[role].offset_minutes,
      }));
      const { error } = await supabase
        .from('app_field_visibility')
        .upsert(rows, { onConflict: 'company_id,field_key,role' });
      if (error) throw error;
      return { ok: true };
    } catch (e) {
      setError(prettyErr(e));
      return { ok: false, msg: prettyErr(e) };
    }
  }

  async function loadFields(ctx) {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      let data = null;
      const cid = companyId;

      // Try RPC with multiple payload shapes (with and without company_id)
      const attempts = [
        { payload: { context: ctx, company_id: cid } },
        { payload: { mode: ctx, company_id: cid } },
        { payload: { ctx, company_id: cid } },
        { payload: { context: ctx } },
        { payload: { mode: ctx } },
        { payload: { ctx } },
      ];
      for (const a of attempts) {
        try {
          const { data: d, error: e } = await supabase.rpc('get_form_schema', a.payload);
          if (!e && d) { data = d; break; }
        } catch {}
      }

      if (!data) {
        // Fallback: read directly from app_form_fields
        let r = null;
        try {
          if (cid) {
            r = await supabase.from('app_form_fields').select('*').eq('company_id', cid);
            if (r.error && /(column|does not exist|unknown)/i.test(String(r.error.message||''))) {
              r = await supabase.from('app_form_fields').select('*');
            }
          } else {
            r = await supabase.from('app_form_fields').select('*');
          }
        } catch (e) {
          r = await supabase.from('app_form_fields').select('*');
        }
        if (r.error) throw r.error;
        data = (r.data || []).filter((row) => {
          if (typeof row.context === 'undefined' || row.context === null) return true;
          return String(row.context) === String(ctx);
        });
      }

      const normalized = (data || []).map((f, idx) => ({
        id: f.id || null,
        company_id: f.company_id ?? cid ?? null,
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
    setTimeout(() => setNotice(''), 3200);
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

  async function onEdit(index) {
    const f = fields[index];
    let phoneVis = null;
    if (f.key === 'phone') phoneVis = await loadPhoneVisibility();
    setEditor({ visible: true, index, field: { ...f, __phoneVisibility: phoneVis } });
  }

  function onDuplicate(index) {
    setFields((prev) => {
      const src = prev[index];
      if (!src) return prev;
      const base = sanitizeKey(src.key || 'field');
      let n = 2;
      let candidate = base + '_' + n;
      const keys = new Set(prev.map((x) => x.key));
      while (keys.has(candidate)) {
        n += 1;
        candidate = base + '_' + n;
      }
      const clone = {
        ...src,
        id: null,
        key: candidate,
        label: src.label ? src.label + ' (копия)' : 'Новое поле',
      };
      const arr = [...prev];
      arr.splice(index + 1, 0, clone);
      return arr.map((f, i) => ({ ...f, order_index: i }));
    });
    showNotice('Поле скопировано');
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

  function toggleActive(index, value) {
    setFields((prev) => {
      const next = [...prev];
      if (!next[index]) return prev;
      next[index] = { ...next[index], is_active: !!value };
      return next;
    });
  }

  function toggleRequired(index, value) {
    setFields((prev) => {
      const next = [...prev];
      if (!next[index]) return prev;
      next[index] = { ...next[index], required: !!value };
      return next;
    });
  }

  function validateBeforeSave(arr) {
    const map = new Map();
    for (const f of arr) {
      const k = String(f.key || '').trim();
      if (!k) return { ok: false, msg: `У поля "${f.label || ''}" пустой key` };
      const kk = (f.context || contextTab) + '|' + k;
      if (map.has(kk)) return { ok: false, msg: `Дублирующийся key "${k}" в этом контексте` };
      map.set(kk, true);
    }
    return { ok: true };
  }

  async function saveAll() {
    setSaving(true);
    setError('');
    try {
      const cid = companyId || undefined;

      // sanitize keys before validation and payload
      const normalized = fields.map((f) => ({ ...f, key: sanitizeKey(f.key || '') }));
      const v = validateBeforeSave(normalized);
      if (!v.ok) {
        setError(v.msg);
        setSaving(false);
        return;
      }

      const payload = normalized.map((f) => ({
        id: f.id || undefined,
        company_id: cid,
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

      // Back-compat transforms
      const mapOrderIndexToOrder = (arr) =>
        arr.map(({ order_index, ...rest }) => ({ ...rest, order: Number(order_index) || 0 }));
      const stripContext = (arr) => arr.map(({ context, ...rest }) => rest);
      const stripCompany = (arr) => arr.map(({ company_id, ...rest }) => rest);

      const candidates = [
        { transform: (x) => x },
        { transform: mapOrderIndexToOrder },
        { transform: stripContext },
        { transform: (x) => stripContext(mapOrderIndexToOrder(x)) },
        { transform: stripCompany },
        { transform: (x) => stripCompany(mapOrderIndexToOrder(x)) },
        { transform: (x) => stripCompany(stripContext(x)) },
        { transform: (x) => stripCompany(stripContext(mapOrderIndexToOrder(x))) },
      ];

      let data = null;
      let lastErr = null;
      for (const { transform } of candidates) {
        const p = transform(payload);
        const { data: d, error: e } = await supabase
          .from('app_form_fields')
          .upsert(p, { onConflict: 'id' })
          .select();
        if (!e) { data = d; lastErr = null; break; }
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
        byKey.set(
          (row.key || row.field_key) +
            '|' +
            (row.context || contextTab) +
            '|' +
            (row.company_id || cid || ''),
          row
        );
      setFields((prev) =>
        prev.map((f) => {
          const r = byKey.get(
            f.key + '|' + (f.context || contextTab) + '|' + (f.company_id || cid || '')
          );
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

  // ===== UI =====
  if (!roleChecked) {
    return (
      <Screen background="background" edges={['top','bottom']}>
        <CenteredLoader colors={colors} text="Загрузка…" />
      </Screen>
    );
  }

  if (!isAdmin) {
    return (
      <Screen background="background" edges={['top','bottom']}>
        <HeaderLarge title="Конструктор формы" onBack={() => router.back()} colors={colors} />
        <CenteredLoader colors={colors} text="Только для администратора" />
      </Screen>
    );
  }

  return (
    <Screen background="background" edges={['top','bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
        style={{ flex: 1 }}
      >
        <HeaderLarge title="Конструктор формы" onBack={() => router.back()} colors={colors} />
        <Tabs value={contextTab} onChange={setContextTab} colors={colors} />

        {notice ? <Banner text={notice} colors={colors} /> : null}
        {error ? <Banner text={error} colors={colors} danger /> : null}

        {loading ? (
          <CenteredLoader colors={colors} text="Загрузка полей…" />
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
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
                  onDuplicate={() => onDuplicate(i)}
                  onDelete={() => onDeleteAsk(i)}
                  onToggleActive={(v) => toggleActive(i, v)}
                  onToggleRequired={(v) => toggleRequired(i, v)}
                />
              ))}
            </View>

            <Button
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
                opacity: pressed ? 0.9 : 1,
              })}
            >
              <Text style={{ color: colors.tint, fontSize: 16, fontWeight: '600' }}>
                + Добавить поле
              </Text>
            </Button>
          </ScrollView>
        )}

        <SaveBar onSave={saveAll} saving={saving} colors={colors} />
      </KeyboardAvoidingView>

      {editor.visible ? (
        <FieldEditorModal
          visible={editor.visible}
          field={editor.field}
          onSavePhoneVisibility={async (map) => {
            if (map) await savePhoneVisibility(map);
          }}
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
    </Screen>
  );
}

// ===== Reusable UI parts =====

function HeaderLarge({ title, onBack, colors }) {
  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 8,
        backgroundColor: colors.bg,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Button
          onPress={onBack}
          style={({ pressed }) => ({
            paddingVertical: 8,
            paddingHorizontal: 8,
            borderRadius: 10,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text style={{ color: colors.tint, fontSize: 16 }}>Назад</Text>
        </Button>
        <View style={{ width: 56 }} />
      </View>
      <Text style={{ color: colors.text, fontSize: 28, fontWeight: '800', marginTop: 4 }}>
        {title}
      </Text>
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
            <Button
              key={v}
              onPress={() => onChange(v)}
              style={({ pressed }) => ({
                flex: 1,
                backgroundColor: active ? colors.tint : 'transparent',
                borderRadius: 10,
                paddingVertical: 10,
                alignItems: 'center',
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text
                style={{
                  color: active ? colors.onPrimary : colors.text,
                  fontWeight: '700',
                  fontSize: 15,
                  letterSpacing: 0.2,
                }}
              >
                {v === 'create' ? 'Создание' : 'Редактирование'}
              </Text>
            </Button>
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

function CenteredLoader({ colors, text }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator />
      {text ? <Text style={{ marginTop: 12, color: colors.sub }}>{text}</Text> : null}
    </View>
  );
}

function FieldCard({
  f,
  colors,
  onUp,
  onDown,
  onEdit,
  onDuplicate,
  onDelete,
  onToggleActive,
  onToggleRequired,
}) {
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
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>
            {f.label || f.key}
          </Text>
          <Text style={{ color: colors.sub, marginTop: 4, fontSize: 13 }}>key: {f.key}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip text={f.type} colors={colors} />
            <ToggleChip
              label="Обяз."
              value={!!f.required}
              onToggle={onToggleRequired}
              colors={colors}
            />
            <ToggleChip
              label="Активно"
              value={!!f.is_active}
              onToggle={onToggleActive}
              colors={colors}
            />
          </View>
        </View>
      </View>

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
          <Btn title="Дублировать" onPress={onDuplicate} colors={colors} outline />
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
    <Button
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
        opacity: pressed ? 0.78 : 1,
      })}
    >
      <Text style={{ color: colors.tint, fontSize: 16, fontWeight: '700' }}>{label}</Text>
    </Button>
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

function ToggleChip({ label, value, onToggle, colors }) {
  return (
    <Button
      onPress={() => onToggle && onToggle(!value)}
      style={({ pressed }) => ({
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: value ? colors.tint : colors.card2,
        borderWidth: 1,
        borderColor: value ? colors.tint : colors.border,
        opacity: pressed ? 0.86 : 1,
      })}
    >
      <Text style={{ color: value ? colors.onPrimary : colors.text, fontSize: 12, fontWeight: '600' }}>
        {label}
      </Text>
    </Button>
  );
}

function Btn({ title, onPress, colors, outline, danger, disabled }) {
  const bg = outline ? 'transparent' : danger ? colors.danger : colors.tint;
  const color = outline ? (danger ? colors.danger : colors.tint) : colors.onPrimary;
  const borderColor = danger ? colors.danger : colors.tint;
  return (
    <Button
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 12,
        backgroundColor: disabled ? colors.textSecondary : bg,
        borderWidth: outline ? 1 : 0,
        borderColor: outline ? borderColor : 'transparent',
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text style={{ color: disabled ? colors.onPrimary : color, fontWeight: '700' }}>{title}</Text>
    </Button>
  );
}

function FieldEditorModal({ visible, onClose, onSave, field, colors, onSavePhoneVisibility }) {
  const [state, setState] = useState(field);

  useEffect(() => {
    setState(field);
  }, [field]);

  function setValue(k, v) {
    setState((s) => ({ ...s, [k]: v }));
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: colors.overlay,
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
              style={{ width: 36, height: 5, backgroundColor: colors.border, borderRadius: 999 }}
            />
          </View>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 12 }}>
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
            onChangeText={(t) => setValue('key', sanitizeKey(t))}
            colors={colors}
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
              trackColor={{ true: colors.tint }}
              thumbColor={undefined}
            />
          </Row>

          <Row style={{ marginTop: 8 }}>
            <Text style={{ color: colors.text, fontSize: 16 }}>Активное поле</Text>
            <Switch
              value={!!state.is_active}
              onValueChange={(v) => setValue('is_active', v)}
              trackColor={{ true: colors.tint }}
              thumbColor={undefined}
            />
          </Row>

          {/* Special config for phone visibility */}
          {state.key === 'phone' && (
            <PhoneVisibilityEditor
              map={state.__phoneVisibility || {}}
              colors={colors}
              onChange={(m) => setValue('__phoneVisibility', m)}
            />
          )}

          <Row style={{ marginTop: 14, justifyContent: 'flex-end' }}>
            <Btn title="Отмена" onPress={onClose} colors={colors} outline />
            <View style={{ width: 8 }} />
            <Btn
              title="Сохранить"
              onPress={async () => {
                if (state.key === 'phone' && typeof onSavePhoneVisibility === 'function') {
                  await onSavePhoneVisibility(state.__phoneVisibility);
                }
                onSave(state);
              }}
              colors={colors}
            />
          </Row>
        </View>
      </View>
    </Modal>
  );
}

function PhoneVisibilityEditor({ map, colors, onChange }) {
  const roles = ['admin', 'dispatcher', 'worker'];
  const current = map || {};
  return (
    <View
      style={{
        marginTop: 16,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card2,
      }}
    >
      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, marginBottom: 8 }}>
        Видимость телефона по ролям
      </Text>
      {roles.map((r) => {
        const row = current[r] || { mode: 'always', offset_minutes: 0 };
        return (
          <View key={r} style={{ marginBottom: 10 }}>
            <Text style={{ color: colors.sub, marginBottom: 6, textTransform: 'capitalize' }}>
              {r}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <RadioPill
                label="Всегда"
                active={row.mode === 'always'}
                onPress={() => onChange({ ...current, [r]: { mode: 'always', offset_minutes: 0 } })}
                colors={colors}
              />
              <View style={{ width: 8 }} />
              <RadioPill
                label="Никогда"
                active={row.mode === 'never'}
                onPress={() => onChange({ ...current, [r]: { mode: 'never', offset_minutes: 0 } })}
                colors={colors}
              />
              <View style={{ width: 8 }} />
              <RadioPill
                label="За N часов"
                active={row.mode === 'offset'}
                onPress={() =>
                  onChange({
                    ...current,
                    [r]: { mode: 'offset', offset_minutes: row.offset_minutes || 60 },
                  })
                }
                colors={colors}
              />
            </View>
            {row.mode === 'offset' ? (
              <Input
                label="N часов до выезда"
                value={String(Math.max(0, Math.round((row.offset_minutes || 0) / 60)))}
                onChangeText={(t) => {
                  const h = Math.max(0, parseInt(String(t || '').replace(/\D/g, '')) || 0);
                  onChange({ ...current, [r]: { mode: 'offset', offset_minutes: h * 60 } });
                }}
                colors={colors}
                style={{ marginTop: 8 }}
              />
            ) : null}
          </View>
        );
      })}
      <Text style={{ color: colors.sub, fontSize: 12 }}>
        Применяется на экране заявки через защищённые выборки.
      </Text>
    </View>
  );
}

function RadioPill({ label, active, onPress, colors }) {
  return (
    <Button
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: active ? colors.tint : colors.card2,
        borderWidth: 1,
        borderColor: active ? colors.tint : colors.border,
        opacity: pressed ? 0.86 : 1,
      })}
    >
      <Text style={{ color: active ? colors.onPrimary : colors.text, fontWeight: '600' }}>{label}</Text>
    </Button>
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
        style={{ flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center' }}
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
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '800' }}>{title}</Text>
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
      <Button
        onPress={onSave}
        disabled={saving}
        style={({ pressed }) => ({
          backgroundColor: saving ? colors.textSecondary : colors.tint,
          borderRadius: 14,
          paddingVertical: 14,
          alignItems: 'center',
          opacity: pressed ? 0.9 : 1,
        })}
      >
        {saving ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text style={{ color: colors.onPrimary, fontWeight: '800', fontSize: 16 }}>Сохранить изменения</Text>
        )}
      </Button>
    </View>
  );
}

function TypeSelector({ value, onChange, colors }) {
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={{ color: colors.sub, marginBottom: 8, fontSize: 13 }}>Тип поля</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {TYPE_PRESETS.map((t) => {
          const active = value === t;
          return (
            <Button
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
              <Text style={{ color: active ? colors.onPrimary : colors.text, fontSize: 13 }}>{t}</Text>
            </Button>
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
      <TextField
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
