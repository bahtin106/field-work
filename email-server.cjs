const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const crypto = require('crypto');
const { Client } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

function resolveSupabaseBaseUrl(rawUrl) {
  const fallback = process.env.SUPABASE_PUBLIC_URL || 'https://supabase.monitorapp.ru';
  const candidate = String(rawUrl || '').trim();
  if (!candidate) return fallback;

  try {
    const parsed = new URL(candidate);
    const host = String(parsed.hostname || '').toLowerCase();
    if (!host || host === 'supabase-kong' || host === 'localhost' || host.endsWith('.internal')) {
      return fallback;
    }
    return parsed.origin;
  } catch {
    return fallback;
  }
}

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

const SUBSCRIPTION_EMAIL_TEXT = Object.freeze({
  ru: {
    subjects: {
      warning_7d: 'Подписка MonitorApp скоро закончится',
      warning_1d: 'Подписка MonitorApp заканчивается завтра',
      expired: 'Подписка MonitorApp закончилась',
    },
    greeting: 'Здравствуйте',
    closing: 'С уважением, команда MonitorApp',
    warning_intro: 'Срок подписки вашей компании скоро заканчивается.',
    warning_days_left: 'До окончания подписки осталось: {days} дн.',
    warning_period_end: 'Дата окончания подписки: {date}',
    warning_impact_title: 'Что произойдет после окончания подписки:',
    warning_impact_1: 'Приложение перейдет в режим только чтения.',
    warning_impact_2: 'Полный доступ останется только у администратора компании.',
    warning_impact_3: 'Остальные сотрудники будут заблокированы до оплаты.',
    warning_pay_note: 'Пожалуйста, продлите подписку заранее, чтобы избежать блокировок.',
    expired_intro: 'Срок подписки вашей компании закончился.',
    expired_mode: 'Сейчас приложение доступно только в режиме чтения и только для администратора.',
    expired_blocked: 'Остальные сотрудники заблокированы до оплаты подписки.',
    expired_recovery: 'После оплаты доступ сотрудников будет восстановлен автоматически.',
    company_label: 'Компания',
  },
  en: {
    subjects: {
      warning_7d: 'Your MonitorApp subscription is ending soon',
      warning_1d: 'Your MonitorApp subscription ends tomorrow',
      expired: 'Your MonitorApp subscription has expired',
    },
    greeting: 'Hello',
    closing: 'Best regards, MonitorApp team',
    warning_intro: 'Your company subscription is about to expire.',
    warning_days_left: 'Days left until expiration: {days}.',
    warning_period_end: 'Subscription end date: {date}',
    warning_impact_title: 'What will happen after expiration:',
    warning_impact_1: 'The app will switch to read-only mode.',
    warning_impact_2: 'Full access will remain only for company admin users.',
    warning_impact_3: 'Other employees will be blocked until payment.',
    warning_pay_note: 'Please renew in advance to avoid access disruption.',
    expired_intro: 'Your company subscription has expired.',
    expired_mode: 'The app is now available in read-only mode and only for the admin.',
    expired_blocked: 'Other employees are blocked until payment.',
    expired_recovery: 'After payment, employee access will be restored automatically.',
    company_label: 'Company',
  },
});

function pickLang(lang) {
  const code = String(lang || 'ru').toLowerCase();
  return code.startsWith('en') ? 'en' : 'ru';
}

function formatDateByLang(iso, lang) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso || '');
    const locale = lang === 'en' ? 'en-US' : 'ru-RU';
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'Europe/Moscow',
    }).format(d);
  } catch {
    return String(iso || '');
  }
}

