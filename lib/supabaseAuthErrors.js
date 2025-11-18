/**
 * Профессиональное маппирование ошибок Supabase Auth.
 * Избегаем зависимости от текстов ошибок, используем стабильные коды.
 */

import { logger } from './logger';

// --- ОШИБКИ ПРИЛОЖЕНИЯ (UI) ---
export const AUTH_ERRORS = {
  INVALID_CREDENTIALS: 'errors_invalid_credentials',
  AUTH_ERROR: 'errors_auth_error',
  NETWORK_ERROR: 'errors_network_error',
  UNKNOWN_ERROR: 'errors_unknown_error',
  USER_NOT_FOUND: 'errors_user_not_found',
  TOO_MANY_REQUESTS: 'errors_too_many_requests',
};

// --- ЛОКАЛИЗОВАННЫЕ СООБЩЕНИЯ (fallback на русский) ---
export const AUTH_ERROR_MESSAGES = {
  [AUTH_ERRORS.INVALID_CREDENTIALS]: 'Неверный e-mail или пароль',
  [AUTH_ERRORS.AUTH_ERROR]: 'Ошибка авторизации',
  [AUTH_ERRORS.NETWORK_ERROR]: 'Проверьте подключение к интернету',
  [AUTH_ERRORS.UNKNOWN_ERROR]: 'Неизвестная ошибка',
  [AUTH_ERRORS.USER_NOT_FOUND]: 'Пользователь не найден',
  [AUTH_ERRORS.TOO_MANY_REQUESTS]: 'Слишком много попыток входа. Попробуйте позже',
};

/**
 * Маппирует ошибку Supabase на приложатель-ную ошибку
 * @param {Error|AuthError} error - ошибка от Supabase
 * @returns {string} ключ из AUTH_ERRORS для локализации
 */
export function mapSupabaseAuthError(error) {
  if (!error) {
    return AUTH_ERRORS.AUTH_ERROR;
  }

  const message = error?.message || '';
  const status = error?.status;

  // Классификация по официальным кодам и сообщениям Supabase
  // Документация: https://supabase.com/docs/reference/javascript/auth-signup

  // 401 - неверные учётные данные
  if (status === 401 || message.includes('Invalid login credentials')) {
    return AUTH_ERRORS.INVALID_CREDENTIALS;
  }

  // 429 - rate limit / too many requests
  if (status === 429 || message.includes('too many')) {
    return AUTH_ERRORS.TOO_MANY_REQUESTS;
  }

  // 404 - пользователь не найден
  if (status === 404 || message.includes('User not found')) {
    return AUTH_ERRORS.USER_NOT_FOUND;
  }

  // Сетевые ошибки
  if (message.includes('Network') || message.includes('ECONNREFUSED') || status === 0) {
    return AUTH_ERRORS.NETWORK_ERROR;
  }

  // Остальные ошибки
  return AUTH_ERRORS.AUTH_ERROR;
}

/**
 * Логирует ошибку авторизации с контекстом для отладки
 * @param {string} action - действие (login, signup и т.д.)
 * @param {Error} error - ошибка
 * @param {Object} context - контекстная информация (email и т.д.)
 */
export function logAuthError(action, error, context = {}) {
  const errorKey = mapSupabaseAuthError(error);

  // Неверные учётные данные - это обычная ситуация, не ERROR
  // Логируем как debug чтобы не засорять терминал
  if (errorKey === AUTH_ERRORS.INVALID_CREDENTIALS) {
    logger.debug(`Auth attempt during ${action}:`, {
      errorKey,
      email: context.email,
    });
    return;
  }

  // Остальные ошибки логируем как error (сетевые, серверные и т.д.)
  logger.error(`Auth error during ${action}:`, {
    errorKey,
    originalMessage: error?.message,
    status: error?.status,
    ...context,
  });
}

/**
 * Проверяет, есть ли интернет-соединение (простая heuristic)
 * В реальном приложении используй @react-native-community/netinfo
 * @returns {boolean}
 */
export function isNetworkError(error) {
  if (!error) return false;
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('network') ||
    message.includes('econnrefused') ||
    message.includes('timeout') ||
    error?.status === 0
  );
}
