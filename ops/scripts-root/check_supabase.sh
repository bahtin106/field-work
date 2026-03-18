#!/bin/bash
# Скрипт для диагностики состояния Self-Hosted Supabase

echo "🔍 ДИАГНОСТИКА SELF-HOSTED SUPABASE"
echo "===================================="
echo ""

SUPABASE_URL="https://supabase.monitorapp.ru"

# 1. Проверка доступности
echo "1️⃣ Проверка доступности сервера..."
if curl -s -I "$SUPABASE_URL" | grep -q "200\|301\|302"; then
  echo "✅ Сервер доступен"
else
  echo "❌ Сервер недоступен"
  exit 1
fi
echo ""

# 2. Проверка Studio
echo "2️⃣ Проверка Supabase Studio..."
if curl -s "$SUPABASE_URL/project/default" | grep -q "studio"; then
  echo "✅ Studio работает"
  echo "   Откройте: $SUPABASE_URL/project/default"
else
  echo "⚠️ Studio может быть недоступна"
fi
echo ""

# 3. Инструкция по SQL
echo "3️⃣ СЛЕДУЮЩИЙ ШАГ:"
echo "   Откройте: $SUPABASE_URL/project/default"
echo "   Перейдите в: SQL Editor"
echo "   Выполните скрипт из: restore_user.sql"
echo ""

echo "4️⃣ ПРОВЕРКА ПОЛЬЗОВАТЕЛЕЙ В БД:"
echo "   Выполните в SQL Editor:"
echo "   SELECT COUNT(*) FROM auth.users;"
echo "   (Должно быть > 0 после восстановления)"
echo ""

echo "✅ Готово к восстановлению!"
