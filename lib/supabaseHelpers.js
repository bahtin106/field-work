// lib/supabaseHelpers.js
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { TBL } from './constants';
import { getLocale } from '../src/i18n';

function normalizeErrMessage(raw, fallback = 'Unknown error') {
  if (!raw) return fallback;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (typeof raw?.message === 'string' && raw.message.trim()) return raw.message.trim();
  if (typeof raw?.error === 'string' && raw.error.trim()) return raw.error.trim();
  return fallback;
}

function isSuccessfulFunctionPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  return payload.ok === true || payload.success === true;
}

async function extractInvokeError(error, fallback) {
  try {
    const ctx = error?.context;
    if (ctx && typeof ctx === 'object') {
      const source = typeof ctx.clone === 'function' ? ctx.clone() : ctx;
      if (typeof source.json === 'function') {
        try {
          const payload = await source.json();
          return normalizeErrMessage(payload, fallback);
        } catch {}
      }
      if (typeof source.text === 'function') {
        try {
          const text = await source.text();
          return normalizeErrMessage(text, fallback);
        } catch {}
      }
    }
  } catch {}
  return normalizeErrMessage(error, fallback);
}

/** Get current authenticated user's id or throw NO_AUTH */
export async function getUid() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) throw new Error('NO_AUTH');
  return data.user.id;
}

/** Upsert notification preferences for a user (by user_id). */
export async function upsertNotifPrefs(userId, prefs) {
  const { error } = await supabase
    .from('notification_prefs')
    .upsert({ user_id: userId, ...prefs }, { onConflict: 'user_id' });
  if (error) throw error;
  return true;
}

/** Load profile (role, company_id) by user id. */
export async function readProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('role, company_id')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/** Read app role permission value */
export async function readRolePerm(companyId, role, key) {
  const { data, error } = await supabase
    .from(TBL.APP_ROLE_PERMS)
    .select('value')
    .eq('company_id', companyId)
    .eq('role', role)
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

/** Save (upsert) Expo push token per user */
let __deviceIdPromise = null;

async function getDeviceId() {
  if (__deviceIdPromise) return __deviceIdPromise;
  __deviceIdPromise = (async () => {
    try {
      if (Platform.OS === 'android') {
        const androidId = await Application.getAndroidId?.();
        if (androidId && typeof androidId === 'string') return androidId.trim();
      }
      if (Platform.OS === 'ios') {
        const iosId = await Application.getIosIdForVendorAsync?.();
        if (iosId && typeof iosId === 'string') return iosId.trim();
      }
    } catch {}
    return null;
  })();
  return __deviceIdPromise;
}

function getAppVersion() {
  try {
    const fromExpo =
      Constants?.expoConfig?.version ||
      Constants?.manifest?.version ||
      Constants?.manifest2?.extra?.expoClient?.version ||
      '';
    const fromNative = Application?.nativeApplicationVersion || '';
    const fromBuild = Application?.nativeBuildVersion || '';
    const raw = String(fromExpo || fromNative || fromBuild || '').trim();
    return raw || null;
  } catch {
    return null;
  }
}

function getAppLocaleTag() {
  try {
    const i18nLocale = String(getLocale?.() || '').trim();
    if (i18nLocale) return i18nLocale;
  } catch {}
  try {
    const intlLocale = String(Intl?.DateTimeFormat?.().resolvedOptions?.().locale || '').trim();
    if (intlLocale) return intlLocale;
  } catch {}
  return null;
}

export async function savePushToken(userId, token, platform) {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.access_token ? String(session.access_token) : '';
    if (!accessToken) throw new Error('No session');
    const deviceId = await getDeviceId();
    const body = {
      action: 'upsert',
      push_token: token,
      platform: platform || 'unknown',
      app_version: getAppVersion(),
      locale: getAppLocaleTag(),
      enable_notifications: true,
    };
    if (deviceId) body.device_id = deviceId;

    const { data, error } = await supabase.functions.invoke('push-token-sync', {
      headers: { Authorization: `Bearer ${accessToken}` },
      body,
    });
    if (!error && isSuccessfulFunctionPayload(data)) return true;
    if (error) throw new Error(await extractInvokeError(error, 'push-token-sync invoke failed'));
    throw new Error(normalizeErrMessage(data, 'push-token-sync failed'));
  } catch (e) {
    throw new Error(normalizeErrMessage(e, 'push-token-sync failed'));
  }
}

