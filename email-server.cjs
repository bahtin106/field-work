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
            <p>Привет, ${fullName}!</p>
            <p>Вы были приглашены в систему управления заказами MonitorApp.</p>
            <p style="margin-top: 16px;">Ваш пароль для входа:</p>
            <div style="font-family: monospace; font-size: 16px; font-weight: 700; padding: 12px; background: #f3f4f6; border-radius: 8px;">${tempPassword}</div>
            <p style="margin-top: 16px;">После входа рекомендуем сменить пароль.</p>
            <p style="margin-top: 30px; color: #666; font-size: 12px;">
              Если вы не регистрировались в этой системе, пожалуйста, проигнорируйте это письмо.
            </p>
          </div>
        `;
        text = `Добро пожаловать в MonitorApp!\n\nПривет, ${fullName}!\n\nВы были приглашены в систему управления заказами MonitorApp.\n\nВаш пароль для входа: ${tempPassword}\n\nПосле входа рекомендуем сменить пароль.`;
      } else if (resetLink) {
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Добро пожаловать в MonitorApp!</h2>
            <p>Привет, ${fullName}!</p>
            <p>Вы были приглашены в систему управления заказами MonitorApp.</p>
            <p style="margin-top: 30px;">
              <a href="${resetLink}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
                Установить пароль
              </a>
            </p>
            <p style="margin-top: 30px; color: #666; font-size: 12px;">
              Если вы не регистрировались в этой системе, пожалуйста, проигнорируйте это письмо.
            </p>
          </div>
        `;
        text = `Добро пожаловать в MonitorApp!\n\nПривет, ${fullName}!\n\nВы были приглашены в систему управления заказами MonitorApp.\n\nПерейти по ссылке для установки пароля: ${resetLink}`;
      } else {
        return res.status(400).json({ error: 'Missing resetLink or tempPassword' });
      }
    } else if (type === 'password-reset') {
      const fullName = `${firstName || ''} ${lastName || ''}`.trim() || 'Пользователь';
      subject = 'Восстановление пароля в MonitorApp';
      if (tempPassword) {
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Сброс пароля</h2>
            <p>Привет, ${fullName}!</p>
            <p>Администратор сбросил пароль вашей учетной записи.</p>
            <p style="margin-top: 16px;">Ваш новый пароль:</p>
            <div style="font-family: monospace; font-size: 16px; font-weight: 700; padding: 12px; background: #f3f4f6; border-radius: 8px;">${tempPassword}</div>
            <p style="margin-top: 16px;">После входа рекомендуем сменить пароль.</p>
          </div>
        `;
        text = `Сброс пароля\n\nПривет, ${fullName}!\n\nАдминистратор сбросил пароль вашей учетной записи.\n\nВаш новый пароль: ${tempPassword}\n\nПосле входа рекомендуем сменить пароль.`;
      } else if (resetLink) {
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Восстановление пароля</h2>
            <p>Привет, ${fullName}!</p>
            <p>Вы запросили восстановление пароля для вашей учетной записи.</p>
            <p style="margin-top: 30px;">
              <a href="${resetLink}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
                Установить новый пароль
              </a>
            </p>
            <p style="margin-top: 30px; color: #666; font-size: 12px;">
              Ссылка действительна в течение 24 часов.<br/>
              Если вы не запрашивали восстановление пароля, проигнорируйте это письмо.
            </p>
          </div>
        `;
        text = `Восстановление пароля\n\nПривет, ${fullName}!\n\nВы запросили восстановление пароля.\n\nПерейти по ссылке: ${resetLink}\n\nСсылка действительна 24 часа.`;
      } else {
        return res.status(400).json({ error: 'Missing resetLink or tempPassword' });
      }
    } else {
      return res.status(400).json({ error: 'Invalid email type' });
    }

    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || 'MonitorApp <noreply@monitorapp.ru>',
      replyTo: process.env.SMTP_REPLY_TO || 'support@monitorapp.ru',
      to: email,
      subject,
      html,
      text,
      headers: {
        'X-Priority': '1 (Highest)',
        'Importance': 'high',
        'Priority': 'urgent'
      }
    });

    console.log(`[${new Date().toISOString()}] Email sent to ${email}:`, info.messageId);
    return res.status(200).json({ success: true, messageId: info.messageId, message: 'Email sent successfully' });
  } catch (error) {
    console.error('[/send-email] Error:', error);
    return res.status(500).json({ error: error.message || 'Failed to send email' });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Endpoint для обновления пароля в Supabase через Admin API
app.post('/update-password', async (req, res) => {
  try {
    const { userId, newPassword, supabaseUrl, supabaseServiceKey } = req.body;
    
    if (!userId || !newPassword) {
      return res.status(400).json({ error: 'Missing userId or newPassword' });
    }

    const url = supabaseUrl || process.env.SUPABASE_URL;
    const key = supabaseServiceKey || process.env.SUPABASE_SERVICE_KEY;

    if (!url || !key) {
      console.error(`[${new Date().toISOString()}] Missing Supabase credentials`);
      return res.status(500).json({ error: 'Missing Supabase configuration' });
    }

    console.log(`[${new Date().toISOString()}] Updating password for user: ${userId}`);

    // Используем Supabase Admin API для обновления пароля пользователя
    const adminUrl = `${url}/auth/v1/admin/users/${userId}`;
    const response = await fetch(adminUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        password: newPassword
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[${new Date().toISOString()}] Admin API call failed:`, errorText);
      return res.status(response.status).json({ 
        error: 'Admin API call failed', 
        details: errorText 
      });
    }

    const result = await response.json();
    console.log(`[${new Date().toISOString()}] Password updated successfully for user: ${userId}`);
    
    return res.status(200).json({ 
      success: true, 
      message: 'Password updated successfully',
      result
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [/update-password] Error:`, error.message);
    return res.status(500).json({ 
      error: 'Failed to update password', 
      details: error.message 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Email server running on port ${PORT}`);
  console.log(`POST http://localhost:${PORT}/send-email - Send email`);
  console.log(`POST http://localhost:${PORT}/update-password - Password update confirmation`);
  console.log(`GET http://localhost:${PORT}/health - Health check`);
});
