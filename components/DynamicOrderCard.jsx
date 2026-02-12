import React, { memo, useMemo } from 'react';
import { Platform, Text, TouchableOpacity, View } from 'react-native';

import { useCompanySettings } from '../hooks/useCompanySettings';
import { formatCurrency } from '../lib/currency';
import { readValueFromOrder } from '../lib/settings';
import { supabase } from '../lib/supabase';
import { useSettings } from '../providers/SettingsProvider';
import { useTheme } from '../theme/ThemeProvider';

/* ===== Color helpers ===== */
function withAlpha(color, a) {
  if (typeof color === 'string') {
    const hex = color.match(/^#([0-9a-fA-F]{6})$/);
    if (hex) {
      const alpha = Math.round(Math.max(0, Math.min(1, a)) * 255)
        .toString(16)
        .padStart(2, '0');
      return color + alpha;
    }
    const rgb = color.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
    if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${a})`;
  }
  return `rgba(0,0,0,${a})`;
}

/* ===== Utils ===== */

/* ===== Name cache for executor (avoid N requests in lists) ===== */
const EXECUTOR_NAME_CACHE = (globalThis.EXECUTOR_NAME_CACHE ||= new Map());

const RUS_LABELS = {
  customer_name: 'Заказчик',
  address: 'Адрес',
  time_window_start: 'Дата выезда',
};

function formatDateShort(iso, showTime = true) {
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
  const dateStr = `${d.getDate()} ${months[d.getMonth()] || ''} ${d.getFullYear()}`;
  if (showTime) {
    return `${dateStr}, ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  }
  return dateStr;
}

function formatPrice(val, currency = 'RUB') {
  return formatCurrency(val, currency, 'ru-RU');
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
    // Формируем адрес компактно: пропускаем область/район, показываем город,
    // улицу без приставки "ул."/"улица" и номер дома.
    const city = order?.city || order?.town || order?.settlement || null;
    const rawStreet = order?.street || order?.snt || null;
    const street =
      typeof rawStreet === 'string' ? rawStreet.replace(/^\s*(ул\.?|улица)\s+/i, '') : rawStreet;
    const house = order?.house || order?.plot || order?.building || null;
    const composed = [city, street, house].filter(Boolean).join(', ');
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
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str))
    return true;
  return false;
}

