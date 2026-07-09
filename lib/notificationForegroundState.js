let activeOrderId = '';

function normalizeId(value) {
  return String(value || '').trim();
}

function normalizeData(data) {
  if (!data || typeof data !== 'object') return {};
  return data;
}

function extractOrderId(notification) {
  const contentData = normalizeData(notification?.request?.content?.data);
  const remoteData = normalizeData(notification?.request?.trigger?.remoteMessage?.data);
  const data = { ...remoteData, ...contentData };
  const entityType = String(data.entity_type || '').trim();
  const route = String(data.route || '').trim();
  return normalizeId(
    data.order_id ??
      data.orderId ??
      data.request_id ??
      data.requestId ??
      (entityType === 'order' ? data.entity_id : null) ??
      (entityType === 'order' || route.startsWith('/orders/') ? data.params?.id : null),
  );
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
  const notificationOrderId = extractOrderId(notification);
  return !!notificationOrderId && notificationOrderId === currentOrderId;
}
