/**
 * Профессиональные валидаторы для authentication.
 * Все значения и ограничения централизованы и легко конфигурируемы.
 */

// --- КОНСТАНТЫ ВАЛИДАЦИИ ---
export const AUTH_CONSTRAINTS = {
  EMAIL: {
    MIN_LENGTH: 3,
    MAX_LENGTH: 254, // RFC 5321
    PATTERN: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  },
  PASSWORD: {
    MIN_LENGTH: 1, // На фронте можем не требовать, валидация на бэке
    MAX_LENGTH: 128,
  },
};

/**
 * Валидирует email согласно стандартам
 * @param {string} email
 * @returns {boolean} true если email валиден
 */
export function isValidEmail(email) {
  if (typeof email !== 'string') return false;

  const trimmed = email.trim().toLowerCase();
  const { MIN_LENGTH, MAX_LENGTH, PATTERN } = AUTH_CONSTRAINTS.EMAIL;

  // Проверка границ
  if (trimmed.length < MIN_LENGTH || trimmed.length > MAX_LENGTH) {
    return false;
  }

  // Проверка формата
  if (!PATTERN.test(trimmed)) {
    return false;
  }

  // Дополнительные проверки
  if (trimmed.includes('..')) {
    return false; // Повторяющиеся точки запрещены
  }

  return true;
}

/**
 * Валидирует пароль (базовые требования)
 * @param {string} password
 * @returns {boolean} true если пароль валиден
 */
export function isValidPassword(password) {
  if (typeof password !== 'string') return false;

  const { MIN_LENGTH, MAX_LENGTH } = AUTH_CONSTRAINTS.PASSWORD;

  return password.length >= MIN_LENGTH && password.length <= MAX_LENGTH;
}

/**
 * Возвращает причину, почему email не валиден (для логирования/отладки)
 * @param {string} email
 * @returns {string|null} причина или null если валиден
 */
export function getEmailValidationError(email) {
  if (typeof email !== 'string') {
    return 'email_is_not_string';
  }

  const trimmed = email.trim();

  if (trimmed.length === 0) {
    return 'email_is_empty';
  }

  if (trimmed.length < AUTH_CONSTRAINTS.EMAIL.MIN_LENGTH) {
    return 'email_too_short';
  }

  if (trimmed.length > AUTH_CONSTRAINTS.EMAIL.MAX_LENGTH) {
    return 'email_too_long';
  }

  if (!AUTH_CONSTRAINTS.EMAIL.PATTERN.test(trimmed)) {
    return 'email_invalid_format';
  }

  if (trimmed.includes('..')) {
    return 'email_has_double_dots';
  }

  return null;
}
