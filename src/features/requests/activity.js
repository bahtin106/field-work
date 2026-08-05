import { supabase } from '../../../lib/supabase';

const asObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);
const asText = (value) => (typeof value === 'string' ? value.trim() : '');
const ADDRESS_FIELDS = [
  'country', 'region', 'district', 'city', 'street', 'house',
  'postal_code', 'floor', 'entrance', 'apartment',
];

const normalizeAddress = (value) => {
  const row = asObject(value);
  const result = {};
  ADDRESS_FIELDS.forEach((field) => {
    const normalized = asText(row[field]);
    if (normalized) result[field] = normalized;
  });
  return Object.keys(result).length > 0 ? result : null;
};

const normalizeReference = (value) => {
  const row = asObject(value);
  const entityId = asText(row.entity_id);
  const label = asText(row.label);
  if (!entityId && !label) return null;
  return {
    entityType: ['user', 'client', 'object', 'work_type'].includes(asText(row.entity_type))
      ? asText(row.entity_type)
      : '',
    entityId,
    label,
    available: row.available === true,
  };
};

export const normalizeOrderActivityEvent = (value) => {
  const row = asObject(value);
  const eventId = asText(row.event_id);
  const occurredAt = asText(row.occurred_at);
  const action = asText(row.action);
  const entityType = asText(row.entity_type);
  if (!eventId || !occurredAt || !['insert', 'update', 'delete'].includes(action)) return null;
  if (!['orders', 'order_finance_entries', 'order_customer_payments'].includes(entityType)) return null;
  const context = asObject(row.context);
  const actor = asObject(context.actor);
  const changes = (Array.isArray(row.changes) ? row.changes : [])
    .map((value) => {
      const change = asObject(value);
      const field = asText(change.field);
      if (!field) return null;
      const valueType = asText(change.value_type);
      return {
        field,
        before: change.before ?? null,
        after: change.after ?? null,
        beforeRef: normalizeReference(change.before_ref),
        afterRef: normalizeReference(change.after_ref),
        redacted: change.redacted === true,
        valueType: ['reference', 'media_count'].includes(valueType) ? valueType : 'scalar',
      };
    })
    .filter(Boolean);

  return {
    eventId,
    occurredAt,
    action,
    entityType,
    actorUserId: asText(row.actor_user_id) || null,
    actorName: asText(row.actor_name),
    changes,
    context: {
      entityId: asText(context.entity_id),
      title: asText(context.title),
      amount: typeof context.amount === 'number' && Number.isFinite(context.amount)
        ? context.amount
        : null,
      currency: asText(context.currency),
      actor: {
        firstName: asText(actor.first_name),
        middleName: asText(actor.middle_name),
        lastName: asText(actor.last_name),
      },
      client: normalizeReference(context.client),
      object: normalizeReference(context.object),
      assignee: normalizeReference(context.assignee),
      beforeAddress: normalizeAddress(context.before_address),
      afterAddress: normalizeAddress(context.after_address),
    },
  };
};

export async function fetchOrderActivityPage({ orderId, limit = 30, cursor = null }) {
  const pageSize = Math.min(100, Math.max(1, Math.trunc(limit)));
  const { data, error } = await supabase.rpc('get_order_activity', {
    p_order_id: orderId,
    p_limit: pageSize,
    p_before_created_at: cursor?.occurredAt || null,
    p_before_id: cursor?.eventId || null,
  });
  if (error) throw error;
  const events = (Array.isArray(data) ? data : [])
    .map(normalizeOrderActivityEvent)
    .filter(Boolean);
  const last = events[events.length - 1];
  return {
    events,
    nextCursor: events.length === pageSize && last
      ? { occurredAt: last.occurredAt, eventId: last.eventId }
      : null,
  };
}
