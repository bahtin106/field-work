import dismissToRoute from './dismissToRoute';

export default function goBackSmart(navigation, router, target, fallbackTarget = '/orders') {
  try {
    if (typeof navigation?.canGoBack === 'function' && navigation.canGoBack()) {
      navigation.goBack();
      return true;
    }
  } catch {}

  if (target && dismissToRoute(router, target)) {
    return true;
  }

  if (fallbackTarget && dismissToRoute(router, fallbackTarget)) {
    return true;
  }

  return false;
}
