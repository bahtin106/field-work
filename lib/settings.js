// field_key -> value mapping for orders.
export function readValueFromOrder(orderJson, field) {
  if (!orderJson || !field) return null;
  const { field_key, storage_target } = field;

  if (storage_target === 'custom') return null;

  return orderJson[field_key] ?? null;
}

// Legacy helper kept for compatibility with old RPC contracts.
export function buildCustomPayload(fields, formValuesByFieldKey) {
  void fields;
  void formValuesByFieldKey;
  return {};
}
