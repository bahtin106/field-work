// lib/userLocale.js
import { supabase } from '../lib/supabase';
import { withReadDeadline } from '../src/shared/network/readDeadline';

// Читает preferred locale из таблицы profiles.locale текущего пользователя
export async function loadUserLocale(options = {}) {
  const signal = options?.signal;
  let userId = String(options?.userId || '').trim();

  if (!userId) {
    const {
      data: { user },
      error: uerr,
    } = await withReadDeadline(supabase.auth.getUser(), {
      label: 'Locale auth user',
      signal,
    });
    if (uerr || !user) return null;
    userId = String(user.id || '').trim();
  }
  if (!userId) return null;

  const { data, error } = await withReadDeadline(
    (readSignal) =>
      supabase
        .from('profiles')
        .select('locale')
        .eq('id', userId)
        .maybeSingle()
        .abortSignal(readSignal),
    { label: 'User locale', signal },
  );

  if (error) throw error;
  return data?.locale || null;
}

// Сохраняет preferred locale в profiles.locale текущего пользователя
export async function saveUserLocale(localeCode) {
  const {
    data: { user },
    error: uerr,
  } = await supabase.auth.getUser();
  if (uerr || !user) return false;

  const { error } = await supabase
    .from('profiles')
    .update({ locale: localeCode })
    .eq('id', user.id);

  if (error) throw error;
  return true;
}
