// Simple in-memory logout event bus. Used to force RootLayout to react to logout immediately
const listeners = new Set();

export function onLogout(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function emitLogout(payload) {
  for (const cb of Array.from(listeners)) {
    try {
      cb(payload);
    } catch (e) {
      void e;
    }
  }
}

export default { onLogout, emitLogout };
