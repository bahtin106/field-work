export function installEdgeToEdgeWarnFilter() {
  if (__DEV__) {
    try {
      const g: any = globalThis as any;
      if (!g.__EDGE2EDGE_WARN_FILTER__) {
        const _origWarn = console.warn.bind(console);
        const _re = /`setBehaviorAsync` is not supported with edge-to-edge enabled\.|`setBackgroundColorAsync` is not supported with edge-to-edge enabled\./;
        console.warn = (...args: any[]) => {
          try {
            const first = args && args.length ? String(args[0]) : "";
            if (_re.test(first)) return;
          } catch {}
          return _origWarn(...args);
        };
        g.__EDGE2EDGE_WARN_FILTER__ = true;
      }
    } catch {}
  }
}
