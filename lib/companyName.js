import { supabase } from './supabase';

export const COMPANY_NAME_MAX_LENGTH = 64;

export function normalizeCompanyName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function validateCompanyName(value, t) {
  const name = normalizeCompanyName(value);
  if (!name) return t('errors_companyName_required');
  if (name.length > COMPANY_NAME_MAX_LENGTH) return t('errors_companyName_tooLong');
  return null;
}

export async function isCompanyNameAvailable(name, excludeCompanyId = null) {
  const normalized = normalizeCompanyName(name);
  if (!normalized) return false;
  const { data, error } = await supabase.rpc('company_name_is_available', {
    p_name: normalized,
    p_exclude_company_id: excludeCompanyId || null,
  });
  if (error) throw error;
  return data === true;
}

