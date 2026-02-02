import { Dimensions, Platform, UIManager, findNodeHandle } from 'react-native';

const KEYBOARD_HEIGHT = 300;
const TOP_MARGIN = 100;
const BOTTOM_MARGIN = 50;

export function ensureVisibleField({
  fieldRef,
  scrollRef,
  scrollYRef,
  insetsBottom = 0,
  headerHeight = 56,
}) {
  if (!fieldRef?.current || !scrollRef?.current) return;

  const delay = Platform.OS === 'android' ? 300 : 150;
  setTimeout(() => {
    try {
      const fieldNode = typeof fieldRef.current === 'number' ? fieldRef.current : findNodeHandle(fieldRef.current);
      const scrollNode = typeof scrollRef.current === 'number' ? scrollRef.current : findNodeHandle(scrollRef.current);

      if (!fieldNode) {
        try {
          scrollRef.current?.scrollToEnd?.({ animated: true });
        } catch {}
        return;
      }

      // measure absolute position in window
      UIManager.measure(
        fieldNode,
        (_x, _y, _width, height, _pageX, pageY) => {
          try {
            const screenHeight = Dimensions.get('window').height;
            const visibleAreaHeight = screenHeight - KEYBOARD_HEIGHT - headerHeight - (insetsBottom || 0);
            const currentScrollY = scrollYRef?.current || 0;

            const fieldTopPage = pageY;
            const fieldBottomPage = pageY + height;

            const visibleTop = headerHeight;
            const visibleBottom = headerHeight + visibleAreaHeight;

            if (fieldBottomPage > visibleBottom - BOTTOM_MARGIN) {
              const delta = fieldBottomPage - (visibleBottom - BOTTOM_MARGIN) + TOP_MARGIN;
              const target = Math.max(0, currentScrollY + delta);
              try {
                scrollRef.current?.scrollTo({ y: target, animated: true });
              } catch {}
            } else if (fieldTopPage < visibleTop + TOP_MARGIN / 2) {
              const delta = visibleTop + TOP_MARGIN - fieldTopPage;
              const target = Math.max(0, currentScrollY - delta);
              try {
                scrollRef.current?.scrollTo({ y: target, animated: true });
              } catch {}
            }
          } catch (e) {
            try {
              scrollRef.current?.scrollToEnd?.({ animated: true });
            } catch {}
          }
        },
      );
    } catch (e) {
      // Ignore errors
    }
  }, delay);
}
