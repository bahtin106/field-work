// apps/field-work/constants/settings.js
import { strings } from './strings';

export const SETTINGS_SECTIONS = {
  COMPANY: {
    title: strings.sections.company.title,
    items: [
      { key: 'timezone', label: strings.sections.company.items.timezone, type: 'tz' },
      { key: 'employees', label: strings.sections.company.items.employees, route: '/users', showValue: false },
      { key: 'billing', label: strings.sections.company.items.billing, route: '/billing', showValue: false },
    ],
  },
  MANAGEMENT: {
    title: strings.sections.management.title,
    items: [
      { key: 'notifications', label: strings.sections.management.items.notifications, route: '/settings/notifications' },
      { key: 'access', label: strings.sections.management.items.access, route: '/settings/access' },
      { key: 'form_builder', label: strings.sections.management.items.form_builder, route: '/settings/sections/form-builder' },
      { key: 'work_types', label: strings.sections.management.items.work_types, route: '/settings/sections/WorkTypesSettings' },
      { key: 'departments', label: strings.sections.management.items.departments, route: '/settings/sections/DepartmentsSettings' },
    ],
  },
  DEPARTURE: {
    title: strings.sections.departure.title,
  },
  PHONE: {
    title: strings.sections.phone.title,
  },
};

export const UI_TEXT = {
  settingsTitle: strings.settingsTitle,
  toggles: {
    useDepartureTime: strings.sections.departure.toggles.useDepartureTime,
  },
  phone: {
    mode: strings.sections.phone.items.phoneMode,
    windowBefore: strings.sections.phone.items.windowBefore,
    windowAfter: strings.sections.phone.items.windowAfter,
  },
  helperText: {
    departureOn: strings.sections.departure.helperText.departureOn,
    departureOff: strings.sections.departure.helperText.departureOff,
  },
  modals: {
    timezone: {
      title: strings.modals.timezone.title,
      subtitleDevice: strings.modals.timezone.subtitleDevice,
      searchable: strings.modals.timezone.searchable,
    },
    phoneMode: {
      title: strings.modals.phoneMode.title,
      searchable: strings.modals.phoneMode.searchable,
    },
  },
};

export const PHONE_MODE_OPTIONS = [
  { id: 'always', label: strings.modals.phoneMode.options.always },
  { id: 'never',  label: strings.modals.phoneMode.options.never },
  { id: 'window', label: strings.modals.phoneMode.options.window },
];
