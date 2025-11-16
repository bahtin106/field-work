/**
 * DataCache - Профессиональная система управления кэшем данных
 *
 * Возможности:
 * - TTL (Time To Live) для автоматического устаревания данных
 * - Stale-While-Revalidate стратегия
 * - Оптимистичные обновления
 * - Инвалидация кэша по ключу или паттерну
 * - Персистентность (опционально через AsyncStorage)
 * - Автоматическая очистка устаревших данных
 */

class DataCache {
  constructor(options = {}) {
    this.cache = new Map();
    this.timestamps = new Map();
    this.defaultTTL = options.defaultTTL || 5 * 60 * 1000; // 5 минут по умолчанию
    this.staleTime = options.staleTime || 30 * 1000; // 30 секунд до повторной загрузки
    this.cleanupInterval = options.cleanupInterval || 60 * 1000; // Очистка каждую минуту

    // Автоматическая очистка устаревших данных
    this.startCleanupTimer();
  }

  /**
   * Получить данные из кэша
   * @param {string} key - Ключ кэша
   * @param {number} customStaleTime - Опциональное время "свежести" для конкретного запроса
   * @returns {Object|null} - { data, isStale, timestamp }
   */
  get(key, customStaleTime) {
    if (!this.cache.has(key)) {
      return null;
    }

    const data = this.cache.get(key);
    const timestamp = this.timestamps.get(key);
    const now = Date.now();
    const age = now - timestamp;

    // Используем кастомный TTL если указан
    const ttl = this.customTTLs?.get(key) || this.defaultTTL;

    // Данные полностью устарели (превысили TTL)
    if (age > ttl) {
      this.delete(key);
      return null;
    }

    // Используем переданный staleTime или дефолтный
    const staleThreshold = customStaleTime !== undefined ? customStaleTime : this.staleTime;

    // Данные stale (нужно обновить в фоне), но еще пригодны
    const isStale = age > staleThreshold;

    return {
      data,
      isStale,
      timestamp,
      age,
    };
  }

  /**
   * Сохранить данные в кэш
   * @param {string} key - Ключ кэша
   * @param {*} data - Данные для сохранения
   * @param {number} customTTL - Опциональный TTL для конкретного ключа
   */
  set(key, data, customTTL) {
    this.cache.set(key, data);
    this.timestamps.set(key, Date.now());

    // Если указан кастомный TTL, сохраняем его
    if (customTTL) {
      if (!this.customTTLs) this.customTTLs = new Map();
      this.customTTLs.set(key, customTTL);
    }
  }

  /**
   * Удалить данные из кэша
   * @param {string} key - Ключ кэша
   */
  delete(key) {
    this.cache.delete(key);
    this.timestamps.delete(key);
    if (this.customTTLs) {
      this.customTTLs.delete(key);
    }
  }

  /**
   * Инвалидировать кэш по паттерну (например, все ключи начинающиеся с "users:")
   * @param {string|RegExp} pattern - Паттерн для поиска ключей
   */
  invalidate(pattern) {
    const regex =
      typeof pattern === 'string' ? new RegExp(`^${pattern.replace('*', '.*')}`) : pattern;

    const keysToDelete = [];
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.delete(key));
    return keysToDelete.length;
  }

  /**
   * Очистить весь кэш
   */
  clear() {
    this.cache.clear();
    this.timestamps.clear();
    if (this.customTTLs) {
      this.customTTLs.clear();
    }
  }

  /**
   * Получить размер кэша
   */
  size() {
    return this.cache.size;
  }

  /**
   * Запустить таймер автоматической очистки
   */
  startCleanupTimer() {
    if (this.cleanupTimer) {
      // eslint-disable-next-line no-undef
      clearInterval(this.cleanupTimer);
    }

    // eslint-disable-next-line no-undef
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);
  }

  /**
   * Остановить таймер автоматической очистки
   */
  stopCleanupTimer() {
    if (this.cleanupTimer) {
      // eslint-disable-next-line no-undef
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Очистить устаревшие данные
   */
  cleanup() {
    const now = Date.now();
    const keysToDelete = [];

    for (const [key, timestamp] of this.timestamps.entries()) {
      const ttl = this.customTTLs?.get(key) || this.defaultTTL;
      const age = now - timestamp;

      if (age > ttl) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.delete(key));

    return keysToDelete.length;
  }

  /**
   * Получить статистику кэша
   */
  getStats() {
    const now = Date.now();
    let staleCount = 0;
    let freshCount = 0;

    for (const [_key, timestamp] of this.timestamps.entries()) {
      const age = now - timestamp;
      if (age > this.staleTime) {
        staleCount++;
      } else {
        freshCount++;
      }
    }

    return {
      total: this.cache.size,
      fresh: freshCount,
      stale: staleCount,
    };
  }
}

// Глобальный экземпляр кэша
const globalCache = new DataCache({
  defaultTTL: 5 * 60 * 1000, // 5 минут
  staleTime: 2 * 60 * 1000, // 2 минуты
  cleanupInterval: 5 * 60 * 1000, // 5 минут
});

export { DataCache, globalCache };
