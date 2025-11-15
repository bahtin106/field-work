/* global process, console */
// Minimal logger wrapper — centralizes logging and allows future enhancements (masking, remote sinks)
const isProd = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';

function safeStringify(v) {
  try {
    if (typeof v === 'string') return v;
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function debug(...args) {
  if (!isProd) {
    console.log('[DEBUG]', ...args.map(safeStringify));
  }
}

export function info(...args) {
  console.log('[INFO]', ...args.map(safeStringify));
}

export function warn(...args) {
  if (!isProd) {
    console.warn('[WARN]', ...args.map(safeStringify));
  }
}

export function error(...args) {
  console.error('[ERROR]', ...args.map(safeStringify));
}

const logger = { debug, info, warn, error };
export default logger;
export { logger };
