import { useEffect, useState } from 'react';
import { getMyCompanyId } from '../lib/workTypes';

/**
 * ПРОФЕССИОНАЛЬНОЕ РЕШЕНИЕ: Глобальный синглтон для companyId
 *
 * Проблема: При каждом монтировании компонента companyId загружался заново,
 * что приводило к изменению queryKey и повторной загрузке данных.
 *
 * Решение: Кэшируем companyId в памяти приложения (глобальный синглтон).
 * Загружаем его только один раз при первом вызове, все последующие вызовы
 * возвращают закэшированное значение мгновенно.
 */

// Глобальный кэш для companyId (синглтон паттерн)
let cachedCompanyId = null;
let cachedError = null;
let loadingPromise = null;

// Функция загрузки с кэшированием
const loadCompanyId = async () => {
  // Если уже загружено, возвращаем кэш
  if (cachedCompanyId !== null) {
    return cachedCompanyId;
  }

  // Если идет загрузка, ждем её завершения
  if (loadingPromise !== null) {
    return loadingPromise;
  }

  // Начинаем загрузку
  loadingPromise = getMyCompanyId()
    .then((id) => {
      cachedCompanyId = id;
      cachedError = null;
      loadingPromise = null;
      return id;
    })
    .catch((e) => {
      cachedError = e;
      loadingPromise = null;
      throw e;
    });

  return loadingPromise;
};

/**
 * Хук для получения companyId с глобальным кэшированием
 * Загружает companyId только один раз при первом вызове,
 * все последующие вызовы возвращают закэшированное значение
 */
export const useMyCompanyId = () => {
  const [companyId, setCompanyId] = useState(cachedCompanyId);
  const [loading, setLoading] = useState(cachedCompanyId === null);
  const [error, setError] = useState(cachedError);

  useEffect(() => {
    // Если уже в кэше, не загружаем
    if (cachedCompanyId !== null) {
      setCompanyId(cachedCompanyId);
      setLoading(false);
      return;
    }

    // Если была ошибка, возвращаем её
    if (cachedError !== null) {
      setError(cachedError);
      setLoading(false);
      return;
    }

    // Загружаем с кэшированием
    setLoading(true);
    loadCompanyId()
      .then((id) => {
        setCompanyId(id);
        setError(null);
      })
      .catch((e) => {
        setError(e);
        console.error('Failed to fetch company ID:', e);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return { companyId, loading, error };
};

/**
 * Функция для очистки кэша (используется при logout)
 */
export const clearCompanyIdCache = () => {
  cachedCompanyId = null;
  cachedError = null;
  loadingPromise = null;
};
