import nodemailer from 'nodemailer';
import { getEmailTranslations } from './emailTranslations';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
  tls: {
    rejectUnauthorized: String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false',
  },
});

/**
 * Отправляет письмо с приглашением нового пользователя
 */
export const sendInviteEmail = async (email, firstName, lastName, resetLink, locale) => {
  try {
    const copy = getEmailTranslations(locale);
    const fullName = `${lastName || ''} ${firstName || ''}`.trim() || copy.inviteFallbackName;
    
    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@monitorapp.ru',
      replyTo: process.env.SMTP_REPLY_TO || 'support@monitorapp.ru',
      to: email,
      subject: copy.inviteSubject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>${copy.inviteTitle}</h2>
          <p>${copy.greeting.replace('{name}', fullName)}</p>
          <p>${copy.inviteBody}</p>
          <p style="margin-top: 30px;">
            <a href="${resetLink}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
              ${copy.setPassword}
            </a>
          </p>
          <p style="margin-top: 30px; color: #666; font-size: 12px;">
            ${copy.inviteIgnore}
          </p>
        </div>
      `,
      text: `
        ${copy.inviteTitle}
        
        ${copy.greeting.replace('{name}', fullName)}
        
        ${copy.inviteBody}
        
        ${copy.inviteTextAction.replace('{link}', resetLink)}
      `,
    };

    const result = await transporter.sendMail(mailOptions);
    console.info('[sendInviteEmail] Email sent:', result.messageId);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('[sendInviteEmail] Error:', error);
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

/**
 * Отправляет письмо для сброса пароля
 */
export const sendPasswordResetEmail = async (email, firstName, lastName, resetLink, locale) => {
  try {
    const copy = getEmailTranslations(locale);
    const fullName = `${lastName || ''} ${firstName || ''}`.trim() || copy.resetFallbackName;
    
    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@monitorapp.ru',
      replyTo: process.env.SMTP_REPLY_TO || 'support@monitorapp.ru',
      to: email,
      subject: copy.resetSubject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>${copy.resetTitle}</h2>
          <p>${copy.greeting.replace('{name}', fullName)}</p>
          <p>${copy.resetBody}</p>
          <p style="margin-top: 30px;">
            <a href="${resetLink}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
              ${copy.setNewPassword}
            </a>
          </p>
          <p style="margin-top: 30px; color: #666; font-size: 12px;">
            ${copy.resetExpires}
            <br/>
            ${copy.resetIgnore}
          </p>
        </div>
      `,
      text: `
        ${copy.resetTitle}
        
        ${copy.greeting.replace('{name}', fullName)}
        
        ${copy.resetBody}
        
        ${copy.resetTextAction.replace('{link}', resetLink)}
        
        ${copy.resetExpires}
      `,
    };

    const result = await transporter.sendMail(mailOptions);
    console.info('[sendPasswordResetEmail] Email sent:', result.messageId);
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
    console.info('[verifySmtpConnection] SMTP connection successful');
    return true;
  } catch (error) {
    console.error('[verifySmtpConnection] SMTP connection failed:', error);
    return false;
  }
};

