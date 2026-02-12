import express from 'express';
import nodemailer from 'nodemailer';
import cors from 'cors';

const app = express();

app.use(cors());
app.use(express.json());

// Настройка транспорта для отправки через локальный Postfix
const transporter = nodemailer.createTransport({
  host: 'localhost',
  port: 25,
  secure: false,
  tls: {
    rejectUnauthorized: false,
  },
});

// Проверка подключения к Postfix
transporter.verify((error, success) => {
  if (error) {
    console.error('[SMTP] Connection failed:', error);
  } else {
    console.log('[SMTP] Connection successful!');
  }
});

/**
 * POST /send-email
 * Отправляет email письмо
 */
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
            <p style="margin-top: 16px;">Ваш временный пароль:</p>
            <div style="font-family: monospace; font-size: 16px; font-weight: 700; padding: 12px; background: #f3f4f6; border-radius: 8px;">${tempPassword}</div>
            <p style="margin-top: 16px;">После входа рекомендуем сменить пароль.</p>
            <p style="margin-top: 30px; color: #666; font-size: 12px;">
              Если вы не регистрировались в этой системе, пожалуйста, проигнорируйте это письмо.
            </p>
          </div>
        `;
        text = `Добро пожаловать в MonitorApp!\n\nПривет, ${fullName}!\n\nВы были приглашены в систему управления заказами MonitorApp.\n\nВаш временный пароль: ${tempPassword}\n\nПосле входа рекомендуем сменить пароль.`;
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
            <p style="margin-top: 16px;">Ваш новый временный пароль:</p>
            <div style="font-family: monospace; font-size: 16px; font-weight: 700; padding: 12px; background: #f3f4f6; border-radius: 8px;">${tempPassword}</div>
            <p style="margin-top: 16px;">После входа рекомендуем сменить пароль.</p>
          </div>
        `;
        text = `Сброс пароля\n\nПривет, ${fullName}!\n\nАдминистратор сбросил пароль вашей учетной записи.\n\nВаш новый временный пароль: ${tempPassword}\n\nПосле входа рекомендуем сменить пароль.`;
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

// Отправляем письмо
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || 'MonitorApp <noreply@monitorapp.ru>',
      replyTo: process.env.SMTP_REPLY_TO || 'support@monitorapp.ru',
      to: email,
      subject: subject,
      html: html,
      text: text,
    });

    console.log(`[${new Date().toISOString()}] Email sent to ${email}:`, info.messageId);
    return res.status(200).json({
      success: true,
      messageId: info.messageId,
      message: 'Email sent successfully',
    });
  } catch (error) {
    console.error('[/send-email] Error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to send email',
    });
  }
});

/**
 * GET /health
 * Проверка статуса сервера
 */
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Email server running on port ${PORT}`);
  console.log(`POST http://localhost:${PORT}/send-email - Send email`);
  console.log(`GET http://localhost:${PORT}/health - Health check`);
});
