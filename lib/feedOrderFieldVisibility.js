import { getOrderStatusVariant } from '../src/features/orders/statusPresentation';
import {
  applyCompanySettingsCachePatch,
  broadcastCompanySettingsChanged,
  COMPANY_SETTINGS_QUERY_KEY,
} from './companySettingsQuery';
import { supabase } from './supabase';

export const FEED_ORDER_FIELD_KEYS = Object.freeze({
  CUSTOMER_NAME: 'customer_name',
  ADDRESS: 'address',
  PHONE: 'phone',
  DEPARTURE_TIME: 'departure_time',
  FINANCE: 'finance',
});

export const FEED_ORDER_FIELD_OPTIONS = Object.freeze([
  { key: FEED_ORDER_FIELD_KEYS.CUSTOMER_NAME, labelKey: 'feed_fields_customer' },
  { key: FEED_ORDER_FIELD_KEYS.ADDRESS, labelKey: 'feed_fields_address' },
  { key: FEED_ORDER_FIELD_KEYS.PHONE, labelKey: 'feed_fields_phone' },
  { key: FEED_ORDER_FIELD_KEYS.DEPARTURE_TIME, labelKey: 'feed_fields_departure_time' },
  { key: FEED_ORDER_FIELD_KEYS.FINANCE, labelKey: 'feed_fields_finance' },
]);

export const ALL_FEED_ORDER_FIELDS = Object.freeze(FEED_ORDER_FIELD_OPTIONS.map((item) => item.key));

export const DEFAULT_FEED_ORDER_FIELDS = Object.freeze([
  FEED_ORDER_FIELD_KEYS.CUSTOMER_NAME,
  FEED_ORDER_FIELD_KEYS.ADDRESS,
  FEED_ORDER_FIELD_KEYS.DEPARTURE_TIME,
  FEED_ORDER_FIELD_KEYS.FINANCE,
]);

const ALLOWED_FEED_ORDER_FIELDS = new Set(FEED_ORDER_FIELD_OPTIONS.map((item) => item.key));
const LEGACY_FEED_ORDER_FIELDS = new Set(['title', 'assigned_to_name']);
const LEGACY_ALWAYS_VISIBLE_FIELDS = [
  FEED_ORDER_FIELD_KEYS.DEPARTURE_TIME,
  FEED_ORDER_FIELD_KEYS.FINANCE,
];

export function normalizeFeedOrderFields(value) {
  const hasExplicitValue = Array.isArray(value);
  const source = hasExplicitValue ? value : DEFAULT_FEED_ORDER_FIELDS;
  const rawKeys = source
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const hasLegacyKeys = rawKeys.some((key) => LEGACY_FEED_ORDER_FIELDS.has(key));
  const next = [];

  for (const key of rawKeys) {
    if (!ALLOWED_FEED_ORDER_FIELDS.has(key) || next.includes(key)) continue;
    next.push(key);
  }

  if (!hasExplicitValue) {
    return [...DEFAULT_FEED_ORDER_FIELDS];
  }

  if (hasLegacyKeys) {
    for (const key of LEGACY_ALWAYS_VISIBLE_FIELDS) {
      if (!next.includes(key)) next.push(key);
    }
  }

  return next;
}

export async function saveFeedOrderFieldVisibility(companyId, fields, queryClient = null) {
  const id = String(companyId || '').trim();
  if (!id) throw new Error('company_id_required');

  const patch = { feed_order_card_fields: normalizeFeedOrderFields(fields) };
  const { error } = await supabase
    .from('companies')
    .update(patch)
    .eq('id', id);
  if (error) throw error;

  applyCompanySettingsCachePatch(queryClient, id, patch);
  await broadcastCompanySettingsChanged(id, Object.keys(patch));
  await queryClient?.invalidateQueries?.({
    queryKey: COMPANY_SETTINGS_QUERY_KEY,
    refetchType: 'active',
  });

  return patch.feed_order_card_fields;
}

export function isFeedOrder(orderOrStatus) {
  const status =
    orderOrStatus && typeof orderOrStatus === 'object'
      ? orderOrStatus.status
      : orderOrStatus;
  return getOrderStatusVariant(status) === 'feed';
}

export function shouldApplyFeedOrderFieldVisibilityForRole(role) {
  return String(role || '').trim().toLowerCase() === 'worker';
}

export function getFeedOrderFieldsForRole(settings, role) {
  if (!shouldApplyFeedOrderFieldVisibilityForRole(role)) {
    return [...ALL_FEED_ORDER_FIELDS];
  }
  return normalizeFeedOrderFields(settings?.feed_order_card_fields);
}

export function isFeedOrderFieldVisible(settings, fieldKey, order = null, role = null) {
  if (order && !isFeedOrder(order)) return true;
  const normalizedKey = String(fieldKey || '').trim();
  if (!ALLOWED_FEED_ORDER_FIELDS.has(normalizedKey)) return true;
  if (!shouldApplyFeedOrderFieldVisibilityForRole(role)) return true;
  return normalizeFeedOrderFields(settings?.feed_order_card_fields).includes(normalizedKey);
}