function DynamicOrderCard({
  order,
  context = 'all_orders', // 'all_orders' | 'my_orders' | 'calendar' | 'order_card'
  onPress,
  viewerRole, // 'admin' | 'dispatcher' | 'worker' (optional)
}) {
  const settings = useSettings();
  const { presetsByContext, getFieldByKey } = settings;
  const { theme } = useTheme();
  const { settings: companySettings, useDepartureTime } = useCompanySettings();

  // Presets with safe defaults: exclude time_window_start from middle block
  const preset = useMemo(() => {
    const presetRaw = presetsByContext(context);
    return {
      fields:
        Array.isArray(presetRaw?.fields) && presetRaw.fields.length > 0
          ? presetRaw.fields.filter((k) => k !== 'time_window_start')
          : ['title', 'customer_name', 'address'],
      pills:
        Array.isArray(presetRaw?.pills) && presetRaw.pills.length > 0 ? presetRaw.pills : ['status'],
      secondary:
        Array.isArray(presetRaw?.secondary) && presetRaw.secondary.length > 0
          ? presetRaw.secondary
          : ['assigned_to_name'],
    };
  }, [context, presetsByContext]);

  const fields = useMemo(() => preset.fields, [preset.fields]);
  const pills = useMemo(() => preset.pills, [preset.pills]);

  // Primary rows
  const primaryRows = useMemo(() => {
    return fields
      .map((key) => {
        const field = getFieldByKey(key);
        let value = readWithFallback(order, field, key);
        if (key === 'phone') {
          if (order?.customer_phone_visible) value = order.customer_phone_visible;
          else if (order?.phone_is_visible) value = order.phone;
          else if (order?.customer_phone_masked) value = order.customer_phone_masked;
        }
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
    let color = theme.colors.primary;
    if (/лент/i.test(statusTitle)) {
      color = theme.colors.warning || theme.colors.primary;
    } else if (/заверш/i.test(statusTitle)) {
      color = theme.colors.textSecondary;
    } else if (/работ/i.test(statusTitle)) {
      color = theme.colors.success || theme.colors.primary;
    }
    return { title: statusTitle, bg: withAlpha(color, 0.14), text: color };
  }, [statusTitle, theme]);

  // Executor name (bottom-right)
  const executorName = useMemo(() => {
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
      if (obj.user) {
        const nn = joinName(obj.user);
        if (nn) return nn;
      }
    }
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
    const emailLike =
      order?.assigned_to_email ||
      order?.executor_email ||
      order?.assignee_email ||
      order?.assigned_to_login ||
      order?.executor_login;
    if (typeof emailLike === 'string' && emailLike.trim()) return emailLike.trim();

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

  // Price extraction: show price from field meta or common raw keys
  const priceValue = useMemo(() => {
    const f = getFieldByKey?.('price');
    let v = readWithFallback(order, f, 'price');
    if (v == null || v === '') {
      v = order?.price ?? order?.total_price ?? order?.amount ?? null;
    }
    return v;
  }, [order, getFieldByKey]);

  // Bottom date (footer only)
  const bottomDateIso = useMemo(() => {
    const keys = ['time_window_start', 'date', 'start_at'];
    for (const k of keys) {
      const f = getFieldByKey(k);
      const v = readWithFallback(order, f, k);
      if (v) return v;
    }
    return null;
  }, [order, getFieldByKey]);

  // Time string derived from bottomDateIso (used in calendar context)
  const bottomTimeStr = useMemo(() => {
    if (!useDepartureTime) return ''; // Время не показываем если настройка выключена
    try {
      if (!bottomDateIso) return '';
      const d = new Date(bottomDateIso);
      if (isNaN(d)) return '';
      return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }, [bottomDateIso, useDepartureTime]);

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
    showExecutor = isAdminOrDispatcher || roleRaw === '';
  } else {
    showExecutor = true;
  }
  const showDate = context !== 'calendar' && !!bottomDateIso;
  const showUrgentDot = !!order?.urgent;

  // Title
  const title =
    readWithFallback(order, getFieldByKey('title'), 'title') ||
    order?.title ||
    order?.city ||
    order?.id;

  // Resolve missing executor via Supabase
  const initialExecCached =
    (order?.assigned_to && EXECUTOR_NAME_CACHE.get(order.assigned_to)) || '';
  const [resolvedExecutorName, setResolvedExecutorName] = React.useState(initialExecCached);
  React.useEffect(() => {
    if (!showExecutor) return;
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

  const mutedColor = theme?.text?.muted?.color ?? theme?.colors?.muted ?? '#8E8E93';

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
        ...(context === 'calendar'
          ? {
              shadowColor: 'transparent',
              shadowOpacity: 0,
              shadowRadius: 0,
              elevation: 0,
            }
          : theme.shadows?.level1?.[Platform.OS] || {
              shadowColor: theme.colors.shadow || '#000',
              shadowOpacity: theme.mode === 'dark' ? 0.25 : 0.05,
              shadowRadius: 4,
              elevation: 1,
            }),
      }}
    >
      {/* Header */}
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
          <Text key={row.key} numberOfLines={1} style={{ fontSize: 14, color: mutedColor }}>
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
                backgroundColor: theme.colors.danger,
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 6,
              }}
            >
              <Text
                style={{
                  color: theme.colors.onPrimary,
                  fontSize: 12,
                  fontWeight: '700',
                  lineHeight: 12,
                }}
              >
                с
              </Text>
            </View>
          )}
          {context === 'calendar' && bottomTimeStr ? (
            <Text numberOfLines={1} style={{ fontSize: 13, color: mutedColor }}>
              {bottomTimeStr}
            </Text>
          ) : showDate ? (
            <Text numberOfLines={1} style={{ fontSize: 13, color: mutedColor }}>
              {formatDateShort(bottomDateIso, useDepartureTime)}
            </Text>
          ) : null}
        </View>

        {showExecutor ? (
          <Text numberOfLines={1} style={{ fontSize: 13, color: mutedColor }}>
            {resolvedExecutorName || executorName || '—'}
          </Text>
        ) : priceValue ? (
          <Text numberOfLines={1} style={{ fontSize: 13, color: mutedColor }}>
            {formatPrice(priceValue, order?.currency || companySettings?.currency || 'RUB')}
          </Text>
        ) : (
          <View style={{ width: 1, height: 1 }} />
        )}
      </View>
    </TouchableOpacity>
  );
}

function areCardPropsEqual(prev, next) {
  return (
    prev.order === next.order &&
    prev.context === next.context &&
    prev.viewerRole === next.viewerRole &&
    prev.onPress === next.onPress
  );
}

const MemoizedDynamicOrderCard = memo(DynamicOrderCard, areCardPropsEqual);
export default MemoizedDynamicOrderCard;
