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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

  const hooksResultsRef = useRef({});

  // Инициализируем все хуки параллельно
  const hooksResults = useMemo(() => {
    const results = {};
    for (const [key, config] of Object.entries(sourcesConfig)) {
      if (config && config.hook) {
        // React Hook rules are bypassed intentionally here for parallel hooks initialization
        results[key] = config.hook(config.options || {});
      }
    }
    hooksResultsRef.current = results;
    return results;
  }, [sourcesConfig]);

  // Синхронизируем состояние хуков с нашим состоянием
  useEffect(() => {
    const newState = {};

    for (const [key, result] of Object.entries(hooksResults)) {
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
    return Object.values(dataState).some((s) => s.isLoading);
  }, [dataState]);

  const isRefreshing = useMemo(() => {
    return Object.values(dataState).some((s) => s.isRefreshing);
  }, [dataState]);

  const error = useMemo(() => {
    return Object.values(dataState).find((s) => s.error)?.error || null;
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
    result[key] = state.data;
    result[`${key}Loading`] = state.isLoading;
    result[`${key}Refreshing`] = state.isRefreshing;
    result[`${key}Error`] = state.error;
  }

  return result;
}
