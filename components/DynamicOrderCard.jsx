import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

import { readValueFromOrder } from '../lib/settings';
import { supabase } from '../lib/supabase';
import { useSettings } from '../providers/SettingsProvider';
import { useTheme } from '../theme/ThemeProvider';

/* ===== Utils ===== */

/* ===== Name cache for executor (avoid N requests in lists) ===== */
const EXECUTOR_NAME_CACHE = (globalThis.EXECUTOR_NAME_CACHE ||= new Map());

const RUS_LABELS = {
  customer_name: 'Заказчик',
  address: 'Адрес',
  datetime: 'Дата выезда',
};

function formatDateShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const months = [
    'янв.',
    'февр.',
    'март',
    'апр.',
    'май',
    'июнь',
    'июль',
    'авг.',
    'сент.',
    'окт.',
    'нояб.',
    'дек.',
  ];
  return `${d.getDate()} ${months[d.getMonth()] || ''} ${d.getFullYear()}`;
}

function getOptionLabel(field, value) {
  if (!field || !field.options || !Array.isArray(field.options)) return value ?? '';
  const found = field.options.find((o) => o?.value === value);
  return found?.label ?? value ?? '';
}

function joinName(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const parts = [
    obj.full_name,
    obj.fullName,
    obj.name,
    [obj.surname, obj.first_name, obj.last_name].filter(Boolean).join(' '),
    [obj.last_name, obj.first_name, obj.middle_name].filter(Boolean).join(' '),
  ].filter(Boolean);
  return (parts[0] || '').trim();
}

/* Try to read value by field/meta, with robust fallbacks from raw order */
function readWithFallback(order, field, key) {
  let val = readValueFromOrder(order, field || { field_key: key, storage_target: 'builtin' });

  if ((val == null || val === '') && key === 'customer_name') {
    const cand = [
      order?.customer_name,
      order?.customerName,
      order?.customer_full_name,
      order?.customerFullName,
      order?.client_name,
      order?.clientName,
      order?.client_full_name,
      order?.clientFullName,
      order?.fio,
      typeof order?.customer === 'string' ? order?.customer : joinName(order?.customer),
      typeof order?.client === 'string' ? order?.client : joinName(order?.client),
      order?.name,
    ].find(Boolean);
    val = cand || '';
  }

  if ((val == null || val === '') && key === 'address') {
    const composed = [
      order?.region || order?.area,
      order?.city || order?.town || order?.settlement,
      order?.street || order?.snt,
      order?.house || order?.plot || order?.building,
    ]
      .filter(Boolean)
      .join(', ');
    const cand = [order?.address, order?.addr, composed].find(Boolean);
    val = cand || '';
  }

  if (field?.type === 'select' || field?.type === 'multiselect') {
    if (Array.isArray(val)) val = val.map((v) => getOptionLabel(field, v)).join(', ');
    else val = getOptionLabel(field, val);
  }
  return val;
}

/* Status extraction robust */
function extractStatus(order, getFieldByKey, pills) {
  const pillCandidate = pills.find((k) => String(k).toLowerCase().includes('status')) || pills[0];
  const candidates = [
    pillCandidate,
    'status_v2',
    'status',
    'state',
    'order_status',
    'orderState',
  ].filter(Boolean);
  for (const key of candidates) {
    const f = getFieldByKey?.(key);
    const v = readWithFallback(order, f, key);
    if (v) return String(v);
  }
  // try raw known keys
  const raw = order?.status_v2 || order?.status || order?.state || order?.order_status;
  return raw ? String(raw) : '';
}

/* Detect if a string looks like a UUID to avoid printing it as a name */
function looksLikeUuid(s) {
  if (typeof s !== 'string') return false;
  const str = s.trim();
  if (!str) return false;
  // classic v4 with dashes
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str))
    return true;
  // ulid-like (26 chars, base32) — do not hide it automatically, may be used as readable codes
  return false;
}

