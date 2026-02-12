/* global console */
/**
 * Link Prefetch Component - Умная предзагрузка при наведении
 *
 * Использование:
 * <PrefetchLink to="/users/123" prefetchKey="user:123">
 *   <Text>Профиль пользователя</Text>
 * </PrefetchLink>
 */

import { useRouter } from 'expo-router';
import React from 'react';
import { Platform, Pressable } from 'react-native';
import { prefetchManager } from '../lib/prefetch';

export function PrefetchLink({
  to,
  prefetchKey,
  children,
  onPress,
  prefetchDelay = 100, // Задержка перед prefetch (ms)
  ...props
}) {
  const router = useRouter();
  const prefetchTimerRef = React.useRef(null);
  const hasPrefetched = React.useRef(false);

  const handlePrefetch = React.useCallback(() => {
    if (hasPrefetched.current || !prefetchKey) return;

    // Очищаем предыдущий таймер
    if (prefetchTimerRef.current) {
      clearTimeout(prefetchTimerRef.current);
    }

    // Ставим небольшую задержку - если пользователь просто проводит мышью, не грузим
    prefetchTimerRef.current = setTimeout(async () => {
      try {
        await prefetchManager.prefetchPage(prefetchKey);
        hasPrefetched.current = true;
        console.info(`[PrefetchLink] Prefetched: ${prefetchKey}`);
      } catch (error) {
        console.info(`[PrefetchLink] Failed to prefetch ${prefetchKey}:`, error.message);
      }
    }, prefetchDelay);
  }, [prefetchKey, prefetchDelay]);

  const handleCancelPrefetch = React.useCallback(() => {
    if (prefetchTimerRef.current) {
      clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = null;
    }
  }, []);

  const handlePress = React.useCallback(() => {
    // Отменяем prefetch если он еще не завершен
    handleCancelPrefetch();

    // Вызываем кастомный onPress если есть
    if (onPress) {
      onPress();
    } else if (to) {
      router.push(to);
    }
  }, [to, onPress, router, handleCancelPrefetch]);

  // Очищаем таймер при размонтировании
  React.useEffect(() => {
    return () => {
      if (prefetchTimerRef.current) {
        clearTimeout(prefetchTimerRef.current);
      }
    };
  }, []);

  // На web используем hover, на mobile - долгое нажатие (опционально)
  const prefetchProps =
    Platform.OS === 'web'
      ? {
          onMouseEnter: handlePrefetch,
          onMouseLeave: handleCancelPrefetch,
        }
      : {
          // На мобильных можно использовать долгое нажатие для prefetch
          // onLongPress: handlePrefetch,
        };

  return (
    <Pressable onPress={handlePress} {...prefetchProps} {...props}>
      {children}
    </Pressable>
  );
}

/**
 * Hook для ручной предзагрузки
 *
 * Использование:
 * const { prefetch } = useLinkPrefetch();
 *
 * // При скролле видимых элементов
 * useEffect(() => {
 *   visibleUsers.forEach(user => {
 *     prefetch(`user:${user.id}`);
 *   });
 * }, [visibleUsers]);
 */
export function useLinkPrefetch() {
  const prefetch = React.useCallback(async (prefetchKey, delay = 0) => {
    if (!prefetchKey) return;

    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      await prefetchManager.prefetchPage(prefetchKey);
    } catch (error) {
      console.info(`[useLinkPrefetch] Failed to prefetch ${prefetchKey}:`, error.message);
    }
  }, []);

  return { prefetch };
}

