/**
 * Runs non-visual work only after the destination has had a chance to paint.
 * Calling query prefetch/import work in the same press event delays React
 * Navigation's commit on low-end Android devices.
 */
export function runAfterNavigationFrame(task: () => void) {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const frame = requestAnimationFrame(() => {
    timer = setTimeout(() => {
      timer = null;
      if (cancelled) return;
      try {
        task();
      } catch {}
    }, 0);
  });

  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
    if (timer) clearTimeout(timer);
  };
}