/** Set notification allow flag for user via service function. */
export async function setNotificationAllow(userId, allow) {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.access_token ? String(session.access_token) : '';
    if (!accessToken) throw new Error('No session');

    const { data, error } = await supabase.functions.invoke('push-token-sync', {
      headers: { Authorization: `Bearer ${accessToken}` },
      body: { action: 'set_allow', allow: !!allow },
    });
    if (!error && isSuccessfulFunctionPayload(data)) return true;
    if (error) throw new Error(await extractInvokeError(error, 'push-token-sync set_allow failed'));
    throw new Error(normalizeErrMessage(data, 'push-token-sync set_allow failed'));
  } catch (e) {
    throw new Error(normalizeErrMessage(e, 'push-token-sync set_allow failed'));
  }
}

/** Save quiet hours via service function (bypasses client RLS INSERT limits). */
export async function setQuietHours(userId, quietStart, quietEnd, quietTimezone = null) {
  try {
    // Preferred path: DB RPC (self-hosted safe, bypasses edge relay routing issues).
    const { error: rpcErr } = await supabase.rpc('set_quiet_hours_self', {
      p_quiet_start: quietStart ?? null,
      p_quiet_end: quietEnd ?? null,
      p_quiet_timezone: (typeof quietTimezone === 'string' && quietTimezone.trim()) ? quietTimezone.trim() : null,
    });
    if (!rpcErr) return true;

    const rpcMsg = normalizeErrMessage(rpcErr, 'set_quiet_hours_self failed');
    const rpcCode = String(rpcErr?.code || '').toUpperCase();
    const isRpcMissing =
      rpcCode === 'PGRST202' ||
      rpcCode === '42883' ||
      rpcMsg.toLowerCase().includes('set_quiet_hours_self') && rpcMsg.toLowerCase().includes('not found');
    if (!isRpcMissing) {
      throw new Error(rpcMsg);
    }

    // Fallback path: edge function for environments where RPC is not deployed yet.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.access_token ? String(session.access_token) : '';
    if (!accessToken) throw new Error('No session');

    const body = {
      action: 'set_quiet',
      quiet_start: quietStart ?? null,
      quiet_end: quietEnd ?? null,
    };
    if (typeof quietTimezone === 'string' && quietTimezone.trim()) {
      body.quiet_timezone = quietTimezone.trim();
    }

    const { data, error } = await supabase.functions.invoke('push-token-sync', {
      headers: { Authorization: `Bearer ${accessToken}` },
      body,
    });
    if (!error && isSuccessfulFunctionPayload(data)) return true;
    if (error) throw new Error(await extractInvokeError(error, 'push-token-sync set_quiet failed'));
    throw new Error(normalizeErrMessage(data, 'push-token-sync set_quiet failed'));
  } catch (e) {
    throw new Error(normalizeErrMessage(e, 'push-token-sync set_quiet failed'));
  }
}

/** Delete push token by user */
export async function deletePushToken(userId, options = {}) {
  const disableNotifications = options?.disableNotifications === true;
  const pushToken = String(options?.pushToken || '').trim();
  let invokeFailureMessage = '';
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.access_token ? String(session.access_token) : '';
    if (accessToken) {
      const { data, error } = await supabase.functions.invoke('push-token-sync', {
        headers: { Authorization: `Bearer ${accessToken}` },
        body: {
          action: 'delete',
          push_token: pushToken || undefined,
          disable_notifications: disableNotifications,
        },
      });
      if (!error && isSuccessfulFunctionPayload(data)) return true;
      if (error) {
        invokeFailureMessage = await extractInvokeError(error, 'push-token-sync delete failed');
      } else if (!isSuccessfulFunctionPayload(data)) {
        invokeFailureMessage = normalizeErrMessage(data, 'push-token-sync delete failed');
      }
    }
  } catch (e) {
    if (!invokeFailureMessage) {
      invokeFailureMessage = normalizeErrMessage(e, 'push-token-sync delete failed');
    }
  }

  let fallbackDelete = supabase.from('push_tokens').delete().eq('user_id', userId);
  if (pushToken) fallbackDelete = fallbackDelete.eq('token', pushToken);
  const { error } = await fallbackDelete;
  if (error) {
    const msg = `delete fallback failed${invokeFailureMessage ? ` | edge: ${invokeFailureMessage}` : ''} | table: ${normalizeErrMessage(error)}`;
    throw new Error(msg);
  }
  return true;
}
