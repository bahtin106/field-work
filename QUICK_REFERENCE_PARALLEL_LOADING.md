## Быстрая справка: Параллельная загрузка данных

### Что изменилось?

✅ Отделы больше не мерцают при каждом визите  
✅ Все данные загружаются одновременно  
✅ Используется глобальный кеш (TTL: 60 минут)

### Где это реализовано?

- **`components/hooks/useParallelDataLoad.js`** — новый хук для параллельной загрузки
- **`components/hooks/useDepartments.js`** — обновлено кеширование (60 мин TTL)
- **`app/users/index.jsx`** — использует новую параллельную загрузку

### Как это использовать в других местах?

```javascript
import { useParallelDataLoad } from '../../components/hooks/useParallelDataLoad';
import { useUsers } from '../../components/hooks/useUsers';
import { useDepartments } from '../../components/hooks/useDepartments';

// В компоненте:
const { users, departments, isLoading, refreshAll } = useParallelDataLoad({
  users: {
    hook: useUsers,
    options: { filters: {...}, enabled: true }
  },
  departments: {
    hook: useDepartments,
    options: { companyId, enabled: true }
  },
  // Добавьте любые другие источники данных...
});

// isLoading = true только если ОБА источника загружаются
// Как только один из источников получил данные из кеша - он готов к показу
```

### Важные моменты

1. **Кеширование отделов:**
   - TTL: 60 минут (отделы меняются редко)
   - staleTime: 30 минут (обновляем в фоне после 30 минут)

2. **Параллельная загрузка:**
   - Оба хука инициализируются одновременно
   - Нет очереди загрузок, всё асинхронно

3. **Pull-to-refresh:**
   - Вызывает `refreshAll()` для обновления ВСЕХ данных одновременно

4. **Realtime синхронизация:**
   - Продолжает работать через `useRealtimeSync`
   - Обновления в БД отражаются в обоих хуках

### Тестирование

Чтобы проверить что работает:

1. Откройте страницу Users
2. Закройте и откройте снова (в течение 60 минут)
3. Отделы должны загружаться **мгновенно** из кеша
4. Нет мерцания, нет дополнительных запросов

---

Документация: `/PARALLEL_LOADING_SOLUTION.md`
