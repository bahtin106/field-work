export const CLIENT_OBJECT_DEFAULT_NAME = 'Объект';

export const CLIENT_OBJECT_ADDRESS_FIELDS = [
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

export function createEmptyClientObjectDraft(overrides = {}) {
  return {
    name: CLIENT_OBJECT_DEFAULT_NAME,
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

export function buildClientObjectAddressSummary(objectLike) {
  if (!objectLike || typeof objectLike !== 'object') return '';
  const parts = [
    objectLike.country,
    objectLike.region,
    objectLike.city,
    objectLike.street,
    objectLike.house,
    objectLike.building,
    objectLike.entrance,
    objectLike.apartment,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return parts.join(', ').trim();
}

export function normalizeClientObject(row) {
  if (!row || typeof row !== 'object') return null;
  const normalized = {
    ...row,
    id: row.id ? String(row.id) : null,
    client_id: row.client_id ? String(row.client_id) : null,
    company_id: row.company_id ? String(row.company_id) : null,
    name: String(row.name || '').trim() || CLIENT_OBJECT_DEFAULT_NAME,
    is_primary: !!row.is_primary,
  };
  CLIENT_OBJECT_ADDRESS_FIELDS.forEach((field) => {
    normalized[field] = String(row[field] || '').trim();
  });
  normalized.summary =
    String(row.summary || '').trim() || buildClientObjectAddressSummary(normalized) || null;
  return normalized;
}

export function sanitizeClientObjectPayload(draft, { nameRequired = true } = {}) {
  const next = {};
  const cleanName = String(draft?.name || '').trim();
  next.name = cleanName || (nameRequired ? CLIENT_OBJECT_DEFAULT_NAME : '');
  CLIENT_OBJECT_ADDRESS_FIELDS.forEach((field) => {
    next[field] = String(draft?.[field] || '').trim() || null;
  });
  return next;
}

export function hasClientObjectAddressContent(objectLike) {
  return CLIENT_OBJECT_ADDRESS_FIELDS.some((field) => String(objectLike?.[field] || '').trim());
}

