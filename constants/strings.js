// constants/strings.js
import { t as T } from '../src/i18n';

export const strings = {
  settingsTitle: T('company_settings_title'),
  sections: {
    company: {
      title: T('company_settings_sections_company_title'),
      items: {
        timezone: T('company_settings_sections_company_items_timezone'),
        employees: T('company_settings_sections_company_items_employees'),
        billing: T('company_settings_sections_company_items_billing'),
      },
    },
    management: {
      title: T('company_settings_sections_management_title'),
      items: {
        notifications: T('company_settings_sections_management_items_notifications'),
        access: T('company_settings_sections_management_items_access'),
        form_builder: T('company_settings_sections_management_items_form_builder'),
        work_types: T('company_settings_sections_management_items_work_types'),
        departments: T('company_settings_sections_management_items_departments'),
      },
    },
    departure: {
      title: T('company_settings_sections_departure_title'),
      toggles: { useDepartureTime: T('company_settings_sections_departure_toggles_useDepartureTime') },
      helperText: {
        departureOn: T('company_settings_sections_departure_helperText_departureOn'),
        departureOff: T('company_settings_sections_departure_helperText_departureOff'),
      },
    },
    phone: {
      title: T('company_settings_sections_phone_title'),
      items: {
        phoneMode: T('company_settings_sections_phone_items_phoneMode'),
        windowBefore: T('company_settings_sections_phone_items_windowBefore'),
        windowAfter: T('company_settings_sections_phone_items_windowAfter'),
      },
    },
  },
  modals: {
    timezone: {
      title: T('company_settings_modals_timezone_title'),
      subtitleDevice: T('company_settings_modals_timezone_subtitleDevice'),
      searchable: true, // это конфиг, не перевод
    },
    phoneMode: {
      title: T('company_settings_modals_phoneMode_title'),
      options: {
        always: T('company_settings_modals_phoneMode_options_always'),
        never: T('company_settings_modals_phoneMode_options_never'),
        window: T('company_settings_modals_phoneMode_options_window'),
      },
      searchable: false, // это конфиг, не перевод
    },
  },
};
