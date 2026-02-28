import { supabase } from './supabase';

export const COMPANY_SETTINGS_QUERY_KEY = ['companySettings'];

const EXTENDED_SELECT =
  'name, timezone, use_departure_time, use_departments, use_work_types, worker_phone_mode, worker_phone_window_before_mins, worker_phone_window_after_mins, currency, currency_rate, currency_rate_updated_at, recalc_in_progress, media_provider, profile_media_provider';
const LEGACY_SELECT =
  'name, timezone, use_departure_time, use_departments, use_work_types, worker_phone_mode, worker_phone_window_before_mins, worker_phone_window_after_mins, media_provider, profile_media_provider';

export async function fetchCompanySettingsByCompanyId(companyId) {
  if (!companyId) return null;
  try {
    const { data, error } = await supabase
      .from('companies')
      .select(EXTENDED_SELECT)
      .eq('id', companyId)
      .single();
    if (error) throw error;
    return data || null;
  } catch {
    const { data, error } = await supabase
      .from('companies')
      .select(LEGACY_SELECT)
      .eq('id', companyId)
      .single();
    if (error) throw error;
    return data || null;
  }
}
