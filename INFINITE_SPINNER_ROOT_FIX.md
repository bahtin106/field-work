# ✅ Полное исправление проблемы бесконечного спиннера

## Проблема

При перезапуске приложения через Expo Go (после закрытия и повторного открытия) периодически возникает бесконечный спиннер загрузки. Приложение не загружается, пользователь видит только крутящийся индикатор.

## Корневые причины

Проблема возникала из-за **отсутствия гарантированных таймаутов** на критических путях загрузки данных:

### 1. **useQueryWithCache без таймаута**

- `isLoading` мог застрять в `true`, если запрос к Supabase зависал
- Не было защиты от зависших Promise в `queryFn`
- При `enabled=false` состояние `isLoading` не сбрасывалось

### 2. **useAuth без защиты**

- `supabase.auth.getSession()` мог зависнуть без таймаута
- `isLoading` оставался `true` навсегда
- Блокировал useUsers и useDepartments через цепочку зависимостей

### 3. **Логика загрузки в app/users/index.jsx**

- `isLoading = usersLoading && departmentsLoading` блокировалась если **оба** хука зависали
- Условие `if (isLoading && users.length === 0)` показывало спиннер бесконечно
- Не учитывало наличие кэшированных данных

### 4. **useUsers и useDepartments**

- Параметр `enabled` не учитывал `isAuthenticated` корректно
- При холодном старте `enabled=false` → `isLoading` не сбрасывался

### 5. **orders/index.jsx**

- `getUserRole()` мог зависнуть без таймаута
- Блокировал показ `UniversalHome` и остальной UI

## Решение

### 1. ✅ useQueryWithCache - гарантированные таймауты

**Что исправлено:**

- Добавлен **10-секундный таймаут** для принудительного сброса `isLoading`
- Добавлен **15-секундный таймаут** для всех `queryFn` через `Promise.race()`
- Гарантированный сброс `isLoading` при `enabled=false`
- Обработка ошибок с гарантией сброса состояния

```javascript
// Таймаут для разблокировки isLoading
useEffect(() => {
  if (!enabled || !isLoading) return;

  const timeout = setTimeout(() => {
    if (mountedRef.current && isLoading) {
      console.warn(`⏰ useQueryWithCache timeout for ${queryKey} - force stop loading`);
      setIsLoading(false);
      setIsRefreshing(false);
      setIsFetching(false);
    }
  }, 10000); // 10 секунд максимум

  return () => clearTimeout(timeout);
}, [enabled, isLoading, queryKey]);

// Таймаут для queryFn
const timeout = new Promise((_, reject) =>
  setTimeout(() => reject(new Error('Query timeout')), 15000),
);

const result = await Promise.race([queryFn(), timeout]);
```

### 2. ✅ useAuth - защита от зависания

**Что исправлено:**

- **5-секундный таймаут** для `getSession()`
- Гарантированный сброс `isLoading` через `finally`
- Защита от обновления unmounted компонента

```javascript
const checkAuth = async () => {
  try {
    const timeout = new Promise((resolve) =>
      setTimeout(() => resolve({ data: { session: null } }), 5000),
    );

    const sessionPromise = supabase.auth.getSession();
    const result = await Promise.race([sessionPromise, timeout]);

    const session = result?.data?.session;

    if (mounted) {
      setIsAuthenticated(!!session);
      setUser(session?.user || null);
    }
  } catch {
    if (mounted) {
      setIsAuthenticated(false);
      setUser(null);
    }
  } finally {
    if (mounted) {
      setIsLoading(false); // ГАРАНТИРОВАННЫЙ СБРОС
    }
  }
};
```

### 3. ✅ app/users/index.jsx - улучшенная логика загрузки

**Что исправлено:**

- Изменена логика `isLoading`: показываем спиннер только если **нет данных вообще**
- Учитываются кэшированные данные
- `enabled` зависит от `!companyIdLoading` вместо `!!companyId`

```javascript
// Показываем loader только если ОБА источника грузятся И нет данных
const hasAnyData = users.length > 0 || departments.length > 0;
const isLoading = (usersLoading || departmentsLoading) && !hasAnyData;

// enabled учитывает завершение загрузки companyId
enabled: !companyIdLoading;
```

### 4. ✅ useUsers и useDepartments - корректный enabled

**Что исправлено:**

- `enabled` теперь включает проверку `isAuthenticated`
- Не пытается загружать данные без авторизации

```javascript
// useUsers
enabled: enabled && isAuthenticated;

// useDepartments
enabled: enabled && !!companyId && isAuthenticated;
```

### 5. ✅ orders/index.jsx - защита getUserRole

**Что исправлено:**

