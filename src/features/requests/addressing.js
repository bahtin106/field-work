import { buildAddressForNavigator } from '../../../components/ui/map';

import { t as T } from '../../i18n';

export const ORDER_ADDRESS_MODE = Object.freeze({
  OBJECT: 'object',
  CUSTOM: 'custom',
});

export const ORDER_ADDRESS_FIELDS = Object.freeze([
  'country',
  'region',
  'district',
  'city',
  'street',
  'house',
  'postal_code',
  'floor',
  'entrance',
  'apartment',
  'comment',
  'entrance_info',
  'geo_lat',
  'geo_lng',
]);
export const ORDER_LOCATION_MODE_FIELD = 'location_mode';
const ORDER_ADDRESS_OBJECT_FIELD_KEY_MAP = Object.freeze({
  comment: 'comment',
  entrance_info: 'comment',
});

export function normalizeOrderAddressMode(value) {
  return String(value || '').trim().toLowerCase() === ORDER_ADDRESS_MODE.OBJECT
    ? ORDER_ADDRESS_MODE.OBJECT
    : ORDER_ADDRESS_MODE.CUSTOM;
}

export function extractOrderAddress(source) {
  const result = {};
  for (const field of ORDER_ADDRESS_FIELDS) {
    const normalized = String(source?.[field] ?? '').trim();
    result[field] = normalized || '';
  }
  result.apartment = String(source?.apartment ?? result.apartment ?? '').trim();
  // An order's `comment` is its description, while `entrance_info` contains
  // address-specific entry instructions. They must remain independent when an
  // existing order is hydrated and saved again.
  result.comment = String(source?.comment ?? '').trim();
  result.entrance_info = String(source?.entrance_info ?? '').trim();
  const explicitLocationMode = String(source?.[ORDER_LOCATION_MODE_FIELD] || '').trim().toLowerCase();
  result[ORDER_LOCATION_MODE_FIELD] =
    explicitLocationMode === 'map' || explicitLocationMode === 'address'
      ? explicitLocationMode
      : result.geo_lat && result.geo_lng
        ? 'map'
        : 'address';
  return result;
}

export function extractOrderAddressFromObject(objectItem) {
  const source = objectItem || {};
  const entryInstructions = String(source?.comment ?? source?.entrance_info ?? '').trim();
  return extractOrderAddress({
    ...source,
    apartment: source?.apartment || '',
    comment: entryInstructions,
    entrance_info: entryInstructions,
  });
}

export function getObjectFieldKeyForOrderAddressField(fieldKey) {
  const normalized = String(fieldKey || '').trim();
  if (!normalized) return '';
  return ORDER_ADDRESS_OBJECT_FIELD_KEY_MAP[normalized] || normalized;
}

export function filterOrderAddressByObjectFieldSettings(address, objectFieldsByKey, options = {}) {
  const normalized = extractOrderAddress(address || {});
  const preserveFilledDisabled = options?.preserveFilledDisabled === true;
  const result = {};
  for (const field of ORDER_ADDRESS_FIELDS) {
    const settingsFieldKey = getObjectFieldKeyForOrderAddressField(field);
    const value = String(normalized[field] || '').trim();
    const isEnabled = objectFieldsByKey?.get(settingsFieldKey)?.isEnabled === true;
    if (!isEnabled && !(preserveFilledDisabled && value)) continue;
    result[field] = value;
  }
  if (
    objectFieldsByKey?.get('comment')?.isEnabled === true ||
    (preserveFilledDisabled && String(result.comment || result.entrance_info || '').trim())
  ) {
    const comment = String(result.comment || result.entrance_info || '').trim();
    result.comment = comment;
    result.entrance_info = comment;
  }
  result[ORDER_LOCATION_MODE_FIELD] = normalized[ORDER_LOCATION_MODE_FIELD];
  return result;
}

export function toOrderAddressPatch(address) {
  const patch = {};
  for (const field of ORDER_ADDRESS_FIELDS) {
    // `comment` is the order description and is saved separately by order
    // forms. Only `entrance_info` belongs to the persisted address snapshot.
    if (field === 'comment') continue;
    const normalized = String(address?.[field] ?? '').trim();
    patch[field] = normalized || null;
  }
  return patch;
}

export function buildOrderAddressShort(address) {
  return [address?.city, address?.street, address?.house].filter(Boolean).join(', ').trim();
}

export function buildOrderAddressDisplay(address) {
  const normalized = address || {};
  const parts = [
    normalized.postal_code,
    normalized.country,
    normalized.region,
    normalized.district,
    normalized.city,
    normalized.street ? `${T('address_part_street_prefix')} ${String(normalized.street).trim()}` : '',
    normalized.house ? `${T('address_part_house_prefix')} ${String(normalized.house).trim()}` : '',
    normalized.apartment ? `${T('address_part_apartment_prefix')} ${String(normalized.apartment).trim()}` : '',
    normalized.entrance ? `${T('address_part_entrance_prefix')} ${String(normalized.entrance).trim()}` : '',
    normalized.floor ? `${T('address_part_floor_prefix')} ${String(normalized.floor).trim()}` : '',
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return parts.join(', ').trim();
}

export function buildOrderAddressNavigatorQuery(address) {
  return buildAddressForNavigator(address || {});
}

export function hasOrderAddressValue(address) {
  return ORDER_ADDRESS_FIELDS.some((field) => String(address?.[field] ?? '').trim().length > 0);
}
