export default function dismissToRoute(router, target) {
  if (!router || !target) return false;

  try {
    if (typeof router.dismissTo === 'function') {
      router.dismissTo(target);
      return true;
    }
  } catch {}

  try {
    if (typeof router.navigate === 'function') {
      router.navigate(target);
      return true;
    }
  } catch {}

  try {
    if (typeof router.replace === 'function') {
      router.replace(target);
      return true;
    }
  } catch {}

  return false;
}
