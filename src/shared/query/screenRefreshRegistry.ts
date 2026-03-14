import { useEffect } from 'react';

type RefreshContext = {
  reason?: string;
  path?: string;
};

type RefreshHandler = (context?: RefreshContext) => void | Promise<void>;

const registry = new Map<string, Set<RefreshHandler>>();

export function registerScreenRefresh(scope: string, handler: RefreshHandler) {
  const normalizedScope = String(scope || '').trim();
  if (!normalizedScope || typeof handler !== 'function') {
    return () => {};
  }

  let handlers = registry.get(normalizedScope);
  if (!handlers) {
    handlers = new Set();
    registry.set(normalizedScope, handlers);
  }
  handlers.add(handler);

  return () => {
    const current = registry.get(normalizedScope);
    if (!current) return;
    current.delete(handler);
    if (current.size === 0) {
      registry.delete(normalizedScope);
    }
  };
}

export async function requestScreenRefresh(
  scopes: string[] = [],
  context: RefreshContext = {},
) {
  const callbacks = new Set<RefreshHandler>();

  for (const scope of scopes) {
    const normalizedScope = String(scope || '').trim();
    if (!normalizedScope) continue;
    const handlers = registry.get(normalizedScope);
    if (!handlers?.size) continue;
    handlers.forEach((handler) => callbacks.add(handler));
  }

  if (!callbacks.size) return;
  await Promise.allSettled(Array.from(callbacks, (handler) => Promise.resolve(handler(context))));
}

export function useScreenRefreshRegistration(
  scope: string,
  handler: RefreshHandler,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return undefined;
    return registerScreenRefresh(scope, handler);
  }, [enabled, handler, scope]);
}
