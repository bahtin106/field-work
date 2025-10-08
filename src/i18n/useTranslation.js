// src/i18n
import * as React from 'react';
import { t as tRaw, getLocale, useI18nVersion } from './index';

export function useTranslation() {
  useI18nVersion(); // подписка, просто триггерит ререндер
  const locale = getLocale();
  const t = React.useCallback((key, fallback) => tRaw(key, fallback), []);
  return { t, locale };
}
