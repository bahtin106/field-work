const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const crypto = require('crypto');
const { Client } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// Функция для простого хеширования пароля (bcrypt альтернатива)
// Примечание: используем crypto вместо bcrypt
function hashPassword(password) {
  // Для демонстрации используем SHA256, но это НЕ полная замена bcrypt
  // Правильное решение - установить bcrypt в контейнере
  const salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512');
  return `$pbkdf2-sha512$${salt}$${hash.toString('hex')}`;
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || '172.17.0.1',  // Docker host gateway
  port: process.env.SMTP_PORT || 25,
  secure: false,
  tls: { rejectUnauthorized: false },
});

transporter.verify((error) => {
  if (error) {
    console.error('[SMTP] Connection failed:', error);
  } else {
    console.log('[SMTP] Connection successful!');
  }
});

app.post('/send-email', async (req, res) => {
  try {
    const { type, email, firstName, lastName, resetLink, tempPassword } = req.body;

    if (!type || !email) {
      return res.status(400).json({ error: 'Missing required fields: type, email' });
    }

    let subject, html, text;
    if (type === 'invite') {
      const fullName = `${firstName || ''} ${lastName || ''}`.trim() || 'Сотрудник';

      subject = 'Приглашение присоединиться к системе MonitorApp';
      if (tempPassword) {
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Добро пожаловать в MonitorApp!</h2>
            <p>Здравствуйте, ${fullName}!</p>
            <p>Ваш аккаунт был создан в системе MonitorApp.</p>
            <p><strong>Временный пароль:</strong> <code style="background: #f0f0f0; padding: 5px 10px; border-radius: 3px;">${tempPassword}</code></p>
            <p>Пожалуйста, введите этот пароль при первом входе и измените его на собственный пароль.</p>
            <p>${resetLink ? `<a href="${resetLink}" style="background: #007BFF; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Перейти в систему</a>` : ''}</p>
            <p style="color: #666; font-size: 12px; margin-top: 20px;">Если вы получили это письмо по ошибке, просто проигнорируйте его.</p>
          </div>
        `;
      } else {
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Приглашение в MonitorApp</h2>
            <p>Здравствуйте, ${fullName}!</p>
            <p>Вы были приглашены присоединиться к системе MonitorApp.</p>
            <p>${resetLink ? `<a href="${resetLink}" style="background: #007BFF; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Принять приглашение</a>` : 'Пожалуйста, обратитесь к администратору для получения доступа.'}</p>
            <p style="color: #666; font-size: 12px; margin-top: 20px;">Если вы получили это письмо по ошибке, просто проигнорируйте его.</p>
          </div>
        `;
      }
    } else if (type === 'password-reset') {
      subject = 'Восстановление пароля в MonitorApp';
      html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Восстановление пароля</h2>
          <p>Здравствуйте!</p>
          <p>Вы запросили восстановление пароля для вашего аккаунта в MonitorApp.</p>
          <p>${resetLink ? `<a href="${resetLink}" style="background: #007BFF; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Восстановить пароль</a>` : 'Пожалуйста, обратитесь к администратору.'}</p>
          <p style="color: #666; font-size: 12px; margin-top: 20px;">Если вы не запрашивали восстановление пароля, проигнорируйте это письмо.</p>
        </div>
      `;
    }

    if (!subject || !html) {
      return res.status(400).json({ error: 'Invalid email type' });
    }

    const mailOptions = {
      from: process.env.MAIL_FROM || 'noreply@monitor-app.local',
      to: email,
      subject,
      html,
      text: text || subject,
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error(`[${new Date().toISOString()}] [SEND-EMAIL] Error:`, error.message);
        return res.status(500).json({ error: 'Failed to send email', details: error.message });
      }
      console.log(`[${new Date().toISOString()}] [SEND-EMAIL] Email sent successfully to ${email}:`, info.response);
      return res.status(200).json({ success: true, message: 'Email sent successfully', response: info.response });
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [SEND-EMAIL] Exception:`, error.message);
    return res.status(500).json({ error: 'Failed to process email', details: error.message });
  }
});

/**
 * POST /api/update-password
 * 
 * UPDATED endpoint for password updates with proper parameter names
 * Accepts both 'userId' (legacy) and 'user_id' (new) parameters
 * 
 * Body:
 * {
 *   user_id: string (UUID) - required (or userId for backward compatibility)
 *   password: string - required (minimum 6 characters)
 *   email?: string - optional new email
 *   changed_by?: string - optional UUID of admin who changed password
 * }
 */
app.post('/api/update-password', async (req, res) => {
  try {
    // Accept both 'userId' (legacy) and 'user_id' (new API standard)
    const userId = req.body.user_id || req.body.userId;
    const { newPassword, password, email, changed_by, supabaseUrl, supabaseServiceKey } = req.body;
    
    // Accept both 'newPassword' and 'password' parameter names
    const finalPassword = password || newPassword;

    if (!userId) {
      console.warn(`[${new Date().toISOString()}] [UPDATE_PASSWORD] Missing userId/user_id`);
      return res.status(400).json({ 
        ok: false,
        error: 'Missing userId or user_id', 
        message: 'user_id (UUID) is required' 
      });
    }

    if (!finalPassword) {
      console.warn(`[${new Date().toISOString()}] [UPDATE_PASSWORD] Missing password for user: ${userId}`);
      return res.status(400).json({ 
        ok: false,
        error: 'Missing password', 
        message: 'password is required' 
      });
    }

    if (finalPassword.length < 6) {
      console.warn(`[${new Date().toISOString()}] [UPDATE_PASSWORD] Password too short for user: ${userId}`);
      return res.status(400).json({ 
        ok: false,
        error: 'Password too short', 
        message: 'password must be at least 6 characters' 
      });
    }

    const url = supabaseUrl || process.env.SUPABASE_URL;
    const key = supabaseServiceKey || process.env.SUPABASE_SERVICE_KEY;

    if (!url || !key) {
      console.error(`[${new Date().toISOString()}] [UPDATE_PASSWORD] Missing Supabase credentials`);
      return res.status(500).json({ 
        ok: false,
        error: 'Missing Supabase configuration',
        message: 'Supabase URL or Service Key not configured on server' 
      });
    }

    console.log(`[${new Date().toISOString()}] [UPDATE_PASSWORD] Attempting to update password for user: ${userId}`, {
      changed_by: changed_by || 'self',
      also_updating_email: !!email,
    });

    // Use Supabase Admin API to update password
    const adminUrl = `${url}/auth/v1/admin/users/${userId}`;
    const updateBody = {
      password: finalPassword
    };
    
    // Also update email if provided
    if (email && String(email).trim()) {
      updateBody.email = String(email).trim();
    }

    const response = await fetch(adminUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify(updateBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[${new Date().toISOString()}] [UPDATE_PASSWORD] API call failed for user ${userId}:`, errorText);
      return res.status(response.status).json({
        ok: false,
        error: 'Supabase API call failed',
        message: `HTTP ${response.status}: ${errorText}`,
        details: errorText
      });
    }

    const result = await response.json();
    console.log(`[${new Date().toISOString()}] [UPDATE_PASSWORD] Password updated successfully for user: ${userId}`);
    
    return res.status(200).json({
      ok: true,
      success: true,
      message: 'Password updated successfully',
      result
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [UPDATE_PASSWORD] Exception:`, error.message, error.stack);
    return res.status(500).json({
      ok: false,
      error: 'Failed to update password',
      message: error.message,
      details: error.message
    });
  }
});

// Legacy endpoint for backward compatibility
app.post('/update-password', async (req, res) => {
  // Redirect to new endpoint
  return res.redirect(307, '/api/update-password');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Email server running on port ${PORT}`);
  console.log(`POST http://localhost:${PORT}/send-email - Send email`);
  console.log(`POST http://localhost:${PORT}/api/update-password - Update password (new)`);
  console.log(`POST http://localhost:${PORT}/update-password - Update password (legacy redirect)`);
  console.log(`[${new Date().toISOString()}] Environment: SUPABASE_URL=${process.env.SUPABASE_URL ? 'configured' : 'NOT SET'}`);
  console.log(`[${new Date().toISOString()}] Environment: SUPABASE_SERVICE_KEY=${process.env.SUPABASE_SERVICE_KEY ? 'configured' : 'NOT SET'}`);
});
