> **Status (2026-02-11): Legacy reference.** This document contains historical notes about removed hooks (`useQueryWithCache`, `useRealtimeSync`).
> Current data layer uses TanStack Query feature hooks in `src/features/*` with shared keys in `src/shared/query/queryKeys.ts`.
# рџљЂ Quick Start - РЎРёСЃС‚РµРјР° РєСЌС€РёСЂРѕРІР°РЅРёСЏ

## РњРёРЅРёРјР°Р»СЊРЅС‹Р№ РїСЂРёРјРµСЂ (РєРѕРїРёРїР°СЃС‚Р°)

### 1. РџСЂРѕСЃС‚РѕР№ СЃРїРёСЃРѕРє СЃ РєСЌС€РµРј Рё pull-to-refresh

```javascript
import { useQueryWithCache } from '../../components/hooks/useQueryWithCache';
import { supabase } from '../../lib/supabase';
import { FlatList, RefreshControl } from 'react-native';

function MyListScreen() {
  // Р’СЃРµ РІ РѕРґРЅРѕРј С…СѓРєРµ: РєСЌС€, Р·Р°РіСЂСѓР·РєР°, РѕР±РЅРѕРІР»РµРЅРёРµ
  const { data, isLoading, isRefreshing, refresh } = useQueryWithCache({
    queryKey: 'myList',
    queryFn: async () => {
      const { data, error } = await supabase.from('my_table').select('*');
      if (error) throw error;
      return data;
    },
    ttl: 5 * 60 * 1000, // 5 РјРёРЅСѓС‚ РІ РєСЌС€Рµ
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

### 2. РЎ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРѕР№ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёРµР№ (Realtime)

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
    // Realtime - РґР°РЅРЅС‹Рµ РѕР±РЅРѕРІР»СЏСЋС‚СЃСЏ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё РїСЂРё РёР·РјРµРЅРµРЅРёСЏС… РІ Р‘Р”
    enableRealtime: true,
    realtimeTable: 'profiles',
    supabaseClient: supabase,
  });

  // Р’СЃС‘! Р”Р°РЅРЅС‹Рµ С‚РµРїРµСЂСЊ РІСЃРµРіРґР° Р°РєС‚СѓР°Р»СЊРЅС‹Рµ
}
```

### 3. РЎ С„РёР»СЊС‚СЂР°РјРё

```javascript
function UsersWithFilters() {
  const [filters, setFilters] = useState({ role: 'admin' });

  // queryKey Р·Р°РІРёСЃРёС‚ РѕС‚ С„РёР»СЊС‚СЂРѕРІ - РїСЂРё РёР·РјРµРЅРµРЅРёРё С„РёР»СЊС‚СЂРѕРІ Р·Р°РіСЂСѓР¶Р°СЋС‚СЃСЏ РЅРѕРІС‹Рµ РґР°РЅРЅС‹Рµ
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

### 4. Р”РµС‚Р°Р»СЊРЅР°СЏ СЃС‚СЂР°РЅРёС†Р° СЃ РєСЌС€РµРј

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
    enabled: !!orderId, // РќРµ РіСЂСѓР·РёС‚СЊ РїРѕРєР° РЅРµС‚ ID
  });

  const updateStatus = async (newStatus) => {
    // РћРїС‚РёРјРёСЃС‚РёС‡РЅРѕРµ РѕР±РЅРѕРІР»РµРЅРёРµ - UI РѕР±РЅРѕРІР»СЏРµС‚СЃСЏ СЃСЂР°Р·Сѓ
    mutate((prev) => ({ ...prev, status: newStatus }));

    // РЎРѕС…СЂР°РЅСЏРµРј РІ Р‘Р”
    await supabase.from('orders').update({ status: newStatus }).eq('id', orderId);
  };

  if (isLoading) return <Loader />;
  return <OrderCard order={order} onUpdateStatus={updateStatus} />;
}
```

## рџЋЁ Р“РѕС‚РѕРІС‹Рµ С…СѓРєРё

### useUsers - Р”Р»СЏ СЃРїРёСЃРєР° РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№

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

### useDepartments - Р”Р»СЏ РѕС‚РґРµР»РѕРІ

```javascript
import { useDepartments } from '../../components/hooks/useDepartments';

function DepartmentPicker() {
  const { departments, isLoading } = useDepartments({
    companyId: myCompanyId,
    onlyEnabled: true, // РўРѕР»СЊРєРѕ Р°РєС‚РёРІРЅС‹Рµ
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

## рџ”„ РЎРѕР·РґР°С‚СЊ СЃРІРѕР№ С…СѓРє (С€Р°Р±Р»РѕРЅ)

```javascript
// components/hooks/useOrders.js
import { useCallback, useMemo } from 'react';
import { useQueryWithCache } from './useQueryWithCache';
import { useRealtimeSync } from './useRealtimeSync';
import { supabase } from '../../lib/supabase';

