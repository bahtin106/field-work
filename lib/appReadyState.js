/* global __DEV__, console */

// lib/appReadyState.js
// Глобальная синхронизация готовности UI между главной страницей и bottom bar

/**
 * Централизованное состояние готовности приложения.
 * Гарантирует, что главный экран и bottom bar появляются синхронно.
 */
class AppReadyState {
  constructor() {
    // Состояние bootstrap главной страницы
    this.bootState = {
      current: 'boot', // 'boot' | 'fetching' | 'ready'
      mountTs: Date.now(),
    };

    // Подписчики на изменения состояния
    this.listeners = new Set();
  }

  /**
   * Получить текущее состояние готовности
   */
  getBootState() {
    return this.bootState.current;
  }

  /**
   * Установить состояние готовности
   */
  setBootState(state) {
    if (this.bootState.current !== state) {
      this.bootState.current = state;
      this.notifyListeners();
    }
  }

  /**
   * Проверить, готово ли приложение к показу UI
   */
  isReady() {
    return this.bootState.current === 'ready';
  }

  /**
   * Сбросить состояние (при логауте/логине)
   */
  reset() {
    this.bootState.current = 'boot';
    this.bootState.mountTs = Date.now();
    this.notifyListeners();
  }

  /**
   * Получить timestamp монтирования
   */
  getMountTs() {
    return this.bootState.mountTs;
  }

  /**
   * Обновить timestamp монтирования
   */
  updateMountTs() {
    this.bootState.mountTs = Date.now();
  }

  /**
   * Подписаться на изменения состояния готовности
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Уведомить всех подписчиков об изменении
   */
  notifyListeners() {
    this.listeners.forEach((listener) => {
      try {
        listener(this.bootState.current);
      } catch {
        // silent catch
      }
    });
  }
}

// Глобальный singleton
const appReadyState = new AppReadyState();

export default appReadyState;
