import { supabase } from '../../../lib/supabase';
import {
  buildFallbackEntityFieldSettings,
  getEntityFieldCatalog,
  normalizeEntityField,
} from './catalog';

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

async function fetchServerFieldKeys(entityType) {
  const { data, error } = await supabase.rpc('get_company_entity_field_settings', {
    p_entity_type: String(entityType || ''),
  });
  if (error) throw error;
  const keys = new Set();
  const rows = Array.isArray(data?.fields) ? data.fields : [];
  rows.forEach((row) => {
    const fieldKey = String(row?.field_key || row?.fieldKey || '').trim();
    if (fieldKey) keys.add(fieldKey);
  });
  return keys;
}

export async function listEntityFieldSettings(entityType) {
  const fallback = buildFallbackEntityFieldSettings(entityType);

  try {
    const { data, error } = await supabase.rpc('get_company_entity_field_settings', {
      p_entity_type: String(entityType || ''),
    });
    if (error) throw error;
    return normalizeResponse(entityType, data);
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    const missingRpc =
      message.includes('function') && (message.includes('does not exist') || message.includes('not found'));
    if (!missingRpc) {
      fallback.errorMessage = String(error?.message || '').trim() || null;
    }
    return fallback;
  }
}

export async function saveEntityFieldSettings({ entityType, fields, expectedVersion = null }) {
  const validFieldKeys = new Set(
    getEntityFieldCatalog(entityType)
      .map((field) => String(field?.fieldKey || '').trim())
      .filter(Boolean),
  );

  const payload = (Array.isArray(fields) ? fields : [])
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
    const { data, error } = await supabase.rpc('save_company_entity_field_settings', {
      p_entity_type: String(entityType || ''),
      p_expected_version: expectedVersion || null,
      p_fields: nextPayload,
    });
    if (error) throw error;
    return normalizeResponse(entityType, data);
  };

  try {
    return await savePayload(payload);
  } catch (error) {
    if (!isUnknownFieldKeyError(error)) throw error;

    const serverFieldKeys = await fetchServerFieldKeys(entityType);
    if (!serverFieldKeys.size) throw error;

    const retryPayload = payload.filter((field) => serverFieldKeys.has(field.field_key));
    return savePayload(retryPayload);
  }
}
