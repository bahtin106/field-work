import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { ANDROID_CHANNEL_ID, ANDROID_CHANNEL_NAME } from '../config/notifications';
import { maybeRequestAndroidBatteryExemption } from './androidPushReliability';
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
    const current = await Notifications.getPermissionsAsync();
    if (current?.status !== 'granted') {
      return { token: null, reason: 'push_permission_denied' };
    }

    if (Platform.OS === 'android') {
      try {
        await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
          name: ANDROID_CHANNEL_NAME,
          importance: Notifications.AndroidImportance.MAX,
          sound: 'default',
          vibrationPattern: [0, 250, 150, 250],
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        });
      } catch (e) {
        __devLog('setNotificationChannelAsync failed:', e?.message || e);
      }
    }

    let token = null;
    let reason = null;
    try {
      const projectId =
        Constants?.expoConfig?.extra?.eas?.projectId ??
        Constants?.expoConfig?.extra?.easProjectId ??
        Constants?.manifest2?.extra?.expoClient?.extra?.eas?.projectId ??
        Constants?.manifest?.extra?.eas?.projectId ??
        Constants?.easConfig?.projectId;
      const resp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
      token = resp?.data || null;
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

    if (Platform.OS === 'android') {
      try {
        await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
          name: ANDROID_CHANNEL_NAME,
          importance: Notifications.AndroidImportance.MAX,
          sound: 'default',
          vibrationPattern: [0, 250, 150, 250],
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        });
      } catch (e) {
        __devLog('setNotificationChannelAsync failed:', e?.message || e);
      }
    }

    let token = null;
    let reason = null;
    try {
      const projectId =
        Constants?.expoConfig?.extra?.eas?.projectId ??
        Constants?.expoConfig?.extra?.easProjectId ??
        Constants?.manifest2?.extra?.expoClient?.extra?.eas?.projectId ??
        Constants?.manifest?.extra?.eas?.projectId ??
        Constants?.easConfig?.projectId;
      const resp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
      token = resp?.data || null;
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

    // Respect explicit opt-out made by the user in app settings.
    if (prefs?.allow === false) {
      return { ok: true, skipped: true, reason: 'disabled_by_user' };
    }

    const { granted, token, reason } = await ensurePushPermissionAndTokenWithOptions({
      requestIfNeeded: options?.requestPermission !== false,
    });
    if (!granted || !token) {
      return { ok: false, skipped: true, reason: reason || 'permission_or_token_missing' };
    }

    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    await savePushToken(userId, token, platform);

    // Ask once for battery optimization exemption to reduce OEM background kills.
    if (Platform.OS === 'android') {
      try {
        await maybeRequestAndroidBatteryExemption();
      } catch {}
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
