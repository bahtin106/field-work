# 🚀 Quick Start - Система кэширования

## Минимальный пример (копипаста)

### 1. Простой список с кэшем и pull-to-refresh

```javascript
import { useQueryWithCache } from '../../components/hooks/useQueryWithCache';
import { supabase } from '../../lib/supabase';
import { FlatList, RefreshControl } from 'react-native';

function MyListScreen() {
  // Все в одном хуке: кэш, загрузка, обновление
  const { data, isLoading, isRefreshing, refresh } = useQueryWithCache({
    queryKey: 'myList',
    queryFn: async () => {
      const { data, error } = await supabase.from('my_table').select('*');
      if (error) throw error;
      return data;
    },
    ttl: 5 * 60 * 1000, // 5 минут в кэше
  });

  if (isLoading) return <Loader />;

  return (
    <FlatList
      data={data}
      renderItem={({ item }) => <Item item={item} />}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
    />
  );
}
```

### 2. С автоматической синхронизацией (Realtime)

```javascript
import { useQueryWithCache } from '../../components/hooks/useQueryWithCache';
import { supabase } from '../../lib/supabase';

function UsersScreen() {
  const {
    data: users,
    isLoading,
    refresh,
  } = useQueryWithCache({
    queryKey: 'users',
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('*');
      return data;
    },
    // Realtime - данные обновляются автоматически при изменениях в БД
    enableRealtime: true,
    realtimeTable: 'profiles',
    supabaseClient: supabase,
  });

  // Всё! Данные теперь всегда актуальные
}
```

### 3. С фильтрами

```javascript
function UsersWithFilters() {
  const [filters, setFilters] = useState({ role: 'admin' });

  // queryKey зависит от фильтров - при изменении фильтров загружаются новые данные
  const { data: users } = useQueryWithCache({
    queryKey: `users:${JSON.stringify(filters)}`,
    queryFn: async () => {
      let query = supabase.from('profiles').select('*');
      if (filters.role) query = query.eq('role', filters.role);
      const { data } = await query;
      return data;
    },
  });

  return (
    <>
      <FilterPicker value={filters.role} onChange={(role) => setFilters({ role })} />
      <UserList users={users} />
    </>
  );
}
```

### 4. Детальная страница с кэшем

```javascript
function OrderDetails({ orderId }) {
  const {
    data: order,
    isLoading,
    mutate,
  } = useQueryWithCache({
    queryKey: `order:${orderId}`,
    queryFn: async () => {
      const { data } = await supabase.from('orders').select('*').eq('id', orderId).single();
      return data;
    },
    enabled: !!orderId, // Не грузить пока нет ID
  });

  const updateStatus = async (newStatus) => {
    // Оптимистичное обновление - UI обновляется сразу
    mutate((prev) => ({ ...prev, status: newStatus }));

    // Сохраняем в БД
    await supabase.from('orders').update({ status: newStatus }).eq('id', orderId);
  };

  if (isLoading) return <Loader />;
  return <OrderCard order={order} onUpdateStatus={updateStatus} />;
}
```

## 🎨 Готовые хуки

### useUsers - Для списка пользователей

```javascript
import { useUsers } from '../../components/hooks/useUsers';

function MyComponent() {
  const { users, isLoading, isRefreshing, refresh } = useUsers({
    filters: {
      departments: [1, 2],
      roles: ['admin'],
      suspended: false,
    },
  });

  return (
    <FlatList
      data={users}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
    />
  );
}
```

### useDepartments - Для отделов

```javascript
import { useDepartments } from '../../components/hooks/useDepartments';

function DepartmentPicker() {
  const { departments, isLoading } = useDepartments({
    companyId: myCompanyId,
    onlyEnabled: true, // Только активные
  });

  return (
    <Picker>
      {departments.map((dept) => (
        <Picker.Item key={dept.id} label={dept.name} value={dept.id} />
      ))}
    </Picker>
  );
}
```

## 🔄 Создать свой хук (шаблон)

