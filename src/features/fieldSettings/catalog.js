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
    fallbackLabel: 'Название заявки',
    sectionKey: FIELD_SETTINGS_SECTIONS.GENERAL,
    inputKind: 'text',
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 10,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'comment', {
    labelKey: 'order_field_description',
    fallbackLabel: 'Описание',
    sectionKey: FIELD_SETTINGS_SECTIONS.GENERAL,
    inputKind: 'multiline',
    lockedEnabled: true,
    sortOrder: 20,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'work_type_id', {
    labelKey: 'order_field_work_type',
    fallbackLabel: 'Тип работ',
    sectionKey: FIELD_SETTINGS_SECTIONS.GENERAL,
    inputKind: 'select',
    sortOrder: 30,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'urgent', {
    labelKey: 'create_order_label_urgent',
    fallbackLabel: 'Срочная',
    sectionKey: FIELD_SETTINGS_SECTIONS.GENERAL,
    inputKind: 'boolean',
    supportsRequired: false,
    sortOrder: 40,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'client_id', {
    labelKey: 'order_details_customer',
    fallbackLabel: 'Заказчик',
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
    fallbackLabel: 'Объект',
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
    fallbackLabel: 'Телефон',
    sectionKey: FIELD_SETTINGS_SECTIONS.CONTACT,
    inputKind: 'phone',
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 70,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'time_window_start', {
    labelKey: 'create_order_label_date',
    fallbackLabel: 'Дата выезда',
    sectionKey: FIELD_SETTINGS_SECTIONS.SCHEDULING,
    inputKind: 'datetime',
    defaultRequired: true,
    sortOrder: 100,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'departure_time', {
    labelKey: 'order_field_departure_time',
    fallbackLabel: 'Время выезда',
    sectionKey: FIELD_SETTINGS_SECTIONS.SCHEDULING,
    inputKind: 'time',
    sortOrder: 101,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'assigned_to', {
    labelKey: 'create_order_label_executor',
    fallbackLabel: 'Исполнитель',
    sectionKey: FIELD_SETTINGS_SECTIONS.SCHEDULING,
    inputKind: 'relation',
    supportsRequired: false,
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 110,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'finance', {
    labelKey: 'order_field_finance',
    fallbackLabel: 'Финансы',
    sectionKey: FIELD_SETTINGS_SECTIONS.FINANCE,
    inputKind: 'boolean',
    supportsRequired: false,
    defaultEnabled: true,
    defaultRequired: false,
    sortOrder: 120,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'finance_entries', {
    labelKey: 'order_field_finance_entries',
    fallbackLabel: 'Расход, доход, скидка',
    sectionKey: FIELD_SETTINGS_SECTIONS.FINANCE,
    inputKind: 'boolean',
    supportsRequired: false,
    defaultEnabled: true,
    defaultRequired: false,
    sortOrder: 121,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'start_price', {
    labelKey: 'order_field_initial_amount',
    fallbackLabel: 'Изначальная сумма',
    sectionKey: FIELD_SETTINGS_SECTIONS.FINANCE,
    inputKind: 'number',
    supportsRequired: false,
    lockedEnabled: true,
    sortOrder: 130,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'payment_status', {
    labelKey: 'order_field_payment_status',
    fallbackLabel: 'Статус оплаты',
    sectionKey: FIELD_SETTINGS_SECTIONS.FINANCE,
    inputKind: 'select',
    supportsRequired: false,
    lockedEnabled: true,
    sortOrder: 140,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'payment_method', {
    labelKey: 'order_field_payment_method',
    fallbackLabel: 'Способ оплаты',
    sectionKey: FIELD_SETTINGS_SECTIONS.FINANCE,
    inputKind: 'select',
    supportsRequired: false,
    lockedEnabled: true,
    sortOrder: 150,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'media_file_1', {
    labelKey: 'order_media_field_1',
    fallbackLabel: 'Медиа 1',
    sectionKey: FIELD_SETTINGS_SECTIONS.MEDIA,
    inputKind: 'media',
    defaultEnabled: true,
    sortOrder: 160,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'media_file_2', {
    labelKey: 'order_media_field_2',
    fallbackLabel: 'Медиа 2',
    sectionKey: FIELD_SETTINGS_SECTIONS.MEDIA,
    inputKind: 'media',
    defaultEnabled: false,
    sortOrder: 170,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'media_file_3', {
    labelKey: 'order_media_field_3',
    fallbackLabel: 'Медиа 3',
    sectionKey: FIELD_SETTINGS_SECTIONS.MEDIA,
    inputKind: 'media',
    defaultEnabled: false,
    sortOrder: 180,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'media_file_4', {
    labelKey: 'order_media_field_4',
    fallbackLabel: 'Медиа 4',
    sectionKey: FIELD_SETTINGS_SECTIONS.MEDIA,
    inputKind: 'media',
    defaultEnabled: false,
    sortOrder: 190,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.ORDER, 'media_file_5', {
    labelKey: 'order_media_field_5',
    fallbackLabel: 'Медиа 5',
    sectionKey: FIELD_SETTINGS_SECTIONS.MEDIA,
    inputKind: 'media',
    defaultEnabled: false,
    sortOrder: 200,
  }),
];

const OBJECT_FIELDS = [
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'name', {
    labelKey: 'objects_field_name',
    fallbackLabel: 'Название объекта',
    sectionKey: FIELD_SETTINGS_SECTIONS.GENERAL,
    inputKind: 'text',
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 10,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'country', {
    labelKey: 'order_field_country',
    fallbackLabel: 'Страна',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    sortOrder: 20,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'region', {
    labelKey: 'order_field_region',
    fallbackLabel: 'Область',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    sortOrder: 30,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'district', {
    labelKey: 'order_field_district',
    fallbackLabel: 'Район',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    sortOrder: 40,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'city', {
    labelKey: 'order_field_city',
    fallbackLabel: 'Город',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    defaultRequired: false,
    lockedEnabled: false,
    lockedRequired: false,
    sortOrder: 50,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'street', {
    labelKey: 'order_field_street',
    fallbackLabel: 'Улица',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    defaultRequired: false,
    lockedEnabled: false,
    lockedRequired: false,
    sortOrder: 60,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'house', {
    labelKey: 'order_field_house',
    fallbackLabel: 'Дом',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    defaultRequired: false,
    lockedEnabled: false,
    lockedRequired: false,
    sortOrder: 70,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'postal_code', {
    labelKey: 'order_field_postal_code',
    fallbackLabel: 'Индекс',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    sortOrder: 80,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'floor', {
    labelKey: 'order_field_floor',
    fallbackLabel: 'Этаж',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    sortOrder: 90,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'entrance', {
    labelKey: 'order_field_entrance',
    fallbackLabel: 'Подъезд',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    sortOrder: 100,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'apartment', {
    labelKey: 'order_field_apartment',
    fallbackLabel: 'Квартира/офис',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDRESS,
    inputKind: 'text',
    sortOrder: 110,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'comment', {
    labelKey: 'order_field_comment',
    fallbackLabel: 'Комментарий',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDITIONAL,
    inputKind: 'multiline',
    sortOrder: 120,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'additional_phone_1', {
    labelKey: 'order_field_secondary_phone',
    fallbackLabel: 'Доп. телефон',
    sectionKey: FIELD_SETTINGS_SECTIONS.CONTACT,
    inputKind: 'phone',
    sortOrder: 130,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'additional_phone_2', {
    labelKey: 'client_field_additional_phone_2',
    fallbackLabel: 'Доп. телефон 2',
    sectionKey: FIELD_SETTINGS_SECTIONS.CONTACT,
    inputKind: 'phone',
    sortOrder: 140,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'additional_phone_3', {
    labelKey: 'client_field_additional_phone_3',
    fallbackLabel: 'Доп. телефон 3',
    sectionKey: FIELD_SETTINGS_SECTIONS.CONTACT,
    inputKind: 'phone',
    sortOrder: 150,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'media_file_1', {
    labelKey: 'object_media_field_1',
    fallbackLabel: 'Медиа объекта 1',
    sectionKey: FIELD_SETTINGS_SECTIONS.MEDIA,
    inputKind: 'media',
    supportsRequired: false,
    sortOrder: 160,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'media_file_2', {
    labelKey: 'object_media_field_2',
    fallbackLabel: 'Медиа объекта 2',
    sectionKey: FIELD_SETTINGS_SECTIONS.MEDIA,
    inputKind: 'media',
    supportsRequired: false,
    sortOrder: 170,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.OBJECT, 'media_file_3', {
    labelKey: 'object_media_field_3',
    fallbackLabel: 'Медиа объекта 3',
    sectionKey: FIELD_SETTINGS_SECTIONS.MEDIA,
    inputKind: 'media',
    supportsRequired: false,
    sortOrder: 180,
  }),
];

const CLIENT_FIELDS = [
  createFieldConfig(ENTITY_FIELD_TYPES.CLIENT, 'avatar_url', {
    labelKey: 'profile_photo_title',
    fallbackLabel: 'Фото профиля',
    sectionKey: FIELD_SETTINGS_SECTIONS.MEDIA,
    inputKind: 'media',
    supportsRequired: false,
    sortOrder: 10,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.CLIENT, 'first_name', {
    labelKey: 'label_first_name',
    fallbackLabel: 'Имя',
    sectionKey: FIELD_SETTINGS_SECTIONS.PERSONAL,
    inputKind: 'text',
    supportsRequired: false,
    defaultRequired: false,
    lockedEnabled: true,
    lockedRequired: false,
    sortOrder: 20,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.CLIENT, 'last_name', {
    labelKey: 'label_last_name',
    fallbackLabel: 'Фамилия',
    sectionKey: FIELD_SETTINGS_SECTIONS.PERSONAL,
    inputKind: 'text',
    supportsRequired: false,
    defaultRequired: false,
    lockedEnabled: true,
    sortOrder: 30,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.CLIENT, 'middle_name', {
    labelKey: 'label_middle_name',
    fallbackLabel: 'Отчество',
    sectionKey: FIELD_SETTINGS_SECTIONS.PERSONAL,
    inputKind: 'text',
    supportsRequired: false,
    defaultRequired: false,
    lockedEnabled: true,
    sortOrder: 40,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.CLIENT, 'comment', {
    labelKey: 'clients_comment_label',
    fallbackLabel: 'Комментарий',
    sectionKey: FIELD_SETTINGS_SECTIONS.ADDITIONAL,
    inputKind: 'multiline',
    sortOrder: 50,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.CLIENT, 'email', {
    labelKey: 'view_label_email',
    fallbackLabel: 'Эл. почта',
    sectionKey: FIELD_SETTINGS_SECTIONS.CONTACT,
    inputKind: 'email',
    sortOrder: 60,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.CLIENT, 'phone', {
    labelKey: 'view_label_phone',
    fallbackLabel: 'Телефон',
    sectionKey: FIELD_SETTINGS_SECTIONS.CONTACT,
    inputKind: 'phone',
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 70,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.CLIENT, 'additional_phone_1', {
    labelKey: 'order_field_secondary_phone',
    fallbackLabel: 'Доп. телефон',
    sectionKey: FIELD_SETTINGS_SECTIONS.CONTACT,
    inputKind: 'phone',
    sortOrder: 80,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.CLIENT, 'additional_phone_2', {
    labelKey: 'client_field_additional_phone_2',
    fallbackLabel: 'Доп. телефон 2',
    sectionKey: FIELD_SETTINGS_SECTIONS.CONTACT,
    inputKind: 'phone',
    sortOrder: 90,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.CLIENT, 'additional_phone_3', {
    labelKey: 'client_field_additional_phone_3',
    fallbackLabel: 'Доп. телефон 3',
    sectionKey: FIELD_SETTINGS_SECTIONS.CONTACT,
    inputKind: 'phone',
    sortOrder: 100,
  }),
];

const EMPLOYEE_FIELDS = [
  createFieldConfig(ENTITY_FIELD_TYPES.EMPLOYEE, 'avatar_url', {
    labelKey: 'profile_photo_title',
    fallbackLabel: 'Фото профиля',
    sectionKey: FIELD_SETTINGS_SECTIONS.MEDIA,
    inputKind: 'media',
    supportsRequired: false,
    sortOrder: 10,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.EMPLOYEE, 'first_name', {
    labelKey: 'label_first_name',
    fallbackLabel: 'Имя',
    sectionKey: FIELD_SETTINGS_SECTIONS.PERSONAL,
    inputKind: 'text',
    supportsRequired: false,
    defaultRequired: false,
    lockedEnabled: true,
    lockedRequired: false,
    sortOrder: 20,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.EMPLOYEE, 'last_name', {
    labelKey: 'label_last_name',
    fallbackLabel: 'Фамилия',
    sectionKey: FIELD_SETTINGS_SECTIONS.PERSONAL,
    inputKind: 'text',
    supportsRequired: false,
    defaultRequired: false,
    lockedEnabled: true,
    lockedRequired: false,
    sortOrder: 30,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.EMPLOYEE, 'middle_name', {
    labelKey: 'label_middle_name',
    fallbackLabel: 'Отчество',
    sectionKey: FIELD_SETTINGS_SECTIONS.PERSONAL,
    inputKind: 'text',
    supportsRequired: false,
    defaultRequired: false,
    lockedEnabled: true,
    lockedRequired: false,
    sortOrder: 40,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.EMPLOYEE, 'email', {
    labelKey: 'view_label_email',
    fallbackLabel: 'Эл. почта',
    sectionKey: FIELD_SETTINGS_SECTIONS.CONTACT,
    inputKind: 'email',
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 50,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.EMPLOYEE, 'phone', {
    labelKey: 'view_label_phone',
    fallbackLabel: 'Телефон',
    sectionKey: FIELD_SETTINGS_SECTIONS.CONTACT,
    inputKind: 'phone',
    sortOrder: 60,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.EMPLOYEE, 'birthdate', {
    labelKey: 'label_birthdate',
    fallbackLabel: 'Дата рождения',
    sectionKey: FIELD_SETTINGS_SECTIONS.PERSONAL,
    inputKind: 'date',
    sortOrder: 70,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.EMPLOYEE, 'department_id', {
    labelKey: 'label_department',
    fallbackLabel: 'Отдел',
    sectionKey: FIELD_SETTINGS_SECTIONS.COMPANY,
    inputKind: 'select',
    sortOrder: 80,
  }),
  createFieldConfig(ENTITY_FIELD_TYPES.EMPLOYEE, 'role', {
    labelKey: 'label_role',
    fallbackLabel: 'Роль',
    sectionKey: FIELD_SETTINGS_SECTIONS.COMPANY,
    inputKind: 'select',
    supportsRequired: false,
    defaultEnabled: true,
    defaultRequired: true,
    lockedEnabled: true,
    lockedRequired: true,
    sortOrder: 90,
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
        : field?.isEnabled !== undefined
          ? field.isEnabled !== false
        : catalogItem.defaultEnabled !== false;

  const requiredOverride =
    field?.is_required !== undefined
      ? field.is_required
      : field?.isRequired;

  const required =
    catalogItem.lockedRequired === true
      ? true
      : !enabled
        ? false
        : catalogItem.supportsRequired
          ? requiredOverride !== undefined
            ? requiredOverride === true
            : catalogItem.defaultRequired === true
          : false;

  const customLabelRaw =
    field?.custom_label !== undefined
      ? field.custom_label
      : field?.customLabel;
  const customLabel =
    typeof customLabelRaw === 'string' && customLabelRaw.trim()
      ? customLabelRaw.trim()
      : null;

  return {
    ...catalogItem,
    fieldKey: catalogItem.fieldKey,
    field_key: catalogItem.fieldKey,
    isEnabled: enabled,
    isRequired: required,
    customLabel,
    custom_label: customLabel,
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
      label: field.customLabel || field.fallbackLabel,
      custom_label: field.customLabel || null,
      type: field.inputKind,
      position: field.sortOrder,
      required: field.isRequired === true,
      section_key: field.sectionKey,
    }))
    .sort((left, right) => left.position - right.position);
}
