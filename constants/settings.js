// constants/settings.js
import { t as T } from '../src/i18n';

export const SETTINGS_SECTIONS = {
  COMPANY: {
    title: T('company_settings_sections_company_title'),
    items: [
      { key: 'timezone',  label: T('company_settings_sections_company_items_timezone'),  type: 'tz' },
      { key: 'employees', label: T('company_settings_sections_company_items_employees'), route: '/users',   showValue: false },
      { key: 'billing',   label: T('company_settings_sections_company_items_billing'),   route: '/billing', showValue: false },
    ],
  },
  MANAGEMENT: {
    title: T('company_settings_sections_management_title'),
    items: [
      { key: 'notifications', label: T('company_settings_sections_management_items_notifications'), route: '/company_settings/sections/notificationSettings' },
      { key: 'access',        label: T('company_settings_sections_management_items_access'),        route: '/company_settings/sections/access' },
      { key: 'form_builder',  label: T('company_settings_sections_management_items_form_builder'),  route: '/company_settings/sections/form-builder' },
      { key: 'work_types',    label: T('company_settings_sections_management_items_work_types'),    route: '/company_settings/sections/workTypesSettings' },
      { key: 'departments',   label: T('company_settings_sections_management_items_departments'),   route: '/company_settings/sections/departmentsSettings' },
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
    mode:         T('company_settings_sections_phone_items_phoneMode'),
    windowBefore: T('company_settings_sections_phone_items_windowBefore'),
    windowAfter:  T('company_settings_sections_phone_items_windowAfter'),
  },
  helperText: {
    departureOn:  T('company_settings_sections_departure_helperText_departureOn'),
    departureOff: T('company_settings_sections_departure_helperText_departureOff'),
  },
  modals: {
    timezone: {
      title:         T('company_settings_modals_timezone_title'),
      subtitleDevice:T('company_settings_modals_timezone_subtitleDevice'),
      searchable:    true,  // конфиг
    },
    phoneMode: {
      title:      T('company_settings_modals_phoneMode_title'),
      searchable: false, // конфиг
    },
  },
};

export const PHONE_MODE_OPTIONS = [
  { id: 'always', label: T('company_settings_modals_phoneMode_options_always') },
  { id: 'never',  label: T('company_settings_modals_phoneMode_options_never')  },
  { id: 'window', label: T('company_settings_modals_phoneMode_options_window') },
];
