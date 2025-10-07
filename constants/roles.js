// constants/roles.js
export const ROLE = Object.freeze({
  ADMIN: 'admin',
  DISPATCHER: 'dispatcher',
  WORKER: 'worker',
});

// список редактируемых ролей – через env
export const EDITABLE_ROLES = (process.env.EXPO_PUBLIC_EDITABLE_ROLES || `${ROLE.DISPATCHER},${ROLE.WORKER}`)
  .split(',').map(s => s.trim()).filter(Boolean);

// метки ролей – через глобальный i18n (если есть) с безопасными ключами
export const ROLE_LABELS = (globalThis?.APP_I18N?.roles) || {
  [ROLE.DISPATCHER]: (globalThis?.S?.('role_dispatcher')) ?? 'Диспетчер',
  [ROLE.WORKER]:     (globalThis?.S?.('role_worker'))     ?? 'Сотрудник',
  [ROLE.ADMIN]:      (globalThis?.S?.('role_admin'))      ?? 'Администратор',
};
