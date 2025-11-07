// components/navigation/useRouteTitle.js
import { useMemo } from 'react';
import { getRouteTitle } from '../../constants/routeTitles';
import { t as T } from '../../src/i18n';

/**
 * Возвращает финальный заголовок экрана по options/route/pathname
 * Инкапсулирует прежнюю логику resolveTitle и мемоизирует результат
 */
export function useRouteTitle(options = {}, route, pathnameRaw = '') {
  return useMemo(() => {
    // 1) Явный заголовок: params -> options
    const directRaw =
      route?.params?.title ?? route?.params?.headerTitle ?? options?.title ?? options?.headerTitle;

    // Важно: различаем undefined и пустую строку/плейсхолдер
    if (directRaw !== undefined) {
      const v = String(directRaw ?? '');
      const noName = String(T?.('placeholder_no_name', 'Без имени'));
      if (!v || v === noName) return '';
      return v;
    }

    const name = route?.name || '';
    const pathname = pathnameRaw || '';

    // Спец-случай: экран редактирования — показываем понятный заголовок
    if (typeof pathname === 'string' && pathname.includes('/edit')) {
      return globalThis?.S?.('edit_title') ?? 'Редактирование';
    }

    // Для страниц сотрудника скрываем автозаголовок до прихода данных
    if (pathname.startsWith('/users/')) return '';

    // 2) по имени роута через централизованный словарь
    const titleByName = getRouteTitle(name);
    if (titleByName) return titleByName;

    // 3) по пути через централизованный словарь
    const titleByPath = getRouteTitle(pathname.replace(/^\//, ''));
    if (titleByPath) return titleByPath;

    // 4) дефолт: имя роута или пусто
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
