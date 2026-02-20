// components/navigation/useRouteTitle.js
import { useMemo } from 'react';
import { getRouteTitle } from '../../constants/routeTitles';
import { t as T } from '../../src/i18n';

export function useRouteTitle(options = {}, route, pathnameRaw = '') {
  const isTechnicalLabel = (value) => {
    const v = String(value || '').trim();
    if (!v) return true;
    if (v.startsWith('routes.') || v.startsWith('routes/')) return true;
    if (v.includes('/') || v.includes('[') || v.includes(']') || v.includes('(') || v.includes(')')) {
      return true;
    }
    return false;
  };

  return useMemo(() => {
    const directRaw =
      route?.params?.title ?? route?.params?.headerTitle ?? options?.title ?? options?.headerTitle;

    if (directRaw !== undefined) {
      const v = String(directRaw ?? '');
      const noName = String(T?.('placeholder_no_name', 'Без имени'));
      if (!v || v === noName) return '';
      if (!isTechnicalLabel(v)) return v;
      // Ignore technical placeholder labels and continue with route-based title resolution.
    }

    const name = route?.name || '';
    const pathname = pathnameRaw || '';

    if (typeof pathname === 'string' && pathname.includes('/edit')) {
      return globalThis?.S?.('edit_title') ?? 'Редактирование';
    }

    if (pathname.startsWith('/users/')) return '';

    const titleByName = getRouteTitle(name);
    if (titleByName) return titleByName;

    const titleByPath = getRouteTitle(pathname.replace(/^\//, ''));
    if (titleByPath) return titleByPath;

    if (isTechnicalLabel(name)) return '';
    return name || '';
  }, [
    pathnameRaw,
    route?.name,
    route?.params?.title,
    route?.params?.headerTitle,
    options?.title,
    options?.headerTitle,
  ]);
}
