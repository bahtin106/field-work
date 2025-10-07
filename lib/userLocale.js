// lib/userLocale.js
import { supabase } from '../lib/supabase';

// Читает preferred locale из таблицы profiles.locale текущего пользователя
export async function loadUserLocale() {
  const { data: { user }, error: uerr } = await supabase.auth.getUser();
  if (uerr || !user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('locale')
    .eq('id', user.id)
    .maybeSingle();

  if (error) throw error;
  return data?.locale || null;
}

// Сохраняет preferred locale в profiles.locale текущего пользователя
export async function saveUserLocale(localeCode) {
  const { data: { user }, error: uerr } = await supabase.auth.getUser();
  if (uerr || !user) return false;

  const { error } = await supabase
    .from('profiles')
    .update({ locale: localeCode })
    .eq('id', user.id);

  if (error) throw error;
  return true;
}
