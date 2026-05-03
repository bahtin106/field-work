/* global AbortController, clearTimeout, setTimeout */

/**
 * Custom hook для логики входа с правильной обработкой:
 * - AbortController для отмены запросов
 * - Дебаунс
 * - Безопасная обработка ошибок
 * - Правильная очистка при unmount
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { isValidEmail, isValidPasswordForLogin } from '../lib/authValidation';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';
import {
  AUTH_ERRORS,
  AUTH_ERROR_MESSAGES,
  logAuthError,
  mapSupabaseAuthError,
} from '../lib/supabaseAuthErrors';
import { t } from '../src/i18n';

function buildBlockedByAdminMessage() {
  return `${t('auth_access_blocked')}. ${t('auth_blocked_subtitle')}`;
}

/**
 * Hook для авторизации с полной поддержкой жизненного цикла
 * @returns {Object} состояние и методы
 */
export function useAuthLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [accessBlock, setAccessBlock] = useState(null);

  // Refs для отмены запросов и управления жизненным циклом
  const abortControllerRef = useRef(null);
  const isMountedRef = useRef(false);
  const loginTimeoutRef = useRef(null);
  const loginAttemptIdRef = useRef(0);

  // Валидация (мемоизированная для зависимостей)
  const emailValid = isValidEmail(email);
  const passwordValid = isValidPasswordForLogin(password); // Для входа - без минимальной длины
  const canSubmit = emailValid && passwordValid && !loading;

  // Очищаем ошибку при изменении входных данных
  useEffect(() => {
    if (email || password) {
      setError('');
    }
  }, [email, password]);

  /**
   * Выполняет логин с правильной обработкой ошибок
   */
  const performLogin = useCallback(async (emailTrim, passwordValue) => {
    // Убедимся, что компонент ещё смонтирован
    if (!isMountedRef.current) {
      logger.warn('performLogin called after unmount');
      return;
    }

    // Отменяем предыдущие таймеры
    if (loginTimeoutRef.current) {
      clearTimeout(loginTimeoutRef.current);
      loginTimeoutRef.current = null;
    }

    // Отменяем предыдущий запрос если он ещё активен
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    const attemptId = ++loginAttemptIdRef.current;

    setLoading(true);
    setError('');

    try {
      // Выполняем запрос на авторизацию
      const { data, error: authErr } = await supabase.auth.signInWithPassword({
        email: emailTrim,
        password: passwordValue,
      }); // Проверяем, смонтирован ли компонент и не был ли отменён запрос
      if (
        !isMountedRef.current ||
        abortControllerRef.current?.signal.aborted ||
        attemptId !== loginAttemptIdRef.current
      ) {
        logger.debug('Login request abandoned (unmounted or aborted)');
        return false;
      }

      if (authErr) {
        // Логируем ошибку для аналитики
        logAuthError('login', authErr, { email: emailTrim });

        // Маппируем на UI-ошибку
        const errorKey = mapSupabaseAuthError(authErr);
        const errorMessage = t(errorKey, AUTH_ERROR_MESSAGES[errorKey]);

        setError(errorMessage);
        setLoading(false);
        return false;
      }

      // Успешный логин — проверяем что сессия действительно создана
      if (!data?.session?.access_token) {
        logger.warn('Login succeeded but no session token received');
        setError(t(AUTH_ERRORS.UNKNOWN_ERROR, AUTH_ERROR_MESSAGES[AUTH_ERRORS.UNKNOWN_ERROR]));
        setLoading(false);
        return false;
      }

      // Access gate: blocked users must not enter the app for any reason.
      try {
        const { data: accessData, error: accessError } = await supabase.rpc('get_my_access_state');
        if (!accessError) {
          const accessRow = Array.isArray(accessData) ? accessData[0] : accessData;
          if (accessRow && accessRow.can_login === false) {
            const blockCode = String(accessRow.block_code || 'access_blocked');
            const blockMessage =
              String(accessRow.block_message || '') ||
              (blockCode === 'blocked_by_license'
                ? t('auth_blocked_by_license')
                : blockCode === 'company_inactive'
                  ? t('auth_company_inactive')
                : buildBlockedByAdminMessage());
            setAccessBlock({ code: blockCode, message: blockMessage });
            setError(blockMessage);
            setLoading(false);
            return true;
          }
        } else {
          const { data: userRes } = await supabase.auth.getUser();
          const uid = userRes?.user?.id || null;
          if (uid) {
            let profile = null;

            const { data: byId } = await supabase
              .from('profiles')
              .select('is_admin_blocked, license_state, blocked_reason')
              .eq('id', uid)
              .maybeSingle();
            if (byId) {
              profile = byId;
            } else {
              const { data: byUserId } = await supabase
                .from('profiles')
                .select('is_admin_blocked, license_state, blocked_reason')
                .eq('user_id', uid)
                .maybeSingle();
              profile = byUserId || null;
            }

            const blockedByAdmin =
              !!profile?.is_admin_blocked;
            const blockedByLicense = String(profile?.license_state || '') === 'blocked_by_license';

            // Do not fail-close on profile lookup misses right after sign-in:
            // auth state is revalidated in root layout and can block access there.
            if (blockedByAdmin || blockedByLicense) {
              const blockCode = blockedByAdmin ? 'admin_blocked' : 'blocked_by_license';
              const blockMessage = blockedByAdmin
                ? buildBlockedByAdminMessage()
                : t('auth_blocked_by_license');
              setAccessBlock({ code: blockCode, message: blockMessage });
              setError(blockMessage);
              setLoading(false);
              return true;
            }
          }
        }
      } catch (e) {
        // Keep user signed in on transient access-check failures (e.g. mobile network/RPC hiccups).
        // Access is still enforced by periodic checks in root layout.
        logger.warn('Access check failed during login, allowing session and deferring recheck', {
          error: e?.message || String(e || ''),
        });
      }

      logger.info('Login successful', { email: emailTrim, hasSession: !!data.session });

      // Быстрая очистка после успешного логина
      const clearLoadingTimer = setTimeout(() => {
        if (isMountedRef.current) {
          setLoading(false);
          setEmail('');
          setPassword('');
          setError('');
        }
      }, 500);

      loginTimeoutRef.current = clearLoadingTimer;
      return true;
    } catch (err) {
      if (!isMountedRef.current || abortControllerRef.current?.signal.aborted) {
        logger.debug('Login error abandoned (unmounted or aborted)');
        return false;
      }

      logger.error('Unexpected login error', { error: err.message });

      const errorMessage = t(
        AUTH_ERRORS.UNKNOWN_ERROR,
        AUTH_ERROR_MESSAGES[AUTH_ERRORS.UNKNOWN_ERROR],
      );
      setError(errorMessage);
      setLoading(false);
      return false;
    }
  }, []);

  /**
   * Обработчик отправки формы (без дебаунса для лучшего UX)
   */
  const handleLogin = useCallback(async () => {
    // Быстрая проверка валидности
    if (!canSubmit) {
      return false;
    }

    // Если уже идет загрузка, не отправляем повторно
    if (loading) {
      return false;
    }

    // Отменяем предыдущий таймер если есть
    if (loginTimeoutRef.current) {
      clearTimeout(loginTimeoutRef.current);
    }

    // Вызываем сразу (без дебаунса для мгновенной реакции)
    return performLogin(email.trim(), password);
  }, [canSubmit, loading, email, password, performLogin]);

  /**
   * Установка mounted флага при mount
   */
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
      // Очищаем все таймеры
      if (loginTimeoutRef.current) {
        clearTimeout(loginTimeoutRef.current);
        loginTimeoutRef.current = null;
      }
    };
  }, []);

  const reset = useCallback(() => {
    setEmail('');
    setPassword('');
    setError('');
    setLoading(false);
    if (loginTimeoutRef.current) {
      clearTimeout(loginTimeoutRef.current);
      loginTimeoutRef.current = null;
    }
    setAccessBlock(null);
  }, []);

  return {
    // Состояние полей
    email,
    setEmail,
    password,
    setPassword,

    // Состояние процесса
    error,
    loading,

    // Валидация
    emailValid,
    passwordValid,
    canSubmit,

    // Методы
    handleLogin,
    reset,
    accessBlock,
    clearAccessBlock: () => setAccessBlock(null),
  };
}
