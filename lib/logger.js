/* global __DEV__, process, console */

const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : process?.env?.NODE_ENV !== 'production';

const SENSITIVE_KEY_RE =
  /(token|secret|password|authorization|apikey|api_key|anonkey|anon_key|service[_-]?role|cookie|session)/i;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

function maskString(value) {
  if (typeof value !== 'string') return value;
  return value.replace(UUID_RE, '<redacted-uuid>');
}

function maskValue(key, value) {
  if (key && SENSITIVE_KEY_RE.test(String(key))) return '<redacted>';
  if (typeof value === 'string') return maskString(value);
  return value;
}

function sanitize(value, key = '') {
  const maskedPrimitive = maskValue(key, value);
  if (maskedPrimitive !== value || value == null) return maskedPrimitive;
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) return value.map((item) => sanitize(item));

  const out = {};
  Object.entries(value).forEach(([k, v]) => {
    out[k] = sanitize(v, k);
  });
  return out;
}

function baseLog(level, scope, args) {
  const prefix = scope ? `[${scope}]` : '';
  const safeArgs = args.map((item) => sanitize(item));

  if (level === 'debug') {
    if (!isDev) return;
    console.debug(prefix, ...safeArgs);
    return;
  }

  if (level === 'info') {
    if (!isDev) return;
    console.info(prefix, ...safeArgs);
    return;
  }

  if (level === 'warn') {
    console.warn(prefix, ...safeArgs);
    return;
  }

  console.error(prefix, ...safeArgs);
}

export function createLogger(scope = '') {
  return {
    debug: (...args) => baseLog('debug', scope, args),
    info: (...args) => baseLog('info', scope, args),
    warn: (...args) => baseLog('warn', scope, args),
    error: (...args) => baseLog('error', scope, args),
  };
}

const logger = createLogger('app');
export default logger;
export { logger };
