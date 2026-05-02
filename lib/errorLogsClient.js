/* global __DEV__ */

import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

const DEDUPE_WINDOW_MS = 60 * 1000;
const MAX_EVENTS_PER_MINUTE = 20;
const MAX_QUEUE_SIZE = 100;

const MAX_NAME_LEN = 160;
const MAX_MESSAGE_LEN = 2000;
const MAX_STACK_LEN = 8000;
const MAX_APP_VERSION_LEN = 64;
const MAX_ENV_LEN = 32;
const MAX_EXTRA_TEXT_LEN = 4000;
const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_RE =
  /password|passwd|pwd|token|access_token|refresh_token|authorization|cookie|secret|service_role|apikey|api_key|jwt/i;
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi;

let installed = false;
let isFlushing = false;
let inReporter = false;

const queue = [];
const recentBySignature = new Map();
const sentTimestamps = [];

let originalConsoleError = null;
let originalConsoleWarn = null;
let originalGlobalErrorHandler = null;
let detachUnhandledRejection = null;

const IGNORED_EXPO_GO_MESSAGES_RE =
  /`expo-notifications` functionality is not fully supported in Expo Go|expo-notifications: Android Push notifications \(remote notifications\) functionality provided .* removed from Expo Go|Expo Go can no longer provide full access to the media library|Due to changes in Androids permission requirements, Expo Go can no longer provide full access to the media library|`setBehaviorAsync` is not supported with edge-to-edge enabled\.|`setBackgroundColorAsync` is not supported with edge-to-edge enabled\./i;
const IGNORED_NOISE_MESSAGES_RE =
  /Using FullWindowOverlay is only valid on iOS devices\.|Изменение недоступно\. Продлите подписку|Создание заявки недоступно/i;

function clipText(value, maxLen) {
  const text = redactSensitiveText(String(value == null ? '' : value)).trim();
  if (!text) return null;
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

function redactSensitiveText(value) {
  return String(value || '')
    .replace(BEARER_RE, `Bearer ${REDACTED}`)
    .replace(JWT_RE, REDACTED);
}

function redactSensitiveValue(value, depth = 0) {
  if (depth > 6) return '[MaxDepth]';
  if (typeof value === 'string') return redactSensitiveText(value);
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item, depth + 1));

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY_RE.test(key) ? REDACTED : redactSensitiveValue(item, depth + 1);
  }
  return out;
}

function safeStringify(value) {
  try {
    const raw = JSON.stringify(redactSensitiveValue(value));
    if (!raw) return null;
    const redacted = redactSensitiveText(raw);
    return redacted.length > MAX_EXTRA_TEXT_LEN ? redacted.slice(0, MAX_EXTRA_TEXT_LEN) : redacted;
  } catch {
    return null;
  }
}

function normalizeErrorLike(input) {
  if (input instanceof Error) {
    return {
      name: clipText(input.name || 'Error', MAX_NAME_LEN) || 'Error',
      message: clipText(input.message || '', MAX_MESSAGE_LEN) || 'Unknown error',
      stack: clipText(input.stack || '', MAX_STACK_LEN),
    };
  }

  if (typeof input === 'string') {
    return {
      name: 'Error',
      message: clipText(input, MAX_MESSAGE_LEN) || 'Unknown error',
      stack: null,
    };
  }

  const fallbackMessage = clipText(safeStringify(input), MAX_MESSAGE_LEN) || 'Unknown error';
  return { name: 'Error', message: fallbackMessage, stack: null };
}

function shouldIgnoreErrorLog(normalizedError, runtimeExtra) {
  try {
    const message = String(normalizedError?.message || '');
    if (!message) return false;
    if (IGNORED_NOISE_MESSAGES_RE.test(message)) return true;
    if (message.trim().toLowerCase() === 'forbidden') return true;
    const appOwnership = String(runtimeExtra?.appOwnership || '').toLowerCase();
    if (appOwnership !== 'expo') return false;
    return IGNORED_EXPO_GO_MESSAGES_RE.test(message);
  } catch {
    return false;
  }
}

function getRuntimeContext(extra = null) {
  const expoConfig = Constants?.expoConfig || Constants?.manifest || {};
  const appVersion = clipText(
    expoConfig?.version || expoConfig?.runtimeVersion || '',
    MAX_APP_VERSION_LEN,
  );
  const environment = clipText(__DEV__ ? 'dev' : 'prod', MAX_ENV_LEN);

  const baseExtra = {
    platform: Platform.OS,
    appOwnership: Constants?.appOwnership || null,
    executionEnvironment: Constants?.executionEnvironment || null,
  };

  return {
    app_version: appVersion,
    environment,
    extra: extra ? { ...baseExtra, ...extra } : baseExtra,
  };
}

function cleanupWindows(now) {
  while (sentTimestamps.length > 0 && now - sentTimestamps[0] > DEDUPE_WINDOW_MS) {
    sentTimestamps.shift();
  }

  for (const [key, ts] of recentBySignature.entries()) {
    if (now - ts > DEDUPE_WINDOW_MS) recentBySignature.delete(key);
  }
}

