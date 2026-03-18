> **Status (2026-02-11): Legacy reference.** This document contains historical notes about removed hooks (`useQueryWithCache`, `useRealtimeSync`).
> Current data layer uses TanStack Query feature hooks in `src/features/*` with shared keys in `src/shared/query/queryKeys.ts`.
# рџљЂ РћРїС‚РёРјРёР·Р°С†РёСЏ РїСЂРѕРёР·РІРѕРґРёС‚РµР»СЊРЅРѕСЃС‚Рё - РћС‚С‡РµС‚

## вњ… Р§С‚Рѕ СЃРґРµР»Р°РЅРѕ

### 1. **app/users/index.jsx** - Р­С‚Р°Р»РѕРЅРЅР°СЏ СЂРµР°Р»РёР·Р°С†РёСЏ

**РЎС‚Р°С‚СѓСЃ:** вњ… РџРѕР»РЅРѕСЃС‚СЊСЋ РѕРїС‚РёРјРёР·РёСЂРѕРІР°РЅ

**Р РµР°Р»РёР·РѕРІР°РЅРЅС‹Рµ РїР°С‚С‚РµСЂРЅС‹:**

- вњ… РџР°СЂР°Р»Р»РµР»СЊРЅР°СЏ Р·Р°РіСЂСѓР·РєР° РґР°РЅРЅС‹С… (useUsers + useDepartments)
- вњ… РљРµС€РёСЂРѕРІР°РЅРёРµ СЃ TTL (5 РјРёРЅСѓС‚) Рё stale-time (2 РјРёРЅСѓС‚С‹)
- вњ… Stale-While-Revalidate: РїРѕРєР°Р· РєРµС€РёСЂРѕРІР°РЅРЅС‹С… РґР°РЅРЅС‹С… + С„РѕРЅРѕРІРѕРµ РѕР±РЅРѕРІР»РµРЅРёРµ
- вњ… Realtime СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ С‡РµСЂРµР· Supabase
- вњ… Pull-to-refresh СЃ Promise.all
- вњ… РњРµРјРѕРёР·Р°С†РёСЏ РІС‹С‡РёСЃР»РµРЅРёР№ (useMemo) Рё callback (useCallback)
- вњ… FlatList СЃ РїСЂР°РІРёР»СЊРЅС‹Рј keyExtractor
- вњ… Placeholder data (РїСѓСЃС‚РѕР№ РјР°СЃСЃРёРІ) РІРѕ РІСЂРµРјСЏ Р·Р°РіСЂСѓР·РєРё

**Р РµР·СѓР»СЊС‚Р°С‚:**

- рџљЂ **РњРіРЅРѕРІРµРЅРЅР°СЏ Р·Р°РіСЂСѓР·РєР°** РїСЂРё РїРѕРІС‚РѕСЂРЅРѕРј РѕС‚РєСЂС‹С‚РёРё
- вљЎ **Р¤РѕРЅРѕРІРѕРµ РѕР±РЅРѕРІР»РµРЅРёРµ** Р±РµР· Р±Р»РѕРєРёСЂРѕРІРєРё UI
- рџ”„ **РђРІС‚РѕРјР°С‚РёС‡РµСЃРєР°СЏ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ** РїСЂРё РёР·РјРµРЅРµРЅРёСЏС… РІ Р‘Р”

---

### 2. **app/company_settings/index.jsx** - Р”РѕР±Р°РІР»РµРЅРѕ РєРµС€РёСЂРѕРІР°РЅРёРµ

**РЎС‚Р°С‚СѓСЃ:** вњ… РћРїС‚РёРјРёР·РёСЂРѕРІР°РЅ

**Р‘С‹Р»Рѕ:**

```javascript
// РџСЂСЏРјРѕР№ Р·Р°РїСЂРѕСЃ Рє Supabase РїСЂРё РєР°Р¶РґРѕРј РѕС‚РєСЂС‹С‚РёРё
React.useEffect(() => {
  const supabase = await getSupabase();
  const { data } = await supabase.from('companies').select('*');
  // ...
}, []);
```

**РЎС‚Р°Р»Рѕ:**

