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

const ROLE_LABEL_KEYS = Object.freeze({
  [ROLE.DISPATCHER]: 'role_dispatcher',
  [ROLE.WORKER]: 'role_worker',
  [ROLE.ADMIN]: 'role_admin',
});

export function getRoleLabel(role, t) {
  const normalizedRole = String(role || '').trim();
  const key = ROLE_LABEL_KEYS[normalizedRole];
  return key ? t(key) : normalizedRole;
}
