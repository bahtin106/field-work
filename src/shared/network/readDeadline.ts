import { getOfflineSnapshot } from '../offline/offlineStatus';

const ONLINE_READ_DEADLINE_MS = 12_000;
const DEGRADED_READ_DEADLINE_MS = 6_000;
const OFFLINE_READ_DEADLINE_MS = 2_500;

function resolveDeadlineMs(explicitTimeoutMs?: number) {
  if (Number.isFinite(explicitTimeoutMs) && Number(explicitTimeoutMs) > 0) {
    return Number(explicitTimeoutMs);
  }
  const network = getOfflineSnapshot();
  if (network.isNetworkKnown && !network.isOnline) return OFFLINE_READ_DEADLINE_MS;
  if (network.isPoorConnection) return DEGRADED_READ_DEADLINE_MS;
  return ONLINE_READ_DEADLINE_MS;
}

/**
 * Bounds remote reads so stale-while-revalidate can fall back to local data.
 * A factory receives a composed AbortSignal; directly supplied Supabase
 * builders are detected and receive the same signal before they execute.
 * This helper is deliberately not used for writes: timing out a mutation can
 * make a committed server response look failed and invite duplicate retries.
 */
export async function withReadDeadline<T>(
  source:
    | PromiseLike<T>
    | T
    | ((signal: AbortSignal) => PromiseLike<T> | T),
  options: { timeoutMs?: number; label?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const timeoutMs = resolveDeadlineMs(options.timeoutMs);
  const controller = new AbortController();
  const upstreamSignal = options.signal;
  let abortReason: unknown = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let abortListener: (() => void) | null = null;
  let upstreamAbortListener: (() => void) | null = null;

  const createAbortError = () => {
    const reason = abortReason ?? controller.signal.reason;
    if (reason instanceof Error) return reason;
    const error: any = new Error('Network read was aborted');
    error.name = 'AbortError';
    error.code = 'READ_ABORTED';
    return error;
  };
  const abortRead = (reason?: unknown) => {
    abortReason = reason;
    controller.abort(reason);
  };

  if (upstreamSignal) {
    upstreamAbortListener = () => abortRead(upstreamSignal.reason);
    if (upstreamSignal.aborted) upstreamAbortListener();
    else upstreamSignal.addEventListener('abort', upstreamAbortListener, { once: true });
  }

  try {
    const resolveSource = () => {
      if (typeof source === 'function') {
        return (source as (signal: AbortSignal) => PromiseLike<T> | T)(controller.signal);
      }
      const abortableSource = source as any;
      if (abortableSource && typeof abortableSource.abortSignal === 'function') {
        return abortableSource.abortSignal(controller.signal);
      }
      return source;
    };
    const readPromise = controller.signal.aborted
      ? Promise.reject<T>(createAbortError())
      : Promise.resolve(resolveSource());

    return await Promise.race([
      readPromise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          const error: any = new Error(
            `${String(options.label || 'Network read')} timed out after ${timeoutMs}ms`,
          );
          error.name = 'ReadDeadlineError';
          error.code = 'READ_DEADLINE_EXCEEDED';
          abortRead(error);
          reject(error);
        }, timeoutMs);
      }),
      new Promise<T>((_resolve, reject) => {
        abortListener = () => reject(createAbortError());
        controller.signal.addEventListener('abort', abortListener, { once: true });
        if (controller.signal.aborted) abortListener();
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (abortListener) controller.signal.removeEventListener('abort', abortListener);
    if (upstreamSignal && upstreamAbortListener) {
      upstreamSignal.removeEventListener('abort', upstreamAbortListener);
    }
  }
}

export default withReadDeadline;