function buildSubscriptionReminderEmail(payload = {}) {
  const lang = pickLang(payload.lang);
  const dict = SUBSCRIPTION_EMAIL_TEXT[lang];
  const fullName = `${payload.firstName || ''} ${payload.lastName || ''}`.trim();
  const helloName = fullName || 'Admin';
  const companyName = String(payload.companyName || '').trim();
  const eventKeyRaw = String(payload.subscriptionEvent || '').trim().toLowerCase();
  const isExpired = eventKeyRaw === 'expired' || eventKeyRaw === 'expired_0d';
  const normalizedEvent = isExpired
    ? 'expired'
    : eventKeyRaw === 'warning_1d'
      ? 'warning_1d'
      : 'warning_7d';
  const periodEndText = formatDateByLang(payload.periodEndIso, lang);
  const daysLeft = Number.isFinite(Number(payload.daysLeft)) ? Math.max(0, Number(payload.daysLeft)) : null;

  const subject = dict.subjects[normalizedEvent];
  const intro = isExpired ? dict.expired_intro : dict.warning_intro;
  const lines = [];
  if (!isExpired && daysLeft != null) {
    lines.push(dict.warning_days_left.replace('{days}', String(daysLeft)));
  }
  if (periodEndText) {
    lines.push(dict.warning_period_end.replace('{date}', periodEndText));
  }
  const companyLine = companyName ? `${dict.company_label}: ${companyName}` : '';

  const impacts = isExpired
    ? [dict.expired_mode, dict.expired_blocked, dict.expired_recovery]
    : [dict.warning_impact_1, dict.warning_impact_2, dict.warning_impact_3, dict.warning_pay_note];

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
      <h2>${subject}</h2>
      <p>${dict.greeting}, ${helloName}.</p>
      <p>${intro}</p>
      ${companyLine ? `<p><strong>${companyLine}</strong></p>` : ''}
      ${lines.map((line) => `<p>${line}</p>`).join('')}
      <p style="margin-top: 20px;"><strong>${dict.warning_impact_title}</strong></p>
      <ul style="padding-left: 20px;">
        ${impacts.map((line) => `<li style="margin-bottom: 8px;">${line}</li>`).join('')}
      </ul>
      <p style="margin-top: 24px; color: #666;">${dict.closing}</p>
    </div>
  `;

  const text = [
    subject,
    '',
    `${dict.greeting}, ${helloName}.`,
    intro,
    companyLine,
    ...lines,
    '',
    dict.warning_impact_title,
    ...impacts.map((line) => `- ${line}`),
    '',
    dict.closing,
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, html, text };
}

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
    } else if (type === 'subscription-reminder') {
      const built = buildSubscriptionReminderEmail(req.body || {});
      subject = built.subject;
      html = built.html;
      text = built.text;
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

app.post('/api/update-password', async (req, res) => {
  try {
    const userId = req.body.user_id || req.body.userId;
    const { password, newPassword, supabaseUrl, supabaseServiceKey, changed_by } = req.body;
    const finalPassword = password || newPassword;

    if (!userId || !finalPassword) {
      return res.status(400).json({
        ok: false,
        error: 'Missing userId or password',
        message: 'user_id and password are required',
      });
    }

    const url = resolveSupabaseBaseUrl(supabaseUrl || process.env.SUPABASE_URL);
    const key = supabaseServiceKey || process.env.SUPABASE_SERVICE_KEY;

    if (!url || !key) {
      console.error(`[${new Date().toISOString()}] Missing Supabase credentials`);
      return res.status(500).json({
        ok: false,
        error: 'Missing Supabase configuration',
        message: 'Supabase URL or Service Key not configured on server',
      });
    }

    console.log(`[${new Date().toISOString()}] [UPDATE_PASSWORD] Updating password for user: ${userId}`, {
      changed_by: changed_by || userId,
    });

    const adminUrl = `${url}/auth/v1/admin/users/${userId}`;
    const response = await fetch(adminUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        password: finalPassword
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[${new Date().toISOString()}] [UPDATE_PASSWORD] Admin API call failed:`, errorText);
      return res.status(response.status).json({
        ok: false,
        error: 'Admin API call failed',
        message: errorText,
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
    console.error(`[${new Date().toISOString()}] [/api/update-password] Error:`, error.message);
    return res.status(500).json({
      ok: false,
      error: 'Failed to update password',
      message: error.message,
      details: error.message
    });
  }
});

// Endpoint для обновления пароля в Supabase через Admin API
app.post('/update-password', async (req, res) => {
  try {
    const { userId, newPassword, supabaseUrl, supabaseServiceKey } = req.body;
    
    if (!userId || !newPassword) {
      return res.status(400).json({ error: 'Missing userId or newPassword' });
    }

    const url = resolveSupabaseBaseUrl(supabaseUrl || process.env.SUPABASE_URL);
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
  console.log(`POST http://localhost:${PORT}/api/update-password - Update password`);
  console.log(`POST http://localhost:${PORT}/update-password - Password update confirmation`);
  console.log(`GET http://localhost:${PORT}/health - Health check`);
});
