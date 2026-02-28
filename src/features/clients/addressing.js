export const CLIENT_PRIMARY_ADDRESS_LABEL = 'Основной адрес';

export const CLIENT_ADDRESS_FIELDS = [
  'country',
  'region',
  'city',
  'street',
  'house',
  'postal_code',
  'building',
  'floor',
  'entrance',
  'apartment',
  'intercom',
  'entrance_info',
  'parking_notes',
  'geo_lat',
  'geo_lng',
];

export function createEmptyClientAddressDraft(overrides = {}) {
  return {
    label: CLIENT_PRIMARY_ADDRESS_LABEL,
    country: '',
    region: '',
    city: '',
    street: '',
    house: '',
    postal_code: '',
    building: '',
    floor: '',
    entrance: '',
    apartment: '',
    intercom: '',
    entrance_info: '',
    parking_notes: '',
    geo_lat: '',
    geo_lng: '',
    ...overrides,
  };
}

export function normalizeClientAddress(row) {
  if (!row || typeof row !== 'object') return null;
  const normalized = {
    ...row,
    id: row.id ? String(row.id) : null,
    client_id: row.client_id ? String(row.client_id) : null,
    company_id: row.company_id ? String(row.company_id) : null,
    label: String(row.label || '').trim() || CLIENT_PRIMARY_ADDRESS_LABEL,
    is_primary: !!row.is_primary,
  };
  CLIENT_ADDRESS_FIELDS.forEach((field) => {
    normalized[field] = String(row[field] || '').trim();
  });
  return normalized;
}

export function buildClientAddressSummary(address) {
  if (!address || typeof address !== 'object') return '';
  const parts = [
    address.country,
    address.region,
    address.city,
    address.street,
    address.house,
    address.building,
    address.entrance,
    address.apartment,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return parts.join(', ').trim();
}

export function sanitizeClientAddressPayload(draft, { labelRequired = true } = {}) {
  const next = {};
  const cleanLabel = String(draft?.label || '').trim();
  next.label = cleanLabel || (labelRequired ? CLIENT_PRIMARY_ADDRESS_LABEL : '');
  CLIENT_ADDRESS_FIELDS.forEach((field) => {
    next[field] = String(draft?.[field] || '').trim() || null;
  });
  return next;
}

export function getOrderAddressPayloadFromClientAddress(address) {
  const next = {};
  CLIENT_ADDRESS_FIELDS.forEach((field) => {
    next[field] = String(address?.[field] || '').trim();
  });
  return next;
}

export function getClientAddressDraftFromOrder(orderLike = {}, overrides = {}) {
  const next = createEmptyClientAddressDraft(overrides);
  CLIENT_ADDRESS_FIELDS.forEach((field) => {
    next[field] = String(orderLike?.[field] || '').trim();
  });
  return next;
}

export function hasClientAddressContent(address) {
  return CLIENT_ADDRESS_FIELDS.some((field) => String(address?.[field] || '').trim());
}
