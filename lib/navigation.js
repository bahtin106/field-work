import { router } from 'expo-router';
import logger from './logger';

let navigationReady = false;

export function setNavigationReady(ready) {
  navigationReady = ready;
}

export async function forceNavigate(path) {
  if (!navigationReady) {
    logger.warn('Navigation not ready, waiting...');
    await new Promise((resolve) => globalThis?.setTimeout?.(resolve, 500));
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      logger.warn(`Navigation attempt ${attempt + 1} to ${path}`);

      await router.replace(path);
      logger.warn('Navigation successful');
      return;
    } catch (e) {
      logger.warn(`Navigation attempt ${attempt + 1} failed:`, e);
      await new Promise((resolve) => globalThis?.setTimeout?.(resolve, 100));
    }
  }

  logger.warn('All navigation attempts failed');
}
