export const ENTITY_FIELD_TYPES = Object.freeze({
  ORDER: 'order',
  OBJECT: 'object',
});

export const FIELD_SETTINGS_SECTIONS = Object.freeze({
  GENERAL: 'general',
  RELATIONS: 'relations',
  CONTACT: 'contact',
  SCHEDULING: 'scheduling',
  FINANCE: 'finance',
  ADDRESS: 'address',
  ADDITIONAL: 'additional',
});

const ORDER_FIELDS = [
  {
    entityType: ENTITY_FIELD_TYPES.ORDER,
    fieldKey: 'title',
    labelKey: 'order_field_title',
    fallbackLabel: 'Название заявки',
    sectionKey: FIELD_SETTINGS_SECTIONS.GENERAL,
    inputKind: 'text',
    supportsRequired: true,
    defaultEnabled: true,
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 10,
  },
  {
    entityType: ENTITY_FIELD_TYPES.ORDER,
    fieldKey: 'comment',
    labelKey: 'order_field_description',
    fallbackLabel: 'Описание',
    sectionKey: FIELD_SETTINGS_SECTIONS.GENERAL,
    inputKind: 'multiline',
    supportsRequired: true,
    defaultEnabled: true,
    defaultRequired: false,
    lockedEnabled: false,
    lockedRequired: false,
    sortOrder: 20,
  },
  {
    entityType: ENTITY_FIELD_TYPES.ORDER,
    fieldKey: 'work_type_id',
    labelKey: 'order_field_work_type',
    fallbackLabel: 'Тип работ',
    sectionKey: FIELD_SETTINGS_SECTIONS.GENERAL,
    inputKind: 'select',
    supportsRequired: true,
    defaultEnabled: true,
    defaultRequired: false,
    lockedEnabled: false,
    lockedRequired: false,
    sortOrder: 30,
  },
  {
    entityType: ENTITY_FIELD_TYPES.ORDER,
    fieldKey: 'urgent',
    labelKey: 'create_order_label_urgent',
    fallbackLabel: 'Срочная',
    sectionKey: FIELD_SETTINGS_SECTIONS.GENERAL,
    inputKind: 'boolean',
    supportsRequired: false,
    defaultEnabled: true,
    defaultRequired: false,
    lockedEnabled: false,
    lockedRequired: false,
    sortOrder: 40,
  },
  {
    entityType: ENTITY_FIELD_TYPES.ORDER,
    fieldKey: 'client_id',
    labelKey: 'order_details_customer',
    fallbackLabel: 'Заказчик',
    sectionKey: FIELD_SETTINGS_SECTIONS.RELATIONS,
    inputKind: 'relation',
    supportsRequired: false,
    defaultEnabled: true,
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 50,
  },
  {
    entityType: ENTITY_FIELD_TYPES.ORDER,
    fieldKey: 'object_id',
    labelKey: 'routes_objects_object',
    fallbackLabel: 'Объект',
    sectionKey: FIELD_SETTINGS_SECTIONS.RELATIONS,
    inputKind: 'relation',
    supportsRequired: false,
    defaultEnabled: true,
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 60,
  },
  {
    entityType: ENTITY_FIELD_TYPES.ORDER,
    fieldKey: 'phone',
    labelKey: 'order_details_phone',
    fallbackLabel: 'Телефон',
    sectionKey: FIELD_SETTINGS_SECTIONS.CONTACT,
    inputKind: 'phone',
    supportsRequired: true,
    defaultEnabled: true,
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 70,
  },
  {
    entityType: ENTITY_FIELD_TYPES.ORDER,
    fieldKey: 'secondary_phone',
    labelKey: 'order_field_secondary_phone',
    fallbackLabel: 'Доп. телефон',
    sectionKey: FIELD_SETTINGS_SECTIONS.CONTACT,
    inputKind: 'phone',
    supportsRequired: true,
    defaultEnabled: true,
    defaultRequired: false,
    lockedEnabled: false,
    lockedRequired: false,
    sortOrder: 80,
  },
  {
    entityType: ENTITY_FIELD_TYPES.ORDER,
    fieldKey: 'contact_email',
    labelKey: 'order_field_contact_email',
    fallbackLabel: 'Email',
    sectionKey: FIELD_SETTINGS_SECTIONS.CONTACT,
    inputKind: 'email',
    supportsRequired: true,
    defaultEnabled: true,
    defaultRequired: false,
    lockedEnabled: false,
    lockedRequired: false,
    sortOrder: 90,
  },
  {
    entityType: ENTITY_FIELD_TYPES.ORDER,
    fieldKey: 'time_window_start',
    labelKey: 'create_order_label_date',
    fallbackLabel: 'Дата выезда',
    sectionKey: FIELD_SETTINGS_SECTIONS.SCHEDULING,
    inputKind: 'datetime',
    supportsRequired: true,
    defaultEnabled: true,
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 100,
  },
  {
    entityType: ENTITY_FIELD_TYPES.ORDER,
    fieldKey: 'assigned_to',
    labelKey: 'create_order_label_executor',
    fallbackLabel: 'Исполнитель',
    sectionKey: FIELD_SETTINGS_SECTIONS.SCHEDULING,
    inputKind: 'relation',
    supportsRequired: false,
    defaultEnabled: true,
    defaultRequired: false,
    lockedEnabled: false,
    lockedRequired: false,
    sortOrder: 110,
  },
  {
    entityType: ENTITY_FIELD_TYPES.ORDER,
    fieldKey: 'department_id',
    labelKey: 'label_department',
    fallbackLabel: 'Отдел',
    sectionKey: FIELD_SETTINGS_SECTIONS.SCHEDULING,
    inputKind: 'select',
    supportsRequired: false,
    defaultEnabled: true,
    defaultRequired: false,
    lockedEnabled: false,
    lockedRequired: false,
    sortOrder: 120,
  },
  {
    entityType: ENTITY_FIELD_TYPES.ORDER,
    fieldKey: 'price',
    labelKey: 'order_details_amount',
    fallbackLabel: 'Сумма',
    sectionKey: FIELD_SETTINGS_SECTIONS.FINANCE,
    inputKind: 'number',
    supportsRequired: false,
    defaultEnabled: true,
    defaultRequired: false,
    lockedEnabled: false,
    lockedRequired: false,
    sortOrder: 130,
  },
  {
    entityType: ENTITY_FIELD_TYPES.ORDER,
    fieldKey: 'fuel_cost',
    labelKey: 'order_details_fuel',
    fallbackLabel: 'ГСМ',
    sectionKey: FIELD_SETTINGS_SECTIONS.FINANCE,
    inputKind: 'number',
    supportsRequired: false,
    defaultEnabled: true,
    defaultRequired: false,
    lockedEnabled: false,
    lockedRequired: false,
    sortOrder: 140,
  },
];

