let activeGuardEntry = null;

export function registerBottomNavigationGuard(handler) {
  if (typeof handler !== 'function') return () => {};

  const entry = { handler };
  activeGuardEntry = entry;

  return () => {
    if (activeGuardEntry === entry) {
      activeGuardEntry = null;
    }
  };
}

export function requestBottomNavigation(target, proceed) {
  const handler = activeGuardEntry?.handler;
  if (typeof handler !== 'function') return false;

  try {
    handler({ target, proceed });
  } catch (error) {
    // Preserve the current screen if its data-loss guard fails unexpectedly.
    console.warn('[BottomNavigationGuard] Navigation guard failed:', error);
  }
  return true;
}