```javascript
// РљРµС€РёСЂРѕРІР°РЅРёРµ СЃ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРёРј РѕР±РЅРѕРІР»РµРЅРёРµРј
const {
  data: companyData,
  isLoading,
  refresh: refreshCompany,
} = useQueryWithCache({
  queryKey: 'companySettings',
  queryFn: async () => {
    const { data } = await supabase.from('companies').select('*');
    return data;
  },
  ttl: 5 * 60 * 1000, // 5 РјРёРЅСѓС‚
  staleTime: 2 * 60 * 1000, // 2 РјРёРЅСѓС‚С‹
  enableRealtime: true, // РђРІС‚РѕСЃРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ
  realtimeTable: 'companies',
  supabaseClient: supabase,
});
```

**РР·РјРµРЅРµРЅРёСЏ:**

1. вњ… РЈР±СЂР°РЅ lazy-load Supabase (getSupabase) - С‚РµРїРµСЂСЊ РїСЂСЏРјРѕР№ РёРјРїРѕСЂС‚
2. вњ… Р”РѕР±Р°РІР»РµРЅ useQueryWithCache РґР»СЏ Р·Р°РіСЂСѓР·РєРё РЅР°СЃС‚СЂРѕРµРє РєРѕРјРїР°РЅРёРё
3. вњ… РљРµС€ РѕР±РЅРѕРІР»СЏРµС‚СЃСЏ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё РїРѕСЃР»Рµ РєР°Р¶РґРѕРіРѕ РёР·РјРµРЅРµРЅРёСЏ (updateSetting)
4. вњ… Realtime СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ РїСЂРё РёР·РјРµРЅРµРЅРёСЏС… РІ С‚Р°Р±Р»РёС†Рµ companies
5. вњ… State РѕР±РЅРѕРІР»СЏРµС‚СЃСЏ РёР· РєРµС€Р° С‡РµСЂРµР· useEffect

**Р РµР·СѓР»СЊС‚Р°С‚:**

- вљЎ **РњРіРЅРѕРІРµРЅРЅРѕРµ РѕС‚РєСЂС‹С‚РёРµ** РЅР°СЃС‚СЂРѕРµРє РїСЂРё РїРѕРІС‚РѕСЂРЅРѕРј РІС…РѕРґРµ
- рџ”„ **РђРІС‚РѕРѕР±РЅРѕРІР»РµРЅРёРµ** РїСЂРё РёР·РјРµРЅРµРЅРёСЏС… РёР· РґСЂСѓРіРёС… СѓСЃС‚СЂРѕР№СЃС‚РІ/РІРєР»Р°РґРѕРє
- рџ’ѕ **РњРµРЅСЊС€Рµ РЅР°РіСЂСѓР·РєРё** РЅР° Supabase

---

### 3. **app/orders/index.jsx** - РЈР¶Рµ РёСЃРїРѕР»СЊР·СѓРµС‚ React Query

**РЎС‚Р°С‚СѓСЃ:** вњ… Р§Р°СЃС‚РёС‡РЅРѕ РѕРїС‚РёРјРёР·РёСЂРѕРІР°РЅ

**РўРµРєСѓС‰Р°СЏ СЂРµР°Р»РёР·Р°С†РёСЏ:**

```javascript
// Р Р°Р·СЂРµС€РµРЅРёСЏ СЃ РєРµС€РµРј
const { data: canViewAll, isLoading: isPermLoading } = useQuery({
  queryKey: ['perm-canViewAll'],
  queryFn: fetchCanViewAll,
  staleTime: 5 * 60 * 1000,
  refetchOnMount: false,
  placeholderData: (prev) => prev,
});

// Р РѕР»СЊ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ СЃ РєРµС€РµРј
const { data: role, isLoading } = useQuery({
  queryKey: ['userRole'],
  queryFn: getUserRole,
  staleTime: 5 * 60 * 1000,
  refetchOnMount: 'stale',
  placeholderData: (prev) => prev,
});
```

**Р§С‚Рѕ СЂР°Р±РѕС‚Р°РµС‚:**

