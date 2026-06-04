// API endpoint для обновления пароля пользователя
// Положите этот файл на VPS (например, в src/routes/updatePassword.js)
// И подключите его в основное приложение

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

// Используйте свой Supabase admin клиент
const { supabaseAdmin } = require('../lib/supabase'); // или как у вас называется

function timingSafeStringEqual(left, right) {
  const leftBuf = Buffer.from(String(left || ''));
  const rightBuf = Buffer.from(String(right || ''));
  return leftBuf.length === rightBuf.length && crypto.timingSafeEqual(leftBuf, rightBuf);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '').trim(),
  );
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  const email = normalizeEmail(value);
  return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function requireUpdatePasswordToken(req, res, next) {
  const expected = String(process.env.EMAIL_SERVER_API_TOKEN || '').trim();
  if (!expected) {
    return res.status(503).json({ ok: false, message: 'EMAIL_SERVER_API_TOKEN is required' });
  }

  const supplied = String(req.headers['x-email-server-token'] || req.headers.authorization || '')
    .replace(/^Bearer\s+/i, '')
    .trim();

  if (!timingSafeStringEqual(supplied, expected)) {
    return res.status(401).json({ ok: false, message: 'Unauthorized' });
  }

  return next();
}

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
router.post('/update-password', requireUpdatePasswordToken, async (req, res) => {
  try {
    const { user_id, password, changed_by, email } = req.body;
    const normalizedEmail = normalizeEmail(email);

    // Валидация
    if (!isUuid(user_id)) {
      console.warn('[UPDATE_PASSWORD] Missing user_id');
      return res.status(400).json({ ok: false, message: 'valid user_id is required' });
    }

    if (changed_by && !isUuid(changed_by)) {
      console.warn('[UPDATE_PASSWORD] Invalid changed_by for user:', user_id);
      return res.status(400).json({ ok: false, message: 'valid changed_by is required' });
    }

    if (!password || String(password).length < 8) {
      console.warn('[UPDATE_PASSWORD] Invalid password length for user:', user_id);
      return res.status(400).json({ ok: false, message: 'password must be at least 8 characters' });
    }

    if (!isValidEmail(normalizedEmail)) {
      console.warn('[UPDATE_PASSWORD] Invalid email for user:', user_id);
      return res.status(400).json({ ok: false, message: 'valid email is required' });
    }

    console.log('[UPDATE_PASSWORD] Updating password for user:', user_id, {
      changing_by: changed_by || 'self',
      also_changing_email: !!normalizedEmail,
      timestamp: new Date().toISOString(),
    });

    // Подготавливаем объект для обновления
    const updateData = { password };
    if (normalizedEmail) {
      updateData.email = normalizedEmail;
    }

    // Обновляем в auth.users через Supabase Admin API
    const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, updateData);

    if (error) {
      console.error('[UPDATE_PASSWORD] Error updating password:', error.message);
      return res.status(400).json({ 
        ok: false, 
        message: 'Failed to update password'
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
          details: normalizedEmail ? 'also changed email' : null,
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
      message: 'Server error'
    });
  }
});

module.exports = router;
