import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false, // false for 587 (STARTTLS), true for 465 (SMTPS)
  tls: {
    rejectUnauthorized: false, // Allow self-signed certificates
  },
});

/**
 * Отправляет письмо с приглашением нового пользователя
 */
export const sendInviteEmail = async (email, firstName, lastName, resetLink) => {
  try {
    const fullName = `${firstName || ''} ${lastName || ''}`.trim() || 'Сотрудник';
    
    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@monitorapp.ru',
      replyTo: process.env.SMTP_REPLY_TO || 'support@monitorapp.ru',
      to: email,
      subject: 'Приглашение присоединиться к системе MonitorApp',
      html: `
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
      `,
      text: `
        Добро пожаловать в MonitorApp!
        
        Привет, ${fullName}!
        
        Вы были приглашены в систему управления заказами MonitorApp.
        
        Перейдите по ссылке для установки пароля: ${resetLink}
      `,
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('[sendInviteEmail] Email sent:', result.messageId);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('[sendInviteEmail] Error:', error);
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

/**
 * Отправляет письмо для сброса пароля
 */
export const sendPasswordResetEmail = async (email, firstName, lastName, resetLink) => {
  try {
    const fullName = `${firstName || ''} ${lastName || ''}`.trim() || 'Пользователь';
    
    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@monitorapp.ru',
      replyTo: process.env.SMTP_REPLY_TO || 'support@monitorapp.ru',
      to: email,
      subject: 'Восстановление пароля в MonitorApp',
      html: `
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
            Ссылка действительна в течение 24 часов.
            <br/>
            Если вы не запрашивали восстановление пароля, проигнорируйте это письмо.
          </p>
        </div>
      `,
      text: `
        Восстановление пароля
        
        Привет, ${fullName}!
        
        Вы запросили восстановление пароля для вашей учетной записи.
        
        Перейдите по ссылке: ${resetLink}
        
        Ссылка действительна в течение 24 часов.
      `,
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('[sendPasswordResetEmail] Email sent:', result.messageId);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('[sendPasswordResetEmail] Error:', error);
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

/**
 * Проверяет подключение к SMTP серверу
 */
export const verifySmtpConnection = async () => {
  try {
    await transporter.verify();
    console.log('[verifySmtpConnection] SMTP connection successful');
    return true;
  } catch (error) {
    console.error('[verifySmtpConnection] SMTP connection failed:', error);
    return false;
  }
};