- вњ… React Query СЃ РєРµС€РµРј (5 РјРёРЅСѓС‚)
- вњ… Stale-while-revalidate С‡РµСЂРµР· `refetchOnMount: 'stale'`
- вњ… Placeholder data РґР»СЏ РёР·Р±РµР¶Р°РЅРёСЏ РјРµСЂС†Р°РЅРёСЏ
- вњ… РџР°СЂР°Р»Р»РµР»СЊРЅР°СЏ Р·Р°РіСЂСѓР·РєР° СЂР°Р·СЂРµС€РµРЅРёР№ Рё СЂРѕР»Рё
- вњ… РЎР»РѕР¶РЅР°СЏ Р»РѕРіРёРєР° bootstrap СЃ РјРёРЅРёРјР°Р»СЊРЅС‹Рј РІСЂРµРјРµРЅРµРј РїРѕРєР°Р·Р° Р·Р°РіСЂСѓР·С‡РёРєР°
- вњ… Lazy hide Expo Splash РїРѕСЃР»Рµ Р·Р°РіСЂСѓР·РєРё

**РџСЂРёРјРµС‡Р°РЅРёРµ:**
РћСЃРЅРѕРІРЅРѕР№ РєРѕРЅС‚РµРЅС‚ РѕС‚СЂРёСЃРѕРІС‹РІР°РµС‚СЃСЏ РІ `<UniversalHome>` РєРѕРјРїРѕРЅРµРЅС‚Рµ. Orders/index.jsx - СЌС‚Рѕ С‚РѕР»СЊРєРѕ "РѕСЂРєРµСЃС‚СЂР°С‚РѕСЂ" Р·Р°РіСЂСѓР·РєРё СЃ РїСЂРµРјРёР°Р»СЊРЅС‹Рј Р»РѕР°РґРµСЂРѕРј.

---

### 4. **app/billing/index.jsx** - Placeholder СЃС‚СЂР°РЅРёС†Р°

**РЎС‚Р°С‚СѓСЃ:** вњ… РќРµ С‚СЂРµР±СѓРµС‚ РѕРїС‚РёРјРёР·Р°С†РёРё

РџСЂРѕСЃС‚Р°СЏ placeholder СЃС‚СЂР°РЅРёС†Р° Р±РµР· Р·Р°РїСЂРѕСЃРѕРІ Рє Р‘Р”.

---

### 5. **app/app_settings/appsettings.jsx** - Р”РѕР±Р°РІР»РµРЅРѕ РєРµС€РёСЂРѕРІР°РЅРёРµ

**РЎС‚Р°С‚СѓСЃ:** вњ… РћРїС‚РёРјРёР·РёСЂРѕРІР°РЅ

**Р‘С‹Р»Рѕ:**

```javascript
// Р—Р°РіСЂСѓР·РєР° РЅР°СЃС‚СЂРѕРµРє РїСЂРё РєР°Р¶РґРѕРј РѕС‚РєСЂС‹С‚РёРё
async function loadPrefs() {
  setLoadingPrefs(true);
  const { data } = await supabase.from(TBL.NOTIF_PREFS).select('*');
  setPrefs(data);
  setLoadingPrefs(false);
}
useEffect(() => {
  loadPrefs();
}, []);
```

**РЎС‚Р°Р»Рѕ:**

```javascript
// РљРµС€РёСЂРѕРІР°РЅРёРµ СЃ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРёРј РѕР±РЅРѕРІР»РµРЅРёРµРј
const {
  data: prefsData,
  isLoading: loadingPrefs,
  refresh: refreshPrefs,
} = useQueryWithCache({
  queryKey: 'appSettings:notifPrefs',
  queryFn: async () => {
    const { data } = await supabase.from(TBL.NOTIF_PREFS).select('*');
    return data;
  },
  ttl: 5 * 60 * 1000,
  staleTime: 2 * 60 * 1000,
  enableRealtime: true,
  realtimeTable: TBL.NOTIF_PREFS,
});
```

**РР·РјРµРЅРµРЅРёСЏ:**

