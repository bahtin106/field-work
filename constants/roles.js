// constants/roles.js
export const ROLE = Object.freeze({
  ADMIN: 'admin',
  DISPATCHER: 'dispatcher',
  WORKER: 'worker',
});

export const EDITABLE_ROLES = (
  process.env.EXPO_PUBLIC_EDITABLE_ROLES || `${ROLE.DISPATCHER},${ROLE.WORKER}`
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

import { t as T } from '../src/i18n';

export const ROLE_LABELS = {
  [ROLE.DISPATCHER]: T('role_dispatcher'),
  [ROLE.WORKER]: T('role_worker'),
  [ROLE.ADMIN]: T('role_admin'),
};
