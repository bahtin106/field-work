import { buildAddressForNavigator } from '../../../components/ui/map';

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

export function normalizeOrderAddressMode(value) {
  return String(value || '').trim().toLowerCase() === ORDER_ADDRESS_MODE.CUSTOM
    ? ORDER_ADDRESS_MODE.CUSTOM
    : ORDER_ADDRESS_MODE.OBJECT;
}

export function extractOrderAddress(source) {
  const result = {};
  for (const field of ORDER_ADDRESS_FIELDS) {
    const normalized = String(source?.[field] ?? '').trim();
    result[field] = normalized || '';
  }
  result.apartment = String(source?.apartment ?? source?.office ?? result.apartment ?? '').trim();
  result.comment = String(source?.comment ?? source?.entrance_info ?? result.comment ?? '').trim();
  result.entrance_info = result.comment;
  result[ORDER_LOCATION_MODE_FIELD] =
    String(source?.[ORDER_LOCATION_MODE_FIELD] || '').trim().toLowerCase() === 'map'
      ? 'map'
      : result.geo_lat && result.geo_lng
        ? 'map'
        : 'address';
  return result;
}

export function extractOrderAddressFromObject(objectItem) {
  const source = objectItem || {};
  return extractOrderAddress({
    ...source,
    apartment: source?.apartment || source?.office || '',
    comment: source?.comment || source?.entrance_info || '',
  });
}

export function toOrderAddressPatch(address) {
  const patch = {};
  for (const field of ORDER_ADDRESS_FIELDS) {
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
    normalized.street ? `ул. ${String(normalized.street).trim()}` : '',
    normalized.house ? `д. ${String(normalized.house).trim()}` : '',
    normalized.apartment ? `кв. ${String(normalized.apartment).trim()}` : '',
    normalized.entrance ? `подъезд ${String(normalized.entrance).trim()}` : '',
    normalized.floor ? `этаж ${String(normalized.floor).trim()}` : '',
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
