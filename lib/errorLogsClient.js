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

let installed = false;
let isFlushing = false;
let inReporter = false;

const queue = [];
const recentBySignature = new Map();
const sentTimestamps = [];

let originalConsoleError = null;
let originalGlobalErrorHandler = null;
let detachUnhandledRejection = null;

function clipText(value, maxLen) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return null;
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

function safeStringify(value) {
  try {
    const raw = JSON.stringify(value);
    if (!raw) return null;
    return raw.length > MAX_EXTRA_TEXT_LEN ? raw.slice(0, MAX_EXTRA_TEXT_LEN) : raw;
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

  console.error = (...args) => {
    if (typeof originalConsoleError === 'function') {
      originalConsoleError(...args);
    }
    const { errorLike, extra } = formatConsoleArgs(args);
    logClientError(errorLike, extra);
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
