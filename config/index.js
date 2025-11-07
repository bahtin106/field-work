// Centralized app configuration (CommonJS).
// Place this folder as `../../config` relative to AppSettings.jsx.
// You can tweak values here without touching component code.

/** Localization defaults (Point 1) */
const availableLocales = ['ru', 'en']; // order matters; first is the fallback

/** UI defaults for Quiet Hours & Time picker (Point 2) */
const APP_DEFAULTS = {
  quietStart: '18:00', // HH:mm
  quietEnd: '09:00', // HH:mm
  timeStep: 5, // minutes step for time picker
  /** Android notification channel settings (Point 3) */
  notifications: {
    ANDROID_CHANNEL_ID: 'app-notify',
    ANDROID_CHANNEL_NAME: 'App Notifications',
  },
};

/** Tables and permission keys (Point 4)
 * Keep these in sync with your DB migrations and auth layer.
 */
const TBL = {
  users: 'users',
  settings: 'user_settings',
  notifications: 'push_tokens',
};

const PERM_KEYS = {
  canReceivePush: 'notifications:receive',
  canEditQuietHours: 'settings:quiet_hours:edit',
};

module.exports = {
  availableLocales,
  APP_DEFAULTS,
  TBL,
  PERM_KEYS,
};
