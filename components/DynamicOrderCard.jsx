import React, { memo, useCallback, useMemo, useRef } from 'react';
import { Platform, Text, TouchableOpacity, View } from 'react-native';

import { formatCurrency } from '../lib/currency';
import { readValueFromOrder } from '../lib/settings';
import { supabase } from '../lib/supabase';
import { resolveRequestTitle } from '../src/features/requests/title';
import { useTranslation } from '../src/i18n/useTranslation';
import {
  hasClientObjectMapPoint,
  normalizeClientObjectLocationMode,
} from '../src/features/objects/addressing';
import OrderStatusCapsule from './ui/OrderStatusCapsule';
import { useTheme } from '../theme/ThemeProvider';

/* ===== Utils ===== */

/* ===== Name cache for executor (avoid N requests in lists) ===== */
const EXECUTOR_NAME_CACHE = (globalThis.EXECUTOR_NAME_CACHE ||= new Map());
const EXECUTOR_NAME_INFLIGHT = (globalThis.EXECUTOR_NAME_INFLIGHT ||= new Map());
const EXECUTOR_NAME_CACHE_MAX_ENTRIES = 300;
const CARD_PRESS_GUARD_MS = 250;

function getCachedExecutorName(userId) {
  if (!userId || !EXECUTOR_NAME_CACHE.has(userId)) return '';
  const value = EXECUTOR_NAME_CACHE.get(userId);
  EXECUTOR_NAME_CACHE.delete(userId);
  EXECUTOR_NAME_CACHE.set(userId, value);
  return typeof value === 'string' ? value : '';
}

function setCachedExecutorName(userId, displayName) {
  if (!userId) return;
  const value = String(displayName || '').trim();
  EXECUTOR_NAME_CACHE.delete(userId);
  EXECUTOR_NAME_CACHE.set(userId, value);
  while (EXECUTOR_NAME_CACHE.size > EXECUTOR_NAME_CACHE_MAX_ENTRIES) {
    const oldestKey = EXECUTOR_NAME_CACHE.keys().next()?.value;
    if (oldestKey == null) break;
    EXECUTOR_NAME_CACHE.delete(oldestKey);
  }
}

async function fetchExecutorNameById(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return '';
  const cached = getCachedExecutorName(uid);
  if (cached) return cached;
  if (EXECUTOR_NAME_INFLIGHT.has(uid)) {
    return EXECUTOR_NAME_INFLIGHT.get(uid);
  }

  const runner = (async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('first_name, middle_name, last_name')
        .eq('id', uid)
        .single();
      if (error || !data) return '';
      const full = `${data.first_name || ''} ${data.middle_name || ''} ${data.last_name || ''}`.trim();
      if (full) setCachedExecutorName(uid, full);
      return full;
    } catch {
      return '';
    } finally {
      EXECUTOR_NAME_INFLIGHT.delete(uid);
    }
  })();

  EXECUTOR_NAME_INFLIGHT.set(uid, runner);
  return runner;
}

const PRIMARY_ROW_LABEL_KEYS = {
  customer_name: 'order_details_customer',
  address: 'order_details_address',
  time_window_start: 'order_details_departure_date',
};

