import AsyncStorage from '@react-native-async-storage/async-storage';

export const AUTH_BLOCK_NOTICE_KEY = '__AUTH_BLOCK_NOTICE__';
export const AUTH_BLOCK_NOTICE_STORAGE_KEY = '@auth_block_notice';

export async function saveAuthBlockNotice(message) {
  const normalizedMessage = String(message || '').trim();
  try {
    globalThis[AUTH_BLOCK_NOTICE_KEY] = normalizedMessage;
  } catch {}

  try {
    if (normalizedMessage) {
      await AsyncStorage.setItem(AUTH_BLOCK_NOTICE_STORAGE_KEY, normalizedMessage);
    } else {
      await AsyncStorage.removeItem(AUTH_BLOCK_NOTICE_STORAGE_KEY);
    }
  } catch {}
}

export async function consumeAuthBlockNotice() {
  let message = '';
  try {
    message = String(globalThis?.[AUTH_BLOCK_NOTICE_KEY] || '').trim();
  } catch {}

  if (!message) {
    try {
      message = String((await AsyncStorage.getItem(AUTH_BLOCK_NOTICE_STORAGE_KEY)) || '').trim();
    } catch {}
  }

  if (message) {
    try {
      delete globalThis[AUTH_BLOCK_NOTICE_KEY];
    } catch {}
    try {
      await AsyncStorage.removeItem(AUTH_BLOCK_NOTICE_STORAGE_KEY);
    } catch {}
  }

  return message;
}
