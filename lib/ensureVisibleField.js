import { Dimensions, Keyboard, UIManager, findNodeHandle } from 'react-native';

const TOP_MARGIN = 16;
const BOTTOM_MARGIN = 20;
const MEASURE_TIMEOUT_MS = 160;
const MEASURE_RETRY_DELAY_MS = 48;

function collectNodeCandidates(node) {
  const candidates = [];
  const seen = new Set();
  const addCandidate = (candidate) => {
    if (!candidate || seen.has(candidate)) return;
    seen.add(candidate);
    candidates.push(candidate);
  };

  addCandidate(node);
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    ['getNativeScrollRef', 'getScrollResponder', 'getScrollableNode'].forEach((method) => {
      if (typeof candidate?.[method] !== 'function') return;
      try {
        addCandidate(candidate[method]());
      } catch {}
    });
  }

  return candidates;
}

function normalizeMeasurement(x, y, width, height) {
  const top = Number(y);
  const measuredHeight = Number(height);
  if (!Number.isFinite(top) || !Number.isFinite(measuredHeight) || measuredHeight <= 0) {
    return null;
  }
  return {
    x: Number(x) || 0,
    y: top,
    width: Math.max(0, Number(width) || 0),
    height: measuredHeight,
  };
}

export function measureNodeInWindow(node, { timeoutMs = MEASURE_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const candidates = collectNodeCandidates(node);
    if (!candidates.length) {
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (measurement) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(measurement);
    };
    const timeoutId = setTimeout(() => finish(null), timeoutMs);

    for (const candidate of candidates) {
      let nativeMeasurementRequested = false;
      if (typeof candidate?.measureInWindow === 'function') {
        try {
          candidate.measureInWindow((x, y, width, height) => {
            const measurement = normalizeMeasurement(x, y, width, height);
            if (measurement) finish(measurement);
          });
          nativeMeasurementRequested = true;
        } catch {}
      }
      if (nativeMeasurementRequested) continue;

      try {
        const handle = typeof candidate === 'number' ? candidate : findNodeHandle(candidate);
        if (!handle) continue;
        UIManager.measure(handle, (_x, _y, width, height, pageX, pageY) => {
          const measurement = normalizeMeasurement(pageX, pageY, width, height);
          if (measurement) finish(measurement);
        });
      } catch {}
    }
  });
}

function scrollToY(scrollNode, y) {
  const targetY = Math.max(0, Number(y) || 0);
  const candidates = collectNodeCandidates(scrollNode);

  for (const candidate of candidates) {
    if (typeof candidate?.scrollTo === 'function') {
      try {
        candidate.scrollTo({ y: targetY, animated: true });
        return true;
      } catch {}
    }
    if (typeof candidate?.scrollToPosition === 'function') {
      try {
        candidate.scrollToPosition(0, targetY, true);
        return true;
      } catch {}
    }
    if (typeof candidate?.scrollResponderScrollTo === 'function') {
      try {
        candidate.scrollResponderScrollTo({ y: targetY, animated: true });
        return true;
      } catch {}
    }
  }

  return false;
}

export function ensureVisibleField({
  fieldRef,
  scrollRef,
  scrollYRef,
  insetsBottom = 0,
  headerHeight = 56,
}) {
  if (!fieldRef?.current || !scrollRef?.current) return;

  const measureAndScroll = async (attempt = 0) => {
    const fieldNode = fieldRef.current;
    const scrollNode = scrollRef.current;
    if (!fieldNode || !scrollNode) return;

    const [fieldLayout, scrollLayout] = await Promise.all([
      measureNodeInWindow(fieldNode),
      measureNodeInWindow(scrollNode),
    ]);

    if (!fieldLayout || fieldLayout.height <= 0) {
      if (attempt === 0 && fieldRef.current && scrollRef.current) {
        setTimeout(() => measureAndScroll(1), MEASURE_RETRY_DELAY_MS);
      }
      return;
    }

    const windowHeight = Dimensions.get('window').height;
    const keyboardMetrics = Keyboard.metrics?.();
    const keyboardTop = Number(keyboardMetrics?.screenY);
    const keyboardHeight = Math.max(0, Number(keyboardMetrics?.height) || 0);
    const keyboardBoundary = keyboardHeight > 0
      ? Math.min(
          windowHeight,
          Number.isFinite(keyboardTop) && keyboardTop > 0
            ? keyboardTop
            : windowHeight - keyboardHeight,
        )
      : windowHeight;
    const hasScrollViewport = !!scrollLayout?.height;
    const viewportTop = hasScrollViewport
      ? scrollLayout.y
      : Math.max(0, Number(headerHeight) || 0);
    const viewportBottom = hasScrollViewport
      ? Math.min(windowHeight, scrollLayout.y + scrollLayout.height)
      : windowHeight;
    const visibleTop = viewportTop + TOP_MARGIN;
    const visibleBottom = Math.min(viewportBottom, keyboardBoundary)
      - Math.max(0, Number(insetsBottom) || 0)
      - BOTTOM_MARGIN;
    const currentScrollY = Math.max(0, Number(scrollYRef?.current) || 0);
    const fieldTop = fieldLayout.y;
    const fieldBottom = fieldTop + fieldLayout.height;
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);

    if (fieldTop < visibleTop || fieldLayout.height >= visibleHeight) {
      scrollToY(scrollNode, currentScrollY - (visibleTop - fieldTop));
    } else if (fieldBottom > visibleBottom) {
      scrollToY(scrollNode, currentScrollY + fieldBottom - visibleBottom);
    }
  };

  requestAnimationFrame(() => measureAndScroll());
}
