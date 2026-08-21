import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { ANDROID_CHANNEL_ID, getAndroidChannelName } from '../config/notifications';
import { t } from '../src/i18n';
import { devWarn as __devLog } from '../src/utils/dev';
import { upsertNotifPrefs, savePushToken } from './supabaseHelpers';
import { supabase } from './supabase';

let __NotificationsMod = null;
let __notifPrefsSupportsReminderDelay = true;

function isMissingReminderDelayColumnError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('notification_prefs.reminder_delay_minutes') &&
    (message.includes('does not exist') || message.includes('column'))
  );
}

async function getNotifications() {
  if (!__NotificationsMod) {
    __NotificationsMod = await import('expo-notifications');
  }
  return __NotificationsMod;
}

async function ensureAndroidNotificationChannel(Notifications) {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: getAndroidChannelName(t),
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      lightColor: '#0A84FF',
      vibrationPattern: [0, 250, 150, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  } catch (e) {
    __devLog('setNotificationChannelAsync failed:', e?.message || e);
  }
}

function getExpoProjectId() {
  return (
    Constants?.expoConfig?.extra?.eas?.projectId ??
    Constants?.expoConfig?.extra?.easProjectId ??
    Constants?.manifest2?.extra?.expoClient?.extra?.eas?.projectId ??
    Constants?.manifest?.extra?.eas?.projectId ??
    Constants?.easConfig?.projectId
  );
}

async function getExpoPushToken(Notifications, devicePushToken = null) {
  const projectId = getExpoProjectId();
  const options = {};
  if (projectId) options.projectId = projectId;
  if (devicePushToken?.data) options.devicePushToken = devicePushToken;
  const response = await Notifications.getExpoPushTokenAsync(
    Object.keys(options).length ? options : undefined,
  );
  return String(response?.data || '').trim() || null;
}

export async function ensurePushPermissionAndToken() {
  return ensurePushPermissionAndTokenWithOptions({ requestIfNeeded: true });
}

export async function readCurrentPushToken() {
  const { token, reason } = await getPushTokenIfAlreadyGranted();
  return { token, reason };
}

async function getPushTokenIfAlreadyGranted() {
  try {
    if (Platform.OS === 'web') {
      return { token: null, reason: 'web_no_push_token' };
    }

    const isExpoGo = Constants?.appOwnership === 'expo';
    if (isExpoGo) {
      return { token: null, reason: 'expo_go_no_push_token' };
    }

    const Notifications = await getNotifications();
    await ensureAndroidNotificationChannel(Notifications);
    const current = await Notifications.getPermissionsAsync();
    if (current?.status !== 'granted') {
      return { token: null, reason: 'push_permission_denied' };
    }

    let token = null;
    let reason = null;
    try {
      token = await getExpoPushToken(Notifications);
    } catch (e) {
      reason = String(e?.message || e || 'push_token_fetch_failed');
      __devLog('getExpoPushTokenAsync failed:', reason);
    }

    if (!token && !reason) reason = 'push_token_not_returned';
    return { token, reason };
  } catch (e) {
    const reason = String(e?.message || e || 'push_token_fetch_failed');
    __devLog('getPushTokenIfAlreadyGranted failed:', reason);
    return { token: null, reason };
  }
}

async function ensurePushPermissionAndTokenWithOptions(options = {}) {
  const requestIfNeeded = options?.requestIfNeeded !== false;
  try {
    if (Platform.OS === 'web') {
      return { granted: false, token: null, reason: 'web_no_push_token' };
    }

    const isExpoGo = Constants?.appOwnership === 'expo';
    if (isExpoGo) {
      return { granted: false, token: null, reason: 'expo_go_no_push_token' };
    }

    const Notifications = await getNotifications();
    // Android 13 does not surface the notification permission prompt until a
    // channel exists. The versioned ID also migrates upgrades away from the
    // immutable legacy PUBLIC channel.
    await ensureAndroidNotificationChannel(Notifications);
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      if (!requestIfNeeded) {
        return { granted: false, token: null, reason: 'push_permission_denied' };
      }
      const { status, canAskAgain } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
      if (status !== 'granted' && canAskAgain === false) {
        return { granted: false, token: null, reason: 'push_permission_denied' };
      }
    }

    const granted = finalStatus === 'granted';

    let token = null;
    let reason = null;
    try {
      token = await getExpoPushToken(Notifications);
    } catch (e) {
      reason = String(e?.message || e || 'push_token_fetch_failed');
      __devLog('getExpoPushTokenAsync failed:', reason);
    }

    if (granted && !token && !reason) reason = 'push_token_not_returned';
    return { granted, token, reason };
  } catch (e) {
    const reason = String(e?.message || e || 'push_permission_failed');
    __devLog('ensurePushPermissionAndToken failed:', reason);
    return { granted: false, token: null, reason };
  }
}

