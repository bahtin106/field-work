// constants/strings.js
export function getStrings(t) {
  return {
  settingsTitle: t('company_settings_title'),
  sections: {
    company: {
      title: t('company_settings_sections_company_title'),
      items: {
        timezone: t('company_settings_sections_company_items_timezone'),
        employees: t('company_settings_sections_company_items_employees'),
        billing: t('company_settings_sections_company_items_billing'),
      },
    },
    management: {
      title: t('company_settings_sections_management_title'),
      items: {
        notifications: t('company_settings_sections_management_items_notifications'),
        access: t('company_settings_sections_management_items_access'),
        form_builder: t('company_settings_sections_management_items_form_builder'),
        work_types: t('company_settings_sections_management_items_work_types'),
        departments: t('company_settings_sections_management_items_departments'),
      },
    },
    departure: {
      title: t('company_settings_sections_departure_title'),
      toggles: {
        useDepartureTime: t('company_settings_sections_departure_toggles_useDepartureTime'),
      },
      helperText: {
        departureOn: t('company_settings_sections_departure_helperText_departureOn'),
        departureOff: t('company_settings_sections_departure_helperText_departureOff'),
      },
    },
    phone: {
      title: t('company_settings_sections_phone_title'),
      items: {
        phoneMode: t('company_settings_sections_phone_items_phoneMode'),
        windowBefore: t('company_settings_sections_phone_items_windowBefore'),
        windowAfter: t('company_settings_sections_phone_items_windowAfter'),
      },
    },
  },
  modals: {
    timezone: {
      title: t('company_settings_modals_timezone_title'),
      subtitleDevice: t('company_settings_modals_timezone_subtitleDevice'),
      searchable: true, // это конфиг, не перевод
    },
    phoneMode: {
      title: t('company_settings_modals_phoneMode_title'),
      options: {
        always: t('company_settings_modals_phoneMode_options_always'),
        never: t('company_settings_modals_phoneMode_options_never'),
        window: t('company_settings_modals_phoneMode_options_window'),
      },
      searchable: false, // это конфиг, не перевод
    },
  },
  };
}