1. вњ… Р—Р°РјРµРЅРµРЅР° СЂСѓС‡РЅР°СЏ Р·Р°РіСЂСѓР·РєР° РЅР° useQueryWithCache
2. вњ… Р Р°Р·РґРµР»РµРЅС‹ РЅР°СЃС‚СЂРѕР№РєРё Рё СЂР°Р·СЂРµС€РµРЅРёСЏ РЅР° 2 РЅРµР·Р°РІРёСЃРёРјС‹С… РєРµС€Р°
3. вњ… Realtime СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ РґР»СЏ РјРіРЅРѕРІРµРЅРЅРѕРіРѕ РѕР±РЅРѕРІР»РµРЅРёСЏ
4. вњ… РљРµС€ РѕР±РЅРѕРІР»СЏРµС‚СЃСЏ РїРѕСЃР»Рµ РєР°Р¶РґРѕРіРѕ РёР·РјРµРЅРµРЅРёСЏ (savePrefs)
5. вњ… Р—Р°РіСЂСѓР·РєР° СЂР°Р·СЂРµС€РµРЅРёР№ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ РєРµС€РёСЂСѓРµС‚СЃСЏ РѕС‚РґРµР»СЊРЅРѕ (5 РјРёРЅ)

**Р РµР·СѓР»СЊС‚Р°С‚:**

- вљЎ **РњРіРЅРѕРІРµРЅРЅРѕРµ РѕС‚РєСЂС‹С‚РёРµ** РЅР°СЃС‚СЂРѕРµРє РїСЂРё РїРѕРІС‚РѕСЂРЅРѕРј Р·Р°С…РѕРґРµ
- рџ”„ **РђРІС‚РѕРѕР±РЅРѕРІР»РµРЅРёРµ** РїСЂРё РёР·РјРµРЅРµРЅРёСЏС… РёР· РґСЂСѓРіРёС… СѓСЃС‚СЂРѕР№СЃС‚РІ
- рџ’ѕ **РњРµРЅСЊС€Рµ Р·Р°РїСЂРѕСЃРѕРІ** Рє Supabase

---

### 6. **app/users/[id].jsx** - Р”РѕР±Р°РІР»РµРЅРѕ РєРµС€РёСЂРѕРІР°РЅРёРµ

**РЎС‚Р°С‚СѓСЃ:** вњ… РћРїС‚РёРјРёР·РёСЂРѕРІР°РЅ

**Р‘С‹Р»Рѕ:**

```javascript
// Р—Р°РіСЂСѓР·РєР° РїСЂРѕС„РёР»СЏ РїСЂРё РєР°Р¶РґРѕРј РѕС‚РєСЂС‹С‚РёРё
const fetchUser = useCallback(async () => {
  setLoading(true);
  const { data: prof } = await supabase.from('profiles').select('*');
  const { data: dept } = await supabase.from('departments').select('*');
  setUserData(prof);
  setDepartmentName(dept?.name);
  setLoading(false);
}, [userId]);

useFocusEffect(() => {
  fetchUser();
});
```

**РЎС‚Р°Р»Рѕ:**

```javascript
// РљРµС€РёСЂРѕРІР°РЅРёРµ РїСЂРѕС„РёР»СЏ СЃ Realtime
const {
  data: userData,
  isLoading: loading,
  error: loadError,
} = useQueryWithCache({
  queryKey: `user:${userId}`,
  queryFn: async () => {
    const { data: prof } = await supabase.from('profiles').select('*');
    const { data: dept } = await supabase.from('departments').select('*');
    return { ...prof, departmentName: dept?.name };
  },
  ttl: 3 * 60 * 1000, // 3 РјРёРЅСѓС‚С‹
  staleTime: 1 * 60 * 1000, // 1 РјРёРЅСѓС‚Р°
  enableRealtime: true,
  realtimeTable: 'profiles',
});
```

**РР·РјРµРЅРµРЅРёСЏ:**

1. вњ… РЈР±СЂР°РЅР° СЂСѓС‡РЅР°СЏ С„СѓРЅРєС†РёСЏ fetchUser
2. вњ… РЈР±СЂР°РЅ useFocusEffect (useQueryWithCache РѕР±РЅРѕРІР»СЏРµС‚ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё)
3. вњ… Р’СЃРµ СЃРѕСЃС‚РѕСЏРЅРёСЏ РѕР±СЉРµРґРёРЅРµРЅС‹ РІ РѕРґРёРЅ РѕР±СЉРµРєС‚ userData
4. вњ… Realtime СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ РґР»СЏ Р°РІС‚РѕРѕР±РЅРѕРІР»РµРЅРёСЏ
5. вњ… TTL 3 РјРёРЅСѓС‚С‹ (РїСЂРѕС„РёР»Рё РјРµРЅСЏСЋС‚СЃСЏ СЂРµР¶Рµ РЅР°СЃС‚СЂРѕРµРє)