function createSignature(payload) {
  const topStack = String(payload?.stack || '').split('\n')[0] || '';
  return [payload?.name || '', payload?.message || '', topStack].join('|');
}

function shouldDropByDedupe(signature, now) {
  const prev = recentBySignature.get(signature);
  if (!prev) return false;
  return now - prev < DEDUPE_WINDOW_MS;
}

function enqueue(payload) {
  const now = Date.now();
  cleanupWindows(now);
  const signature = createSignature(payload);
  if (shouldDropByDedupe(signature, now)) return;

  recentBySignature.set(signature, now);
  if (queue.length >= MAX_QUEUE_SIZE) queue.shift();
  queue.push(payload);
  flushQueue().catch(() => {});
}

async function flushQueue() {
  if (isFlushing) return;
  isFlushing = true;
  try {
    while (queue.length > 0) {
      const now = Date.now();
      cleanupWindows(now);
      if (sentTimestamps.length >= MAX_EVENTS_PER_MINUTE) break;

      const item = queue.shift();
      if (!item) break;

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id || null;
      if (!userId) continue;

      const body = {
        user_id: userId,
        name: item.name,
        message: item.message,
        stack: item.stack,
        extra: item.extra || null,
        app_version: item.app_version || null,
        environment: item.environment || null,
      };

      inReporter = true;
      const { error } = await supabase.from('error_logs').insert(body);
      inReporter = false;
      if (!error) {
        sentTimestamps.push(now);
      }
    }
  } finally {
    inReporter = false;
    isFlushing = false;
  }
}

export function logClientError(errorLike, extra = null) {
  if (inReporter) return;

  const normalized = normalizeErrorLike(errorLike);
  const ctx = getRuntimeContext(extra);
  if (shouldIgnoreErrorLog(normalized, ctx?.extra)) return;
  enqueue({
    ...normalized,
    ...ctx,
    extra: ctx.extra,
  });
}

function formatConsoleArgs(args) {
  if (!Array.isArray(args) || args.length === 0) {
    return { errorLike: 'Unknown console error', extra: null };
  }

  const firstError = args.find((item) => item instanceof Error);
  if (firstError) {
    const rest = args.filter((item) => item !== firstError);
    return { errorLike: firstError, extra: { source: 'console.error', args: safeStringify(rest) } };
  }

  const message = args
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item instanceof Error) return item.message || String(item);
      return safeStringify(item) || String(item);
    })
    .join(' ')
    .trim();

  return {
    errorLike: message || 'Console error',
    extra: { source: 'console.error' },
  };
}

export function installClientErrorLogging() {
  if (installed) return;
  installed = true;

  if (!originalConsoleError) {
    originalConsoleError = console.error?.bind(console);
  }
  if (!originalConsoleWarn) {
    originalConsoleWarn = console.warn?.bind(console);
  }

  console.error = (...args) => {
    if (typeof originalConsoleError === 'function') {
      originalConsoleError(...args);
    }
    const { errorLike, extra } = formatConsoleArgs(args);
    logClientError(errorLike, extra);
  };

  console.warn = (...args) => {
    if (typeof originalConsoleWarn === 'function') {
      originalConsoleWarn(...args);
    }
    const { errorLike, extra } = formatConsoleArgs(args);
    logClientError(errorLike, { ...(extra || {}), source: 'console.warn' });
  };

  try {
    const errorUtils = globalThis?.ErrorUtils;
    if (errorUtils && typeof errorUtils.getGlobalHandler === 'function') {
      originalGlobalErrorHandler = errorUtils.getGlobalHandler();
      errorUtils.setGlobalHandler((error, isFatal) => {
        logClientError(error, { source: 'global_error_handler', isFatal: !!isFatal });
        if (typeof originalGlobalErrorHandler === 'function') {
          originalGlobalErrorHandler(error, isFatal);
        }
      });
    }
  } catch {}

  try {
    if (typeof globalThis?.addEventListener === 'function') {
      const onUnhandledRejection = (event) => {
        const reason = event?.reason || 'Unhandled promise rejection';
        logClientError(reason, { source: 'unhandledrejection' });
      };
      globalThis.addEventListener('unhandledrejection', onUnhandledRejection);
      detachUnhandledRejection = () => {
        try {
          globalThis.removeEventListener('unhandledrejection', onUnhandledRejection);
        } catch {}
      };
    }
  } catch {}
}

export function uninstallClientErrorLogging() {
  if (!installed) return;
  installed = false;

  if (typeof originalConsoleError === 'function') {
    console.error = originalConsoleError;
  }
  if (typeof originalConsoleWarn === 'function') {
    console.warn = originalConsoleWarn;
  }

  try {
    const errorUtils = globalThis?.ErrorUtils;
    if (errorUtils && typeof errorUtils.setGlobalHandler === 'function' && originalGlobalErrorHandler) {
      errorUtils.setGlobalHandler(originalGlobalErrorHandler);
    }
  } catch {}

  if (typeof detachUnhandledRejection === 'function') {
    detachUnhandledRejection();
    detachUnhandledRejection = null;
  }

  queue.length = 0;
  recentBySignature.clear();
  sentTimestamps.length = 0;
  isFlushing = false;
  inReporter = false;
}
