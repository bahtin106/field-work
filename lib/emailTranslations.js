const EMAIL_TRANSLATIONS = Object.freeze({
  ru: {
    inviteFallbackName: 'Сотрудник',
    inviteSubject: 'Приглашение присоединиться к системе MonitorApp',
    inviteTitle: 'Добро пожаловать в MonitorApp!',
    greeting: 'Привет, {name}!',
    inviteBody: 'Вы были приглашены в систему управления заказами MonitorApp.',
    setPassword: 'Установить пароль',
    inviteIgnore: 'Если вы не регистрировались в этой системе, пожалуйста, проигнорируйте это письмо.',
    inviteTextAction: 'Перейдите по ссылке для установки пароля: {link}',
    resetFallbackName: 'Пользователь',
    resetSubject: 'Восстановление пароля в MonitorApp',
    resetTitle: 'Восстановление пароля',
    resetBody: 'Вы запросили восстановление пароля для вашей учетной записи.',
    setNewPassword: 'Установить новый пароль',
    resetExpires: 'Ссылка действительна в течение 24 часов.',
    resetIgnore: 'Если вы не запрашивали восстановление пароля, проигнорируйте это письмо.',
    resetTextAction: 'Перейдите по ссылке: {link}',
  },
  en: {
    inviteFallbackName: 'Employee',
    inviteSubject: 'Invitation to join MonitorApp',
    inviteTitle: 'Welcome to MonitorApp!',
    greeting: 'Hello, {name}!',
    inviteBody: 'You have been invited to the MonitorApp order management system.',
    setPassword: 'Set password',
    inviteIgnore: 'If you did not register for this system, please ignore this email.',
    inviteTextAction: 'Follow this link to set your password: {link}',
    resetFallbackName: 'User',
    resetSubject: 'Password reset for MonitorApp',
    resetTitle: 'Password reset',
    resetBody: 'You requested a password reset for your account.',
    setNewPassword: 'Set new password',
    resetExpires: 'This link is valid for 24 hours.',
    resetIgnore: 'If you did not request a password reset, please ignore this email.',
    resetTextAction: 'Follow this link: {link}',
  },
});

export function getEmailTranslations(locale) {
  const normalizedLocale = String(locale || '').trim().toLowerCase().split('-')[0];
  return EMAIL_TRANSLATIONS[normalizedLocale] || EMAIL_TRANSLATIONS.ru;
}
