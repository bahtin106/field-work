/* global console, setTimeout, AbortController, __DEV__ */
/**
 * Prefetch Manager - Умная предзагрузка данных (профессиональный подход)
 *
 * Стратегия как в дорогих приложениях:
 * 1. Используем QueryClient напрямую через prefetchQuery
 * 2. НЕ используем globalCache (чтобы не конфликтовать с UI)
 * 3. Приоритеты: критичное → важное → второстепенное
 * 4. Проверяем существующий кэш перед загрузкой
 */

import { supabase } from './supabase';

// Приоритеты загрузки
const PRIORITY = {
  CRITICAL: 0, // Профиль, роль - нужны всегда
  HIGH: 1, // Настройки, департаменты - часто используются  
  MEDIUM: 2, // Пользователи, заказы - по запросу
  LOW: 3, // Редкие данные
};

// Конфигурация prefetch задач
// Используем те же queryKey, что и в useQueryWithCache для совместимости кэша
const PREFETCH_TASKS = [
  // HIGH - настройки компании
  {
    queryKey: ['companySettings'], // совпадает с useQueryWithCache
    priority: PRIORITY.HIGH,
    delay: 1000, // Загружаем через 1 сек после старта
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: profile } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', user.id)
        .single();

      if (!profile?.company_id) return null;

      const { data } = await supabase
        .from('companies')
        .select(
          'name, timezone, use_departure_time, worker_phone_mode, worker_phone_window_before_mins, worker_phone_window_after_mins',
        )
        .eq('id', profile.company_id)
        .single();

      return data;
    },
  },

  // HIGH - настройки уведомлений
  {
    queryKey: ['appSettings', 'notifPrefs'],
    priority: PRIORITY.HIGH,
    delay: 1200,
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;

      const { data } = await supabase
        .from('notification_prefs')
        .select('allow, new_orders, feed_orders, reminders, quiet_start, quiet_end')
        .eq('user_id', user.id)
        .maybeSingle();

      return data;
    },
  },

  // MEDIUM - департаменты
  {
    queryKey: ['departments'],
    priority: PRIORITY.MEDIUM,
    delay: 1500,
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: profile } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', user.id)
        .single();

      if (!profile?.company_id) return null;

      const { data } = await supabase
        .from('departments')
        .select('id, name, description')
        .eq('company_id', profile.company_id)
        .order('name');

      return data || [];
    },
  },
];

class PrefetchManager {
  constructor() {
    this.isRunning = false;
    this.abortController = null;
  }

  /**
   * Запустить предзагрузку всех данных
   */
  async start() {
    if (this.isRunning) {
      if (__DEV__) console.warn('[Prefetch] Already running');
      return;
    }

    this.isRunning = true;
    this.abortController = new AbortController();

    if (__DEV__) console.warn('[Prefetch] Starting background prefetch...');

    // Группируем задачи по приоритетам
    const tasksByPriority = PREFETCH_TASKS.reduce((acc, task) => {
      if (!acc[task.priority]) acc[task.priority] = [];
      acc[task.priority].push(task);
      return acc;
    }, {});

    // Запускаем последовательно по приоритетам
    for (let priority = PRIORITY.CRITICAL; priority <= PRIORITY.LOW; priority++) {
      const tasks = tasksByPriority[priority] || [];
      if (tasks.length === 0) continue;

      // Внутри одного приоритета - параллельно (с задержками)
      await Promise.all(tasks.map((task) => this.prefetchTask(task)));
    }

    if (__DEV__) console.warn('[Prefetch] Completed');
    this.isRunning = false;
  }

  /**
   * Предзагрузить одну задачу
   */
  async prefetchTask(task) {
    try {
      // Проверяем, не отменена ли загрузка
      if (this.abortController?.signal.aborted) return;

      // Ждем задержку (если есть)
      if (task.delay) {
        await new Promise((resolve) => setTimeout(resolve, task.delay));
      }

      // Проверяем кеш - если данные свежие, не загружаем
      const cached = globalCache.get(task.key);
      if (cached && !cached.isStale) {
        if (__DEV__) console.warn(`[Prefetch] ✓ ${task.key} - from cache`);
        return;
      }

      // Загружаем данные
      const data = await task.fetch();

      // Сохраняем в кеш
      if (data !== null && data !== undefined) {
        globalCache.set(task.key, data, task.ttl);
        if (__DEV__) console.warn(`[Prefetch] ✓ ${task.key} - loaded`);
      }
    } catch (error) {
      // Не показываем ошибки пользователю - это фоновая загрузка
      if (__DEV__) console.warn(`[Prefetch] ✗ ${task.key} - ${error.message}`);
    }
  }

  /**
   * Остановить предзагрузку
   */
  stop() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isRunning = false;
    if (__DEV__) console.warn('[Prefetch] Stopped');
  }

  /**
   * Предзагрузить конкретную страницу (вызывается при hover/focus)
   */
  async prefetchPage(pageKey) {
    const task = PREFETCH_TASKS.find((t) => t.key === pageKey);
    if (!task) return;

    await this.prefetchTask(task);
  }
}

// Singleton
export const prefetchManager = new PrefetchManager();

/**
 * Hook для React компонентов
 */
export function usePrefetch() {
  const start = () => prefetchManager.start();
  const stop = () => prefetchManager.stop();
  const prefetchPage = (pageKey) => prefetchManager.prefetchPage(pageKey);

  return { start, stop, prefetchPage };
}
