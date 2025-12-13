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
  CRITICAL: 0, // Сразу после старта основного экрана
  HIGH: 1, // Мои заказы - первое что увидит пользователь
  MEDIUM: 2, // Лента заказов - второе по важности
  LOW: 3, // Редкие данные
};

// Конфигурация prefetch задач
// КРИТИЧНО: queryKey должны совпадать с теми, что в useQueryWithCache!
const PREFETCH_TASKS = [
  // HIGH - Мои заказы (первые 10) - самое важное!
  {
    queryKey: ['orders', 'my', 'recent'],
    priority: PRIORITY.HIGH,
    delay: 0, // Сразу после старта!
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) return [];

      // Загружаем только первые 10 заказов пользователя
      const { data } = await supabase
        .from('orders_secure')
        .select('*')
        .eq('assigned_to', user.id)
        .order('datetime', { ascending: false })
        .limit(10); // Только первые 10!

      return data || [];
    },
  },

  // MEDIUM - Лента заказов (первые 10)
  {
    queryKey: ['orders', 'feed', 'recent'],
    priority: PRIORITY.MEDIUM,
    delay: 200, // Через 200ms после "Моих заказов"
    queryFn: async () => {
      // Загружаем только первые 10 заказов из ленты
      const { data } = await supabase
        .from('orders_secure')
        .select('*')
        .is('assigned_to', null)
        .order('datetime', { ascending: false })
        .limit(10); // Только первые 10!

      return data || [];
    },
  },

  // MEDIUM - Все заказы (первые 10) - для страницы "Все заявки"
  {
    queryKey: ['orders', 'all', 'recent'],
    priority: PRIORITY.MEDIUM,
    delay: 300, // Через 300ms после ленты
    queryFn: async () => {
      // Загружаем первые 10 заказов без фильтров (все заявки)
      const { data } = await supabase
        .from('orders_secure')
        .select('*')
        .order('datetime', { ascending: false })
        .limit(10); // Только первые 10!

      return data || [];
    },
  },

  // HIGH - настройки компании (быстрые данные)
  {
    queryKey: ['companySettings'],
    priority: PRIORITY.HIGH,
    delay: 100,
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
    delay: 100,
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
    priority: PRIORITY.LOW,
    delay: 500,
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
      return;
    }

    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.abortController = new AbortController();

    // Получаем uid для динамических задач
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const uid = user?.id;

    // Создаем динамический список задач с учетом uid
    const dynamicTasks = PREFETCH_TASKS.map((task) => {
      // Исправляем queryKey для счетчиков
      if (task.queryKey[0] === 'counts' && task.queryKey[1] === 'my' && uid) {
        const updatedTask = {
          ...task,
          queryKey: ['counts', 'my', uid], // Добавляем uid!
        };
        return updatedTask;
      }
      return task;
    });

    // Группируем задачи по приоритетам
    const tasksByPriority = dynamicTasks.reduce((acc, task) => {
      if (!acc[task.priority]) acc[task.priority] = [];
      acc[task.priority].push(task);
      return acc;
    }, {});

    // Запускаем последовательно по приоритетам
    for (let priority = PRIORITY.CRITICAL; priority <= PRIORITY.LOW; priority++) {
      const tasks = tasksByPriority[priority] || [];
      if (tasks.length === 0) continue;

      // Внутри одного приоритета - параллельно
      await Promise.all(tasks.map((task) => this.prefetchTask(task)));
    }

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

      // Если данные свежие (< 5 минут), пропускаем
      if (cachedData && queryState?.dataUpdatedAt) {
        const staleTime = 5 * 60 * 1000; // 5 минут (было 2)
        const age = Date.now() - queryState.dataUpdatedAt;
        if (age < staleTime) {
          return;
        }
      }

      // Загружаем через prefetchQuery (заполняет кэш React Query)
      await this.queryClient.prefetchQuery({
        queryKey: task.queryKey,
        queryFn: task.queryFn,
        staleTime: 5 * 60 * 1000, // 5 минут - данные считаются свежими
      });
    } catch (error) {
      // silent
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
  }
}

// Singleton
export const prefetchManager = new PrefetchManager();
