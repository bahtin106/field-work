import { FUNCTIONS } from './constants';
import { supabase } from './supabase';

export async function updatePasswordViaBackend({ userId, password, changedBy }) {
  const resolvedUserId = String(userId || '').trim();
  const resolvedPassword = String(password || '');
  const resolvedChangedBy = String(changedBy || resolvedUserId || '').trim();

  if (!resolvedUserId) {
    throw new Error('user_id is required');
  }

  if (!resolvedPassword) {
    throw new Error('password is required');
  }

  const { data, error } = await supabase.functions.invoke(FUNCTIONS.UPDATE_USER, {
    body: {
      user_id: resolvedUserId,
      password: resolvedPassword,
      changed_by: resolvedChangedBy || resolvedUserId,
    },
  });

  if (error) {
    throw error;
  }

  if (data?.ok === false || data?.success === false) {
    throw new Error(data?.message || data?.error || 'Password update failed');
  }

  return data || { ok: true };
}

export async function updateCurrentUserPasswordViaBackend(password) {
  const resolvedPassword = String(password || '');
  if (!resolvedPassword) {
    throw new Error('password is required');
  }

  const { data, error } = await supabase.auth.updateUser({
    password: resolvedPassword,
  });

  if (error) {
    throw error;
  }

  return data;
}
