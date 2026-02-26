import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

import { devWarn as __devLog } from '../src/utils/dev';

const PROMPT_KEY = 'push_reliability_prompt_v1';

export async function maybeRequestAndroidBatteryExemption() {
  if (Platform.OS !== 'android') return { ok: false, reason: 'not_android' };

  try {
    const alreadyPrompted = await AsyncStorage.getItem(PROMPT_KEY);
    if (alreadyPrompted === '1') return { ok: true, skipped: true };
  } catch {}

  const appId = String(Application.applicationId || '').trim();
  if (!appId) return { ok: false, reason: 'no_application_id' };

  try {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
      {
        data: `package:${appId}`,
      },
    );
    await AsyncStorage.setItem(PROMPT_KEY, '1');
    return { ok: true, skipped: false };
  } catch (e) {
    __devLog('REQUEST_IGNORE_BATTERY_OPTIMIZATIONS failed:', e?.message || e);
    try {
      await IntentLauncher.startActivityAsync(
        IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
        {
          data: `package:${appId}`,
        },
      );
      await AsyncStorage.setItem(PROMPT_KEY, '1');
      return { ok: true, skipped: false, fallback: 'app_details' };
    } catch (e2) {
      __devLog('APPLICATION_DETAILS_SETTINGS failed:', e2?.message || e2);
      return { ok: false, reason: 'intent_failed' };
    }
  }
}
