#!/bin/bash
# Скрипт для восстановления пользователя в self-hosted Supabase

# Конфигурация
SUPABASE_URL="https://supabase.monitorapp.ru"
ANON_KEY="YOUR_ANON_KEY"  # Скопируйте из ~/n8n-install/.env -> ANON_KEY
SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"  # Скопируйте из ~/n8n-install/.env -> SERVICE_ROLE_KEY
EMAIL="Bahtin106@gmail.com"
PASSWORD="ваш_пароль"
FIRST_NAME="Роман"
LAST_NAME="Бахтин"

echo "🔄 Восстановление пользователя в self-hosted Supabase"
echo "URL: $SUPABASE_URL"
echo "Email: $EMAIL"
echo ""

# Попытка 1: Через Edge Function (если развёрнута)
echo "Попытка 1: Вызов Edge Function restore_user..."
RESPONSE=$(curl -s -X POST "$SUPABASE_URL/functions/v1/restore_user" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$EMAIL\",
    \"password\": \"$PASSWORD\",
    \"firstName\": \"$FIRST_NAME\",
    \"lastName\": \"$LAST_NAME\"
  }")

echo "Ответ сервера:"
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"

# Проверяем результат
if echo "$RESPONSE" | grep -q '"success":true'; then
  echo "✅ Пользователь успешно восстановлен!"
  echo "Попробуйте войти с email: $EMAIL"
  exit 0
fi

echo ""
echo "⚠️ Edge Function не сработала, попробуйте вариант 2 (прямая вставка в БД)"