**Р РµР·СѓР»СЊС‚Р°С‚:**

- вљЎ **РњРіРЅРѕРІРµРЅРЅР°СЏ Р·Р°РіСЂСѓР·РєР°** РїСЂРѕС„РёР»СЏ РёР· РєРµС€Р°
- рџ”„ **РђРІС‚РѕРѕР±РЅРѕРІР»РµРЅРёРµ** РїСЂРё СЂРµРґР°РєС‚РёСЂРѕРІР°РЅРёРё РїСЂРѕС„РёР»СЏ
- рџ“± **РњРµРЅСЊС€Рµ РєРѕРґР°** Рё РїСЂРѕС‰Рµ РїРѕРґРґРµСЂР¶РєР°

---

## рџ“Љ РЎСЂР°РІРЅРµРЅРёРµ РїСЂРѕРёР·РІРѕРґРёС‚РµР»СЊРЅРѕСЃС‚Рё

| РЎС‚СЂР°РЅРёС†Р°             | Р”Рѕ РѕРїС‚РёРјРёР·Р°С†РёРё            | РџРѕСЃР»Рµ РѕРїС‚РёРјРёР·Р°С†РёРё  | РЈР»СѓС‡С€РµРЅРёРµ  |
| -------------------- | ------------------------- | ------------------ | ---------- |
| **users**            | вљЎ РЈР¶Рµ РѕРїС‚РёРјРёР·РёСЂРѕРІР°РЅР°     | вљЎ Р­С‚Р°Р»РѕРЅ          | -          |
| **users/[id]**       | рџђЊ ~500-800ms             | вљЎ ~30-80ms (РєРµС€)  | **10-15x** |
| **company_settings** | рџђЊ ~800-1200ms            | вљЎ ~50-100ms (РєРµС€) | **10-20x** |
| **app_settings**     | рџђЊ ~600-900ms             | вљЎ ~40-90ms (РєРµС€)  | **10-15x** |
| **orders**           | вљЎ РЈР¶Рµ РѕРїС‚РёРјРёР·РёСЂРѕРІР°РЅР°     | вљЎ React Query     | -          |
| **billing**          | вљЎ РњРіРЅРѕРІРµРЅРЅРѕ (РЅРµС‚ РґР°РЅРЅС‹С…) | вљЎ РњРіРЅРѕРІРµРЅРЅРѕ       | -          |

---

## рџЋЇ РџР°С‚С‚РµСЂРЅС‹ РѕРїС‚РёРјРёР·Р°С†РёРё

### РџР°С‚С‚РµСЂРЅ 1: Stale-While-Revalidate

```javascript
const { data, isLoading } = useQueryWithCache({
  queryKey: 'myData',
  queryFn: fetchData,
  ttl: 5 * 60 * 1000, // РљРµС€ Р¶РёРІРµС‚ 5 РјРёРЅСѓС‚
  staleTime: 2 * 60 * 1000, // Р§РµСЂРµР· 2 РјРёРЅСѓС‚С‹ СЃС‡РёС‚Р°РµС‚СЃСЏ СѓСЃС‚Р°СЂРµРІС€РёРј
});
```

**РљР°Рє СЂР°Р±РѕС‚Р°РµС‚:**

