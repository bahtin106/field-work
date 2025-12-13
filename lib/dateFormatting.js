import { format } from 'date-fns';
import { ru as dfnsRu } from 'date-fns/locale';

/**
 * Форматирует дату в зависимости от настройки компании на отображение времени
 * @param {string|Date} dateIso - ISO дата или объект Date
 * @param {boolean} useDepartureTime - Включено ли отображение времени выезда
 * @returns {string} Отформатированная дата, с временем или без
 */
export function formatDateWithOptionalTime(dateIso, useDepartureTime = false) {
  if (!dateIso) return '';

  try {
    const date = typeof dateIso === 'string' ? new Date(dateIso) : dateIso;
    if (isNaN(date.getTime())) return '';

    // С временем: "13 декабря 2025, 14:30"
    if (useDepartureTime) {
      return format(date, 'd MMMM yyyy, HH:mm', { locale: dfnsRu });
    }

    // Без времени: "13 декабря 2025"
    return format(date, 'd MMMM yyyy', { locale: dfnsRu });
  } catch {
    return '';
  }
}

/**
 * Извлекает и форматирует только время из ISO даты
 * @param {string|Date} dateIso - ISO дата или объект Date
 * @returns {string} Время в формате "14:30" или пустая строка
 */
export function getTimeOnly(dateIso) {
  if (!dateIso) return '';

  try {
    const date = typeof dateIso === 'string' ? new Date(dateIso) : dateIso;
    if (isNaN(date.getTime())) return '';

    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/**
 * Форматирует дату в коротком формате (для карточек)
 * Используется в списках заявок
 * @param {string|Date} dateIso - ISO дата или объект Date
 * @param {boolean} useDepartureTime - Включено ли отображение времени выезда
 * @returns {string} Короткая дата, например "13 дек" или "13 дек, 14:30"
 */
export function formatDateShortWithOptionalTime(dateIso, useDepartureTime = false) {
  if (!dateIso) return '';

  try {
    const date = typeof dateIso === 'string' ? new Date(dateIso) : dateIso;
    if (isNaN(date.getTime())) return '';

    // С временем: "13 дек, 14:30"
    if (useDepartureTime) {
      return format(date, 'd MMM, HH:mm', { locale: dfnsRu });
    }

    // Без времени: "13 дек"
    return format(date, 'd MMM', { locale: dfnsRu });
  } catch {
    return '';
  }
}
