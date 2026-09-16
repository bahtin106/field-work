type UiIdleTaskOptions = {
  delayMs?: number;
  idleTimeoutMs?: number;
};

export type UiIdleTaskHandle = {
  cancel: () => void;
};

/** Runs non-visual work during an idle JS frame after an optional delay. */
export function scheduleUiIdleTask(
  callback: () => void,
  { delayMs = 0, idleTimeoutMs = 1200 }: UiIdleTaskOptions = {},
) {
  let cancelled = false;
  let idleHandle: number | null = null;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

  const run = () => {
    if (cancelled) return;
    const requestIdle = (globalThis as any).requestIdleCallback;
    if (typeof requestIdle === 'function') {
      idleHandle = requestIdle(
        () => {
          idleHandle = null;
          if (!cancelled) callback();
        },
        { timeout: idleTimeoutMs },
      );
      return;
    }
    fallbackTimer = setTimeout(() => {
      fallbackTimer = null;
      if (!cancelled) callback();
    }, 0);
  };

  const delayTimer = setTimeout(run, Math.max(0, delayMs));

  return () => {
    cancelled = true;
    clearTimeout(delayTimer);
    if (fallbackTimer != null) clearTimeout(fallbackTimer);
    if (idleHandle != null) {
      const cancelIdle = (globalThis as any).cancelIdleCallback;
      if (typeof cancelIdle === 'function') cancelIdle(idleHandle);
    }
  };
}

/** Compatibility shape for call sites that keep a cancellable task handle. */
export function scheduleUiIdleTaskHandle(
  callback: () => void,
  options?: UiIdleTaskOptions,
): UiIdleTaskHandle {
  return { cancel: scheduleUiIdleTask(callback, options) };
}
