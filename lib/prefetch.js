/* global console, setTimeout, AbortController, __DEV__ */
/**
 * Prefetch Manager - профессиональный подход (как в Instagram, Telegram)
 *
 * Ключевые отличия от первой версии:
 * 1. Работает через QueryClient.prefetchQuery (не конкурирует с UI)
 * 2. Использует те же queryKey, что useQueryWithCache (общий кэш)
 * 3. Проверяет staleTime перед загрузкой (экономит трафик)
 * 4. Большие задержки (1-1.5 сек) чтобы точно не мешать старту
 */

import { supabase } from './supabase';

// Приоритеты загрузки
const PRIORITY = {
  HIGH: 1, // Настройки, департаменты - часто используются
  MEDIUM: 2, // Пользователи, заказы - по запросу
};

// Конфигурация prefetch задач
// КРИТИЧНО: queryKey должны совпадать с теми, что в useQueryWithCache!
const PREFETCH_TASKS = [
  // HIGH - настройки компании
  {
    queryKey: ['companySettings'],
    priority: PRIORITY.HIGH,
    delay: 1000, // 1 секунда после старта
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

  // MEDIUM - лента заказов (feed) - САМОЕ ВАЖНОЕ!
  {
    queryKey: ['orders', 'all', JSON.stringify({ status: 'feed', ex: null, dept: null, wt: '' })],
    priority: PRIORITY.MEDIUM,
    delay: 1800,
    queryFn: async () => {
      const { data } = await supabase
        .from('orders_secure')
        .select('*')
        .is('assigned_to', null)
        .order('datetime', { ascending: false });

      return data || [];
    },
  },

  // MEDIUM - счетчики "Мои заказы"
  {
    queryKey: ['counts', 'my'],
    priority: PRIORITY.MEDIUM,
    delay: 2000,
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) return { feed: 0, new: 0, progress: 0, all: 0 };

      const fetchCount = async (filterCb) => {
        let q = supabase.from('orders_secure').select('id', { count: 'exact' });
        q = filterCb(q);
        const { count } = await q.range(0, 0);
        return count || 0;
      };

      const [feedMy, allMy, newMy, progressMy] = await Promise.all([
        fetchCount((q) => q.is('assigned_to', null)),
        fetchCount((q) => q.eq('assigned_to', user.id)),
        fetchCount((q) => q.eq('assigned_to', user.id).or('status.is.null,status.eq.Новый')),
        fetchCount((q) => q.eq('assigned_to', user.id).eq('status', 'В работе')),
      ]);

      return { feed: feedMy, new: newMy, progress: progressMy, all: allMy };
    },
  },
];

/**
 * Prefetch Manager - управляет фоновой загрузкой
 */
class PrefetchManager {
  constructor() {
    this.isRunning = false;
    this.abortController = null;
    this.queryClient = null; // Устанавливается через init()
  }

  /**
   * Инициализация с QueryClient (вызывается из компонента)
   */
  init(queryClient) {
    this.queryClient = queryClient;
  }

  /**
   * Запустить фоновую предзагрузку
   */
  async start() {
    if (!this.queryClient) {
      if (__DEV__) console.warn('[Prefetch] QueryClient not initialized');
      return;
    }

    if (this.isRunning) {
      if (__DEV__) console.warn('[Prefetch] Already running');
      return;
    }

    this.isRunning = true;
    this.abortController = new AbortController();

    if (__DEV__) console.warn('[Prefetch] Starting...');

    // Группируем задачи по приоритетам
    const tasksByPriority = PREFETCH_TASKS.reduce((acc, task) => {
      if (!acc[task.priority]) acc[task.priority] = [];
      acc[task.priority].push(task);
      return acc;
    }, {});

    // Запускаем последовательно по приоритетам
    for (let priority = PRIORITY.HIGH; priority <= PRIORITY.MEDIUM; priority++) {
      const tasks = tasksByPriority[priority] || [];
      if (tasks.length === 0) continue;

      // Внутри одного приоритета - параллельно
      await Promise.all(tasks.map((task) => this.prefetchTask(task)));
    }

    if (__DEV__) console.warn('[Prefetch] Completed');
    this.isRunning = false;
  }

  /**
   * Предзагрузить одну задачу через QueryClient.prefetchQuery
   */
  async prefetchTask(task) {
    try {
      if (this.abortController?.signal.aborted) return;

      // Ждем задержку
      if (task.delay) {
        await new Promise((resolve) => setTimeout(resolve, task.delay));
      }

      // Проверяем кэш React Query
      const cachedData = this.queryClient.getQueryData(task.queryKey);
      const queryState = this.queryClient.getQueryState(task.queryKey);

      // Если данные свежие (< 2 минут), пропускаем
      if (cachedData && queryState?.dataUpdatedAt) {
        const staleTime = 2 * 60 * 1000; // 2 минуты
        const age = Date.now() - queryState.dataUpdatedAt;
        if (age < staleTime) {
          if (__DEV__)
            console.warn(
              `[Prefetch] ✓ ${task.queryKey.join(':')} cached (${Math.round(age / 1000)}s)`,
            );
          return;
        }
      }

      // Загружаем через prefetchQuery (заполняет кэш React Query)
      await this.queryClient.prefetchQuery({
        queryKey: task.queryKey,
        queryFn: task.queryFn,
        staleTime: 5 * 60 * 1000,
      });

      if (__DEV__) console.warn(`[Prefetch] ✓ ${task.queryKey.join(':')} loaded`);
    } catch (error) {
      if (__DEV__) console.warn(`[Prefetch] ✗ ${task.queryKey.join(':')} - ${error.message}`);
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
}

// Singleton
export const prefetchManager = new PrefetchManager();
