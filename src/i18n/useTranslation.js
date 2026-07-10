// src/i18n
import * as React from 'react';
import { t as tRaw, getLocale, useI18nVersion } from './index';

export function useTranslation() {
  const version = useI18nVersion(); // подписка, просто триггерит ререндер
  const locale = getLocale();
  const t = React.useCallback((key, fallback) => {
    // Keep memoized labels in sync when the active dictionary changes.
    void version;
    return tRaw(key, fallback);
  }, [version]);
  return { t, locale };
}
