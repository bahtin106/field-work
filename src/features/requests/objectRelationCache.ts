const ORDER_OBJECT_ADDRESS_CACHE_FIELDS = [
  'country', 'region', 'district', 'city', 'street', 'house', 'postal_code',
  'floor', 'entrance', 'apartment', 'entrance_info', 'parking_notes',
  'geo_lat', 'geo_lng', 'object_location_mode',
] as const;

function detachObjectFromRequestCache(value: any, objectId: string): any {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const patched = detachObjectFromRequestCache(item, objectId);
      if (patched !== item) changed = true;
      return patched;
    });
    return changed ? next : value;
  }
  if (!value || typeof value !== 'object') return value;

  if (String(value.object_id || '').trim() === objectId) {
    const next: Record<string, any> = {
      ...value,
      object_id: null,
      address_mode: 'custom',
      object: null,
      client_object: null,
      object_name: null,
      object_summary: null,
    };
    ORDER_OBJECT_ADDRESS_CACHE_FIELDS.forEach((field) => {
      next[field] = null;
    });
    return next;
  }

  let changed = false;
  const next = { ...value };
  ['pages', 'items', 'data'].forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return;
    const patched = detachObjectFromRequestCache(value[key], objectId);
    if (patched !== value[key]) {
      next[key] = patched;
      changed = true;
    }
  });
  return changed ? next : value;
}

export function detachObjectFromRequestCaches(queryClient: any, objectIdInput: unknown) {
  const objectId = String(objectIdInput || '').trim();
  if (!queryClient || !objectId) return;

  const requestQueries = queryClient.getQueriesData({ queryKey: ['requests'] }) || [];
  requestQueries.forEach(([key, value]: any) => {
    const scope = Array.isArray(key) ? String(key[1] || '') : '';
    if (!['all', 'my', 'calendar', 'detail'].includes(scope)) return;
    const next = detachObjectFromRequestCache(value, objectId);
    if (next !== value) queryClient.setQueryData(key, next);
  });
}