const OBJECT_FIELDS = [
  {
    entityType: ENTITY_FIELD_TYPES.OBJECT,
    fieldKey: 'name',
    labelKey: 'objects_field_name',
    fallbackLabel: 'Название объекта',
    sectionKey: FIELD_SETTINGS_SECTIONS.GENERAL,
    inputKind: 'text',
    supportsRequired: true,
    defaultEnabled: true,
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 10,
  },
  {
    entityType: ENTITY_FIELD_TYPES.OBJECT,
    fieldKey: 'country',
    labelKey: 'order_field_country',
    fallbackLabel: 'Страна',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    supportsRequired: true,
    defaultEnabled: true,
    defaultRequired: false,
    lockedEnabled: false,
    lockedRequired: false,
    sortOrder: 20,
  },
  {
    entityType: ENTITY_FIELD_TYPES.OBJECT,
    fieldKey: 'region',
    labelKey: 'order_field_region',
    fallbackLabel: 'Область',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    supportsRequired: true,
    defaultEnabled: true,
    defaultRequired: false,
    lockedEnabled: false,
    lockedRequired: false,
    sortOrder: 30,
  },
  {
    entityType: ENTITY_FIELD_TYPES.OBJECT,
    fieldKey: 'district',
    labelKey: 'order_field_district',
    fallbackLabel: 'Район',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    supportsRequired: true,
    defaultEnabled: true,
    defaultRequired: false,
    lockedEnabled: false,
    lockedRequired: false,
    sortOrder: 40,
  },
  {
    entityType: ENTITY_FIELD_TYPES.OBJECT,
    fieldKey: 'city',
    labelKey: 'order_field_city',
    fallbackLabel: 'Город',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    supportsRequired: true,
    defaultEnabled: true,
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 50,
  },
  {
    entityType: ENTITY_FIELD_TYPES.OBJECT,
    fieldKey: 'street',
    labelKey: 'order_field_street',
    fallbackLabel: 'Улица',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    supportsRequired: true,
    defaultEnabled: true,
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 60,
  },
  {
    entityType: ENTITY_FIELD_TYPES.OBJECT,
    fieldKey: 'house',
    labelKey: 'order_field_house',
    fallbackLabel: 'Дом',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    supportsRequired: true,
    defaultEnabled: true,
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 70,
  },
  {
    entityType: ENTITY_FIELD_TYPES.OBJECT,
    fieldKey: 'postal_code',
    labelKey: 'order_field_postal_code',
    fallbackLabel: 'Индекс',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    supportsRequired: true,
    defaultEnabled: true,
    defaultRequired: false,
    lockedEnabled: false,
    lockedRequired: false,
    sortOrder: 80,
  },
  {
    entityType: ENTITY_FIELD_TYPES.OBJECT,
    fieldKey: 'office',
    labelKey: 'order_field_office',
    fallbackLabel: 'Офис',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    supportsRequired: true,
    defaultEnabled: true,
    defaultRequired: false,
    lockedEnabled: false,
    lockedRequired: false,
    sortOrder: 90,
  },
  {
    entityType: ENTITY_FIELD_TYPES.OBJECT,
    fieldKey: 'floor',
    labelKey: 'order_field_floor',
    fallbackLabel: 'Этаж',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    supportsRequired: true,
    defaultEnabled: true,
    defaultRequired: false,
    lockedEnabled: false,
    lockedRequired: false,
    sortOrder: 100,
  },
  {
    entityType: ENTITY_FIELD_TYPES.OBJECT,
    fieldKey: 'entrance',
    labelKey: 'order_field_entrance',
    fallbackLabel: 'Подъезд',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    supportsRequired: true,
    defaultEnabled: true,
    defaultRequired: false,
    lockedEnabled: false,
    lockedRequired: false,
    sortOrder: 110,
  },
  {
    entityType: ENTITY_FIELD_TYPES.OBJECT,
    fieldKey: 'apartment',
    labelKey: 'order_field_apartment',
    fallbackLabel: 'Квартира',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    supportsRequired: true,
    defaultEnabled: true,
    defaultRequired: false,
    lockedEnabled: false,
    lockedRequired: false,
    sortOrder: 120,
  },
  {
    entityType: ENTITY_FIELD_TYPES.OBJECT,
    fieldKey: 'entrance_info',
    labelKey: 'order_field_entrance_info',
    fallbackLabel: 'Как попасть',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDITIONAL,
    inputKind: 'multiline',
    supportsRequired: true,
    defaultEnabled: true,
    defaultRequired: false,
    lockedEnabled: false,
    lockedRequired: false,
    sortOrder: 130,
  },
  {
    entityType: ENTITY_FIELD_TYPES.OBJECT,
    fieldKey: 'parking_notes',
    labelKey: 'order_field_parking_notes',
    fallbackLabel: 'Парковка',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDITIONAL,
    inputKind: 'multiline',
    supportsRequired: true,
    defaultEnabled: true,
    defaultRequired: false,
    lockedEnabled: false,
    lockedRequired: false,
    sortOrder: 140,
  },
  {
    entityType: ENTITY_FIELD_TYPES.OBJECT,
    fieldKey: 'geo_lat',
    labelKey: 'order_field_geo_lat',
    fallbackLabel: 'Широта',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDITIONAL,
    inputKind: 'number',
    supportsRequired: true,
    defaultEnabled: true,
    defaultRequired: false,
    lockedEnabled: false,
    lockedRequired: false,
    sortOrder: 150,
  },
  {
    entityType: ENTITY_FIELD_TYPES.OBJECT,
    fieldKey: 'geo_lng',
    labelKey: 'order_field_geo_lng',
    fallbackLabel: 'Долгота',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDITIONAL,
    inputKind: 'number',
    supportsRequired: true,
    defaultEnabled: true,
    defaultRequired: false,
    lockedEnabled: false,
    lockedRequired: false,
    sortOrder: 160,
  },
];

