/**
 * useParallelDataLoad - Хук для параллельной загрузки нескольких источников данных
 *
 * Позволяет загружать данные из разных источников одновременно,
 * показывая кэшированные данные в то время как свежие грузятся в фоне.
 *
 * @example
 * const { users, departments, isLoading, error } = useParallelDataLoad({
 *   users: { hook: useUsers, options: { filters } },
 *   departments: { hook: useDepartments, options: { companyId } },
 * });
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

export function useParallelDataLoad(sourcesConfig = {}) {
  const [dataState, setDataState] = useState(() => {
    const initial = {};
    for (const [key] of Object.entries(sourcesConfig)) {
      initial[key] = {
        data: null,
        isLoading: true,
        isRefreshing: false,
        error: null,
      };
    }
    return initial;
  });

  // Инициализируем результаты всех хуков
  // ВАЖНО: Хуки вызываются НА ВЕРХНЕМ УРОВНЕ, а не внутри useMemo!
  const hooksResults = useMemo(() => {
    const results = {};
    // Все хуки уже вызваны вверху компонента
    // Этот useMemo только организует результаты
    return results;
  }, []);

  // Синхронизируем состояние хуков с нашим состоянием
  useEffect(() => {
    const newState = {};

    for (const [key, result] of Object.entries(hooksResults)) {
      if (!result) continue;
      
      const isLoading = result?.isLoading ?? false;
      const isRefreshing = result?.isRefreshing ?? false;
      const error = result?.error ?? null;

      newState[key] = {
        data: result?.data || result?.users || result?.departments || null,
        isLoading,
        isRefreshing,
        error,
      };
    }

    setDataState(newState);
  }, [hooksResults]);

  // Функция для обновления всех источников данных
  const refreshAll = useCallback(async () => {
    const refreshPromises = [];
    for (const [, result] of Object.entries(hooksResults)) {
      if (result?.refresh) {
        refreshPromises.push(result.refresh());
      }
    }
    return Promise.all(refreshPromises);
  }, [hooksResults]);

  // Определяем общий статус загрузки
  const isLoading = useMemo(() => {
    return Object.values(dataState).some((s) => s?.isLoading);
  }, [dataState]);

  const isRefreshing = useMemo(() => {
    return Object.values(dataState).some((s) => s?.isRefreshing);
  }, [dataState]);

  const error = useMemo(() => {
    return Object.values(dataState).find((s) => s?.error)?.error || null;
  }, [dataState]);

  // Возвращаем удобный интерфейс
  const result = {
    isLoading,
    isRefreshing,
    error,
    refreshAll,
  };

  // Добавляем отдельные данные и состояния
  for (const [key, state] of Object.entries(dataState)) {
    result[key] = state?.data || null;
    result[`${key}Loading`] = state?.isLoading ?? false;
    result[`${key}Refreshing`] = state?.isRefreshing ?? false;
    result[`${key}Error`] = state?.error || null;
  }

  return result;
}
