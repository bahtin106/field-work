# 🔧 Перенос на локальный Supabase сервер

## Дата: 3 февраля 2026

### Что было обновлено

#### 1. **app.json** — Конфигурация клиента
```json
"extra": {
  "supabaseUrl": "https://supabase.monitorapp.ru",
  "supabaseAnonKey": "[обновлен на новый ключ]"
}
```

#### 2. **.env.local** — Переменные для сервера приложения
```env
SUPABASE_URL=https://supabase.monitorapp.ru
SUPABASE_ANON_KEY=[новый публичный ключ]
SUPABASE_SERVICE_ROLE_KEY=[ключ сервиса]
SUPABASE_PUBLIC_URL=https://supabase.monitorapp.ru
API_EXTERNAL_URL=http://localhost:8000
JWT_SECRET=[секретный ключ]
```

#### 3. **supabase/.env.local** — Переменные для Edge Functions
```env
SUPABASE_URL=https://supabase.monitorapp.ru
SUPABASE_ANON_KEY=[новый публичный ключ]
SUPABASE_SERVICE_ROLE_KEY=[ключ сервиса]
PROJECT_URL=https://supabase.monitorapp.ru
SERVICE_ROLE_KEY=[ключ сервиса]
```

### Файлы, которые используют эти переменные:

**Клиент:**
- `lib/supabase.js` — использует `supabaseUrl` и `supabaseAnonKey` из `app.json`
- `useAppLastSeen.js` — использует `supabase` клиент

**Сервер Node.js:**
- `server/expoPush.ts` — использует `SUPABASE_URL` и `SUPABASE_SERVICE_KEY`

**Edge Functions (Supabase):**
- `supabase/functions/push-send/index.ts`
- `supabase/functions/register_user/index.ts`
- `supabase/functions/invite_user/index.ts`
- `supabase/functions/update_user/index.ts`
- `supabase/functions/delete_user/index.ts`
- `supabase/functions/create_user/index.ts`
- `supabase/functions/deactivate_employee/index.ts`
- `supabase/functions/check_employee_orders/index.ts`

### Что нужно сделать далее:

1. **Убедитесь, что данные успешно перенесены** в новую БД на `supabase.monitorapp.ru`
2. **Протестируйте локально:**
   ```bash
   npm install
   expo start
   ```
3. **Если используется локальный Supabase CLI**, запустите:
   ```bash
   supabase start
   ```
4. **Для Edge Functions** они автоматически будут использовать новые переменные из `supabase/.env.local`

### Важно:

- Все переменные окружения находятся в файлах `.env.local` 
- Убедитесь, что `.env.local` добавлены в `.gitignore` (не коммитьте конфиденциальные ключи)
- Протестируйте базовые операции: авторизацию, создание/обновление данных, пуш-уведомления

### Проверка соединения:

Если возникают проблемы с соединением:
1. Убедитесь, что `https://supabase.monitorapp.ru` доступен с вашей машины
2. Проверьте брандмауэр/прокси
3. Убедитесь, что переданные ключи корректны
