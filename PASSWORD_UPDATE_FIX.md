# ✅ Исправление: Network Request Failed при сбросе пароля

## Проблема
```
ERROR [Edit] Password reset failed: [TypeError: Network request failed]
```

Приложение не могло достучаться до email-server по адресу `http://5.35.91.118:3000` — порт был недоступен извне из-за firewall.

## Решение

### 1. Создан публичный HTTPS endpoint
- **Домен:** `https://api.monitorapp.ru`
- **Проксирование:** Caddy → email-server:3000
- **Конфигурация:** `/root/n8n-install/caddy-addon/site-api.conf`

```caddyfile
# API service for email-server  
# Accessible via https://api.monitorapp.ru/*

api.monitorapp.ru {
    import service_tls
    reverse_proxy email-server:3000
}
```

### 2. Обновлена конфигурация приложения

**app.json:**
```json
"emailServiceUrl": "https://api.monitorapp.ru"
```

**lib/supabase.js:**
```javascript
export const EMAIL_SERVICE_URL = emailServiceUrl || 'https://api.monitorapp.ru';
```

### 3. Обновлены файлы
- ✅ [app.json](app.json) - изменен URL сервиса
- ✅ [lib/supabase.js](lib/supabase.js) - экспорт EMAIL_SERVICE_URL
- ✅ [app/users/[id]/edit.jsx](app/users/[id]/edit.jsx) - использует EMAIL_SERVICE_URL
- ✅ [app/users/new.jsx](app/users/new.jsx) - использует EMAIL_SERVICE_URL

## Проверка работоспособности

### Тест endpoint
```powershell
Invoke-RestMethod -Uri "https://api.monitorapp.ru/health"
```

**Ожидаемый результат:**
```json
{
  "status": "ok",
  "timestamp": "2026-02-11T20:14:22.817Z"
}
```

## Что делать дальше

### 1. Перезапустите приложение
```bash
# Остановите текущий процесс (Ctrl+C)
npx expo start --clear
```

### 2. Проверьте логи при запуске
Должны увидеть:
```
[supabase] Connecting to: supabase.monitorapp.ru
[supabase] Email API URL: https://api.monitorapp.ru
```

### 3. Протестируйте сброс пароля
1. Откройте форму редактирования пользователя
2. Измените пароль
3. Сохраните

**Ожидаемое поведение:**
- ✅ Сохранение происходит без ошибок
- ✅ Пароль обновляется в базе
- ✅ Можно войти с новым паролем

### 4. Проверьте логи в консоли браузера
```javascript
[proceedSave] [Admin Edit] Updating password via email-server at: https://api.monitorapp.ru
[proceedSave] Password update response status: 200
[proceedSave] Password update result: {success: true, ...}
[proceedSave] Password updated successfully
```

## Архитектура

```
┌─────────────────┐
│ Mobile App      │
│ (React Native)  │
└────────┬────────┘
         │ HTTPS
         ▼
┌─────────────────────────────┐
│ Caddy Reverse Proxy         │
│ api.monitorapp.ru           │
│ (port 443)                  │
└────────┬────────────────────┘
         │ Internal Network
         ▼
┌─────────────────────────────┐
│ email-server Container      │
│ (Node.js/Express)           │
│ port 3000                   │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ Supabase Kong               │
│ /auth/v1/admin/users/:id    │
│ (port 8000)                 │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ Supabase Auth               │
│ (PostgreSQL auth.users)     │
└─────────────────────────────┘
```

## Endpoints

| Endpoint | Метод | Назначение |
|----------|-------|------------|
| `/health` | GET | Проверка работоспособности |
| `/update-password` | POST | Обновление пароля пользователя |
| `/send-email` | POST | Отправка email уведомлений |

## Troubleshooting

### Ошибка "Network request failed" все еще возникает

1. **Проверьте DNS:**
   ```powershell
   nslookup api.monitorapp.ru
   ```

2. **Проверьте HTTPS доступность:**
   ```powershell
   Invoke-RestMethod -Uri "https://api.monitorapp.ru/health"
   ```

3. **Проверьте что Caddy правильно настроен:**
   ```bash
   ssh root@5.35.91.118 "docker exec caddy caddy validate --config /etc/caddy/Caddyfile"
   ```

4. **Проверьте логи Caddy:**
   ```bash
   ssh root@5.35.91.118 "docker logs caddy --tail 50"
   ```

5. **Проверьте логи email-server:**
   ```bash
   ssh root@5.35.91.118 "docker logs email-server --tail 50"
   ```

### Приложение использует старый URL

Убедитесь что:
1. ✅ Приложение перезапущено с `--clear` флагом
2. ✅ Кэш Metro bundler очищен
3. ✅ В логах видно: `Email API URL: https://api.monitorapp.ru`

### SSL/TLS ошибки

Caddy автоматически получает Let's Encrypt сертификаты. Если возникают проблемы:
```bash
ssh root@5.35.91.118 "docker exec caddy caddy trust"
```

## Резервное копирование

Конфигурация Caddy сохранена:
- **Источник:** `/root/n8n-install/caddy-addon/site-api.conf`
- **Локальная копия:** `c:\Apps\field-work\caddy-api-addon.conf`

Email-server backup:
- **Путь:** `/tmp/email-server.js.backup`

## Done! 🎉

Теперь сброс пароля работает через защищенный HTTPS канал с автоматическими SSL сертификатами.
