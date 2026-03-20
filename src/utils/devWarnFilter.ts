const SUPPRESSED_DEV_LOG_RE =
  /`setBehaviorAsync` is not supported with edge-to-edge enabled\.|`setBackgroundColorAsync` is not supported with edge-to-edge enabled\.|`expo-notifications` functionality is not fully supported in Expo Go|expo-notifications: Android Push notifications \(remote notifications\) functionality provided .* removed from Expo Go|Expo Go can no longer provide full access to the media library|Due to changes in Androids permission requirements, Expo Go can no longer provide full access to the media library/i;
const REPEATED_LOG_DEDUP_WINDOW_MS = 1200;

function normalizeLogSignature(args: any[]) {
  try {
    return (args || [])
      .slice(0, 3)
      .map((part) => String(part ?? ''))
      .join(' | ')
      .slice(0, 500);
  } catch {
    return '';
  }
}

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
    const recentLogTimestamps = new Map<string, number>();

    const isRepeatedTooFast = (level: 'warn' | 'error', args: any[]) => {
      const signature = `${level}:${normalizeLogSignature(args)}`;
      if (!signature) return false;
      const now = Date.now();
      const prev = recentLogTimestamps.get(signature) || 0;
      recentLogTimestamps.set(signature, now);
      if (recentLogTimestamps.size > 500) {
        const staleBefore = now - REPEATED_LOG_DEDUP_WINDOW_MS * 3;
        for (const [key, ts] of recentLogTimestamps.entries()) {
          if (ts < staleBefore) recentLogTimestamps.delete(key);
        }
      }
      return now - prev < REPEATED_LOG_DEDUP_WINDOW_MS;
    };

    console.warn = (...args: any[]) => {
      if (shouldSuppress(args)) return;
      if (isRepeatedTooFast('warn', args)) return;
      return originalWarn(...args);
    };

    console.error = (...args: any[]) => {
      if (shouldSuppress(args)) return;
      if (isRepeatedTooFast('error', args)) return;
      return originalError(...args);
    };

    g.__DEV_WARN_FILTERS_INSTALLED__ = true;
  } catch {}
}

export function installEdgeToEdgeWarnFilter() {
  installDevWarnFilters();
}
