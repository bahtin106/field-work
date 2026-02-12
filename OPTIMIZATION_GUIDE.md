> **Status (2026-02-11): Legacy reference.** This document contains historical notes about removed hooks (`useQueryWithCache`, `useRealtimeSync`).
> Current data layer uses TanStack Query feature hooks in `src/features/*` with shared keys in `src/shared/query/queryKeys.ts`.
// РћРїС‚РёРјРёР·РёСЂРѕРІР°РЅРЅР°СЏ РІРµСЂСЃРёСЏ СЃС‚СЂР°РЅРёС†С‹ РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№ СЃ РїСЂРѕС„РµСЃСЃРёРѕРЅР°Р»СЊРЅС‹Рј РєСЌС€РёСЂРѕРІР°РЅРёРµРј
// Р СѓРєРѕРІРѕРґСЃС‚РІРѕ РїРѕ РїСЂРёРјРµРЅРµРЅРёСЋ Рє РґСЂСѓРіРёРј СЃС‚СЂР°РЅРёС†Р°Рј

## РћСЃРЅРѕРІРЅС‹Рµ РёР·РјРµРЅРµРЅРёСЏ

### 1. РРјРїРѕСЂС‚С‹

Р”РѕР±Р°РІР»РµРЅС‹ РЅРѕРІС‹Рµ С…СѓРєРё РґР»СЏ СЂР°Р±РѕС‚С‹ СЃ РєСЌС€РµРј:

```javascript
import { useUsers } from '../../components/hooks/useUsers';
import { useDepartments } from '../../components/hooks/useDepartments';
```

РЈРґР°Р»РµРЅС‹:

- `useFocusEffect` (С‚РµРїРµСЂСЊ РЅРµ РЅСѓР¶РµРЅ, РєСЌС€ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё РѕР±РЅРѕРІР»СЏРµС‚СЃСЏ)
- РџСЂСЏРјС‹Рµ РёРјРїРѕСЂС‚С‹ `supabase` (С‚РµРїРµСЂСЊ РІ С…СѓРєР°С…)

### 2. State РјРµРЅРµРґР¶РјРµРЅС‚

РЈРїСЂРѕС‰РµРЅ state:

```javascript
// Р‘С‹Р»Рѕ:
const [list, setList] = useState([]);
const [loading, setLoading] = useState(true);
const [errorMsg, setErrorMsg] = useState('');
const [refreshing, setRefreshing] = useState(false);
const [departments, setDepartments] = useState([]);
const [useDepartments, setUseDepartments] = useState(false);
const [flagReady, setFlagReady] = useState(false);

// РЎС‚Р°Р»Рѕ:
const [companyId, setCompanyId] = useState(null);
const [useDepartments, setUseDepartments] = useState(false);

// Р”Р°РЅРЅС‹Рµ С‚РµРїРµСЂСЊ РёР· С…СѓРєРѕРІ:
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

### 3. РЈРґР°Р»РµРЅР° РІСЃСЏ СЂСѓС‡РЅР°СЏ Р·Р°РіСЂСѓР·РєР° РґР°РЅРЅС‹С…

РЈРґР°Р»РµРЅС‹ С„СѓРЅРєС†РёРё:

- `fetchUsers()` - С‚РµРїРµСЂСЊ РІ С…СѓРєРµ `useUsers`
- `fetchDepartments()` - С‚РµРїРµСЂСЊ РІ С…СѓРєРµ `useDepartments`
- `loadCompanyFlag()` - СѓРїСЂРѕС‰РµРЅРѕ РґРѕ РѕРґРЅРѕРіРѕ useEffect
- Р’СЃРµ useEffect СЃ `supabase.channel()` - С‚РµРїРµСЂСЊ РІ `useRealtimeSync`

### 4. Pull-to-refresh СѓРїСЂРѕС‰РµРЅ

```javascript
// Р‘С‹Р»Рѕ:
const onRefresh = useCallback(async () => {
  setRefreshing(true);
  await Promise.all([fetchUsers(), fetchDepartments(), loadCompanyFlag()]);
  setRefreshing(false);
}, [fetchUsers, fetchDepartments, loadCompanyFlag]);

// РЎС‚Р°Р»Рѕ:
const onRefresh = useCallback(async () => {
  await refreshUsers();
}, [refreshUsers]);
```

### 5. РСЃРїРѕР»СЊР·РѕРІР°РЅРёРµ РґР°РЅРЅС‹С…

```javascript
// Р‘С‹Р»Рѕ:
data = { filtered }; // РіРґРµ filtered = useMemo(() => list.filter(...))

