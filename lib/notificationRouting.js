const MAX_NESTED_DATA_DEPTH = 3;

function normalizeObject(value) {
  let candidate = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate
    : null;
}

function collectNotificationData(source) {
  const notification = source?.notification || source;
  const trigger = notification?.request?.trigger;
  const roots = [
    notification?.request?.content?.data,
    trigger?.remoteMessage?.data,
    trigger?.payload,
  ];
  const result = [];
  const queue = roots.map((value) => ({ value, depth: 0 }));
  const seen = new Set();

  while (queue.length > 0) {
    const { value, depth } = queue.shift();
    const data = normalizeObject(value);
    if (!data || seen.has(data)) continue;
    seen.add(data);
    result.push(data);

    if (depth >= MAX_NESTED_DATA_DEPTH) continue;
    for (const key of ['data', 'body', 'payload', 'custom_data']) {
      if (data[key] != null) {
        queue.push({ value: data[key], depth: depth + 1 });
      }
    }
  }

  return result;
}

function normalizeId(value) {
  const normalized = String(value ?? '').trim();
  return normalized && normalized !== 'undefined' && normalized !== 'null'
    ? normalized
    : '';
}

function readFirst(dataList, keys) {
  for (const data of dataList) {
    for (const key of keys) {
      const value = normalizeId(data?.[key]);
      if (value) return value;
    }
  }
  return '';
}

function readRoute(dataList) {
  return readFirst(dataList, ['url', 'route', 'path']);
}

function readRouteId(route, pattern) {
  const match = String(route || '').match(pattern);
  if (!match?.[1]) return '';
  try {
    return normalizeId(decodeURIComponent(match[1]));
  } catch {
    return normalizeId(match[1]);
  }
}

function readParamsId(dataList, routePattern) {
  for (const data of dataList) {
    const route = normalizeId(data?.url ?? data?.route ?? data?.path);
    if (!route || !routePattern.test(route)) continue;
    const params = normalizeObject(data?.params);
    const id = normalizeId(params?.id);
    if (id) return id;
  }
  return '';
}

export function getNotificationRecipientUserId(source) {
  return readFirst(collectNotificationData(source), [
    'recipient_user_id',
    'recipientUserId',
  ]);
}

export function notificationBelongsToUser(source, userId) {
  const recipientUserId = getNotificationRecipientUserId(source);
  if (!recipientUserId) return true;
  return recipientUserId === normalizeId(userId);
}

export function resolveNotificationTarget(source) {
  const dataList = collectNotificationData(source);
  if (dataList.length === 0) return null;

  const eventType = readFirst(dataList, ['event_type', 'eventType']);
  const entityType = readFirst(dataList, ['entity_type', 'entityType']).toLowerCase();
  const route = readRoute(dataList);
  const supportRoutePattern = /\/admin\/feedbacks\/([^/?#]+)/i;
  const orderRoutePattern = /\/orders\/([^/?#]+)/i;

  const feedbackId =
    readFirst(dataList, ['feedback_id', 'feedbackId']) ||
    (['support_feedback', 'support_request', 'feedback'].includes(entityType)
      ? readFirst(dataList, ['entity_id', 'entityId'])
      : '') ||
    readRouteId(route, supportRoutePattern) ||
    readParamsId(dataList, supportRoutePattern);

  if (feedbackId || eventType === 'support_feedback_new') {
    if (!feedbackId) return null;
    return {
      kind: 'support-feedback',
      entityId: feedbackId,
      eventType,
      recipientUserId: getNotificationRecipientUserId(source),
    };
  }

  const orderId =
    readFirst(dataList, ['order_id', 'orderId']) ||
    (['order', 'request'].includes(entityType)
      ? readFirst(dataList, ['entity_id', 'entityId'])
      : '') ||
    readRouteId(route, orderRoutePattern) ||
    readParamsId(dataList, orderRoutePattern) ||
    readFirst(dataList, ['request_id', 'requestId']);

  if (!orderId) return null;
  return {
    kind: 'order',
    entityId: orderId,
    eventType,
    recipientUserId: getNotificationRecipientUserId(source),
  };
}

export function getNotificationOrderId(source) {
  const target = resolveNotificationTarget(source);
  return target?.kind === 'order' ? target.entityId : null;
}

export function getNotificationResponseKey(response) {
  const requestId = normalizeId(response?.notification?.request?.identifier);
  const actionId = normalizeId(response?.actionIdentifier);
  const notificationDate = normalizeId(response?.notification?.date);
  const target = resolveNotificationTarget(response);
  const targetKey = target ? `${target.kind}:${target.entityId}` : '';
  return [requestId || notificationDate, actionId, targetKey].join('|');
}
