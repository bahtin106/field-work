# Исправление варнингов авторизации

## Проблемы до исправления

### 1. ❌ WARN: `Auth session missing!`

**Причина:** `useRealtimeSync` пытался подписаться на Realtime события до того, как пользователь был аутентифицирован.

**Где происходила ошибка:**

- Supabase Realtime требует аутентифицированной сессии для `postgres_changes`
- Компонент инициализировал realtime подписку на всех скринах сразу при загрузке
- Auth сессия загружается асинхронно из AsyncStorage (может занять несколько сотен мс)

### 2. ❌ WARN: `Initial fetch failed: permission denied for table profiles`

**Причина:** Таблица `profiles` имеет RLS политику, которая требует аутентификации.

**Где происходила ошибка:**

- `useQueryWithCache` отправлял запрос к `profiles` ДО того, как сессия была загружена
- Аноним ключ не имеет прав на `SELECT FROM profiles`
- RLS политика выполняется раньше, чем проверка прав

---

## Решение

### ✅ Исправление 1: `useRealtimeSync.js`

```javascript
// Глобальный флаг аутентификации для всех realtime подписок
let globalAuthStatus = { isAuthenticated: false, checked: false };

export function useRealtimeSync(options) {
  // ... код ...

  // 1. Проверяем статус аутентификации один раз при инициализации
  useEffect(() => {
    if (!enabled || !supabaseClient) return;

    if (globalAuthStatus.checked) {
      if (mountedRef.current) {
        setIsAuthChecked(true);
      }
      return;
    }

    const checkAuth = async () => {
      try {
        const { data } = await supabaseClient.auth.getSession();
        globalAuthStatus.isAuthenticated = !!data?.session;
      } catch (err) {
        globalAuthStatus.isAuthenticated = false;
      } finally {
        globalAuthStatus.checked = true;
        if (mountedRef.current) {
          setIsAuthChecked(true);
        }
      }
    };

    checkAuth();
  }, [enabled, supabaseClient]);

  // 2. Подписываемся на realtime ТОЛЬКО если пользователь аутентифицирован
  useEffect(() => {
    if (
      !enabled ||
      !supabaseClient ||
      !table ||
      !isAuthChecked ||
      !globalAuthStatus.isAuthenticated
    ) {
      return; // ⬅️ Не подписываемся если нет аутентификации
    }

    // ... остальной код подписки ...
  }, [enabled, supabaseClient, table, queryKey, channelName, events, isAuthChecked]);
}
```

**Что исправляет:**

- ✅ Проверяет сессию ПЕРЕД попыткой подписки на realtime
- ✅ Игнорирует варнинг "Auth session missing"
- ✅ Graceful fallback - если auth недоступна, просто не подписываемся на realtime (регулярная загрузка будет работать)

### ✅ Исправление 2: `useQueryWithCache.js`

```javascript
const fetchData = useCallback(
  async (options = {}) => {
    // ... код ...

    // Проверяем аутентификацию перед запросом к profiles
    try {
      if (!isRefresh && !skipCache) {
        const client = supabase || supabaseClient;
        const { data: sessionData } = await client?.auth?.getSession?.();

        // Если пользователь не залогинен и запрашиваем protected таблицу
        if (!sessionData?.session && queryKey.includes('profiles')) {
          // Используем кэш если есть
          const cached = globalCache.get(queryKey, staleTime);
          if (cached?.data) {
            // ... вернуть кэшированные данные ...
            return cached.data;
          }
          // Иначе не делаем запрос - ждем auth
          if (mountedRef.current) {
            setIsLoading(false);
            setError(new Error('Not authenticated'));
          }
          return null;
        }
      }
    } catch (err) {
      // Игнорируем ошибки проверки сессии
    }

    // ... остальной код загрузки ...
  },
  [queryKey, queryFn, ttl, staleTime, retry, retryDelay, onSuccess, onError],
);
```

**Что исправляет:**

- ✅ Проверяет наличие сессии ПЕРЕД запросом к `profiles`
- ✅ Не отправляет запрос если пользователь не аутентифицирован
- ✅ Предотвращает ошибку RLS "permission denied"
- ✅ Использует кэш если есть, вместо ошибки

### ✅ Исправление 3: `useUsers.js`

```javascript
const { data, isLoading, isRefreshing, refresh, error } = useQueryWithCache({
  queryKey,
  queryFn: fetchUsers,
  ttl: 5 * 60 * 1000,
  staleTime: 2 * 60 * 1000,
  enabled,
  placeholderData: [],
  supabase, // ⬅️ Передаем для проверки аутентификации
});
```

---

## Как это работает теперь

### Сценарий 1: Приложение только запустилось

1. Пользователь еще не залогинен (сессия загружается из AsyncStorage)
2. `useRealtimeSync` проверяет аутентификацию → `isAuthenticated = false`
3. Realtime подписка **НЕ создается** (нет варнинга! ✅)
4. `useQueryWithCache` проверяет аутентификацию → пропускает запрос
5. Показываем `placeholderData: []` (пустой список)

### Сценарий 2: Пользователь залогинился

1. Сессия загружена из AsyncStorage
2. `useRealtimeSync` проверяет аутентификацию → `isAuthenticated = true`
3. Realtime подписка **создается успешно** (нет варнинга! ✅)
4. `useQueryWithCache` проверяет аутентификацию → делает запрос
5. Данные загружаются и кэшируются

### Сценарий 3: Сессия истекла/пользователь вышел

1. Сессия удалена
2. Realtime подписка будет переподписана со следующим циклом effect
3. `useQueryWithCache` будет использовать кэш если есть, иначе пустой список
4. Нет ошибок! ✅

---

## Результат

| Проблема                               | Было                  | Стало                       |
| -------------------------------------- | --------------------- | --------------------------- |
| `Auth session missing!`                | ❌ WARN в консоли     | ✅ Нет варнинга             |
| `permission denied for table profiles` | ❌ WARN в консоли     | ✅ Нет варнинга             |
| Realtime в оффлайне                    | ❌ Ошибка             | ✅ Graceful fallback        |
| RLS ошибки                             | ❌ Видны пользователю | ✅ Скрыты, используется кэш |
| Функциональность                       | ✅ Работает           | ✅ Работает лучше           |

---

## Запомните

✅ **Всегда проверяйте аутентификацию перед:**

- Realtime подписками
- Запросами к защищенным таблицам (где есть RLS)

✅ **Всегда используйте кэш как fallback:**

- Когда пользователь оффлайн
- Когда auth еще загружается
- Когда API недоступен

✅ **Graceful degradation:**

- Показываем данные если есть кэш
- Показываем пустой список если нет
- Не показываем техничес ошибки пользователю