// РЎС‚Р°Р»Рѕ:
data = { filtered }; // РіРґРµ filtered = useMemo(() => users.filter(...))
```

## РџСЂРµРёРјСѓС‰РµСЃС‚РІР° РЅРѕРІРѕР№ СЃРёСЃС‚РµРјС‹

1. **РњРіРЅРѕРІРµРЅРЅР°СЏ Р·Р°РіСЂСѓР·РєР°**: РџСЂРё РїРѕРІС‚РѕСЂРЅРѕРј Р·Р°С…РѕРґРµ РґР°РЅРЅС‹Рµ РїРѕРєР°Р·С‹РІР°СЋС‚СЃСЏ СЃСЂР°Р·Сѓ РёР· РєСЌС€Р°
2. **Stale-While-Revalidate**: РџРѕРєР°Р·С‹РІР°РµРј РєСЌС€ Рё РѕР±РЅРѕРІР»СЏРµРј РІ С„РѕРЅРµ
3. **РђРІС‚РѕРјР°С‚РёС‡РµСЃРєР°СЏ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ**: Realtime РѕР±РЅРѕРІР»РµРЅРёСЏ Р±РµР· СЂСѓС‡РЅС‹С… РїРѕРґРїРёСЃРѕРє
4. **Pull-to-refresh**: РќР°С‚РёРІРЅР°СЏ Р°РЅРёРјР°С†РёСЏ, РѕРґРЅР° СЃС‚СЂРѕРєР° РєРѕРґР°
5. **РњРµРЅСЊС€Рµ РєРѕРґР°**: ~100 СЃС‚СЂРѕРє СѓРґР°Р»РµРЅРѕ, Р»РѕРіРёРєР° РІС‹РЅРµСЃРµРЅР° РІ РїРµСЂРµРёСЃРїРѕР»СЊР·СѓРµРјС‹Рµ С…СѓРєРё
6. **Р”РµРґСѓРїР»РёРєР°С†РёСЏ Р·Р°РїСЂРѕСЃРѕРІ**: Р•СЃР»Рё РЅРµСЃРєРѕР»СЊРєРѕ РєРѕРјРїРѕРЅРµРЅС‚РѕРІ Р·Р°РїСЂР°С€РёРІР°СЋС‚ РѕРґРЅРё РґР°РЅРЅС‹Рµ, Р·Р°РїСЂРѕСЃ РѕРґРёРЅ
7. **РЈРјРЅС‹Р№ retry**: РђРІС‚РѕРјР°С‚РёС‡РµСЃРєРёРµ РїРѕРІС‚РѕСЂРЅС‹Рµ РїРѕРїС‹С‚РєРё РїСЂРё РѕС€РёР±РєР°С…
8. **TTL РєСЌС€Р°**: РќР°СЃС‚СЂР°РёРІР°РµРјРѕРµ РІСЂРµРјСЏ Р¶РёР·РЅРё РґР°РЅРЅС‹С…

## РљР°Рє РїСЂРёРјРµРЅРёС‚СЊ Рє РґСЂСѓРіРёРј СЃС‚СЂР°РЅРёС†Р°Рј

### РЁР°Рі 1: РЎРѕР·РґР°С‚СЊ СЃРїРµС†РёС„РёС‡РЅС‹Р№ С…СѓРє (РµСЃР»Рё РЅСѓР¶РЅРѕ)

РќР°РїСЂРёРјРµСЂ, РґР»СЏ Р·Р°РєР°Р·РѕРІ:

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

    // РџСЂРёРјРµРЅРёС‚СЊ С„РёР»СЊС‚СЂС‹...

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

### РЁР°Рі 2: Р—Р°РјРµРЅРёС‚СЊ РІ РєРѕРјРїРѕРЅРµРЅС‚Рµ

```javascript
// Р‘С‹Р»Рѕ:
const [orders, setOrders] = useState([]);
const [loading, setLoading] = useState(true);
// + РєСѓС‡Р° useEffect Рё callbacks

// РЎС‚Р°Р»Рѕ:
const { orders, isLoading, isRefreshing, refresh } = useOrders({
  filters: myFilters,
});
```

### РЁР°Рі 3: РћР±РЅРѕРІРёС‚СЊ RefreshControl

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

### РЁР°Рі 4: РћР±РЅРѕРІРёС‚СЊ loader

```javascript
// Р‘С‹Р»Рѕ:
if (loading) return <Loader />;

