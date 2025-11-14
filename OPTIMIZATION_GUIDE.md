// Оптимизированная версия страницы пользователей с профессиональным кэшированием
// Руководство по применению к другим страницам

## Основные изменения

### 1. Импорты

Добавлены новые хуки для работы с кэшем:

```javascript
import { useUsers } from '../../components/hooks/useUsers';
import { useDepartments } from '../../components/hooks/useDepartments';
```

Удалены:

- `useFocusEffect` (теперь не нужен, кэш автоматически обновляется)
- Прямые импорты `supabase` (теперь в хуках)

### 2. State менеджмент

Упрощен state:

```javascript
// Было:
const [list, setList] = useState([]);
const [loading, setLoading] = useState(true);
const [errorMsg, setErrorMsg] = useState('');
const [refreshing, setRefreshing] = useState(false);
const [departments, setDepartments] = useState([]);
const [useDepartments, setUseDepartments] = useState(false);
const [flagReady, setFlagReady] = useState(false);

// Стало:
const [companyId, setCompanyId] = useState(null);
const [useDepartments, setUseDepartments] = useState(false);

// Данные теперь из хуков:
const {
  users,
  isLoading,
  isRefreshing,
  refresh: refreshUsers,
} = useUsers({
  filters: filters.values,
  enabled: !!companyId,
});

const { departments } = useDepartments({
  companyId,
  enabled: useDepartments && !!companyId,
  onlyEnabled: true,
});
```

### 3. Удалена вся ручная загрузка данных

Удалены функции:

- `fetchUsers()` - теперь в хуке `useUsers`
- `fetchDepartments()` - теперь в хуке `useDepartments`
- `loadCompanyFlag()` - упрощено до одного useEffect
- Все useEffect с `supabase.channel()` - теперь в `useRealtimeSync`

### 4. Pull-to-refresh упрощен

```javascript
// Было:
const onRefresh = useCallback(async () => {
  setRefreshing(true);
  await Promise.all([fetchUsers(), fetchDepartments(), loadCompanyFlag()]);
  setRefreshing(false);
}, [fetchUsers, fetchDepartments, loadCompanyFlag]);

// Стало:
const onRefresh = useCallback(async () => {
  await refreshUsers();
}, [refreshUsers]);
```

### 5. Использование данных

```javascript
// Было:
data = { filtered }; // где filtered = useMemo(() => list.filter(...))

// Стало:
data = { filtered }; // где filtered = useMemo(() => users.filter(...))
```

## Преимущества новой системы

1. **Мгновенная загрузка**: При повторном заходе данные показываются сразу из кэша
2. **Stale-While-Revalidate**: Показываем кэш и обновляем в фоне
3. **Автоматическая синхронизация**: Realtime обновления без ручных подписок
4. **Pull-to-refresh**: Нативная анимация, одна строка кода
5. **Меньше кода**: ~100 строк удалено, логика вынесена в переиспользуемые хуки
6. **Дедупликация запросов**: Если несколько компонентов запрашивают одни данные, запрос один
7. **Умный retry**: Автоматические повторные попытки при ошибках
8. **TTL кэша**: Настраиваемое время жизни данных

## Как применить к другим страницам

### Шаг 1: Создать специфичный хук (если нужно)

Например, для заказов:

```javascript
// components/hooks/useOrders.js
export function useOrders(options = {}) {
  const { filters = {}, enabled = true } = options;

  const queryKey = useMemo(() => {
    const filterStr = JSON.stringify(filters);
    return `orders:${filterStr}`;
  }, [filters]);

  const fetchOrders = useCallback(async () => {
    let query = supabase.from('orders').select('*').order('created_at', { descending: true });

    // Применить фильтры...

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }, [filters]);

  const { data, isLoading, isRefreshing, refresh } = useQueryWithCache({
    queryKey,
    queryFn: fetchOrders,
    ttl: 5 * 60 * 1000,
    enabled,
  });

  useRealtimeSync({
    supabaseClient: supabase,
    table: 'orders',
    queryKey,
    onUpdate: refresh,
    enabled,
  });

  return { orders: data || [], isLoading, isRefreshing, refresh };
}
```

### Шаг 2: Заменить в компоненте

```javascript
// Было:
const [orders, setOrders] = useState([]);
const [loading, setLoading] = useState(true);
// + куча useEffect и callbacks

// Стало:
const { orders, isLoading, isRefreshing, refresh } = useOrders({
  filters: myFilters,
});
```

### Шаг 3: Обновить RefreshControl

```javascript
<FlatList
  refreshControl={
    <RefreshControl
      refreshing={isRefreshing}
      onRefresh={refresh}
      tintColor={theme.colors.primary}
    />
  }
/>
```

### Шаг 4: Обновить loader

```javascript
// Было:
if (loading) return <Loader />;

// Стало:
if (isLoading) return <Loader />;
```

## Настройка TTL для разных данных

```javascript
// Часто меняющиеся данные (заказы, сообщения)
ttl: 2 * 60 * 1000; // 2 минуты

// Обычные данные (пользователи, профили)
ttl: 5 * 60 * 1000; // 5 минут

// Редко меняющиеся данные (справочники, настройки)
ttl: 30 * 60 * 1000; // 30 минут

// Статические данные (роли, константы)
ttl: 60 * 60 * 1000; // 1 час
```

## Важные замечания

1. **queryKey должен быть уникальным** и включать все параметры, влияющие на данные
2. **Realtime** подписки автоматически дедуплицируются - можно безопасно использовать везде
3. **refresh()** всегда загружает свежие данные, минуя кэш
4. **Кэш глобальный** - данные доступны между страницами
5. **Автоматическая очистка** устаревших данных каждую минуту

## Примеры использования в других частях приложения

### Для списков с фильтрами

```javascript
const { data, isLoading, refresh } = useQueryWithCache({
  queryKey: `myData:${JSON.stringify(filters)}`,
  queryFn: fetchData,
  ttl: 5 * 60 * 1000,
});
```

### Для деталей объекта

```javascript
const { data, isLoading, refresh } = useQueryWithCache({
  queryKey: `order:${orderId}`,
  queryFn: () => fetchOrderById(orderId),
  ttl: 5 * 60 * 1000,
  enabled: !!orderId,
});
```

### Для справочников

```javascript
const { data: workTypes } = useQueryWithCache({
  queryKey: 'workTypes',
  queryFn: fetchWorkTypes,
  ttl: 30 * 60 * 1000, // 30 минут
});
```
