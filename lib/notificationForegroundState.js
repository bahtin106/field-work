import { getNotificationOrderId } from './notificationRouting';

let activeOrderId = '';

function normalizeId(value) {
  return String(value || '').trim();
}

export function setActiveNotificationOrderId(orderId) {
  activeOrderId = normalizeId(orderId);
}

export function clearActiveNotificationOrderId(orderId = null) {
  const normalized = normalizeId(orderId);
  if (!normalized || activeOrderId === normalized) {
    activeOrderId = '';
  }
}

export function shouldSuppressForegroundOrderNotification(notification) {
  const currentOrderId = normalizeId(activeOrderId);
  if (!currentOrderId) return false;
  const notificationOrderId = normalizeId(getNotificationOrderId(notification));
  return !!notificationOrderId && notificationOrderId === currentOrderId;
}
