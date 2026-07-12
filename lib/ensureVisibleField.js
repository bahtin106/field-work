import { Dimensions, Keyboard, UIManager, findNodeHandle } from 'react-native';

const TOP_MARGIN = 16;
const BOTTOM_MARGIN = 20;

function scrollToY(scrollNode, y) {
  const targetY = Math.max(0, Number(y) || 0);
  if (typeof scrollNode?.scrollTo === 'function') {
    scrollNode.scrollTo({ y: targetY, animated: true });
    return;
  }
  if (typeof scrollNode?.scrollToPosition === 'function') {
    scrollNode.scrollToPosition(0, targetY, true);
    return;
  }
  scrollNode?.getScrollResponder?.()?.scrollResponderScrollTo?.({ y: targetY, animated: true });
}

export function ensureVisibleField({
  fieldRef,
  scrollRef,
  scrollYRef,
  insetsBottom = 0,
  headerHeight = 56,
}) {
  if (!fieldRef?.current || !scrollRef?.current) return;

  requestAnimationFrame(() => {
    try {
      const fieldNode = typeof fieldRef.current === 'number' ? fieldRef.current : findNodeHandle(fieldRef.current);
      if (!fieldNode) return;

      UIManager.measure(
        fieldNode,
        (_x, _y, _width, height, _pageX, pageY) => {
          try {
            const windowHeight = Dimensions.get('window').height;
            const keyboardMetrics = Keyboard.metrics?.();
            const keyboardTop = Number(keyboardMetrics?.screenY);
            const keyboardHeight = Math.max(0, Number(keyboardMetrics?.height) || 0);
            const visibleBottom = Math.min(
              windowHeight,
              Number.isFinite(keyboardTop) ? keyboardTop : windowHeight - keyboardHeight,
            ) - Math.max(0, Number(insetsBottom) || 0) - BOTTOM_MARGIN;
            const visibleTop = Math.max(0, Number(headerHeight) || 0) + TOP_MARGIN;
            const currentScrollY = scrollYRef?.current || 0;
            const fieldTop = Number(pageY) || 0;
            const fieldBottom = fieldTop + (Number(height) || 0);

            if (fieldBottom > visibleBottom) {
              scrollToY(scrollRef.current, currentScrollY + fieldBottom - visibleBottom);
            } else if (fieldTop < visibleTop) {
              scrollToY(scrollRef.current, currentScrollY - (visibleTop - fieldTop));
            }
          } catch {}
        },
      );
    } catch {}
  });
}
