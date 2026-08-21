import { supabase } from '../../../lib/supabase';
import {
  ENTITY_FIELD_TYPES,
  buildFallbackEntityFieldSettings,
  getEntityFieldCatalog,
  normalizeEntityField,
} from './catalog';
import { enforceOrderFinanceFieldDependencies } from './orderFinance';
import {
  assertMutationAuthCarrier,
  pinMutationAuthorization,
} from '../../shared/security/mutationAuthCarrier';

function normalizeFieldRows(entityType, rows) {
  const byKey = new Map();
  for (const field of Array.isArray(rows) ? rows : []) {
    const normalized = normalizeEntityField(entityType, field);
    if (normalized) byKey.set(normalized.fieldKey, normalized);
  }

  return getEntityFieldCatalog(entityType)
    .map((item) => byKey.get(item.fieldKey) || normalizeEntityField(entityType, item))
    .filter(Boolean);
}

function normalizeResponse(entityType, data) {
  if (!data || typeof data !== 'object') {
    return buildFallbackEntityFieldSettings(entityType);
  }

  return {
    entityType,
    versionToken: data.version_token || data.version || null,
    source: 'remote',
    fields: normalizeFieldRows(entityType, data.fields),
  };
}

function isUnknownFieldKeyError(error) {
  const message = String(error?.message || '').toUpperCase();
  return message.includes('UNKNOWN_FIELD_KEY');
}

async function fetchServerFieldKeys(entityType, authCarrier) {
  assertMutationAuthCarrier(authCarrier);
  const request = pinMutationAuthorization(
    supabase.rpc('get_company_entity_field_settings', {
      p_entity_type: String(entityType || ''),
    }),
    authCarrier,
  );
  const { data, error } = await request;
  assertMutationAuthCarrier(authCarrier);
  if (error) throw error;
  const keys = new Set();
  const rows = Array.isArray(data?.fields) ? data.fields : [];
  rows.forEach((row) => {
    const fieldKey = String(row?.field_key || row?.fieldKey || '').trim();
    if (fieldKey) keys.add(fieldKey);
  });
  return keys;
}

export async function listEntityFieldSettings(entityType, signal = undefined) {
  const fallback = buildFallbackEntityFieldSettings(entityType);

  try {
    let query = supabase.rpc('get_company_entity_field_settings', {
      p_entity_type: String(entityType || ''),
    });
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw error;
    return normalizeResponse(entityType, data);
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    const missingRpc =
      message.includes('function') && (message.includes('does not exist') || message.includes('not found'));
    if (missingRpc) return fallback;

    // A network/authorization failure is not a valid replacement for the
    // company's last-known custom form. Let React Query retain persisted data;
    // screens without a cache already provide their own static fallback.
    throw error;
  }
}

export async function saveEntityFieldSettings(
  { entityType, fields, expectedVersion = null },
  authCarrier,
) {
  assertMutationAuthCarrier(authCarrier);
  const normalizedFields =
    entityType === ENTITY_FIELD_TYPES.ORDER
      ? enforceOrderFinanceFieldDependencies(fields)
      : fields;

  const validFieldKeys = new Set(
    getEntityFieldCatalog(entityType)
      .map((field) => String(field?.fieldKey || '').trim())
      .filter(Boolean),
  );

  const payload = (Array.isArray(normalizedFields) ? normalizedFields : [])
    .map((field) => ({
      field_key: String(field.fieldKey || field.field_key || '').trim(),
      is_enabled: field.isEnabled !== false,
      is_required: field.isRequired === true,
      custom_label:
        typeof field.customLabel === 'string' && field.customLabel.trim()
          ? field.customLabel.trim()
          : typeof field.custom_label === 'string' && field.custom_label.trim()
            ? field.custom_label.trim()
            : null,
    }))
    .filter((field) => validFieldKeys.has(field.field_key));

  const savePayload = async (nextPayload) => {
    assertMutationAuthCarrier(authCarrier);
    const request = pinMutationAuthorization(
      supabase.rpc('save_company_entity_field_settings', {
        p_entity_type: String(entityType || ''),
        p_expected_version: expectedVersion || null,
        p_fields: nextPayload,
      }),
      authCarrier,
    );
    const { data, error } = await request;
    assertMutationAuthCarrier(authCarrier);
    if (error) throw error;
    return normalizeResponse(entityType, data);
  };

  try {
    return await savePayload(payload);
  } catch (error) {
    if (!isUnknownFieldKeyError(error)) throw error;

    assertMutationAuthCarrier(authCarrier);
    const serverFieldKeys = await fetchServerFieldKeys(entityType, authCarrier);
    assertMutationAuthCarrier(authCarrier);
    if (!serverFieldKeys.size) throw error;

    const retryPayload = payload.filter((field) => serverFieldKeys.has(field.field_key));
    return savePayload(retryPayload);
  }
}
