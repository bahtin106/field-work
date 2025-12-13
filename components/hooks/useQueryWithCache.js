/* global console, setTimeout, document */
/**
 * useQueryWithCache - Профессиональный хук для загрузки и кэширования данных
 *
 * Возможности:
 * - Stale-While-Revalidate: показывает кэшированные данные и обновляет в фоне
 * - Pull-to-refresh с анимацией
 * - Оптимистичные обновления
 * - Автоматический retry при ошибках
 * - Дедупликация запросов
 * - Поддержка Supabase realtime
 *
 * @example
 * const { data, isLoading, isRefreshing, refresh, error } = useQueryWithCache({
 *   queryKey: 'users',
 *   queryFn: async () => {
 *     const { data } = await supabase.from('profiles').select('*');
 *     return data;
 *   },
 *   ttl: 5 * 60 * 1000, // 5 минут
 *   staleTime: 30 * 1000, // 30 секунд
 *   enableRealtime: true,
 *   realtimeTable: 'profiles',
 * });
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { globalCache } from '../../lib/cache/DataCache';

// Глобальное хранилище активных запросов для дедупликации
const activeRequests = new Map();

export function useQueryWithCache(options) {
  const {
    queryKey,
    queryFn,
    ttl = 5 * 60 * 1000, // 5 минут по умолчанию
    staleTime = 30 * 1000, // 30 секунд до повторной загрузки
    enabled = true,
    retry = 3,
    retryDelay = 1000,
    onSuccess,
    onError,
    enableRealtime = false,
    realtimeTable,
    realtimeChannel,
    supabaseClient,
    placeholderData,
    refetchOnFocus = true,
  } = options;

  const [data, setData] = useState(() => {
    // Пытаемся получить данные из кэша при инициализации
    const cached = globalCache.get(queryKey, staleTime);
    if (cached?.data) {
      return cached.data;
    }
    return placeholderData || null;
  });

  const [isLoading, setIsLoading] = useState(() => {
    // Если есть кэшированные данные, не показываем loader
    const cached = globalCache.get(queryKey, staleTime);
    return !cached?.data && enabled;
  });

  // КРИТИЧНО: Гарантированный таймаут для разблокировки isLoading
  useEffect(() => {
    if (!enabled || !isLoading) return;

    const timeout = setTimeout(() => {
      if (mountedRef.current && isLoading) {
        console.warn(`⏰ useQueryWithCache timeout for ${queryKey} - force stop loading`);
        setIsLoading(false);
        setIsRefreshing(false);
        setIsFetching(false);
      }
    }, 10000); // 10 секунд максимум на загрузку

    return () => clearTimeout(timeout);
  }, [enabled, isLoading, queryKey]);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [isFetching, setIsFetching] = useState(false);

  const mountedRef = useRef(true);
  const retryCountRef = useRef(0);
  const realtimeChannelRef = useRef(null);

  // Основная функция загрузки данных
  const fetchData = useCallback(
    async (options = {}) => {
      const { isRefresh = false, skipCache = false } = options;

      // Проверяем кэш перед загрузкой
      if (!skipCache && !isRefresh) {
        const cached = globalCache.get(queryKey, staleTime);
        if (cached && !cached.isStale) {
          // Данные свежие, используем кэш
          if (mountedRef.current) {
            setData(cached.data);
            setIsLoading(false);
            setError(null);
          }
          return cached.data;
        }

        // Данные stale - показываем их, но загружаем свежие в фоне
        if (cached?.data) {
          if (mountedRef.current) {
            setData(cached.data);
            setIsLoading(false);
            setIsFetching(true); // Показываем что идет фоновая загрузка
          }
        }
      }

      // Дедупликация запросов - если запрос уже идет, ждем его
      if (activeRequests.has(queryKey) && !isRefresh) {
        try {
          const existingPromise = activeRequests.get(queryKey);
          return await existingPromise;
        } catch {
          // Если существующий запрос упал, продолжаем с новым
        }
      }

      // Создаем новый запрос
      const requestPromise = (async () => {
        try {
          // КРИТИЧНО: Добавляем таймаут для queryFn
          const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Query timeout')), 15000),
          );

          const result = await Promise.race([queryFn(), timeout]);

          if (mountedRef.current) {
            setData(result);
            setError(null);
            setIsLoading(false);
            setIsRefreshing(false);
            setIsFetching(false);
            retryCountRef.current = 0;
          }

          // Сохраняем в кэш
          globalCache.set(queryKey, result, ttl);

          // Вызываем onSuccess callback
          if (onSuccess) {
            onSuccess(result);
          }

          return result;
        } catch (err) {
          // Retry логика
          if (retryCountRef.current < retry) {
            retryCountRef.current++;
            await new Promise((resolve) => setTimeout(resolve, retryDelay));
            return fetchData(options);
          }

          if (mountedRef.current) {
            setError(err);
            setIsLoading(false);
            setIsRefreshing(false);
            setIsFetching(false);
          }

          // Вызываем onError callback
          if (onError) {
            onError(err);
          }

          throw err;
        } finally {
          // Удаляем из активных запросов
          activeRequests.delete(queryKey);
        }
      })();

      // Сохраняем запрос в активных
      activeRequests.set(queryKey, requestPromise);

      return requestPromise;
    },
    [queryKey, queryFn, ttl, staleTime, retry, retryDelay, onSuccess, onError],
  );

  // Pull-to-refresh функция
  const refresh = useCallback(async () => {
    if (!enabled || isRefreshing) return;

    setIsRefreshing(true);
    setError(null);

    try {
      await fetchData({ isRefresh: true, skipCache: true });
    } catch (err) {
      console.error('Refresh error:', err);
    }
  }, [enabled, isRefreshing, fetchData]);

  // Оптимистичное обновление данных
  const mutate = useCallback(
    (updater) => {
      setData((prevData) => {
        const newData = typeof updater === 'function' ? updater(prevData) : updater;
        // Сохраняем оптимистичное обновление в кэш
        globalCache.set(queryKey, newData, ttl);
        return newData;
      });
    },
    [queryKey, ttl],
  );

  // Инвалидация кэша
  const invalidate = useCallback(() => {
    globalCache.delete(queryKey);
  }, [queryKey]);

  // Начальная загрузка данных
  useEffect(() => {
    if (!enabled) {
      // КРИТИЧНО: Если disabled, сразу сбрасываем isLoading
      if (mountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
        setIsFetching(false);
      }
      return;
    }

    fetchData().catch(() => {
      // Гарантируем сброс loading даже при ошибке
      if (mountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
        setIsFetching(false);
      }
    });
  }, [enabled, queryKey]); // Перезагружаем при изменении queryKey

  // Realtime подписка
  useEffect(() => {
    if (!enableRealtime || !supabaseClient || !realtimeTable) return;

    const channelName = realtimeChannel || `realtime:${queryKey}`;

    const channel = supabaseClient
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: realtimeTable }, () => {
        // Обновляем данные в фоне при изменениях
        fetchData({ skipCache: true });
      })
      .subscribe();

    realtimeChannelRef.current = channel;

    return () => {
      if (realtimeChannelRef.current) {
        try {
          realtimeChannelRef.current.unsubscribe();
        } catch (err) {
          console.error('Error unsubscribing from realtime:', err);
        }
      }
    };
  }, [enableRealtime, supabaseClient, realtimeTable, realtimeChannel, queryKey, fetchData]);

  // Refetch on focus
  useEffect(() => {
    if (!refetchOnFocus || !enabled) return;

    const handleAppStateChange = () => {
      const cached = globalCache.get(queryKey, staleTime);
      if (cached?.isStale) {
        fetchData({ skipCache: true });
      }
    };

    // Для React Native можно использовать AppState
    // Для web - visibilitychange
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleAppStateChange);
      return () => {
        document.removeEventListener('visibilitychange', handleAppStateChange);
      };
    }
  }, [refetchOnFocus, enabled, queryKey, fetchData]);

  // Cleanup
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    data,
    isLoading,
    isRefreshing,
    isFetching,
    error,
    refresh,
    refetch: refresh,
    mutate,
    invalidate,
  };
}
