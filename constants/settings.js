// constants/settings.js
export const SETTINGS_SECTIONS = {
  COMPANY: {
    titleKey: 'company_settings_sections_company_title',
    items: [
      { key: 'timezone', labelKey: 'company_settings_sections_company_items_timezone', type: 'tz' },
      {
        key: 'billing',
        labelKey: 'company_settings_sections_company_items_billing',
        route: '/billing',
        showValue: false,
      },
    ],
  },
  MANAGEMENT: {
    titleKey: 'company_settings_sections_management_title',
    items: [
      {
        key: 'notifications',
        labelKey: 'company_settings_sections_management_items_notifications',
        route: '/company_settings/sections/notifications',
      },
      {
        key: 'access',
        labelKey: 'company_settings_sections_management_items_access',
        route: '/company_settings/sections/access',
        companyOnly: true,
        helpTopic: 'access_settings',
      },
      {
        key: 'form_builder',
        labelKey: 'company_settings_sections_management_items_form_builder',
        route: '/company_settings/sections/field-editor',
        helpTopic: 'form_builder',
      },
      {
        key: 'finance_rules',
        labelKey: 'company_settings_sections_management_items_finance_rules',
        route: '/company_settings/sections/finance-rules',
        companyOnly: true,
        helpTopic: 'finance_rules',
      },
      // `work_types` and `departments` moved to REFERENCE section
    ],
  },
  REFERENCE: {
    titleKey: 'settings_sections_reference_title',
    items: [
      {
        key: 'employees',
        labelKey: 'settings_sections_reference_items_employees',
        route: '/users',
        showValue: false,
      },
      {
        key: 'clients',
        labelKey: 'settings_sections_reference_items_clients',
        route: '/clients',
        showValue: false,
      },
      {
        key: 'objects',
        labelKey: 'settings_sections_reference_items_objects',
        route: '/objects',
        showValue: false,
      },
      {
        key: 'work_types',
        labelKey: 'settings_sections_reference_items_work_types',
        route: '/company_settings/sections/WorkTypesSettings',
        helpTopic: 'work_types',
      },
      {
        key: 'order_statuses',
        labelKey: 'settings_sections_reference_items_order_statuses',
        route: '/company_settings/sections/order-statuses',
        helpTopic: 'order_statuses',
      },
      {
        key: 'departments',
        labelKey: 'settings_sections_reference_items_departments',
        route: '/company_settings/sections/DepartmentsSettings',
        helpTopic: 'departments',
      },
      {
        key: 'tags',
        labelKey: 'settings_sections_reference_items_tags',
        route: '/company_settings/sections/tags',
        helpTopic: 'tags',
      },
    ],
  },
  INTEGRATIONS: {
    titleKey: 'company_settings_sections_integrations_title',
    items: [
      {
        key: 'crm_systems',
        labelKey: 'company_settings_sections_integrations_items_crm_systems',
      },
      {
        key: 'telegram_bot',
        labelKey: 'settings_integrations_telegram_bot',
        route: '/company_settings/sections/telegram-bot',
        helpTopic: 'messenger_bot',
      },
      {
        key: 'max_bot',
        labelKey: 'settings_integrations_max_bot',
        route: '/company_settings/sections/max-bot',
        helpTopic: 'messenger_bot',
      },
      {
        key: 'yandex_disk',
        labelKey: 'company_settings_sections_integrations_items_yandex_disk',
        route: '/company_settings/sections/yandex-disk',
        helpTopic: 'cloud_storage',
      },
    ],
  },
  DEPARTURE: {
    titleKey: 'company_settings_sections_departure_title',
  },
  PHONE: {
    titleKey: 'company_settings_sections_phone_title',
  },
};

export const UI_TEXT_KEYS = {
  settingsTitle: 'company_settings_title',
  toggles: {
    useDepartureTime: 'company_settings_sections_departure_toggles_useDepartureTime',
  },
  phone: {
    mode: 'company_settings_sections_phone_items_phoneMode',
    windowBefore: 'company_settings_sections_phone_items_windowBefore',
    windowAfter: 'company_settings_sections_phone_items_windowAfter',
  },
  helperText: {
    departureOn: 'company_settings_sections_departure_helperText_departureOn',
    departureOff: 'company_settings_sections_departure_helperText_departureOff',
  },
  modals: {
    timezone: {
      title: 'company_settings_modals_timezone_title',
      subtitleDevice: 'company_settings_modals_timezone_subtitleDevice',
      searchable: true, // конфиг
    },
    phoneMode: {
      title: 'company_settings_modals_phoneMode_title',
      searchable: false, // конфиг
    },
  },
};

export const PHONE_MODE_OPTIONS = [
  { id: 'always', labelKey: 'company_settings_modals_phoneMode_options_always' },
  { id: 'never', labelKey: 'company_settings_modals_phoneMode_options_never' },
  { id: 'window', labelKey: 'company_settings_modals_phoneMode_options_window' },
];
