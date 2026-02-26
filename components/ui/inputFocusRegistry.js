let sequence = 0;
const registry = [];

function normalizeEntry(entry) {
  if (!entry || !entry.id || typeof entry.getInput !== 'function') return null;
  return {
    id: entry.id,
    getInput: entry.getInput,
    order: Number.isFinite(entry.order) ? entry.order : ++sequence,
  };
}

export function registerInput(entry) {
  const normalized = normalizeEntry(entry);
  if (!normalized) return;

  const existingIdx = registry.findIndex((item) => item.id === normalized.id);
  if (existingIdx >= 0) {
    registry[existingIdx] = normalized;
  } else {
    registry.push(normalized);
  }

  registry.sort((a, b) => a.order - b.order);
}

export function unregisterInput(id) {
  const idx = registry.findIndex((item) => item.id === id);
  if (idx >= 0) registry.splice(idx, 1);
}

export function focusNextInput(id) {
  if (!id) return false;
  const idx = registry.findIndex((item) => item.id === id);
  if (idx < 0) return false;

  for (let i = idx + 1; i < registry.length; i += 1) {
    const nextRef = registry[i]?.getInput?.();
    if (!nextRef || typeof nextRef.focus !== 'function') continue;
    try {
      nextRef.focus();
      return true;
    } catch {
      // Continue searching next focusable input.
    }
  }

  return false;
}
