@echo off
REM Скрипт для развертывания исправлений на Windows
REM Выполните в директории проекта field-work

setlocal enabledelayedexpansion

echo.
echo ==================
echo Installing password change log fix
echo ==================
echo.

REM 1. Проверяем, что мы в правильной директории
if not exist "package.json" (
    echo ERROR: package.json not found. Are you in the project directory?
    exit /b 1
)

REM 2. Проверяем, что Supabase CLI установлен
where supabase >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Supabase CLI не установлен. Установите его с помощью:
    echo   npm install -g supabase
    exit /b 1
)

REM 3. Проверяем файлы
echo.
echo Step 1: Checking files...
if exist "supabase\migrations\20260211_password_change_log.sql" (
    echo [OK] Migration file found
) else (
    echo [ERROR] Migration file NOT found
    exit /b 1
)

if exist "supabase\functions\update_user\index.ts" (
    findstr /M "password_change_log" "supabase\functions\update_user\index.ts" >nul
    if !errorlevel! equ 0 (
        echo [OK] Edge function has been updated
    ) else (
        echo [ERROR] Edge function does NOT have password logging
        exit /b 1
    )
) else (
    echo [ERROR] Edge function NOT found
    exit /b 1
)

if exist "app\users\[id]\edit.jsx" (
    findstr /M "\[proceedSave\]" "app\users\[id]\edit.jsx" >nul
    if !errorlevel! equ 0 (
        echo [OK] Frontend has logging
    ) else (
        echo [ERROR] Frontend logging NOT found
    )
) else (
    echo [ERROR] Frontend file NOT found
)

echo.
echo ==================
echo Installation completed!
echo ==================
echo.
echo Next steps:
echo 1. Apply SETUP_PASSWORD_LOGS.sql in Supabase Dashboard SQL Editor
echo 2. Deploy update_user function from Supabase Dashboard
echo 3. Test password change in the application
echo 4. Check browser console for [proceedSave] logs
echo 5. Check password_change_log table:
echo    SELECT * FROM public.password_change_log ORDER BY changed_at DESC;
echo.
echo For more details, see PASSWORD_CHANGE_FIX_REPORT.md
echo.

pause
