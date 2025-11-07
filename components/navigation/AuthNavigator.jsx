import { useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { useEffect, useRef } from 'react';
import logger from '../../lib/logger';

export default function AuthNavigator({ isLoggedIn, onNavigationComplete }) {
  const router = useRouter();
  const segments = useSegments();
  const navigationState = useRootNavigationState();
  const navigationAttempts = useRef(0);
  const timeoutRef = useRef(null);

  const performNavigation = async () => {
    if (!navigationState?.key) {
      logger.warn('Navigation not ready, waiting...');
      return false;
    }

    const seg0 = Array.isArray(segments) ? segments[0] : undefined;
    const inAuth = seg0 === '(auth)';

    // Решаем нужна ли навигация
    const needsNavigation = (!isLoggedIn && !inAuth) || (isLoggedIn && inAuth);
    if (!needsNavigation) {
      return true;
    }

    try {
      navigationAttempts.current += 1;
      logger.warn(`Navigation attempt ${navigationAttempts.current}`);

      const target = isLoggedIn ? '/orders' : '/(auth)/login';
      await router.replace(target);

      logger.warn('Navigation successful');
      return true;
    } catch (e) {
      logger.warn(`Navigation failed (attempt ${navigationAttempts.current}):`, e);
      return false;
    }
  };

  useEffect(() => {
    // Сбрасываем счетчик попыток при изменении статуса логина
    navigationAttempts.current = 0;

    const attemptNavigation = async () => {
      // Очищаем предыдущий таймаут если есть
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      const success = await performNavigation();

      if (success) {
        if (onNavigationComplete) {
          onNavigationComplete();
        }
      } else if (navigationAttempts.current < 3) {
        // Пробуем еще раз через увеличивающийся интервал
        const delay = Math.min(1000 * Math.pow(2, navigationAttempts.current - 1), 5000);
        logger.warn(`Scheduling next attempt in ${delay}ms`);
        timeoutRef.current = setTimeout(attemptNavigation, delay);
      } else {
        logger.warn('All navigation attempts failed');
      }
    };

    attemptNavigation();

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isLoggedIn, navigationState?.key, segments]);

  return null;
}
