import { invokeMediaStorageAction } from './mediaStorageAction';

export async function objectMediaStorage(action, payload = {}) {
  return invokeMediaStorageAction(
    'object-media-storage',
    action,
    payload,
    'Object media storage action failed',
  );
}
