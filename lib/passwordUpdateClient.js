import { EMAIL_SERVICE_URL, supabase } from './supabase';

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

  const response = await fetch(`${EMAIL_SERVICE_URL}/api/update-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: resolvedUserId,
      password: resolvedPassword,
      changed_by: resolvedChangedBy || resolvedUserId,
    }),
  });

  const rawText = await response.text();
  let parsed = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    throw new Error(
      parsed?.message ||
        parsed?.error ||
        rawText ||
        `Password update failed: HTTP ${response.status}`,
    );
  }

  if (parsed?.ok === false || parsed?.success === false) {
    throw new Error(parsed?.message || parsed?.error || 'Password update failed');
  }

  return parsed || { ok: true };
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