export const ENTITY_FIELD_CATALOG = Object.freeze({
  [ENTITY_FIELD_TYPES.ORDER]: ORDER_FIELDS,
  [ENTITY_FIELD_TYPES.OBJECT]: OBJECT_FIELDS,
});

export function getEntityFieldCatalog(entityType) {
  return ENTITY_FIELD_CATALOG[entityType] || [];
}

export function normalizeEntityField(entityType, field) {
  const catalogItem = getEntityFieldCatalog(entityType).find(
    (item) => item.fieldKey === String(field?.field_key || field?.fieldKey || ''),
  );
  if (!catalogItem) return null;

  const enabled =
    catalogItem.lockedEnabled === true
      ? true
      : field?.is_enabled !== undefined
        ? field.is_enabled !== false
        : catalogItem.defaultEnabled !== false;

  const required =
    catalogItem.lockedRequired === true
      ? true
      : !enabled
        ? false
        : catalogItem.supportsRequired
          ? field?.is_required === true || catalogItem.defaultRequired === true
          : false;

  return {
    ...catalogItem,
    fieldKey: catalogItem.fieldKey,
    field_key: catalogItem.fieldKey,
    isEnabled: enabled,
    isRequired: required,
    canToggleEnabled: catalogItem.lockedEnabled !== true,
    canToggleRequired:
      catalogItem.supportsRequired === true &&
      catalogItem.lockedRequired !== true &&
      enabled === true,
  };
}

