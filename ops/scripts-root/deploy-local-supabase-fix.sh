#!/bin/bash
# Скрипт для развертывания updatePassword.js на VPS
# Использование: bash deploy-local-supabase-fix.sh <vps-user> <vps-host> <app-path>
# Пример: bash deploy-local-supabase-fix.sh root 5.35.91.118 /var/www/app

set -e

# Параметры
VPS_USER="${1:-root}"
VPS_HOST="${2:-5.35.91.118}"
APP_PATH="${3:-/var/www/app}"

echo "======================================="
echo "Deploying updatePassword.js to VPS"
echo "======================================="
echo "VPS: $VPS_USER@$VPS_HOST"
echo "App path: $APP_PATH"
echo ""

# Проверяем, что файл существует
if [ ! -f "server/routes/updatePassword.js" ]; then
    echo "ERROR: server/routes/updatePassword.js not found!"
    exit 1
fi

echo "Step 1: Copying updatePassword.js to VPS..."
scp server/routes/updatePassword.js $VPS_USER@$VPS_HOST:$APP_PATH/routes/ || {
    echo "Failed to copy file. Make sure you have SSH access."
    exit 1
}

echo "✓ File copied successfully"
echo ""

echo "Step 2: Checking if route is included in app..."
echo "Remember to add this line to your main app file (app.js, server.js, etc):"
echo ""
echo "  const updatePasswordRoute = require('./routes/updatePassword');"
echo "  app.use('/api', updatePasswordRoute);"
echo ""

echo "Step 3: Restart the app on VPS..."
ssh $VPS_USER@$VPS_HOST << 'EOF'
  # Try different restart methods
  if command -v pm2 &> /dev/null; then
    echo "Restarting with pm2..."
    pm2 restart all
  elif command -v systemctl &> /dev/null; then
    echo "Restarting with systemctl..."
    systemctl restart app || echo "WARNING: Could not restart with systemctl"
  else
    echo "WARNING: Could not find pm2 or systemctl"
    echo "Restart manually: pm2 restart <app-name> or systemctl restart <service>"
  fi
EOF

echo ""
echo "======================================="
echo "✓ Deployment successful!"
echo "======================================="
echo ""
echo "Next steps:"
echo "1. Add route to your main app file (see above)"
echo "2. Test the endpoint: curl http://$VPS_HOST:3000/api/update-password"
echo "3. Try changing password in the app"
echo "4. Check browser console (F12) for [proceedSave] logs"
echo ""
