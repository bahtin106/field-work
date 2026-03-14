export const ENTITY_FIELD_TYPES = Object.freeze({
  ORDER: 'order',
  OBJECT: 'object',
  CLIENT: 'client',
  EMPLOYEE: 'employee',
});

export const FIELD_SETTINGS_SECTIONS = Object.freeze({
  GENERAL: 'general',
  RELATIONS: 'relations',
  CONTACT: 'contact',
  SCHEDULING: 'scheduling',
  FINANCE: 'finance',
  ADDRESS: 'address',
  ADDITIONAL: 'additional',
  PERSONAL: 'personal',
  COMPANY: 'company',
  MEDIA: 'media',
});

function createFieldConfig(entityType, fieldKey, config) {
  return {
    entityType,
    fieldKey,
    labelKey: config.labelKey,
    fallbackLabel: config.fallbackLabel,
    sectionKey: config.sectionKey,
    inputKind: config.inputKind,
    supportsRequired: config.supportsRequired !== false,
    defaultEnabled: config.defaultEnabled !== false,
    defaultRequired: config.defaultRequired === true,
    lockedEnabled: config.lockedEnabled === true,
    lockedRequired: config.lockedRequired === true,
    sortOrder: Number(config.sortOrder || 0),
  };
}

const ORDER_FIELDS = [
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'title', {
    labelKey: 'order_field_title',
    fallbackLabel: 'РќР°Р·РІР°РЅРёРµ Р·Р°СЏРІРєРё',
    sectionKey: FIELD_SETTINGS_SECTIONS.GENERAL,
    inputKind: 'text',
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 10,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'comment', {
    labelKey: 'order_field_description',
    fallbackLabel: 'РћРїРёСЃР°РЅРёРµ',
    sectionKey: FIELD_SETTINGS_SECTIONS.GENERAL,
    inputKind: 'multiline',
    sortOrder: 20,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'work_type_id', {
    labelKey: 'order_field_work_type',
    fallbackLabel: 'РўРёРї СЂР°Р±РѕС‚',
    sectionKey: FIELD_SETTINGS_SECTIONS.GENERAL,
    inputKind: 'select',
    sortOrder: 30,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'urgent', {
    labelKey: 'create_order_label_urgent',
    fallbackLabel: 'РЎСЂРѕС‡РЅР°СЏ',
    sectionKey: FIELD_SETTINGS_SECTIONS.GENERAL,
    inputKind: 'boolean',
    supportsRequired: false,
    sortOrder: 40,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'client_id', {
    labelKey: 'order_details_customer',
    fallbackLabel: 'Р—Р°РєР°Р·С‡РёРє',
    sectionKey: FIELD_SETTINGS_SECTIONS.RELATIONS,
    inputKind: 'relation',
    supportsRequired: false,
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 50,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'object_id', {
    labelKey: 'routes_objects_object',
    fallbackLabel: 'РћР±СЉРµРєС‚',
    sectionKey: FIELD_SETTINGS_SECTIONS.RELATIONS,
    inputKind: 'relation',
    supportsRequired: false,
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 60,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'phone', {
    labelKey: 'order_details_phone',
    fallbackLabel: 'РўРµР»РµС„РѕРЅ',
    sectionKey: FIELD_SETTINGS_SECTIONS.CONTACT,
    inputKind: 'phone',
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 70,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'secondary_phone', {
    labelKey: 'order_field_secondary_phone',
    fallbackLabel: 'Р”РѕРї. С‚РµР»РµС„РѕРЅ',
    sectionKey: FIELD_SETTINGS_SECTIONS.CONTACT,
    inputKind: 'phone',
    sortOrder: 80,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'contact_email', {
    labelKey: 'order_field_contact_email',
    fallbackLabel: 'Email',
    sectionKey: FIELD_SETTINGS_SECTIONS.CONTACT,
    inputKind: 'email',
    sortOrder: 90,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'time_window_start', {
    labelKey: 'create_order_label_date',
    fallbackLabel: 'Р”Р°С‚Р° РІС‹РµР·РґР°',
    sectionKey: FIELD_SETTINGS_SECTIONS.SCHEDULING,
    inputKind: 'datetime',
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 100,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'assigned_to', {
    labelKey: 'create_order_label_executor',
    fallbackLabel: 'РСЃРїРѕР»РЅРёС‚РµР»СЊ',
    sectionKey: FIELD_SETTINGS_SECTIONS.SCHEDULING,
    inputKind: 'relation',
    supportsRequired: false,
    sortOrder: 110,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'department_id', {
    labelKey: 'label_department',
    fallbackLabel: 'РћС‚РґРµР»',
    sectionKey: FIELD_SETTINGS_SECTIONS.SCHEDULING,
    inputKind: 'select',
    supportsRequired: false,
    sortOrder: 120,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'price', {
    labelKey: 'order_details_amount',
    fallbackLabel: 'РЎСѓРјРјР°',
    sectionKey: FIELD_SETTINGS_SECTIONS.FINANCE,
    inputKind: 'number',
    supportsRequired: false,
    sortOrder: 130,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'payment_status', {
    labelKey: 'order_field_payment_status',
    fallbackLabel: 'Статус оплаты',
    sectionKey: FIELD_SETTINGS_SECTIONS.FINANCE,
    inputKind: 'select',
    supportsRequired: false,
    sortOrder: 140,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'payment_method', {
    labelKey: 'order_field_payment_method',
    fallbackLabel: 'Способ оплаты',
    sectionKey: FIELD_SETTINGS_SECTIONS.FINANCE,
    inputKind: 'select',
    supportsRequired: false,
    sortOrder: 150,
  }),
];

const OBJECT_FIELDS = [
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'name', {
    labelKey: 'objects_field_name',
    fallbackLabel: 'РќР°Р·РІР°РЅРёРµ РѕР±СЉРµРєС‚Р°',
    sectionKey: FIELD_SETTINGS_SECTIONS.GENERAL,
    inputKind: 'text',
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 10,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'country', {
    labelKey: 'order_field_country',
    fallbackLabel: 'РЎС‚СЂР°РЅР°',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    sortOrder: 20,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'region', {
    labelKey: 'order_field_region',
    fallbackLabel: 'РћР±Р»Р°СЃС‚СЊ',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    sortOrder: 30,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'district', {
    labelKey: 'order_field_district',
    fallbackLabel: 'Р Р°Р№РѕРЅ',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    sortOrder: 40,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'city', {
    labelKey: 'order_field_city',
    fallbackLabel: 'Р“РѕСЂРѕРґ',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 50,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'street', {
    labelKey: 'order_field_street',
    fallbackLabel: 'РЈР»РёС†Р°',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 60,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'house', {
    labelKey: 'order_field_house',
    fallbackLabel: 'Р”РѕРј',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 70,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'postal_code', {
    labelKey: 'order_field_postal_code',
    fallbackLabel: 'РРЅРґРµРєСЃ',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    sortOrder: 80,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'office', {
    labelKey: 'order_field_office',
    fallbackLabel: 'РћС„РёСЃ',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    sortOrder: 90,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'floor', {
    labelKey: 'order_field_floor',
    fallbackLabel: 'Р­С‚Р°Р¶',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    sortOrder: 100,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'entrance', {
    labelKey: 'order_field_entrance',
    fallbackLabel: 'РџРѕРґСЉРµР·Рґ',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    sortOrder: 110,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'apartment', {
    labelKey: 'order_field_apartment',
    fallbackLabel: 'РљРІР°СЂС‚РёСЂР°',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    sortOrder: 120,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'entrance_info', {
    labelKey: 'order_field_entrance_info',
    fallbackLabel: 'РљР°Рє РїРѕРїР°СЃС‚СЊ',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDITIONAL,
    inputKind: 'multiline',
    sortOrder: 130,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'parking_notes', {
    labelKey: 'order_field_parking_notes',
    fallbackLabel: 'РџР°СЂРєРѕРІРєР°',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDITIONAL,
    inputKind: 'multiline',
    sortOrder: 140,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'geo_lat', {
    labelKey: 'order_field_geo_lat',
    fallbackLabel: 'РЁРёСЂРѕС‚Р°',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDITIONAL,
    inputKind: 'number',
    sortOrder: 150,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'geo_lng', {
    labelKey: 'order_field_geo_lng',
    fallbackLabel: 'Р”РѕР»РіРѕС‚Р°',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDITIONAL,
    inputKind: 'number',
    sortOrder: 160,
  }),
];

const CLIENT_FIELDS = [
  createFieldConfig(ENTITY_FIELD_TYPES.CLIENT, 'avatar_url', {
    labelKey: 'profile_photo_title',
    fallbackLabel: 'Р¤РѕС‚Рѕ РїСЂРѕС„РёР»СЏ',
    sectionKey: FIELD_SETTINGS_SECTIONS.MEDIA,
    inputKind: 'media',
    supportsRequired: false,
    sortOrder: 10,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.CLIENT, 'first_name', {
    labelKey: 'label_first_name',
    fallbackLabel: 'РРјСЏ',
    sectionKey: FIELD_SETTINGS_SECTIONS.PERSONAL,
    inputKind: 'text',
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 20,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.CLIENT, 'last_name', {
    labelKey: 'label_last_name',
    fallbackLabel: 'Р¤Р°РјРёР»РёСЏ',
    sectionKey: FIELD_SETTINGS_SECTIONS.PERSONAL,
    inputKind: 'text',
    sortOrder: 30,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.CLIENT, 'middle_name', {
    labelKey: 'label_middle_name',
    fallbackLabel: 'РћС‚С‡РµСЃС‚РІРѕ',
    sectionKey: FIELD_SETTINGS_SECTIONS.PERSONAL,
    inputKind: 'text',
    sortOrder: 40,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.CLIENT, 'comment', {
    labelKey: 'clients_comment_label',
    fallbackLabel: 'РљРѕРјРјРµРЅС‚Р°СЂРёР№',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDITIONAL,
    inputKind: 'multiline',
    sortOrder: 50,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.CLIENT, 'email', {
    labelKey: 'label_email',
    fallbackLabel: 'Р­Р»РµРєС‚СЂРѕРЅРЅР°СЏ РїРѕС‡С‚Р°',
    sectionKey: FIELD_SETTINGS_SECTIONS.CONTACT,
    inputKind: 'email',
    sortOrder: 60,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.CLIENT, 'phone', {
    labelKey: 'view_label_phone',
    fallbackLabel: 'РўРµР»РµС„РѕРЅ',
    sectionKey: FIELD_SETTINGS_SECTIONS.CONTACT,
    inputKind: 'phone',
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 70,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.CLIENT, 'additional_phone_1', {
    labelKey: 'order_field_secondary_phone',
    fallbackLabel: 'Р”РѕРї. С‚РµР»РµС„РѕРЅ',
    sectionKey: FIELD_SETTINGS_SECTIONS.CONTACT,
    inputKind: 'phone',
    sortOrder: 80,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.CLIENT, 'additional_phone_2', {
    labelKey: 'client_field_additional_phone_2',
    fallbackLabel: 'Р”РѕРї. С‚РµР»РµС„РѕРЅ 2',
    sectionKey: FIELD_SETTINGS_SECTIONS.CONTACT,
    inputKind: 'phone',
    sortOrder: 90,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.CLIENT, 'additional_phone_3', {
    labelKey: 'client_field_additional_phone_3',
    fallbackLabel: 'Р”РѕРї. С‚РµР»РµС„РѕРЅ 3',
    sectionKey: FIELD_SETTINGS_SECTIONS.CONTACT,
    inputKind: 'phone',
    sortOrder: 100,
  }),
];

const EMPLOYEE_FIELDS = [
  createFieldConfig(ENTITY_FIELD_TYPES.EMPLOYEE, 'avatar_url', {
    labelKey: 'profile_photo_title',
    fallbackLabel: 'Р¤РѕС‚Рѕ РїСЂРѕС„РёР»СЏ',
    sectionKey: FIELD_SETTINGS_SECTIONS.MEDIA,
    inputKind: 'media',
    supportsRequired: false,
    sortOrder: 10,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.EMPLOYEE, 'first_name', {
    labelKey: 'label_first_name',
    fallbackLabel: 'РРјСЏ',
    sectionKey: FIELD_SETTINGS_SECTIONS.PERSONAL,
    inputKind: 'text',
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 20,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.EMPLOYEE, 'last_name', {
    labelKey: 'label_last_name',
    fallbackLabel: 'Р¤Р°РјРёР»РёСЏ',
    sectionKey: FIELD_SETTINGS_SECTIONS.PERSONAL,
    inputKind: 'text',
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 30,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.EMPLOYEE, 'email', {
    labelKey: 'label_email',
    fallbackLabel: 'Р­Р»РµРєС‚СЂРѕРЅРЅР°СЏ РїРѕС‡С‚Р°',
    sectionKey: FIELD_SETTINGS_SECTIONS.CONTACT,
    inputKind: 'email',
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 40,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.EMPLOYEE, 'phone', {
    labelKey: 'view_label_phone',
    fallbackLabel: 'РўРµР»РµС„РѕРЅ',
    sectionKey: FIELD_SETTINGS_SECTIONS.CONTACT,
    inputKind: 'phone',
    sortOrder: 50,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.EMPLOYEE, 'birthdate', {
    labelKey: 'label_birthdate',
    fallbackLabel: 'Р”Р°С‚Р° СЂРѕР¶РґРµРЅРёСЏ',
    sectionKey: FIELD_SETTINGS_SECTIONS.PERSONAL,
    inputKind: 'date',
    sortOrder: 60,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.EMPLOYEE, 'department_id', {
    labelKey: 'label_department',
    fallbackLabel: 'РћС‚РґРµР»',
    sectionKey: FIELD_SETTINGS_SECTIONS.COMPANY,
    inputKind: 'select',
    sortOrder: 70,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.EMPLOYEE, 'role', {
    labelKey: 'label_role',
    fallbackLabel: 'Р РѕР»СЊ',
    sectionKey: FIELD_SETTINGS_SECTIONS.COMPANY,
    inputKind: 'select',
    supportsRequired: false,
    defaultEnabled: true,
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 80,
  }),
];

export const ENTITY_FIELD_CATALOG = Object.freeze({
  [ENTITY_FIELD_TYPES.ORDER]: ORDER_FIELDS,
  [ENTITY_FIELD_TYPES.OBJECT]: OBJECT_FIELDS,
  [ENTITY_FIELD_TYPES.CLIENT]: CLIENT_FIELDS,
  [ENTITY_FIELD_TYPES.EMPLOYEE]: EMPLOYEE_FIELDS,
});

export function getEntityFieldCatalog(entityType) {
  return ENTITY_FIELD_CATALOG[String(entityType || '')] || [];
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

export function compareEntityFields(left, right, options = {}) {
  const lockRankLeft = left?.lockedEnabled === true && left?.lockedRequired === true ? 0 : 1;
  const lockRankRight = right?.lockedEnabled === true && right?.lockedRequired === true ? 0 : 1;
  if (options.lockedFirst === true && lockRankLeft !== lockRankRight) {
    return lockRankLeft - lockRankRight;
  }

  const requiredRankLeft = left?.isRequired === true ? 0 : 1;
  const requiredRankRight = right?.isRequired === true ? 0 : 1;
  if (options.requiredFirst === true && requiredRankLeft !== requiredRankRight) {
    return requiredRankLeft - requiredRankRight;
  }

  const sortLeft = Number(left?.sortOrder || 0);
  const sortRight = Number(right?.sortOrder || 0);
  if (sortLeft !== sortRight) return sortLeft - sortRight;

  return String(left?.fieldKey || left?.field_key || '').localeCompare(
    String(right?.fieldKey || right?.field_key || ''),
    'ru',
  );
}

export function getOrderedEntityFields(settings, options = {}) {
  const fieldKeySet = options.fieldKeys
    ? new Set((Array.isArray(options.fieldKeys) ? options.fieldKeys : []).map((value) => String(value || '')))
    : null;

  return (settings?.fields || [])
    .filter((field) => {
      const fieldKey = String(field?.fieldKey || field?.field_key || '');
      if (fieldKeySet && !fieldKeySet.has(fieldKey)) return false;
      if (options.visibleOnly === true && field?.isEnabled === false) return false;
      return true;
    })
    .slice()
    .sort((left, right) => compareEntityFields(left, right, options));
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

