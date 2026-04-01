import { supabase } from './supabase';

export const COMPANY_SETTINGS_QUERY_KEY = ['companySettings'];

const EXTENDED_SELECT =
  'name, timezone, use_departments, use_work_types, worker_phone_mode, worker_phone_window_before_mins, worker_phone_window_after_mins, currency, currency_rate, currency_rate_updated_at, recalc_in_progress, media_provider, profile_media_provider, enable_client_tags, enable_object_tags';
const LEGACY_SELECT =
  'name, timezone, use_departments, use_work_types, worker_phone_mode, worker_phone_window_before_mins, worker_phone_window_after_mins, media_provider, profile_media_provider';

let preferLegacySelect = false;

function isSchemaMismatchError(error) {
  const code = String(error?.code || '').trim().toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  const hint = String(error?.hint || '').toLowerCase();
  if (code === '42703' || code === 'PGRST204') return true;
  const text = `${message} ${details} ${hint}`;
  return text.includes('column') && text.includes('does not exist');
}

async function selectCompanySettings(companyId, selectClause) {
  const { data, error } = await supabase
    .from('companies')
    .select(selectClause)
    .eq('id', companyId)
    .single();
  if (error) throw error;
  return data || null;
}

export async function fetchCompanySettingsByCompanyId(companyId) {
  if (!companyId) return null;
  if (preferLegacySelect) {
    return selectCompanySettings(companyId, LEGACY_SELECT);
  }

  try {
    return await selectCompanySettings(companyId, EXTENDED_SELECT);
  } catch (error) {
    if (!isSchemaMismatchError(error)) throw error;
    preferLegacySelect = true;
    return selectCompanySettings(companyId, LEGACY_SELECT);
  }
}
