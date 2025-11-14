// lib/authState.js
// Global auth state flag to coordinate between login screen and layout
let authStateListeners = [];

export function notifyAuthSuccess(user) {
  authStateListeners.forEach((listener) => {
    try {
      listener(user);
    } catch {
      // ignore
    }
  });
}

export function subscribeAuthSuccess(listener) {
  authStateListeners.push(listener);
  return () => {
    authStateListeners = authStateListeners.filter((l) => l !== listener);
  };
}