export async function bootstrapPushForUser(userId) {
  return bootstrapPushForUserWithOptions(userId, { requestPermission: true });
}

export async function syncChangedPushTokenForUser(userId, devicePushToken) {
  if (!userId || !devicePushToken?.data || Platform.OS === 'web') {
    return { ok: false, skipped: true, reason: 'missing_user_or_device_token' };
  }

  try {
    const Notifications = await getNotifications();
    await ensureAndroidNotificationChannel(Notifications);
    const permissions = await Notifications.getPermissionsAsync();
    if (permissions?.status !== 'granted') {
      return { ok: false, skipped: true, reason: 'push_permission_denied' };
    }

    const token = await getExpoPushToken(Notifications, devicePushToken);
    if (!token) {
      return { ok: false, skipped: false, reason: 'push_token_not_returned' };
    }

    await savePushToken(
      userId,
      token,
      Platform.OS === 'ios' ? 'ios' : 'android',
      { enableNotifications: false },
    );
    return { ok: true, skipped: false };
  } catch (error) {
    const reason = String(error?.message || error || 'push_token_change_sync_failed');
    __devLog('syncChangedPushTokenForUser failed:', reason);
    return { ok: false, skipped: false, reason };
  }
}

export async function bootstrapPushForUserWithOptions(userId, options = {}) {
  if (!userId) {
    return { ok: false, skipped: true, reason: 'no_user_id' };
  }

  try {
    const { data, error: prefsErr } = await supabase
      .from('notification_prefs')
      .select('allow, new_orders, feed_orders, reminders, reminder_delay_minutes, quiet_start, quiet_end, quiet_timezone')
      .eq('user_id', userId)
      .maybeSingle();

    let prefs = data;
    let normalizedError = prefsErr;
    if (prefsErr && isMissingReminderDelayColumnError(prefsErr)) {
      __notifPrefsSupportsReminderDelay = false;
      const legacy = await supabase
        .from('notification_prefs')
        .select('allow, new_orders, feed_orders, reminders, quiet_start, quiet_end, quiet_timezone')
        .eq('user_id', userId)
        .maybeSingle();
      prefs = legacy.data;
      normalizedError = legacy.error;
    } else if (!prefsErr) {
      __notifPrefsSupportsReminderDelay = true;
    }

    if (normalizedError) throw normalizedError;

    const notificationsAllowed = prefs?.allow !== false;

    const { granted, token, reason } = await ensurePushPermissionAndTokenWithOptions({
      requestIfNeeded: notificationsAllowed && options?.requestPermission !== false,
    });
    if (!granted || !token) {
      return { ok: false, skipped: true, reason: reason || 'permission_or_token_missing' };
    }

    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    await savePushToken(userId, token, platform, {
      enableNotifications: notificationsAllowed,
    });

    // Even an opted-out account claims the physical installation so a token
    // left by a previous account cannot keep receiving its notifications.
    // The existing false preference still prevents sends to the new account.
    if (!notificationsAllowed) {
      return { ok: true, skipped: true, reason: 'disabled_by_user' };
    }

    const prefsPatch = {
      allow: true,
      new_orders: prefs?.new_orders ?? true,
      feed_orders: prefs?.feed_orders ?? true,
      reminders: prefs?.reminders ?? true,
      reminder_delay_minutes: Number.isFinite(prefs?.reminder_delay_minutes)
        ? prefs.reminder_delay_minutes
        : 20,
      quiet_start: prefs?.quiet_start ?? null,
      quiet_end: prefs?.quiet_end ?? null,
      quiet_timezone: prefs?.quiet_timezone || null,
    };
    if (!__notifPrefsSupportsReminderDelay) {
      delete prefsPatch.reminder_delay_minutes;
    }
    await upsertNotifPrefs(userId, prefsPatch);

    return { ok: true, skipped: false };
  } catch (e) {
    return { ok: false, skipped: false, reason: String(e?.message || e || 'push_bootstrap_failed') };
  }
}