export function buildFallbackEntityFieldSettings(entityType) {
  const fields = getEntityFieldCatalog(entityType)
    .map((item) => normalizeEntityField(entityType, item))
    .filter(Boolean);

  return {
    entityType,
    versionToken: null,
    source: 'fallback',
    fields,
  };
}

export function getEntityFieldMap(settings) {
  const map = new Map();
  for (const field of settings?.fields || []) {
    map.set(String(field.fieldKey || field.field_key || ''), field);
  }
  return map;
}

export function isEntityFieldEnabled(settings, fieldKey) {
  const field = getEntityFieldMap(settings).get(String(fieldKey || ''));
  return field ? field.isEnabled !== false : false;
}

export function isEntityFieldRequired(settings, fieldKey) {
  const field = getEntityFieldMap(settings).get(String(fieldKey || ''));
  return field ? field.isRequired === true : false;
}

export function toLegacySchemaFields(settings) {
  return (settings?.fields || [])
    .filter((field) => field?.isEnabled !== false)
    .map((field) => ({
      field_key: field.fieldKey,
      label_key: field.labelKey,
      label: field.fallbackLabel,
      type: field.inputKind,
      position: field.sortOrder,
      required: field.isRequired === true,
      section_key: field.sectionKey,
    }))
    .sort((left, right) => left.position - right.position);
}
