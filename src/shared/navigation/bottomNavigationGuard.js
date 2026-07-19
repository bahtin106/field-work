const guardEntries = [];

export function registerBottomNavigationGuard(handler) {
  if (typeof handler !== 'function') return () => {};

  const entry = { handler };
  guardEntries.push(entry);

  return () => {
    const index = guardEntries.lastIndexOf(entry);
    if (index >= 0) guardEntries.splice(index, 1);
  };
}

export function requestBottomNavigation(target, proceed) {
  const snapshot = [...guardEntries];
  if (!snapshot.length) return false;

  const dispatch = (index) => {
    let nextIndex = index;
    while (nextIndex >= 0 && !guardEntries.includes(snapshot[nextIndex])) {
      nextIndex -= 1;
    }
    if (nextIndex < 0) {
      proceed();
      return;
    }

    const handler = snapshot[nextIndex]?.handler;
    if (typeof handler !== 'function') {
      dispatch(nextIndex - 1);
      return;
    }

    try {
      handler({ target, proceed: () => dispatch(nextIndex - 1) });
    } catch (error) {
      // Preserve the current screen if its data-loss guard fails unexpectedly.
      console.warn('[BottomNavigationGuard] Navigation guard failed:', error);
    }
  };

  dispatch(snapshot.length - 1);
  return true;
}