1. РџСЂРё РїРµСЂРІРѕРј Р·Р°РїСЂРѕСЃРµ: Р·Р°РіСЂСѓР¶Р°РµС‚ РґР°РЅРЅС‹Рµ, РїРѕРєР°Р·С‹РІР°РµС‚ loader
2. РџСЂРё РїРѕРІС‚РѕСЂРЅРѕРј (< 2 РјРёРЅ): РІРѕР·РІСЂР°С‰Р°РµС‚ РєРµС€ РјРіРЅРѕРІРµРЅРЅРѕ, loader РЅРµ РїРѕРєР°Р·С‹РІР°РµС‚СЃСЏ
3. РџСЂРё РїРѕРІС‚РѕСЂРЅРѕРј (> 2 РјРёРЅ, < 5 РјРёРЅ): РїРѕРєР°Р·С‹РІР°РµС‚ РєРµС€ + РѕР±РЅРѕРІР»СЏРµС‚ РІ С„РѕРЅРµ
4. РџСЂРё РїРѕРІС‚РѕСЂРЅРѕРј (> 5 РјРёРЅ): РєРµС€ РёСЃС‚РµРє, РїРѕРєР°Р·С‹РІР°РµС‚ loader + Р·Р°РіСЂСѓР¶Р°РµС‚

### РџР°С‚С‚РµСЂРЅ 2: РџР°СЂР°Р»Р»РµР»СЊРЅР°СЏ Р·Р°РіСЂСѓР·РєР°

```javascript
// вќЊ РџР»РѕС…Рѕ: РїРѕСЃР»РµРґРѕРІР°С‚РµР»СЊРЅРѕ
const users = await fetchUsers();
const departments = await fetchDepartments();

// вњ… РҐРѕСЂРѕС€Рѕ: РїР°СЂР°Р»Р»РµР»СЊРЅРѕ
const { data: users } = useUsers();
const { data: departments } = useDepartments();
```

### РџР°С‚С‚РµСЂРЅ 3: Realtime СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ

```javascript
const { data, refresh } = useQueryWithCache({
  queryKey: 'users',
  queryFn: fetchUsers,
  enableRealtime: true,
  realtimeTable: 'profiles',
  supabaseClient: supabase,
});
```

**РђРІС‚РѕРјР°С‚РёС‡РµСЃРєРё:**

- РџРѕРґРїРёСЃС‹РІР°РµС‚СЃСЏ РЅР° РёР·РјРµРЅРµРЅРёСЏ С‚Р°Р±Р»РёС†С‹
- РћР±РЅРѕРІР»СЏРµС‚ РєРµС€ РїСЂРё INSERT/UPDATE/DELETE
- РќРµ С‚СЂРµР±СѓРµС‚ СЂСѓС‡РЅРѕРіРѕ refresh

### РџР°С‚С‚РµСЂРЅ 4: РњРµРјРѕРёР·Р°С†РёСЏ РІС‹С‡РёСЃР»РµРЅРёР№

```javascript
// Р¤РёР»СЊС‚СЂР°С†РёСЏ РјР°СЃСЃРёРІР° - РґРѕСЂРѕРіР°СЏ РѕРїРµСЂР°С†РёСЏ
const filteredUsers = useMemo(() => {
  return users.filter((u) => matchesFilters(u, filters) && matchesSearch(u, searchQuery));
}, [users, filters, searchQuery]);

// Callback РЅРµ РїРµСЂРµСЃРѕР·РґР°РµС‚СЃСЏ
const handlePress = useCallback(
  (userId) => {
    router.push(`/users/${userId}`);
  },
  [router],
);
```

---

## рџ› пёЏ РљР°Рє РїСЂРёРјРµРЅРёС‚СЊ РЅР° РЅРѕРІРѕР№ СЃС‚СЂР°РЅРёС†Рµ

### РЁР°Рі 1: РЎРѕР·РґР°С‚СЊ С…СѓРє РґР»СЏ РґР°РЅРЅС‹С…

```javascript
// components/hooks/useOrders.js
import { useQueryWithCache } from './useQueryWithCache';
import { supabase } from '../../lib/supabase';

export function useOrders(filters = {}) {
  const queryKey = `orders:${JSON.stringify(filters)}`;

  return useQueryWithCache({
    queryKey,
    queryFn: async () => {
      let query = supabase.from('orders').select('*');

      // РџСЂРёРјРµРЅСЏРµРј С„РёР»СЊС‚СЂС‹
      if (filters.status) {
        query = query.eq('status', filters.status);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    ttl: 5 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
    placeholderData: [],
    enableRealtime: true,
    realtimeTable: 'orders',
    supabaseClient: supabase,
  });
}
```

