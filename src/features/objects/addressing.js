export const CLIENT_OBJECT_DEFAULT_NAME = 'Новый объект';

export const CLIENT_OBJECT_PRIMARY_ADDRESS_FIELDS = [
  'country',
  'region',
  'district',
  'city',
  'street',
  'house',
  'postal_code',
  'office',
  'floor',
  'entrance',
  'apartment',
];

export const CLIENT_OBJECT_ADDITIONAL_INFO_FIELDS = [
  'entrance_info',
  'parking_notes',
];

export const CLIENT_OBJECT_MAP_COORD_FIELDS = ['geo_lat', 'geo_lng'];

export const CLIENT_OBJECT_CONTACT_FIELDS = [
  'additional_phone_1',
  'additional_phone_1_label',
  'additional_phone_2',
  'additional_phone_2_label',
  'additional_phone_3',
  'additional_phone_3_label',
];

export const CLIENT_OBJECT_MEDIA_FIELDS = ['media_file_1', 'media_file_2', 'media_file_3'];

export const CLIENT_OBJECT_ADDRESS_FIELDS = [
  ...CLIENT_OBJECT_PRIMARY_ADDRESS_FIELDS,
  ...CLIENT_OBJECT_ADDITIONAL_INFO_FIELDS,
];

export function createEmptyClientObjectDraft(overrides = {}) {
  return {
    name: CLIENT_OBJECT_DEFAULT_NAME,
    photoUrl: '',
    country: '',
    region: '',
    district: '',
    city: '',
    street: '',
    house: '',
    postal_code: '',
    office: '',
    floor: '',
    entrance: '',
    apartment: '',
    entrance_info: '',
    parking_notes: '',
    geo_lat: '',
    geo_lng: '',
    additional_phone_1: '',
    additional_phone_1_label: '',
    additional_phone_2: '',
    additional_phone_2_label: '',
    additional_phone_3: '',
    additional_phone_3_label: '',
    ...overrides,
  };
}

export function buildClientObjectAddressSummary(objectLike) {
  if (!objectLike || typeof objectLike !== 'object') return '';
  const parts = [
    objectLike.city,
    objectLike.street,
    objectLike.house,
    objectLike.office ? `оф. ${String(objectLike.office).trim()}` : '',
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return parts.join(', ').trim();
}

export function buildClientObjectFullAddress(objectLike) {
  if (!objectLike || typeof objectLike !== 'object') return '';
  const parts = [
    objectLike.postal_code,
    objectLike.country,
    objectLike.region,
    objectLike.district,
    objectLike.city,
    objectLike.street ? `ул. ${String(objectLike.street).trim()}` : '',
    objectLike.house ? `д. ${String(objectLike.house).trim()}` : '',
    objectLike.apartment ? `кв. ${String(objectLike.apartment).trim()}` : '',
    objectLike.office ? `оф. ${String(objectLike.office).trim()}` : '',
    objectLike.entrance ? `подъезд ${String(objectLike.entrance).trim()}` : '',
    objectLike.floor ? `этаж ${String(objectLike.floor).trim()}` : '',
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return parts.join(', ').trim();
}

export function buildClientObjectAdditionalInfoSummary(objectLike) {
  if (!objectLike || typeof objectLike !== 'object') return '';
  const parts = [objectLike.parking_notes, objectLike.entrance_info]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return parts.join(', ').trim();
}

export function buildClientObjectShortAddress(objectLike) {
  if (!objectLike || typeof objectLike !== 'object') return '';
  const parts = [objectLike.city, objectLike.street, objectLike.house]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  return parts.join(', ').trim();
}

export function normalizeClientObject(row) {
  if (!row || typeof row !== 'object') return null;
  const tags = Array.isArray(row?.object_tag_links)
    ? row.object_tag_links
        .map((link) => {
          const tag = link?.tag || link?.company_tags || null;
          const id = String(tag?.id || '').trim();
          const value = String(tag?.value || '').trim();
          if (!id || !value) return null;
          return { id, value };
        })
        .filter(Boolean)
    : [];
  const normalized = {
    ...row,
    id: row.id ? String(row.id) : null,
    client_id: row.client_id ? String(row.client_id) : null,
    company_id: row.company_id ? String(row.company_id) : null,
    name: String(row.name || '').trim() || CLIENT_OBJECT_DEFAULT_NAME,
    photoUrl: String(row.photo_url || row.photoUrl || '').trim() || '',
    photoDisplayUrl:
      String(row.photo_display_url || row.photoDisplayUrl || row.photo_url || row.photoUrl || '').trim() || '',
    is_primary: !!row.is_primary,
    tags,
  };
  CLIENT_OBJECT_ADDRESS_FIELDS.forEach((field) => {
    normalized[field] = String(row[field] || '').trim();
  });
  CLIENT_OBJECT_CONTACT_FIELDS.forEach((field) => {
    normalized[field] = String(row[field] || '').trim();
  });
  CLIENT_OBJECT_MEDIA_FIELDS.forEach((field) => {
    normalized[field] = Array.isArray(row?.[field])
      ? row[field].map((value) => String(value || '').trim()).filter(Boolean)
      : [];
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
  CLIENT_OBJECT_CONTACT_FIELDS.forEach((field) => {
    next[field] = String(draft?.[field] || '').trim() || null;
  });
  return next;
}

export function hasClientObjectAddressContent(objectLike) {
  return CLIENT_OBJECT_ADDRESS_FIELDS.some((field) => String(objectLike?.[field] || '').trim());
}
