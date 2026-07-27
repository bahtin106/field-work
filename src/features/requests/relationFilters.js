export function normalizeRelationId(value) {
  const next = String(value || '').trim();
  return next || '';
}

export function parseRelationIdsParam(raw) {
  const values = Array.isArray(raw) ? raw : [raw];
  return Array.from(
    new Set(
      values
        .flatMap((value) => String(value || '').split(','))
        .map((value) => normalizeRelationId(value))
        .filter(Boolean),
    ),
  );
}

export function hasRelationFilters({ clientId = '', objectIds = [] } = {}) {
  return Boolean(normalizeRelationId(clientId) || (Array.isArray(objectIds) && objectIds.length));
}

export function buildOrderRelationOrFilter({ clientId = '', objectIds = [] } = {}) {
  const normalizedClientId = normalizeRelationId(clientId);
  const normalizedObjectIds = Array.from(
    new Set((Array.isArray(objectIds) ? objectIds : []).map((value) => normalizeRelationId(value)).filter(Boolean)),
  );

  const clauses = [];
  if (normalizedClientId) {
    clauses.push(`client_id.eq.${normalizedClientId}`);
  }
  if (normalizedObjectIds.length) {
    clauses.push(`object_id.in.(${normalizedObjectIds.join(',')})`);
  }

  return clauses.join(',');
}

export function applyOrderRelationFilters(query, filters = {}) {
  const orFilter = buildOrderRelationOrFilter(filters);
  if (!orFilter) return query;
  return query.or(orFilter);
}

export function buildOrdersEntityFilterRoute({
  canViewAllOrders = false,
  entityType = '',
  entityId = '',
  label = '',
} = {}) {
  const normalizedType = String(entityType || '').trim().toLowerCase();
  const normalizedId = normalizeRelationId(entityId);
  if (!normalizedId || (normalizedType !== 'client' && normalizedType !== 'object')) {
    return null;
  }

  const entityLabel = String(label || '').trim();
  return {
    pathname: canViewAllOrders ? '/orders/all-orders' : '/orders/my-orders',
    params: {
      ...(canViewAllOrders ? {} : { seedFilter: 'all' }),
      ...(normalizedType === 'client'
        ? { client_ids: normalizedId, object_ids: '' }
        : { client_ids: '', object_ids: normalizedId }),
      reset_order_filters: '1',
      filter_entity_type: normalizedType,
      filter_entity_id: normalizedId,
      ...(entityLabel ? { filter_entity_label: entityLabel } : {}),
    },
  };
}