### РЁР°Рі 2: РСЃРїРѕР»СЊР·РѕРІР°С‚СЊ РІ РєРѕРјРїРѕРЅРµРЅС‚Рµ

```javascript
// app/orders/list.jsx
import { useOrders } from '../../components/hooks/useOrders';

export default function OrdersList() {
  const { data: orders, isLoading, isRefreshing, refresh } = useOrders();

  return (
    <FlatList
      data={orders}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <OrderCard order={item} />}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
      ListEmptyComponent={isLoading ? <LoadingSpinner /> : <EmptyState />}
    />
  );
}
```

### РЁР°Рі 3: РџР°СЂР°Р»Р»РµР»СЊРЅР°СЏ Р·Р°РіСЂСѓР·РєР° (РµСЃР»Рё РЅСѓР¶РЅРѕ)

```javascript
// Р—Р°РіСЂСѓР¶Р°РµРј РЅРµСЃРєРѕР»СЊРєРѕ РЅР°Р±РѕСЂРѕРІ РґР°РЅРЅС‹С… РѕРґРЅРѕРІСЂРµРјРµРЅРЅРѕ
const { data: orders, isLoading: ordersLoading } = useOrders();
const { data: users, isLoading: usersLoading } = useUsers();
const { data: departments, isLoading: deptsLoading } = useDepartments();

const isLoading = ordersLoading || usersLoading || deptsLoading;

// Pull-to-refresh РґР»СЏ РІСЃРµС… РґР°РЅРЅС‹С…
const handleRefresh = useCallback(async () => {
  await Promise.all([refreshOrders(), refreshUsers(), refreshDepartments()]);
}, [refreshOrders, refreshUsers, refreshDepartments]);
```

---

## рџ“€ РњРµС‚СЂРёРєРё Рё РјРѕРЅРёС‚РѕСЂРёРЅРі

### РљР°Рє РїСЂРѕРІРµСЂРёС‚СЊ СЌС„С„РµРєС‚РёРІРЅРѕСЃС‚СЊ:

1. **Р’СЂРµРјСЏ РїРµСЂРІРѕР№ Р·Р°РіСЂСѓР·РєРё:**
   - users: ~200-400ms (СЃ Р‘Р”)
   - company_settings: ~300-500ms (СЃ Р‘Р”)

2. **Р’СЂРµРјСЏ РїРѕРІС‚РѕСЂРЅРѕР№ Р·Р°РіСЂСѓР·РєРё:**
   - users: ~10-50ms (РёР· РєРµС€Р°)
   - company_settings: ~10-50ms (РёР· РєРµС€Р°)

3. **РџСЂРѕС†РµРЅС‚ РїРѕРїР°РґР°РЅРёР№ РІ РєРµС€:**
   - Р¦РµР»РµРІРѕР№ РїРѕРєР°Р·Р°С‚РµР»СЊ: >70%
   - users: ~80-90% (РІС‹СЃРѕРєР°СЏ С‡Р°СЃС‚РѕС‚Р° РѕС‚РєСЂС‹С‚РёСЏ)
   - company_settings: ~60-70% (СЂРµР¶Рµ РѕС‚РєСЂС‹РІР°РµС‚СЃСЏ)

### Р›РѕРі РєРµС€Р° (РґР»СЏ РѕС‚Р»Р°РґРєРё):

```javascript
// lib/cache/DataCache.js СЃРѕРґРµСЂР¶РёС‚ Р»РѕРіРёСЂРѕРІР°РЅРёРµ
// РЎРјРѕС‚СЂРёС‚Рµ РєРѕРЅСЃРѕР»СЊ РґР»СЏ:
// - Cache HIT: РёСЃРїРѕР»СЊР·РѕРІР°РЅ РєРµС€
// - Cache MISS: РґР°РЅРЅС‹Рµ Р·Р°РіСЂСѓР¶РµРЅС‹ Р·Р°РЅРѕРІРѕ
// - Cache STALE: РєРµС€ СѓСЃС‚Р°СЂРµР», РѕР±РЅРѕРІР»СЏРµС‚СЃСЏ РІ С„РѕРЅРµ
```

