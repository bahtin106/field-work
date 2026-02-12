#!/bin/bash
# Скрипт для развертывания исправлений на VPS
# Выполните на VPS в директории проекта field-work

set -e

echo "=================="
echo "Installing password change log fix"
echo "=================="

# 1. Проверяем, что мы в правильной директории
if [ ! -f "package.json" ]; then
    echo "ERROR: package.json not found. Are you in the project directory?"
    exit 1
fi

# 2. Проверяем, что Supabase CLI установлен
if ! command -v supabase &> /dev/null; then
    echo "ERROR: Supabase CLI не установлен. Установите его с помощью:"
    echo "  npm install -g supabase"
    exit 1
fi

# 3. Применяем миграцию к локальной БД (если нужно)
echo ""
echo "Step 1: Applying database migration..."
if [ -f "supabase/migrations/20260211_password_change_log.sql" ]; then
    echo "✓ Migration file found"
    # Это будет применено автоматически при 'supabase db push'
else
    echo "✗ Migration file NOT found at supabase/migrations/20260211_password_change_log.sql"
fi

# 4. Проверяем, что edge-функция обновлена
echo ""
echo "Step 2: Checking edge function..."
if [ -f "supabase/functions/update_user/index.ts" ]; then
    if grep -q "password_change_log" "supabase/functions/update_user/index.ts"; then
        echo "✓ Edge function has been updated with password logging"
    else
        echo "✗ Edge function does NOT have password logging code"
        exit 1
    fi
else
    echo "✗ Edge function file NOT found"
    exit 1
fi

# 5. Проверяем фронтенд изменения
echo ""
echo "Step 3: Checking frontend changes..."
if grep -q "\\[proceedSave\\]" "app/users/[id]/edit.jsx"; then
    echo "✓ Frontend has detailed logging"
else
    echo "✗ Frontend logging NOT found"
fi

# 6. Применяем миграцию к удаленной БД
echo ""
echo "Step 4: Pushing migration to remote database..."
echo "NOTE: This will only work if you have 'supabase link' configured"
echo "If you haven't linked your project, please run:"
echo "  supabase link --project-ref your-project-ref"
echo ""
read -p "Continue with database migration? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    supabase db push || echo "✗ Migration failed. You may need to apply SETUP_PASSWORD_LOGS.sql manually in Supabase Dashboard"
fi

# 7. Развертываем edge-функцию
echo ""
echo "Step 5: Deploying edge function..."
echo "NOTE: Make sure you have 'supabase link' configured"
echo ""
read -p "Deploy update_user edge function? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    supabase functions deploy update_user || echo "✗ Deployment failed"
fi

# 8. Выводим итоговую информацию
echo ""
echo "=================="
echo "Installation completed!"
echo "=================="
echo ""
echo "Next steps:"
echo "1. If database migration failed, manually execute SETUP_PASSWORD_LOGS.sql in Supabase Dashboard"
echo "2. If edge function deployment failed, deploy manually from Supabase Dashboard"
echo "3. Test password change in the application"
echo "4. Check browser console for [proceedSave] logs"
echo "5. Check Supabase Edge Function logs in Dashboard"
echo "6. Verify password_change_log table has entries:"
echo "   SELECT * FROM public.password_change_log ORDER BY changed_at DESC LIMIT 10;"
echo ""
echo "For more details, see PASSWORD_CHANGE_FIX_REPORT.md"
