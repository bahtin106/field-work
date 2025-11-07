// lib/supabaseHelpers.js
import { supabase } from './supabase';
import { TBL } from './constants';

/** Get current authenticated user's id or throw NO_AUTH */
export async function getUid() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) throw new Error('NO_AUTH');
  return data.user.id;
}

/** Upsert notification preferences for a user (by user_id). */
export async function upsertNotifPrefs(userId, prefs) {
  const { error } = await supabase
    .from('notification_prefs')
    .upsert({ user_id: userId, ...prefs }, { onConflict: 'user_id' });
  if (error) throw error;
  return true;
}

/** Load profile (role, company_id) by user id. */
export async function readProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('role, company_id')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/** Read app role permission value */
export async function readRolePerm(companyId, role, key) {
  const { data, error } = await supabase
    .from(TBL.APP_ROLE_PERMS)
    .select('value')
    .eq('company_id', companyId)
    .eq('role', role)
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

/** Save (upsert) Expo push token per user */
export async function savePushToken(userId, token, platform) {
  const { error } = await supabase
    .from('push_tokens')
    .upsert({ user_id: userId, token, platform }, { onConflict: 'user_id' });
  if (error) throw error;
  return true;
}

/** Delete push token by user */
export async function deletePushToken(userId) {
  const { error } = await supabase.from('push_tokens').delete().eq('user_id', userId);
  if (error) throw error;
  return true;
}
