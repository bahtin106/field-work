import { invokeMediaStorageAction } from './mediaStorageAction';

export async function orderMediaStorage(action, payload = {}, options = {}) {
  return invokeMediaStorageAction(
    'order-media-storage',
    action,
    payload,
    'Order media storage action failed',
    options,
  );
}
