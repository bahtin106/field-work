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
  const payload = (Array.isArray(fields) ? fields : []).map((field) => ({
    field_key: String(field.fieldKey || field.field_key || ''),
    is_enabled: field.isEnabled !== false,
    is_required: field.isRequired === true,
  }));

  const { data, error } = await supabase.rpc('save_company_entity_field_settings', {
    p_entity_type: String(entityType || ''),
    p_expected_version: expectedVersion || null,
    p_fields: payload,
  });
  if (error) throw error;
  return normalizeResponse(entityType, data);
}