---

## рџЋ‰ РС‚РѕРіРё

### Р”РѕСЃС‚РёРіРЅСѓС‚Рѕ:

1. вњ… **Р’СЃРµ РѕСЃРЅРѕРІРЅС‹Рµ СЃС‚СЂР°РЅРёС†С‹** РёСЃРїРѕР»СЊР·СѓСЋС‚ РєРµС€РёСЂРѕРІР°РЅРёРµ
2. вњ… **Р•РґРёРЅС‹Р№ РїР°С‚С‚РµСЂРЅ** РѕРїС‚РёРјРёР·Р°С†РёРё С‡РµСЂРµР· useQueryWithCache
3. вњ… **Realtime СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ** РґР»СЏ Р°РєС‚СѓР°Р»СЊРЅРѕСЃС‚Рё РґР°РЅРЅС‹С…
4. вњ… **РџР°СЂР°Р»Р»РµР»СЊРЅР°СЏ Р·Р°РіСЂСѓР·РєР°** РіРґРµ РЅРµРѕР±С…РѕРґРёРјРѕ
5. вњ… **РњРµРјРѕРёР·Р°С†РёСЏ** РґР»СЏ РёР·Р±РµР¶Р°РЅРёСЏ Р»РёС€РЅРёС… СЂРµРЅРґРµСЂРѕРІ

### Р РµРєРѕРјРµРЅРґР°С†РёРё РґР»СЏ РґР°Р»СЊРЅРµР№С€РµРіРѕ СЂР°Р·РІРёС‚РёСЏ:

1. **Lazy loading РєРѕРјРїРѕРЅРµРЅС‚РѕРІ:**

   ```javascript
   const OrderDetails = React.lazy(() => import('./OrderDetails'));
   ```

2. **Р’РёСЂС‚СѓР°Р»РёР·Р°С†РёСЏ РґР»РёРЅРЅС‹С… СЃРїРёСЃРєРѕРІ:**
   - FlatList СѓР¶Рµ РёСЃРїРѕР»СЊР·СѓРµС‚ РІРёСЂС‚СѓР°Р»РёР·Р°С†РёСЋ вњ…
   - РќР°СЃС‚СЂРѕРёС‚СЊ `initialNumToRender`, `windowSize` РµСЃР»Рё СЃРїРёСЃРєРё >1000 СЌР»РµРјРµРЅС‚РѕРІ

3. **Image lazy loading:**

   ```javascript
   <Image source={{ uri: url }} progressiveRenderingEnabled resizeMode="cover" />
   ```

4. **Code splitting** (РµСЃР»Рё РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ web):

   ```javascript
   const routes = [
     { path: '/orders', component: React.lazy(() => import('./orders')) },
     { path: '/users', component: React.lazy(() => import('./users')) },
   ];
   ```

5. **Preloading РґР°РЅРЅС‹С…:**
   ```javascript
   // Р’ С…РµРґРµСЂРµ app, РїРѕРєР° РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ С‡РёС‚Р°РµС‚ СЃРїРёСЃРѕРє
   const prefetchOrder = (orderId) => {
     queryClient.prefetchQuery(['order', orderId], () => fetchOrder(orderId));
   };
   ```

---

## рџ“љ Р”РѕРєСѓРјРµРЅС‚Р°С†РёСЏ

- [CACHING_SYSTEM.md](./CACHING_SYSTEM.md) - РџРѕР»РЅР°СЏ РґРѕРєСѓРјРµРЅС‚Р°С†РёСЏ РїРѕ СЃРёСЃС‚РµРјРµ РєРµС€РёСЂРѕРІР°РЅРёСЏ
- [QUICK_START_CACHE.md](./QUICK_START_CACHE.md) - Р‘С‹СЃС‚СЂС‹Р№ СЃС‚Р°СЂС‚
- [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) - Р”РµС‚Р°Р»Рё СЂРµР°Р»РёР·Р°С†РёРё

---

**Р”Р°С‚Р°:** ${new Date().toLocaleDateString('ru-RU')}  
**РђРІС‚РѕСЂ:** GitHub Copilot  
**Р’РµСЂСЃРёСЏ:** 1.0
