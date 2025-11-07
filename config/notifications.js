// config/notifications.js
let APP_DEFAULTS = { quietStart: '18:00', quietEnd: '09:00', timeStep: 5, notifications: {} };
try {
  // Allow project-level override via ../../config (common pattern)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const cfg = require('../config');
  if (cfg?.APP_DEFAULTS) APP_DEFAULTS = { ...APP_DEFAULTS, ...cfg.APP_DEFAULTS };
} catch {}
const __NOTIF = (APP_DEFAULTS && APP_DEFAULTS.notifications) || {};
export const ANDROID_CHANNEL_ID = __NOTIF.ANDROID_CHANNEL_ID || 'default';
export const ANDROID_CHANNEL_NAME = __NOTIF.ANDROID_CHANNEL_NAME || 'default';
export { APP_DEFAULTS };
