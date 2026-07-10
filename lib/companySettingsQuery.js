import { supabase } from './supabase';

export const COMPANY_SETTINGS_QUERY_KEY = ['companySettings'];
export const COMPANY_SETTINGS_UPDATED_EVENT = 'company-settings-updated';
export const COMPANY_SETTINGS_LIVE_REFETCH_MS = 4000;

const COMPANY_SETTINGS_CACHE_FIELDS = new Set([
  'name',
  'timezone',
  'use_departments',
  'use_work_types',
  'worker_phone_mode',
  'worker_phone_window_before_mins',
  'worker_phone_window_after_mins',
  'worker_phone_show_condition',
  'worker_phone_show_offset_mins',
  'worker_phone_show_status',
  'worker_phone_hide_condition',
  'worker_phone_hide_offset_mins',
  'worker_phone_hide_status',
  'currency',
  'currency_rate',
  'currency_rate_updated_at',
  'recalc_in_progress',
  'media_provider',
  'profile_media_provider',
  'enable_client_tags',
  'enable_object_tags',
  'feed_order_card_fields',
  'use_order_statuses',
  'feed_status_enabled',
]);

const EXTENDED_SELECT =
  'name, timezone, use_departments, use_work_types, worker_phone_mode, worker_phone_window_before_mins, worker_phone_window_after_mins, worker_phone_show_condition, worker_phone_show_offset_mins, worker_phone_hide_condition, worker_phone_hide_offset_mins, worker_phone_hide_status, currency, currency_rate, currency_rate_updated_at, recalc_in_progress, media_provider, profile_media_provider, enable_client_tags, enable_object_tags, use_order_statuses, feed_status_enabled';
const PREFERRED_SELECT =
  `${EXTENDED_SELECT}, feed_order_card_fields`;
const LEGACY_SELECT =
  'name, timezone, use_departments, use_work_types, worker_phone_mode, worker_phone_window_before_mins, worker_phone_window_after_mins, media_provider, profile_media_provider';

let preferLegacySelect = false;
let preferSelectWithoutFeedFields = false;

export function getCompanySettingsQueryKey(companyId) {
  return [...COMPANY_SETTINGS_QUERY_KEY, companyId || 'no-company'];
}

function pickCompanySettingsFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const patch = {};
  Object.keys(value).forEach((key) => {
    if (COMPANY_SETTINGS_CACHE_FIELDS.has(key)) {
      patch[key] = value[key];
    }
  });
  return Object.keys(patch).length ? patch : null;
}

export function applyCompanySettingsCachePatch(queryClient, companyId, value) {
  if (!queryClient || !companyId) return false;
  const patch = pickCompanySettingsFields(value);
  if (!patch) return false;
  queryClient.setQueryData(getCompanySettingsQueryKey(companyId), (prev) => ({
    ...(prev && typeof prev === 'object' ? prev : {}),
    ...patch,
  }));
  return true;
}

export async function broadcastCompanySettingsChanged(companyId, changedKeys = []) {
  const id = String(companyId || '').trim();
  if (!id) return false;
  const safeChangedKeys = Array.isArray(changedKeys)
    ? changedKeys.map((key) => String(key || '').trim()).filter(Boolean)
    : [];
  const channel = supabase.channel(`company-settings-${id}`);
  try {
    await channel.send({
      type: 'broadcast',
      event: COMPANY_SETTINGS_UPDATED_EVENT,
      payload: {
        companyId: id,
        changedKeys: safeChangedKeys,
        sentAt: Date.now(),
      },
    });
    return true;
  } catch {
    return false;
  } finally {
    try {
      supabase.removeChannel(channel);
    } catch {}
  }
}

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
  if (!preferSelectWithoutFeedFields) {
    try {
      return await selectCompanySettings(companyId, PREFERRED_SELECT);
    } catch (error) {
      if (!isSchemaMismatchError(error)) throw error;
      preferSelectWithoutFeedFields = true;
    }
  }

  try {
    return await selectCompanySettings(companyId, EXTENDED_SELECT);
  } catch (error) {
    if (!isSchemaMismatchError(error)) throw error;
    preferLegacySelect = true;
    return selectCompanySettings(companyId, LEGACY_SELECT);
  }
}