export function useOrders(options = {}) {
  const { filters = {}, enabled = true } = options;

  // 1. РЈРЅРёРєР°Р»СЊРЅС‹Р№ РєР»СЋС‡ РЅР° РѕСЃРЅРѕРІРµ С„РёР»СЊС‚СЂРѕРІ
  const queryKey = useMemo(() => {
    return `orders:${JSON.stringify(filters)}`;
  }, [filters]);

  // 2. Р¤СѓРЅРєС†РёСЏ Р·Р°РіСЂСѓР·РєРё
  const fetchOrders = useCallback(async () => {
    let query = supabase.from('orders').select('*');

    // РџСЂРёРјРµРЅРёС‚СЊ С„РёР»СЊС‚СЂС‹
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.userId) query = query.eq('user_id', filters.userId);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }, [filters]);

  // 3. РљСЌС€ СЃ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРёРј РѕР±РЅРѕРІР»РµРЅРёРµРј
  const { data, isLoading, isRefreshing, refresh, error } = useQueryWithCache({
    queryKey,
    queryFn: fetchOrders,
    ttl: 3 * 60 * 1000, // 3 РјРёРЅСѓС‚С‹ (Р·Р°РєР°Р·С‹ РјРµРЅСЏСЋС‚СЃСЏ С‡Р°СЃС‚Рѕ)
    enabled,
  });

  // 4. Realtime СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ
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

## вљЎ РњРёРіСЂР°С†РёСЏ СЃСѓС‰РµСЃС‚РІСѓСЋС‰РµР№ СЃС‚СЂР°РЅРёС†С‹

### Р‘С‹Р»Рѕ (СЃС‚Р°СЂС‹Р№ РєРѕРґ):

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

### РЎС‚Р°Р»Рѕ (РЅРѕРІС‹Р№ РєРѕРґ):

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

**Р РµР·СѓР»СЊС‚Р°С‚:** -50 СЃС‚СЂРѕРє РєРѕРґР°, +Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРёР№ РєСЌС€, +РґРµРґСѓРїР»РёРєР°С†РёСЏ, +retry, +stale-while-revalidate! рџЋ‰

## рџ“¦ Р§С‚Рѕ СѓР¶Рµ СЂР°Р±РѕС‚Р°РµС‚

- вњ… **users/index.jsx** - РїРѕР»РЅРѕСЃС‚СЊСЋ РјРёРіСЂРёСЂРѕРІР°РЅР°
- вњ… Р’СЃРµ РЅРѕРІС‹Рµ СЃС‚СЂР°РЅРёС†С‹ РјРѕР¶РЅРѕ РґРµР»Р°С‚СЊ РїРѕ С€Р°Р±Р»РѕРЅР°Рј РІС‹С€Рµ

## рџЋЇ TTL РЁРїР°СЂРіР°Р»РєР°

```javascript
ttl: 1 * 60 * 1000; // 1 РјРёРЅ  - СЃРѕРѕР±С‰РµРЅРёСЏ, СѓРІРµРґРѕРјР»РµРЅРёСЏ
ttl: 3 * 60 * 1000; // 3 РјРёРЅ  - Р·Р°РєР°Р·С‹, Р·Р°РґР°С‡Рё
ttl: 5 * 60 * 1000; // 5 РјРёРЅ  - РїРѕР»СЊР·РѕРІР°С‚РµР»Рё (default)
ttl: 15 * 60 * 1000; // 15 РјРёРЅ - РѕС‚РґРµР»С‹, РЅР°СЃС‚СЂРѕР№РєРё
ttl: 30 * 60 * 1000; // 30 РјРёРЅ - СЃРїСЂР°РІРѕС‡РЅРёРєРё
ttl: 60 * 60 * 1000; // 1 С‡Р°СЃ  - РєРѕРЅСЃС‚Р°РЅС‚С‹
```

## рџ† Troubleshooting

**Р”Р°РЅРЅС‹Рµ РЅРµ РѕР±РЅРѕРІР»СЏСЋС‚СЃСЏ?**

```javascript
// РџСЂРёРЅСѓРґРёС‚РµР»СЊРЅРѕРµ РѕР±РЅРѕРІР»РµРЅРёРµ
refresh();

// РР»Рё РѕС‡РёСЃС‚РёС‚СЊ РєСЌС€
import { globalCache } from '../lib/cache/DataCache';
globalCache.invalidate('myQueryKey');
```

**Realtime РЅРµ СЂР°Р±РѕС‚Р°РµС‚?**

```javascript
// РЈР±РµРґРёС‚РµСЃСЊ С‡С‚Рѕ РІСЃРµ РїР°СЂР°РјРµС‚СЂС‹ Р·Р°РґР°РЅС‹
enableRealtime: true,
realtimeTable: 'your_table',  // в†ђ РќР°Р·РІР°РЅРёРµ С‚Р°Р±Р»РёС†С‹
supabaseClient: supabase,     // в†ђ РљР»РёРµРЅС‚
```

**РҐРѕС‡Сѓ РґСЂСѓРіРѕР№ TTL РґР»СЏ РєРѕРЅРєСЂРµС‚РЅРѕРіРѕ Р·Р°РїСЂРѕСЃР°?**

```javascript
ttl: 10 * 60 * 1000; // 10 РјРёРЅСѓС‚ РІРјРµСЃС‚Рѕ РґРµС„РѕР»С‚РЅС‹С… 5
```

---

**рџЋ‰ Р“РѕС‚РѕРІРѕ! РўРµРїРµСЂСЊ РІСЃРµ РґР°РЅРЅС‹Рµ РіСЂСѓР·СЏС‚СЃСЏ Р±С‹СЃС‚СЂРѕ Рё РѕР±РЅРѕРІР»СЏСЋС‚СЃСЏ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё!**

РџРѕРґСЂРѕР±РЅР°СЏ РґРѕРєСѓРјРµРЅС‚Р°С†РёСЏ: `CACHING_SYSTEM.md`
