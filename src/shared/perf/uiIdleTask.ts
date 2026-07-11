import { InteractionManager } from 'react-native';

type UiIdleTaskOptions = {
  delayMs?: number;
  idleTimeoutMs?: number;
};

/** Runs non-visual work after gestures/animations and during an idle JS frame. */
export function scheduleUiIdleTask(
  callback: () => void,
  { delayMs = 0, idleTimeoutMs = 1200 }: UiIdleTaskOptions = {},
) {
  let cancelled = false;
  let interactionTask: { cancel?: () => void } | null = null;
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

  const delayTimer = setTimeout(() => {
    interactionTask = InteractionManager.runAfterInteractions(run);
  }, Math.max(0, delayMs));

  return () => {
    cancelled = true;
    clearTimeout(delayTimer);
    interactionTask?.cancel?.();
    if (fallbackTimer) clearTimeout(fallbackTimer);
    if (idleHandle != null) {
      const cancelIdle = (globalThis as any).cancelIdleCallback;
      if (typeof cancelIdle === 'function') cancelIdle(idleHandle);
    }
  };
}
