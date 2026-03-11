// constants/settings.js
import { t as T } from '../src/i18n';

export const SETTINGS_SECTIONS = {
  COMPANY: {
    title: T('company_settings_sections_company_title'),
    items: [
      { key: 'timezone', label: T('company_settings_sections_company_items_timezone'), type: 'tz' },
      {
        key: 'telegram_bot',
        label: T('company_settings_sections_company_items_telegram_bot'),
        route: '/company_settings/sections/telegram-bot',
      },
      {
        key: 'billing',
        label: T('company_settings_sections_company_items_billing'),
        route: '/billing',
        showValue: false,
      },
    ],
  },
  MANAGEMENT: {
    title: T('company_settings_sections_management_title'),
    items: [
      {
        key: 'notifications',
        label: T('company_settings_sections_management_items_notifications'),
        route: '/company_settings/sections/notifications',
      },
      {
        key: 'access',
        label: T('company_settings_sections_management_items_access'),
        route: '/company_settings/sections/access',
      },
      {
        key: 'form_builder',
        label: T('company_settings_sections_management_items_form_builder'),
        route: '/company_settings/sections/field-editor',
      },
      {
        key: 'finance_rules',
        label: T('company_settings_sections_management_items_finance_rules'),
        route: '/company_settings/sections/finance-rules',
      },
      // `work_types` and `departments` moved to REFERENCE section
    ],
  },
  REFERENCE: {
    title: T('settings_sections_reference_title'),
    items: [
      {
        key: 'employees',
        label: T('company_settings_sections_company_items_employees'),
        route: '/users',
        showValue: false,
      },
      {
        key: 'clients',
        label: T('company_settings_sections_company_items_clients'),
        route: '/clients',
        showValue: false,
      },
      {
        key: 'objects',
        label: T('settings_sections_reference_items_objects'),
        route: '/objects',
        showValue: false,
      },
      {
        key: 'work_types',
        label: T('company_settings_sections_management_items_work_types'),
        route: '/company_settings/sections/WorkTypesSettings',
      },
      {
        key: 'departments',
        label: T('company_settings_sections_management_items_departments'),
        route: '/company_settings/sections/DepartmentsSettings',
      },
      {
        key: 'tags',
        label: T('settings_sections_reference_items_tags'),
        route: '/company_settings/sections/tags',
      },
    ],
  },
  INTEGRATIONS: {
    title: T('company_settings_sections_integrations_title'),
    items: [
      {
        key: 'crm_systems',
        label: T('company_settings_sections_integrations_items_crm_systems'),
      },
      {
        key: 'yandex_disk',
        label: T('company_settings_sections_integrations_items_yandex_disk'),
        route: '/company_settings/sections/yandex-disk',
      },
    ],
  },
  DEPARTURE: {
    title: T('company_settings_sections_departure_title'),
  },
  PHONE: {
    title: T('company_settings_sections_phone_title'),
  },
};

export const UI_TEXT = {
  settingsTitle: T('company_settings_title'),
  toggles: {
    useDepartureTime: T('company_settings_sections_departure_toggles_useDepartureTime'),
  },
  phone: {
    mode: T('company_settings_sections_phone_items_phoneMode'),
    windowBefore: T('company_settings_sections_phone_items_windowBefore'),
    windowAfter: T('company_settings_sections_phone_items_windowAfter'),
  },
  helperText: {
    departureOn: T('company_settings_sections_departure_helperText_departureOn'),
    departureOff: T('company_settings_sections_departure_helperText_departureOff'),
  },
  modals: {
    timezone: {
      title: T('company_settings_modals_timezone_title'),
      subtitleDevice: T('company_settings_modals_timezone_subtitleDevice'),
      searchable: true, // конфиг
    },
    phoneMode: {
      title: T('company_settings_modals_phoneMode_title'),
      searchable: false, // конфиг
    },
  },
};

export const PHONE_MODE_OPTIONS = [
  { id: 'always', label: T('company_settings_modals_phoneMode_options_always') },
  { id: 'never', label: T('company_settings_modals_phoneMode_options_never') },
  { id: 'window', label: T('company_settings_modals_phoneMode_options_window') },
];
