/**
 * Правильное склонение числительных в русском языке
 *
 * @example
 * pluralizeRu(1, 'час', 'часа', 'часов')   → 'час'
 * pluralizeRu(2, 'час', 'часа', 'часов')   → 'часа'
 * pluralizeRu(5, 'час', 'часа', 'часов')   → 'часов'
 * pluralizeRu(11, 'час', 'часа', 'часов')  → 'часов'
 * pluralizeRu(21, 'час', 'часа', 'часов')  → 'час'
 * pluralizeRu(22, 'час', 'часа', 'часов')  → 'часа'
 * pluralizeRu(25, 'час', 'часа', 'часов')  → 'часов'
 *
 * @param {number} n - число
 * @param {string} form1 - форма для 1 (час, минута, день, заказ)
 * @param {string} form2 - форма для 2-4 (часа, минуты, дня, заказа)
 * @param {string} form5 - форма для 5+ (часов, минут, дней, заказов)
 * @returns {string} правильная форма
 */
export function pluralizeRu(n, form1, form2, form5) {
  const abs = Math.abs(n) % 100;
  const rem = abs % 10;

  // Исключения: 11-14 всегда используют форму для 5+
  if (abs >= 11 && abs <= 14) return form5;

  // 1, 21, 31, 41... → форма 1
  if (rem === 1) return form1;

  // 2-4, 22-24, 32-34... → форма 2
  if (rem >= 2 && rem <= 4) return form2;

  // 0, 5-20, 25-30... → форма 5
  return form5;
}

/**
 * Форматирование времени в относительном формате с правильным склонением
 *
 * @example
 * formatRelativeTime(1, 'минута', 'минуты', 'минут')   → '1 минута назад'
 * formatRelativeTime(2, 'минута', 'минуты', 'минут')   → '2 минуты назад'
 * formatRelativeTime(5, 'минута', 'минуты', 'минут')   → '5 минут назад'
 * formatRelativeTime(22, 'час', 'часа', 'часов')       → '22 часа назад'
 *
 * @param {number} n - количество единиц времени
 * @param {string} form1 - форма для 1
 * @param {string} form2 - форма для 2-4
 * @param {string} form5 - форма для 5+
 * @param {string} suffix - суффикс (по умолчанию 'назад')
 * @returns {string} отформатированная строка
 */
export function formatRelativeTime(n, form1, form2, form5, suffix = 'назад') {
  const word = pluralizeRu(n, form1, form2, form5);
  return `${n} ${word} ${suffix}`;
}