```javascript
// components/hooks/useOrders.js
import { useCallback, useMemo } from 'react';
import { useQueryWithCache } from './useQueryWithCache';
import { useRealtimeSync } from './useRealtimeSync';
import { supabase } from '../../lib/supabase';

export function useOrders(options = {}) {
  const { filters = {}, enabled = true } = options;

  // 1. Уникальный ключ на основе фильтров
  const queryKey = useMemo(() => {
    return `orders:${JSON.stringify(filters)}`;
  }, [filters]);

  // 2. Функция загрузки
  const fetchOrders = useCallback(async () => {
    let query = supabase.from('orders').select('*');

    // Применить фильтры
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.userId) query = query.eq('user_id', filters.userId);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }, [filters]);

  // 3. Кэш с автоматическим обновлением
  const { data, isLoading, isRefreshing, refresh, error } = useQueryWithCache({
    queryKey,
    queryFn: fetchOrders,
    ttl: 3 * 60 * 1000, // 3 минуты (заказы меняются часто)
    enabled,
  });

  // 4. Realtime синхронизация
  useRealtimeSync({
    supabaseClient: supabase,
    table: 'orders',
    queryKey,
    onUpdate: refresh,
    enabled,
  });

  return {
    orders: data || [],
    isLoading,
    isRefreshing,
    refresh,
    error,
  };
}
```

## ⚡ Миграция существующей страницы

### Было (старый код):

```javascript
function OldScreen() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data } = await supabase.from('table').select('*');
    setData(data);
    setLoading(false);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  useEffect(() => {
    const channel = supabase
      .channel('my-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table' }, fetchData)
      .subscribe();

    return () => channel.unsubscribe();
  }, []);

  if (loading) return <Loader />;
  return <FlatList data={data} />;
}
```

### Стало (новый код):

```javascript
import { useQueryWithCache } from '../../components/hooks/useQueryWithCache';
import { supabase } from '../../lib/supabase';

function NewScreen() {
  const { data, isLoading, isRefreshing, refresh } = useQueryWithCache({
    queryKey: 'myData',
    queryFn: async () => {
      const { data } = await supabase.from('table').select('*');
      return data;
    },
    enableRealtime: true,
    realtimeTable: 'table',
    supabaseClient: supabase,
  });

  if (isLoading) return <Loader />;

  return (
    <FlatList
      data={data}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
    />
  );
}
```

**Результат:** -50 строк кода, +автоматический кэш, +дедупликация, +retry, +stale-while-revalidate! 🎉

## 📦 Что уже работает

- ✅ **users/index.jsx** - полностью мигрирована
- ✅ Все новые страницы можно делать по шаблонам выше

## 🎯 TTL Шпаргалка

```javascript
ttl: 1 * 60 * 1000; // 1 мин  - сообщения, уведомления
ttl: 3 * 60 * 1000; // 3 мин  - заказы, задачи
ttl: 5 * 60 * 1000; // 5 мин  - пользователи (default)
ttl: 15 * 60 * 1000; // 15 мин - отделы, настройки
ttl: 30 * 60 * 1000; // 30 мин - справочники
ttl: 60 * 60 * 1000; // 1 час  - константы
```

## 🆘 Troubleshooting

**Данные не обновляются?**

```javascript
// Принудительное обновление
refresh();

// Или очистить кэш
import { globalCache } from '../lib/cache/DataCache';
globalCache.invalidate('myQueryKey');
```

**Realtime не работает?**

```javascript
// Убедитесь что все параметры заданы
enableRealtime: true,
realtimeTable: 'your_table',  // ← Название таблицы
supabaseClient: supabase,     // ← Клиент
```

**Хочу другой TTL для конкретного запроса?**

```javascript
ttl: 10 * 60 * 1000; // 10 минут вместо дефолтных 5
```

---

**🎉 Готово! Теперь все данные грузятся быстро и обновляются автоматически!**

Подробная документация: `CACHING_SYSTEM.md`
