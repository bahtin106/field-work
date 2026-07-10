import { enUS, ru } from 'date-fns/locale';

import { getLocale } from '../src/i18n';

export function resolveAppLocale(locale = getLocale()) {
  return String(locale || '').trim().toLowerCase().startsWith('en') ? 'en-US' : 'ru-RU';
}

export function resolveDateFnsLocale(locale = getLocale()) {
  return String(locale || '').trim().toLowerCase().startsWith('en') ? enUS : ru;
}