// РЎС‚Р°Р»Рѕ:
if (isLoading) return <Loader />;
```

## РќР°СЃС‚СЂРѕР№РєР° TTL РґР»СЏ СЂР°Р·РЅС‹С… РґР°РЅРЅС‹С…

```javascript
// Р§Р°СЃС‚Рѕ РјРµРЅСЏСЋС‰РёРµСЃСЏ РґР°РЅРЅС‹Рµ (Р·Р°РєР°Р·С‹, СЃРѕРѕР±С‰РµРЅРёСЏ)
ttl: 2 * 60 * 1000; // 2 РјРёРЅСѓС‚С‹

// РћР±С‹С‡РЅС‹Рµ РґР°РЅРЅС‹Рµ (РїРѕР»СЊР·РѕРІР°С‚РµР»Рё, РїСЂРѕС„РёР»Рё)
ttl: 5 * 60 * 1000; // 5 РјРёРЅСѓС‚

// Р РµРґРєРѕ РјРµРЅСЏСЋС‰РёРµСЃСЏ РґР°РЅРЅС‹Рµ (СЃРїСЂР°РІРѕС‡РЅРёРєРё, РЅР°СЃС‚СЂРѕР№РєРё)
ttl: 30 * 60 * 1000; // 30 РјРёРЅСѓС‚

// РЎС‚Р°С‚РёС‡РµСЃРєРёРµ РґР°РЅРЅС‹Рµ (СЂРѕР»Рё, РєРѕРЅСЃС‚Р°РЅС‚С‹)
ttl: 60 * 60 * 1000; // 1 С‡Р°СЃ
```

## Р’Р°Р¶РЅС‹Рµ Р·Р°РјРµС‡Р°РЅРёСЏ

1. **queryKey РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ СѓРЅРёРєР°Р»СЊРЅС‹Рј** Рё РІРєР»СЋС‡Р°С‚СЊ РІСЃРµ РїР°СЂР°РјРµС‚СЂС‹, РІР»РёСЏСЋС‰РёРµ РЅР° РґР°РЅРЅС‹Рµ
2. **Realtime** РїРѕРґРїРёСЃРєРё Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё РґРµРґСѓРїР»РёС†РёСЂСѓСЋС‚СЃСЏ - РјРѕР¶РЅРѕ Р±РµР·РѕРїР°СЃРЅРѕ РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ РІРµР·РґРµ
3. **refresh()** РІСЃРµРіРґР° Р·Р°РіСЂСѓР¶Р°РµС‚ СЃРІРµР¶РёРµ РґР°РЅРЅС‹Рµ, РјРёРЅСѓСЏ РєСЌС€
4. **РљСЌС€ РіР»РѕР±Р°Р»СЊРЅС‹Р№** - РґР°РЅРЅС‹Рµ РґРѕСЃС‚СѓРїРЅС‹ РјРµР¶РґСѓ СЃС‚СЂР°РЅРёС†Р°РјРё
5. **РђРІС‚РѕРјР°С‚РёС‡РµСЃРєР°СЏ РѕС‡РёСЃС‚РєР°** СѓСЃС‚Р°СЂРµРІС€РёС… РґР°РЅРЅС‹С… РєР°Р¶РґСѓСЋ РјРёРЅСѓС‚Сѓ

## РџСЂРёРјРµСЂС‹ РёСЃРїРѕР»СЊР·РѕРІР°РЅРёСЏ РІ РґСЂСѓРіРёС… С‡Р°СЃС‚СЏС… РїСЂРёР»РѕР¶РµРЅРёСЏ

### Р”Р»СЏ СЃРїРёСЃРєРѕРІ СЃ С„РёР»СЊС‚СЂР°РјРё

```javascript
const { data, isLoading, refresh } = useQueryWithCache({
  queryKey: `myData:${JSON.stringify(filters)}`,
  queryFn: fetchData,
  ttl: 5 * 60 * 1000,
});
```

### Р”Р»СЏ РґРµС‚Р°Р»РµР№ РѕР±СЉРµРєС‚Р°

```javascript
const { data, isLoading, refresh } = useQueryWithCache({
  queryKey: `order:${orderId}`,
  queryFn: () => fetchOrderById(orderId),
  ttl: 5 * 60 * 1000,
  enabled: !!orderId,
});
```

### Р”Р»СЏ СЃРїСЂР°РІРѕС‡РЅРёРєРѕРІ

```javascript
const { data: workTypes } = useQueryWithCache({
  queryKey: 'workTypes',
  queryFn: fetchWorkTypes,
  ttl: 30 * 60 * 1000, // 30 РјРёРЅСѓС‚
});
```
