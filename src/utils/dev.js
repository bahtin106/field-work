// src/utils/dev.js
/** Dev-only logger for silent catches */
export const devWarn = (...args) => {
  try {
    if (typeof __DEV__ !== "undefined" && __DEV__) console.warn(...args);
  } catch {}
};
