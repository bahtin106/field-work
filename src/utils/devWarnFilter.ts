const SUPPRESSED_DEV_LOG_RE =
  /`setBehaviorAsync` is not supported with edge-to-edge enabled\.|`setBackgroundColorAsync` is not supported with edge-to-edge enabled\.|`expo-notifications` functionality is not fully supported in Expo Go|expo-notifications: Android Push notifications \(remote notifications\) functionality provided .* removed from Expo Go|Expo Go can no longer provide full access to the media library|Due to changes in Androids permission requirements, Expo Go can no longer provide full access to the media library/i;

function shouldSuppress(args: any[]) {
  try {
    const first = args && args.length ? String(args[0]) : '';
    return SUPPRESSED_DEV_LOG_RE.test(first);
  } catch {
    return false;
  }
}

export function installDevWarnFilters() {
  if (!__DEV__) return;

  try {
    const g: any = globalThis as any;
    if (g.__DEV_WARN_FILTERS_INSTALLED__) return;

    const originalWarn = console.warn.bind(console);
    const originalError = console.error.bind(console);

    console.warn = (...args: any[]) => {
      if (shouldSuppress(args)) return;
      return originalWarn(...args);
    };

    console.error = (...args: any[]) => {
      if (shouldSuppress(args)) return;
      return originalError(...args);
    };

    g.__DEV_WARN_FILTERS_INSTALLED__ = true;
  } catch {}
}

export function installEdgeToEdgeWarnFilter() {
  installDevWarnFilters();
}
