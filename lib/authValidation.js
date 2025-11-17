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
    MIN_LENGTH: 8, // Минимум 8 символов
    MAX_LENGTH: 128,
    // Разрешенные символы: латиница, цифры, спецсимволы (без кириллицы и экзотики)
    ALLOWED_CHARS_PATTERN: /^[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]+$/,
    // Паттерн для поиска НЕДОПУСТИМЫХ символов (для сообщений пользователю)
    INVALID_CHARS_PATTERN: /[^a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/g,
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

  const { MIN_LENGTH, MAX_LENGTH, ALLOWED_CHARS_PATTERN } = AUTH_CONSTRAINTS.PASSWORD;

  // Проверка длины
  if (password.length < MIN_LENGTH || password.length > MAX_LENGTH) {
    return false;
  }

  // Проверка на допустимые символы
  if (!ALLOWED_CHARS_PATTERN.test(password)) {
    return false;
  }

  return true;
}

/**
 * Проверяет, содержит ли строка недопустимые символы для пароля
 * @param {string} password
 * @returns {boolean} true если есть недопустимые символы
 */
export function hasInvalidPasswordChars(password) {
  if (typeof password !== 'string') return false;
  return AUTH_CONSTRAINTS.PASSWORD.INVALID_CHARS_PATTERN.test(password);
}

/**
 * Фильтрует строку, оставляя только допустимые символы для пароля
 * @param {string} input
 * @returns {string} отфильтрованная строка
 */
export function filterPasswordInput(input) {
  if (typeof input !== 'string') return '';
  return input.replace(AUTH_CONSTRAINTS.PASSWORD.INVALID_CHARS_PATTERN, '');
}

/**
 * Возвращает детальную информацию о проблемах с паролем
 * @param {string} password
 * @returns {object} { valid: boolean, errors: string[] }
 */
export function getPasswordValidationErrors(password) {
  const errors = [];

  if (typeof password !== 'string') {
    return { valid: false, errors: ['password_not_string'] };
  }

  const { MIN_LENGTH, MAX_LENGTH } = AUTH_CONSTRAINTS.PASSWORD;

  if (password.length === 0) {
    errors.push('password_empty');
  } else if (password.length < MIN_LENGTH) {
    errors.push('password_too_short');
  }

  if (password.length > MAX_LENGTH) {
    errors.push('password_too_long');
  }

  if (hasInvalidPasswordChars(password)) {
    errors.push('password_invalid_chars');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
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