function formatDateShort(iso, showTime = true) {
  if (!iso) return '';
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).formatToParts(d);
  const day = parts.find((p) => p.type === 'day')?.value || String(d.getDate());
  const month = parts.find((p) => p.type === 'month')?.value || '';
  const year = parts.find((p) => p.type === 'year')?.value || String(d.getFullYear());
  const dateStr = `${day} ${month} ${year}`;
  if (showTime) {
    return `${dateStr}, ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  }
  return dateStr;
}

function hasExplicitDepartureTime(order) {
  if (!order) return false;
  if (typeof order?.departure_time === 'string' && order.departure_time.trim()) return true;
  const raw = order?.time_window_start;
  if (!raw) return false;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed?.getTime?.())) return false;
  return parsed.getHours() !== 0 || parsed.getMinutes() !== 0;
}

function parseDepartureTime(order) {
  const raw = String(order?.departure_time || '').trim();
  if (raw) {
    const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (match) {
      const hh = Number(match[1]);
      const mm = Number(match[2]);
      if (Number.isFinite(hh) && Number.isFinite(mm) && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
        return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      }
    }
  }
  const startRaw = order?.time_window_start;
  if (!startRaw) return '';
  const parsed = new Date(startRaw);
  if (Number.isNaN(parsed?.getTime?.())) return '';
  const hh = parsed.getHours();
  const mm = parsed.getMinutes();
  if (hh === 0 && mm === 0) return '';
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
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
    [obj.first_name, obj.middle_name, obj.last_name].filter(Boolean).join(' '),
    [obj.first_name, obj.middle_name, obj.surname].filter(Boolean).join(' '),
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
    const locationMode = normalizeClientObjectLocationMode(order?.object_location_mode || order?.location_mode, {
      fallback: hasClientObjectMapPoint(order) ? 'map' : 'address',
    });
    if (locationMode === 'map' && hasClientObjectMapPoint(order)) {
      return '__MAP_POINT__';
    }
    if (String(order?.address_mode || '').trim().toLowerCase() === 'custom') {
      return '';
    }
    // Формируем адрес компактно: пропускаем область/район, показываем город,
    // улицу без приставки "ул."/"улица" и номер дома.
    const city = order?.city || order?.town || order?.settlement || null;
    const rawStreet = order?.street || order?.snt || null;
    const street =
      typeof rawStreet === 'string' ? rawStreet.replace(/^\s*(ул\.?|улица)\s+/i, '') : rawStreet;
    const house = order?.house || order?.plot || null;
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

function mapInputKindToLegacyType(inputKind) {
  switch (String(inputKind || '')) {
    case 'multiline':
      return 'textarea';
    case 'relation':
      return 'select';
    case 'media':
      return 'file';
    default:
      return String(inputKind || 'text');
  }
}

function DynamicOrderCard({
  order,
  context = 'all_orders', // 'all_orders' | 'my_orders' | 'calendar' | 'order_card'
  hideExecutor = false,
  onPress,
  viewerRole, // 'admin' | 'dispatcher' | 'worker' (optional)
  departureTimeEnabled, // optional explicit flag from order field settings
  orderFieldsByKey = null, // Map<fieldKey, normalized entity field>
  companyCurrency = null, // optional currency from parent screen
}) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const lastPressAtRef = useRef(0);

  const getFieldByKey = useCallback(
    (key) => {
      const field = orderFieldsByKey?.get?.(String(key || ''));
      if (!field) return null;
      return {
        field_key: String(key || ''),
        label: field.customLabel || t(field.labelKey, field.fallbackLabel || String(key || '')),
        type: mapInputKindToLegacyType(field.inputKind),
        required: field.isRequired === true,
        storage_target: 'builtin',
      };
    },
    [orderFieldsByKey, t],
  );

  const isFieldEnabledBySettings = useCallback(
    (fieldKey) => {
      const field = orderFieldsByKey?.get?.(String(fieldKey || ''));
      if (!field) return true;
      return field.isEnabled !== false;
    },
    [orderFieldsByKey],
  );
  const handlePress = useCallback(() => {
    const now = Date.now();
    if (now - lastPressAtRef.current < CARD_PRESS_GUARD_MS) return;
    lastPressAtRef.current = now;
    if (typeof onPress === 'function') {
      onPress(order?.id, order);
    }
  }, [onPress, order]);

  // Keep stable defaults for card layout.
  const preset = useMemo(
    () => ({
      fields: ['title', 'customer_name', 'address'],
      pills: ['status'],
      secondary: ['assigned_to_name'],
    }),
    [],
  );

  const fields = useMemo(() => preset.fields, [preset.fields]);
  const pills = useMemo(() => preset.pills, [preset.pills]);
  const hasOrderFieldValue = useCallback(
    (fieldKey, fallbackValue = null) => {
      const direct = fallbackValue;
      if (direct !== null && direct !== undefined && String(direct).trim().length > 0) return true;
      const key = String(fieldKey || '').trim();
      if (!key) return false;
      if (key === 'customer_name') {
        return [
          order?.customer_name,
          order?.customerName,
          order?.customer_full_name,
          order?.client_name,
          order?.clientName,
          order?.fio,
        ].some((value) => String(value || '').trim().length > 0);
      }
      if (key === 'address') {
        const locationMode = normalizeClientObjectLocationMode(order?.object_location_mode || order?.location_mode, {
          fallback: hasClientObjectMapPoint(order) ? 'map' : 'address',
        });
        if (locationMode === 'map' && hasClientObjectMapPoint(order)) return true;
        if (String(order?.address_mode || '').trim().toLowerCase() === 'custom') return false;
        const city = order?.city || order?.town || order?.settlement || '';
        const street = order?.street || order?.snt || '';
        const house = order?.house || order?.plot || '';
        return [order?.address, order?.addr, city, street, house].some(
          (value) => String(value || '').trim().length > 0,
        );
      }
      if (key === 'departure_time') return hasExplicitDepartureTime(order);
      if (key === 'start_price') {
        return (
          order?.start_price !== null &&
          order?.start_price !== undefined &&
          String(order?.start_price).trim().length > 0
        );
      }
      return String(order?.[key] || '').trim().length > 0;
    },
    [order],
  );
  const isCardFieldVisible = useCallback(
    (fieldKey) => {
      return isFieldEnabledBySettings(fieldKey) || hasOrderFieldValue(fieldKey);
    },
    [hasOrderFieldValue, isFieldEnabledBySettings],
  );

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
            : PRIMARY_ROW_LABEL_KEYS[key]
              ? t(key === 'address' ? 'order_details_address' : PRIMARY_ROW_LABEL_KEYS[key])
              : (field?.label ?? key);
        if (key === 'address' && value === '__MAP_POINT__') {
          value = t('order_address_point_on_map', 'точка на карте');
        }
        if (key === 'address' && !value) {
          value = t('order_details_address_not_specified');
        }
        const visibleBySettings = isCardFieldVisible(key);
        const hasValue = hasOrderFieldValue(key, value);
        return { key, label, value, visibleBySettings, hasValue };
      })
      .filter((r) => r.key !== 'title' && (r.visibleBySettings || r.hasValue));
  }, [fields, order, getFieldByKey, hasOrderFieldValue, isCardFieldVisible, t]);

  // Status pill
  const statusTitle = useMemo(
    () => extractStatus(order, getFieldByKey, pills),
    [order, pills, getFieldByKey],
  );

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
    const triples = [
      [order?.assigned_to_first_name, order?.assigned_to_middle_name, order?.assigned_to_last_name],
      [order?.executor_first_name, order?.executor_middle_name, order?.executor_last_name],
      [order?.assignee_first_name, order?.assignee_middle_name, order?.assignee_last_name],
      [order?.worker_first_name, order?.worker_middle_name, order?.worker_last_name],
    ];
    for (const [fn, mn, ln] of triples) {
      const name = [fn, mn, ln].filter(Boolean).join(' ').trim();
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
    const f = getFieldByKey?.('start_price');
    let v = readWithFallback(order, f, 'start_price');
    if (v == null || v === '') {
      v = order?.start_price ?? order?.total_price ?? order?.amount ?? null;
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

  const showDepartureTime = useMemo(() => {
    const explicitTime = hasExplicitDepartureTime(order);
    if (typeof departureTimeEnabled === 'boolean') {
      if (departureTimeEnabled) return explicitTime;
      return hasOrderFieldValue('departure_time');
    }
    const hasField = !!getFieldByKey?.('departure_time');
    if (!hasField) return explicitTime;
    return isCardFieldVisible('departure_time') && explicitTime;
  }, [departureTimeEnabled, getFieldByKey, hasOrderFieldValue, isCardFieldVisible, order]);

  // Time string derived from bottomDateIso (used in calendar context)
  const bottomTimeStr = useMemo(() => {
    if (!showDepartureTime) return '';
    return parseDepartureTime(order);
  }, [order, showDepartureTime]);

  // Context-driven visibility
  const roleRaw = (
    viewerRole ||
    order?.viewerRole ||
    order?.current_user_role ||
    order?.role ||
    ''
  )
    .toString()
    .toLowerCase();
  const isAdminOrDispatcher = roleRaw === 'admin' || roleRaw === 'dispatcher';
  let showExecutor = false;
  if (context === 'my_orders') {
    showExecutor = true;
  } else if (context === 'calendar') {
    showExecutor = isAdminOrDispatcher || roleRaw === '';
  } else {
    showExecutor = true;
  }
  if (hideExecutor) {
    showExecutor = false;
  }
  const showDate = context !== 'calendar' && !!bottomDateIso;
  const showUrgentDot = !!order?.urgent;

  // Title
  const title = resolveRequestTitle(
    readWithFallback(order, getFieldByKey('title'), 'title') || order,
    {
      fallbackDate: order?.time_window_start || order?.created_at,
      prefix: t('order_auto_title_prefix', 'Заявка от'),
    },
  );

  // Resolve missing executor via Supabase
  const initialExecCached = getCachedExecutorName(order?.assigned_to);
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
    const cached = getCachedExecutorName(uid);
    if (cached) {
      setResolvedExecutorName(cached);
      return;
    }
    let cancelled = false;
    (async () => {
      const full = await fetchExecutorNameById(uid);
      if (!cancelled && full) {
          setResolvedExecutorName(full);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [order?.assigned_to, executorName, showExecutor]);

  const mutedColor = theme?.text?.muted?.color ?? theme?.colors?.muted ?? '#8E8E93';
  const spacing = theme?.spacing || {};
  const cardPadding = spacing.md ?? 16;
  const rowGap = spacing.xs ?? 6;
  const titleRightGap = spacing.xs ?? 8;
  const showPrice =
    (isCardFieldVisible('start_price') || hasOrderFieldValue('start_price', priceValue)) &&
    priceValue !== null &&
    priceValue !== undefined &&
    String(priceValue).trim().length > 0;
  const priceText = showPrice ? formatPrice(priceValue, order?.currency || companyCurrency || 'RUB') : '';
  const footerLeftText =
    context === 'calendar' && bottomTimeStr
      ? bottomTimeStr
      : showDate
        ? formatDateShort(bottomDateIso, showDepartureTime)
        : '';
  const footerRightText = showExecutor ? String(resolvedExecutorName || executorName || '').trim() : '';
  const footerRightTopText = showExecutor ? (priceText || ' ') : ' ';
  const footerRightBottomText = showExecutor ? (footerRightText || ' ') : (priceText || ' ');

  /* ===== Render ===== */
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      delayPressIn={0}
      delayPressOut={0}
      onPress={handlePress}
      style={{
        backgroundColor: theme.colors.card,
        borderRadius: 14,
        padding: cardPadding,
        minHeight: 132,
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
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          columnGap: rowGap,
        }}
      >
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{
            fontSize: 16,
            fontWeight: '600',
            color: theme.colors.text,
            flex: 1,
            minWidth: 0,
            paddingRight: titleRightGap,
          }}
        >
          {title || '—'}
        </Text>
        <OrderStatusCapsule
          status={statusTitle}
          style={{ maxWidth: '48%', flexShrink: 1 }}
          textStyle={{ flexShrink: 1 }}
        />
      </View>

      {/* Details under title (no datetime here) */}
      <View style={{ gap: 2, marginTop: rowGap, marginBottom: 0 }}>
        {primaryRows.map((row) => (
          <Text
            key={row.key}
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{ fontSize: 14, color: mutedColor, lineHeight: 20, minWidth: 0 }}
          >
            {row.label ? `${row.label}: ` : ''}
            <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: theme.colors.text }}>
              {row.value || '—'}
            </Text>
          </Text>
        ))}
      </View>

      {/* Footer line */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          marginTop: rowGap,
          gap: rowGap,
        }}
      >
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' }}>
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
                  width: '100%',
                  textAlign: 'center',
                  includeFontPadding: false,
                  textAlignVertical: 'center',
                }}
              >
                {t('order_urgent_short', 'с')}
              </Text>
            </View>
          )}
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{ flex: 1, minWidth: 0, fontSize: 13, color: mutedColor, lineHeight: 18 }}
          >
            {footerLeftText || ' '}
          </Text>
        </View>

        <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-end', justifyContent: 'flex-end' }}>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{ fontSize: 13, color: mutedColor, textAlign: 'right', width: '100%', lineHeight: 18 }}
          >
            {footerRightTopText}
          </Text>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{ fontSize: 13, color: mutedColor, textAlign: 'right', width: '100%', lineHeight: 18 }}
          >
            {footerRightBottomText}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function areCardPropsEqual(prev, next) {
  return (
    prev.order === next.order &&
    prev.context === next.context &&
    prev.viewerRole === next.viewerRole &&
    prev.departureTimeEnabled === next.departureTimeEnabled &&
    prev.hideExecutor === next.hideExecutor &&
    prev.orderFieldsByKey === next.orderFieldsByKey &&
    prev.companyCurrency === next.companyCurrency &&
    prev.onPress === next.onPress
  );
}

const MemoizedDynamicOrderCard = memo(DynamicOrderCard, areCardPropsEqual);
export default MemoizedDynamicOrderCard;