- **8-секундный таймаут** для `getUserRole()`
- Принудительная установка роли `'worker'` при зависании

```javascript
useEffect(() => {
  if (!isLoading) return;

  const timeout = setTimeout(() => {
    console.warn('⏰ getUserRole timeout - force stop loading');
    qc.setQueryData(['userRole'], 'worker'); // fallback роль
  }, 8000);

  return () => clearTimeout(timeout);
}, [isLoading, qc]);
```

## Архитектура защиты

```
┌─────────────────────────────────────────────┐
│           app/_layout.js                    │
│  ✅ 10s timeout: initializeApp              │
│  ✅ 12s timeout: force ready                │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│         app/orders/index.jsx                │
│  ✅ 8s timeout: getUserRole                 │
│  ✅ 5s MAX_BOOT_MS для force ready          │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│       components/universalhome.jsx          │
│  ✅ Мгновенный рендер (без блокировки)      │
│  ✅ Показывает UI с placeholders            │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│         app/users/index.jsx                 │
│  ✅ Показывает loader только без данных     │
│  ✅ Использует кэш если доступен            │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│      hooks/useQueryWithCache.js             │
│  ✅ 10s timeout: isLoading force reset      │
│  ✅ 15s timeout: queryFn timeout            │
│  ✅ Сброс при disabled                      │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│          hooks/useAuth.js                   │
│  ✅ 5s timeout: getSession                  │
│  ✅ Гарантированный finally                 │
└─────────────────────────────────────────────┘
```

## Уровни защиты (Defense in Depth)

### Уровень 1: Глобальные таймауты (app/\_layout.js)

- **10 секунд**: `initializeApp` максимальное время
- **12 секунд**: force ready для UI

### Уровень 2: Экранные таймауты

- **8 секунд**: `getUserRole` в orders/index.jsx
- **5 секунд**: `MAX_BOOT_MS` для принудительного показа UI

### Уровень 3: Хуки загрузки данных

- **10 секунд**: `useQueryWithCache` сброс `isLoading`
- **15 секунд**: таймаут для `queryFn`
- **5 секунд**: `useAuth.getSession()`

### Уровень 4: Умная логика загрузки

- Показ кэшированных данных немедленно (stale-while-revalidate)
- Spinner только при отсутствии данных
- `enabled` учитывает состояние зависимостей

## Результат

✅ **Гарантированная разблокировка UI** через максимум 12 секунд (глобальный таймаут)  
✅ **Нет бесконечных спиннеров** - все пути загрузки имеют таймауты  
✅ **Быстрый старт с кэшем** - показываем данные мгновенно при их наличии  
✅ **Защита от race conditions** - все обновления проверяют `mounted`  
✅ **Graceful degradation** - fallback на роль `'worker'` при ошибках

## Тестирование

### Тест 1: Холодный старт

1. Закрыть приложение полностью
2. Открыть через Expo Go
3. ✅ Должно загрузиться за 2-5 секунд
4. ✅ Максимум через 12 секунд UI точно появится

### Тест 2: Плохое соединение

1. Включить режим "Slow 3G" в настройках сети
2. Перезапустить приложение
3. ✅ UI должен появиться, показывая кэшированные данные
4. ✅ Обновление в фоне при восстановлении сети

### Тест 3: Офлайн режим

1. Отключить интернет полностью
2. Перезапустить приложение
3. ✅ UI должен показать кэшированные данные
4. ✅ Через 10-12 секунд UI точно появится (с пустыми данными если кэш пуст)

### Тест 4: Быстрый переход между юзерами

1. Залогиниться как пользователь А
2. Разлогиниться
3. Залогиниться как пользователь Б
4. ✅ Данные пользователя А должны очиститься
5. ✅ Данные пользователя Б загрузятся за 2-5 секунд

## Файлы изменены

1. ✅ `components/hooks/useQueryWithCache.js` - таймауты для загрузки
2. ✅ `components/hooks/useAuth.js` - таймаут для getSession
3. ✅ `components/hooks/useUsers.js` - правильный enabled с isAuthenticated
4. ✅ `components/hooks/useDepartments.js` - правильный enabled с isAuthenticated
5. ✅ `app/users/index.jsx` - улучшенная логика isLoading
6. ✅ `app/orders/index.jsx` - таймаут для getUserRole

## Мониторинг

В консоли будут логи при срабатывании защитных механизмов:

```
⏰ useQueryWithCache timeout for users:... - force stop loading
⏰ getUserRole timeout - force stop loading
🚨 FORCE READY TIMEOUT - Unblocking UI after 12s
```

Эти логи помогут выявить реальные проблемы с сетью или Supabase для дальнейшей оптимизации.