export default function DynamicOrderCard({
  order,
  context = 'all_orders', // 'all_orders' | 'my_orders' | 'calendar' | 'order_card'
  onPress,
  viewerRole, // 'admin' | 'dispatcher' | 'worker' (optional)
}) {
  const settings = useSettings();
  const { presetsByContext, getFieldByKey } = settings;
  const { theme } = useTheme();

  // Presets with safe defaults: exclude datetime from middle block
  const presetRaw = presetsByContext(context);
  const preset = {
    fields:
      Array.isArray(presetRaw?.fields) && presetRaw.fields.length > 0
        ? presetRaw.fields.filter((k) => k !== 'datetime')
        : ['title', 'customer_name', 'address'],
    pills:
      Array.isArray(presetRaw?.pills) && presetRaw.pills.length > 0 ? presetRaw.pills : ['status'],
    secondary:
      Array.isArray(presetRaw?.secondary) && presetRaw.secondary.length > 0
        ? presetRaw.secondary
        : ['assigned_to_name'],
  };

  const fields = useMemo(() => preset.fields, [preset]);
  const pills = useMemo(() => preset.pills, [preset]);
  const secondary = useMemo(() => preset.secondary, [preset]);

  // Primary rows
  const primaryRows = useMemo(() => {
    return fields
      .map((key) => {
        const field = getFieldByKey(key);
        let value = readWithFallback(order, field, key);
        if (key === 'phone' && order?.phone_visible && !value) value = order.phone_visible;
        const label =
          field?.label && field.label !== key
            ? field.label
            : RUS_LABELS[key] || (field?.label ?? key);
        return { key, label, value };
      })
      .filter((r) => r.key !== 'title');
  }, [fields, order, getFieldByKey]);

  // Status pill
  const statusTitle = useMemo(
    () => extractStatus(order, getFieldByKey, pills),
    [order, pills, getFieldByKey],
  );
  const statusBadge = useMemo(() => {
    if (!statusTitle) return null;
    let bg = '#E8F0FE',
      text = '#0A84FF'; // Новый — синий
    if (/лент/i.test(statusTitle)) {
      bg = '#FFF7CC';
      text = '#8A6D1F';
    } // В ленте — жёлтый
    else if (/заверш/i.test(statusTitle)) {
      bg = '#F2F2F7';
      text = '#8E8E93';
    } // Завершённая — серый
    else if (/работ/i.test(statusTitle)) {
      bg = '#E9F7EF';
      text = '#34C759';
    } // В работе — зелёный
    return { title: statusTitle, bg, text };
  }, [statusTitle]);

  // Executor name (bottom-right) — robust detection
  const executorName = useMemo(() => {
    // 1) Prefer explicit "name" fields first (most typical in our app)
    const byNamePriority = [
      'assigned_to_name',
      'assigned_to_fullname',
      'assigned_to_fio',
      'assignee_name',
      'assignee_fullname',
      'assignee_fio',
      'executor_name',
      'executor_fullname',
      'executor_fio',
      'worker_name',
      'worker_fullname',
      'worker_fio',
      'responsible_name',
      'responsible_fullname',
    ];
    for (const key of byNamePriority) {
      const f = getFieldByKey(key);
      let v = readWithFallback(order, f, key);
      if (!v && typeof order?.[key] === 'object') v = joinName(order?.[key]);
      if (typeof v === 'string' && v.trim() && !looksLikeUuid(v)) return v.trim();
    }

    // 2) Common nested objects (profiles)
    const nestedObjs = [
      order?.assigned_to_profile,
      order?.executor_profile,
      order?.assignee_profile,
      order?.assigned_user,
      order?.executor_user,
      order?.worker_user,
      order?.assigned_to_user,
    ].filter(Boolean);
    for (const obj of nestedObjs) {
      const n = joinName(obj);
      if (n) return n;
      // sometimes name is inside "user" level deeper
      if (obj.user) {
        const nn = joinName(obj.user);
        if (nn) return nn;
      }
    }

    // 3) Pair fields like first_name + last_name
    const pairs = [
      [order?.assigned_to_first_name, order?.assigned_to_last_name],
      [order?.executor_first_name, order?.executor_last_name],
      [order?.assignee_first_name, order?.assignee_last_name],
      [order?.worker_first_name, order?.worker_last_name],
    ];
    for (const [fn, ln] of pairs) {
      const name = [fn, ln].filter(Boolean).join(' ').trim();
      if (name) return name;
    }

    // 4) ID-based lookup via users_map
    if (order?.users_map) {
      const idKeys = [
        'assigned_to',
        'executor',
        'assignee',
        'worker',
        'responsible',
        'assigned_user_id',
        'executor_id',
      ];
      for (const idKey of idKeys) {
        const idVal = order?.[idKey];
        const mapped = typeof idVal === 'string' ? order.users_map[idVal] : null;
        if (mapped && typeof mapped === 'string' && mapped.trim()) return mapped.trim();
      }
    }

    // 5) Direct object in "assigned_to"/"executor"/etc. with name fields
    const dirKeys = ['assigned_to', 'executor', 'assignee', 'worker', 'responsible'];
    for (const k of dirKeys) {
      const obj = order?.[k];
      if (obj && typeof obj === 'object') {
        const n = joinName(obj);
        if (n) return n;
        const alt = [obj.display_name, obj.displayName, obj.username, obj.email].find(Boolean);
        if (typeof alt === 'string' && alt.trim()) return alt.trim();
      } else if (typeof obj === 'string' && obj.trim() && !looksLikeUuid(obj)) {
        return obj.trim();
      }
    }

    // 6) Email/username fallbacks
    const emailLike =
      order?.assigned_to_email ||
      order?.executor_email ||
      order?.assignee_email ||
      order?.assigned_to_login ||
      order?.executor_login;
    if (typeof emailLike === 'string' && emailLike.trim()) return emailLike.trim();

    // 7) As a last resort, scan all keys for "*name" near executor/assigned context
    try {
      const entries = Object.entries(order || {});
      for (const [k, v] of entries) {
        const lk = String(k).toLowerCase();
        if (
          (lk.includes('executor') ||
            lk.includes('assign') ||
            lk.includes('worker') ||
            lk.includes('responsible')) &&
          lk.includes('name')
        ) {
          if (typeof v === 'string' && v.trim() && !looksLikeUuid(v)) return v.trim();
          if (typeof v === 'object') {
            const n = joinName(v);
            if (n) return n;
          }
        }
      }
    } catch {}

    return '';
  }, [order, getFieldByKey]);

  // Bottom date (footer only)
  const bottomDateIso = useMemo(() => {
    const keys = ['datetime', 'date', 'start_at'];
    for (const k of keys) {
      const f = getFieldByKey(k);
      const v = readWithFallback(order, f, k);
      if (v) return v;
    }
    return null;
  }, [order, getFieldByKey]);

  // Context-driven visibility
  const roleRaw = (
    viewerRole ||
    order?.viewerRole ||
    order?.current_user_role ||
    order?.role ||
    settings?.role ||
    settings?.currentRole ||
    ''
  )
    .toString()
    .toLowerCase();
  const isAdminOrDispatcher = roleRaw === 'admin' || roleRaw === 'dispatcher';
  let showExecutor = false;
  if (context === 'my_orders') {
    showExecutor = false;
  } else if (context === 'calendar') {
    // If role is unknown, default to showing executor to avoid hiding useful info
    showExecutor = isAdminOrDispatcher || roleRaw === '';
  } else {
    showExecutor = true; // all_orders, order_card, etc.
  }
  const showDate = context !== 'calendar' && !!bottomDateIso;
  const showUrgentDot = !!order?.urgent;

  // Title
  const title =
    readWithFallback(order, getFieldByKey('title'), 'title') ||
    order?.title ||
    order?.city ||
    order?.id;

  // Resolve missing executor via Supabase (same logic as in order-details)
  const initialExecCached =
    (order?.assigned_to && EXECUTOR_NAME_CACHE.get(order.assigned_to)) || '';
  const [resolvedExecutorName, setResolvedExecutorName] = React.useState(initialExecCached);
  React.useEffect(() => {
    if (!showExecutor) return;
    // if local detection already found a name — sync and stop
    if (executorName && executorName.trim()) {
      setResolvedExecutorName(executorName.trim());
      return;
    }
    const uid = order?.assigned_to;
    if (!uid || typeof uid !== 'string') {
      setResolvedExecutorName('');
      return;
    }
    const cached = EXECUTOR_NAME_CACHE.get(uid);
    if (typeof cached === 'string') {
      setResolvedExecutorName(cached);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('first_name, last_name')
          .eq('id', uid)
          .single();
        if (!cancelled && !error && data) {
          const full = `${data.first_name || ''} ${data.last_name || ''}`.trim();
          EXECUTOR_NAME_CACHE.set(uid, full);
          setResolvedExecutorName(full);
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [order?.assigned_to, executorName, showExecutor]);

  /* ===== Render ===== */
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={{
        backgroundColor: theme.colors.card,
        borderRadius: 14,
        padding: 16,
        marginHorizontal: 0,
        alignSelf: 'stretch',
        width: '100%',
        marginVertical: 8,
        shadowColor: theme.mode === 'dark' ? '#000' : '#000',
        shadowOpacity: theme.mode === 'dark' ? 0.25 : 0.05,
        shadowRadius: 4,
        elevation: 1,
      }}
    >
      {/* Header: title + status pill */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text
          numberOfLines={1}
          style={{
            fontSize: 16,
            fontWeight: '600',
            color: theme.colors.text,
            flex: 1,
            paddingRight: 8,
          }}
        >
          {title || '—'}
        </Text>
        {statusBadge && (
          <View
            style={{
              backgroundColor: statusBadge.bg,
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 6,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: '700',
                letterSpacing: 0.3,
                color: statusBadge.text,
              }}
            >
              {statusBadge.title}
            </Text>
          </View>
        )}
      </View>

      {/* Details under title (no datetime here) */}
      <View style={{ gap: 2, marginTop: 4, marginBottom: 6 }}>
        {primaryRows.map((row) => (
          <Text
            key={row.key}
            numberOfLines={1}
            style={{ fontSize: 14, color: theme.text.muted.color }}
          >
            {row.label ? `${row.label}: ` : ''}
            <Text style={{ color: theme.colors.text }}>{row.value || '—'}</Text>
          </Text>
        ))}
      </View>

      {/* Footer line */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 6,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {showUrgentDot && (
            <View
              style={{
                width: 18,
                height: 18,
                borderRadius: 9,
                backgroundColor: '#FF3B30',
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 6,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', lineHeight: 12 }}>
                с
              </Text>
            </View>
          )}
          {showDate ? (
            <Text numberOfLines={1} style={{ fontSize: 13, color: theme.text.muted.color }}>
              {formatDateShort(bottomDateIso)}
            </Text>
          ) : null}
        </View>

        {showExecutor ? (
          <Text numberOfLines={1} style={{ fontSize: 13, color: theme.text.muted.color }}>
            {resolvedExecutorName || executorName || '—'}
          </Text>
        ) : (
          <View style={{ width: 1, height: 1 }} />
        )}
      </View>
    </TouchableOpacity>
  );
}
