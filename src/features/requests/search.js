import { buildSearchIndex } from '../../shared/search/matching';
import { readOrderExecutorName } from './executorNameCache';

const ADDRESS_FIELDS = [
  'address_short',
  'address_navigator_query',
  'country',
  'region',
  'district',
  'city',
  'street',
  'house',
  'postal_code',
  'office',
  'apartment',
  'floor',
  'entrance',
  'entrance_info',
  'parking_notes',
];

const PERSON_FIELDS = [
  'fio',
  'customer_name',
  'first_name',
  'middle_name',
  'last_name',
  'full_name',
  'email',
];

function collectScalarValues(value, target, depth = 0) {
  if (value == null || depth > 2) return;
  if (typeof value === 'string' || typeof value === 'number') {
    target.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectScalarValues(item, target, depth + 1));
    return;
  }
  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectScalarValues(item, target, depth + 1));
  }
}

export function buildRequestSearchIndex(order, options = {}) {
  const row = order || {};
  const client = row.client || {};
  const objectItem = row.object || row.client_object || {};
  const texts = [
    options.title,
    row.title,
    row.order_number,
    row.request_number,
    row.number,
    row.status,
    options.statusLabel,
    row.description,
    row.comment,
    row.object_name,
    row.object_summary,
    row.address,
    objectItem.name,
    objectItem.label,
    objectItem.address,
    row.work_type_name,
    row.work_type?.name,
    row.department_name,
    row.payment_method,
    row.payment_status,
    readOrderExecutorName(row),
    row.assigned_to_name,
    row.executor_name,
    row.created_at,
    row.time_window_start,
    row.departure_time,
    ...PERSON_FIELDS.flatMap((field) => [row?.[field], client?.[field]]),
    ...ADDRESS_FIELDS.flatMap((field) => [row?.[field], objectItem?.[field]]),
    ...(Array.isArray(options.extraTexts) ? options.extraTexts : []),
  ];

  collectScalarValues(row.tags, texts);
  collectScalarValues(row.client_tags, texts);
  collectScalarValues(client.tags, texts);
  collectScalarValues(row.object_tags, texts);
  collectScalarValues(objectItem.tags, texts);
  collectScalarValues(row.custom_fields, texts);
  collectScalarValues(row.extra_fields, texts);

  const additionalPhones = Array.isArray(client.additional_phones)
    ? client.additional_phones.flatMap((item) =>
        typeof item === 'string' ? [item] : [item?.phone, item?.value, item?.number],
      )
    : [];
  const phones = options.includePhones
    ? [
        row.customer_phone_visible,
        row.customer_phone,
        row.phone,
        row.secondary_phone,
        client.phone,
        client.secondary_phone,
        ...additionalPhones,
      ]
    : [];

  return buildSearchIndex({ texts, phones });
}
