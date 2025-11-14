/* global console */
/**
 * useRealtimeSync - Умная система фоновой синхронизации с Supabase Realtime
 *
 * Автоматически подписывается на изменения в таблице и обновляет кэш
 * Поддерживает множественные подписки, автоматическую очистку и дедупликацию
 */

import { useEffect, useRef } from 'react';
import { globalCache } from '../../lib/cache/DataCache';

// Глобальный менеджер подписок для предотвращения дублирования
const subscriptionManager = {
  subscriptions: new Map(),
  channels: new Map(),

  getKey(table, channel) {
    return `${table}:${channel || 'default'}`;
  },

  addSubscription(table, channel, channelInstance) {
    const key = this.getKey(table, channel);
    if (!this.channels.has(key)) {
      this.channels.set(key, channelInstance);
      this.subscriptions.set(key, 1);
    } else {
      this.subscriptions.set(key, (this.subscriptions.get(key) || 0) + 1);
    }
  },

  removeSubscription(table, channel) {
    const key = this.getKey(table, channel);
    const count = this.subscriptions.get(key) || 0;

    if (count <= 1) {
      // Последняя подписка - отписываемся
      const channelInstance = this.channels.get(key);
      if (channelInstance) {
        try {
          channelInstance.unsubscribe();
        } catch (err) {
          console.error('Error unsubscribing:', err);
        }
      }
      this.subscriptions.delete(key);
      this.channels.delete(key);
    } else {
      this.subscriptions.set(key, count - 1);
    }
  },

  getChannel(table, channel) {
    const key = this.getKey(table, channel);
    return this.channels.get(key);
  },
};

/**
 * useRealtimeSync - Хук для автоматической синхронизации данных через Realtime
 *
 * @param {Object} options
 * @param {Object} options.supabaseClient - Экземпляр Supabase клиента
 * @param {string} options.table - Название таблицы для прослушивания
 * @param {string} options.queryKey - Ключ кэша для обновления
 * @param {Function} options.onUpdate - Callback для обновления данных
 * @param {string} options.channel - Опциональное имя канала (для множественных подписок)
 * @param {boolean} options.enabled - Включена ли синхронизация
 * @param {Array<string>} options.events - Массив событий для прослушивания ['INSERT', 'UPDATE', 'DELETE', '*']
 */
export function useRealtimeSync(options) {
  const {
    supabaseClient,
    table,
    queryKey,
    onUpdate,
    channel: channelName,
    enabled = true,
    events = ['*'],
  } = options;

  const mountedRef = useRef(true);
  const onUpdateRef = useRef(onUpdate);

  // Обновляем ref при изменении callback
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    if (!enabled || !supabaseClient || !table) return;

    const actualChannelName = channelName || `realtime:${table}:${queryKey}`;

    // Проверяем, есть ли уже активная подписка
    let channel = subscriptionManager.getChannel(table, actualChannelName);

    if (!channel) {
      // Создаем новую подписку
      channel = supabaseClient.channel(actualChannelName);

      events.forEach((event) => {
        channel.on(
          'postgres_changes',
          {
            event: event === '*' ? '*' : event,
            schema: 'public',
            table,
          },
          (payload) => {
            if (!mountedRef.current) return;

            // Инвалидируем кэш
            if (queryKey) {
              globalCache.invalidate(queryKey);
            }

            // Вызываем callback для обновления данных
            if (onUpdateRef.current) {
              onUpdateRef.current(payload);
            }
          },
        );
      });

      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Realtime subscribed successfully
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`Realtime connection error for ${table}:`, status);
        }
      });

      subscriptionManager.addSubscription(table, actualChannelName, channel);
    } else {
      // Увеличиваем счетчик подписок
      subscriptionManager.addSubscription(table, actualChannelName, channel);
    }

    return () => {
      mountedRef.current = false;
      subscriptionManager.removeSubscription(table, actualChannelName);
    };
  }, [enabled, supabaseClient, table, queryKey, channelName, events]);
}

/**
 * useMultiTableSync - Хук для синхронизации нескольких таблиц одновременно
 *
 * @example
 * useMultiTableSync({
 *   supabaseClient: supabase,
 *   tables: [
 *     { table: 'profiles', queryKey: 'users', onUpdate: refetchUsers },
 *     { table: 'departments', queryKey: 'departments', onUpdate: refetchDepartments }
 *   ]
 * });
 */
export function useMultiTableSync({ supabaseClient, tables, enabled = true }) {
  tables.forEach((config) => {
    useRealtimeSync({
      supabaseClient,
      enabled,
      ...config,
    });
  });
}
