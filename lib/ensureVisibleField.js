import { Dimensions, Platform } from 'react-native';

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
      fieldRef.current.measureLayout(
        scrollRef.current,
        (_x, y, _width, height) => {
          const screenHeight = Dimensions.get('window').height;
          const visibleAreaHeight =
            screenHeight - KEYBOARD_HEIGHT - headerHeight - (insetsBottom || 0);
          const currentScrollY = scrollYRef.current || 0;
          const fieldTop = y;
          const fieldBottom = y + height;
          const fieldTopInViewport = fieldTop - currentScrollY;
          const fieldBottomInViewport = fieldBottom - currentScrollY;

          if (fieldBottomInViewport > visibleAreaHeight - BOTTOM_MARGIN) {
            const scrollTo = fieldBottom - visibleAreaHeight + TOP_MARGIN;
            scrollRef.current?.scrollTo({ y: Math.max(0, scrollTo), animated: true });
          } else if (fieldTopInViewport < TOP_MARGIN / 2) {
            const scrollTo = fieldTop - TOP_MARGIN;
            scrollRef.current?.scrollTo({ y: Math.max(0, scrollTo), animated: true });
          }
        },
        () => {
          scrollRef.current?.scrollToEnd({ animated: true });
        },
      );
    } catch (e) {
      // Ignore errors
    }
  }, delay);
}
