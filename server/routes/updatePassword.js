// API endpoint для обновления пароля пользователя
// Положите этот файл на VPS (например, в src/routes/updatePassword.js)
// И подключите его в основное приложение

const express = require('express');
const router = express.Router();

// Используйте свой Supabase admin клиент
const { supabaseAdmin } = require('../lib/supabase'); // или как у вас называется

/**
 * POST /api/update-password
 * 
 * Обновляет пароль пользователя и логирует это действие
 * 
 * Body:
 * {
 *   user_id: string (UUID)
 *   password: string (новый пароль)
 *   changed_by?: string (UUID администратора, если меняет админ)
 *   email?: string (новый email если меняется)
 * }
 */
router.post('/update-password', async (req, res) => {
  try {
    const { user_id, password, changed_by, email } = req.body;

    // Валидация
    if (!user_id) {
      console.warn('[UPDATE_PASSWORD] Missing user_id');
      return res.status(400).json({ ok: false, message: 'user_id is required' });
    }

    if (!password || password.length < 6) {
      console.warn('[UPDATE_PASSWORD] Invalid password length for user:', user_id);
      return res.status(400).json({ ok: false, message: 'password must be at least 6 characters' });
    }

    console.log('[UPDATE_PASSWORD] Updating password for user:', user_id, {
      changing_by: changed_by || 'self',
      also_changing_email: !!email,
      timestamp: new Date().toISOString(),
    });

    // Подготавливаем объект для обновления
    const updateData = { password };
    if (email && email.trim()) {
      updateData.email = email.trim();
    }

    // Обновляем в auth.users через Supabase Admin API
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(user_id, updateData);

    if (error) {
      console.error('[UPDATE_PASSWORD] Error updating password:', error.message);
      return res.status(400).json({ 
        ok: false, 
        message: `Failed to update password: ${error.message}` 
      });
    }

    console.log('[UPDATE_PASSWORD] Password updated successfully for user:', user_id);

    // Логируем в БД (если нужна таблица password_change_log)
    // Закомментирован, если у вас нет такой таблицы
    /*
    try {
      await supabaseAdmin
        .from('password_change_log')
        .insert({
          user_id,
          changed_by: changed_by || user_id,
          changed_at: new Date().toISOString(),
          ip_address: req.ip,
          user_agent: req.get('user-agent'),
        });
      console.log('[UPDATE_PASSWORD] Logged password change for user:', user_id);
    } catch (logErr) {
      console.warn('[UPDATE_PASSWORD] Failed to log password change:', logErr.message);
      // Логирование не критично, продолжаем
    }
    */

    // Также можно записать в лог файл или БД простую таблицу без RLS
    try {
      await supabaseAdmin
        .from('audit_logs')
        .insert({
          action: 'password_changed',
          user_id,
          changed_by: changed_by || user_id,
          details: email ? `also changed email to ${email}` : null,
          created_at: new Date().toISOString(),
        })
        .catch(err => {
          // Если таблицы нет, просто логируем в консоль
          console.log('[UPDATE_PASSWORD] Audit_logs table not available, skipping');
        });
    } catch (auditErr) {
      console.warn('[UPDATE_PASSWORD] Could not write to audit_logs:', auditErr.message);
    }

    res.json({ ok: true, message: 'Password updated successfully' });

  } catch (err) {
    console.error('[UPDATE_PASSWORD] Unexpected error:', err.message);
    res.status(500).json({ 
      ok: false, 
      message: `Server error: ${err.message}` 
    });
  }
});

module.exports = router;
