// lib/calendarUtils.js

/**
 * Возвращает массив дней месяца с учётом сдвига по дням недели
 * @param {number} year - год
 * @param {number} month - месяц (0-11)
 * @param {number} firstDayOfWeek - первый день недели (0 = воскресенье, 1 = понедельник)
 * @returns {Array<{day: number|null, date: Date|null}>}
 */
export function getMonthDays(year, month, firstDayOfWeek = 1) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();

  // День недели первого числа (0 = воскресенье)
  let startDayOfWeek = firstDay.getDay();

  // Корректируем для понедельника как первого дня недели
  if (firstDayOfWeek === 1) {
    startDayOfWeek = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;
  }

  const days = [];

  // Добавляем пустые ячейки для выравнивания
  for (let i = 0; i < startDayOfWeek; i++) {
    days.push({ day: null, date: null });
  }

  // Добавляем дни месяца
  for (let day = 1; day <= daysInMonth; day++) {
    days.push({
      day,
      date: new Date(year, month, day),
    });
  }

  return days;
}

/**
 * Проверяет, является ли дата сегодняшним днём
 * @param {Date} date
 * @returns {boolean}
 */
export function isToday(date) {
  if (!date) return false;
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}

/**
 * Форматирует дату в yyyy-MM-dd для использования в markedDates
 * @param {Date} date
 * @returns {string}
 */
export function formatDateKey(date) {
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
