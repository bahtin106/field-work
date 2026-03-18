@echo off
REM Deploy updatePassword.js to VPS on Windows
REM Usage: deploy-local-supabase-fix.bat <vps-host> <vps-user> <app-path>
REM Example: deploy-local-supabase-fix.bat 5.35.91.118 root /var/www/app

setlocal enabledelayedexpansion

set VPS_HOST=%1
set VPS_USER=%2
set APP_PATH=%3

if "%VPS_HOST%"=="" (
    set VPS_HOST=5.35.91.118
)
if "%VPS_USER%"=="" (
    set VPS_USER=root
)
if "%APP_PATH%"=="" (
    set APP_PATH=/var/www/app
)

echo.
echo =======================================
echo Deploying updatePassword.js to VPS
echo =======================================
echo VPS: %VPS_USER%@%VPS_HOST%
echo App path: %APP_PATH%
echo.

REM Check if file exists
if not exist "server\routes\updatePassword.js" (
    echo ERROR: server\routes\updatePassword.js not found!
    exit /b 1
)

echo Step 1: Copying updatePassword.js to VPS...
REM Using pscp (PuTTY SCP) if available, otherwise suggest WinSCP
where pscp >nul 2>nul
if %errorlevel% equ 0 (
    pscp server\routes\updatePassword.js %VPS_USER%@%VPS_HOST%:%APP_PATH%/routes/
    if !errorlevel! neq 0 (
        echo Failed to copy file with pscp
        exit /b 1
    )
) else (
    echo pscp not found. Please use one of these methods:
    echo.
    echo Option 1: Use WinSCP
    echo - Open WinSCP
    echo - Connect to %VPS_HOST% as %VPS_USER%
    echo - Navigate to %APP_PATH%/routes/
    echo - Copy server\routes\updatePassword.js there
    echo.
    echo Option 2: Use PuTTY
    echo - Install PuTTY tools (includes pscp)
    echo.
    echo Option 3: Use another SCP client
    echo.
    pause
    exit /b 1
)

echo [OK] File copied successfully
echo.

echo Step 2: Checking if route needs to be included...
echo Remember to add this to your main app file (app.js, server.js, etc):
echo.
echo   const updatePasswordRoute = require('./routes/updatePassword');
echo   app.use('/api', updatePasswordRoute);
echo.

echo Step 3: Ready to restart app on VPS
echo Run on VPS:
echo   pm2 restart all
echo or
echo   systemctl restart app-name
echo.

echo =======================================
echo [OK] File ready for deployment!
echo =======================================
echo.
echo Next steps:
echo 1. Verify file is in %APP_PATH%/routes/updatePassword.js on VPS
echo 2. Add route to your main app file
echo 3. Restart with: pm2 restart all
echo 4. Test: curl http://%VPS_HOST%:3000/api/update-password
echo.

pause
