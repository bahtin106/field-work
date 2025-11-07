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

export function warn(...args) {
  if (!isProd) {
    console.warn(...args.map(safeStringify));
  }
}

export function error(...args) {
  console.error(...args.map(safeStringify));
}

const logger = { warn, error };
export default logger;
