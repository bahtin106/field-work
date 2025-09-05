import { supabase } from '../lib/supabase'; // проверь путь к твоему клиенту Supabase

const VALID_ROLES = ['admin', 'dispatcher', 'worker'];

async function ensureProfile(user) {
  // 1) Пытаемся прочитать профиль
  const { data: profile, error: selErr } = await supabase
    .from('profiles')
    .select('id, email, role, full_name')
    .eq('id', user.id)
    .maybeSingle();

  if (selErr && selErr.code !== 'PGRST116') {
    // не "row not found"
    throw new Error(`profiles select failed: ${selErr.message}`);
  }

  // 2) Если профиля нет — создаём со стандартной ролью 'worker'
  if (!profile) {
    const insertPayload = {
      id: user.id,
      email: user.email ?? null,
      full_name: (user.user_metadata?.full_name || '').toString(),
      role: 'worker',
    };
    const { data: inserted, error: insErr } = await supabase
      .from('profiles')
      .insert(insertPayload)
      .select('id, role')
      .single();
    if (insErr) throw new Error(`profiles insert failed: ${insErr.message}`);
    return inserted;
  }

  // 3) Если роль пустая/битая — чиним на 'worker'
  const role = typeof profile.role === 'string' ? profile.role : '';
  if (!VALID_ROLES.includes(role)) {
    const { data: fixed, error: updErr } = await supabase
      .from('profiles')
      .update({ role: 'worker' })
      .eq('id', user.id)
      .select('id, role')
      .single();
    if (updErr) throw new Error(`profiles role fix failed: ${updErr.message}`);
    return fixed;
  }

  return profile;
}

/**
 * Возвращает одну из: 'admin' | 'dispatcher' | 'worker' | null (если не залогинен)
 * Бросает исключение, если Supabase вернул ошибку.
 */
export async function getUserRole() {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(`auth.getUser failed: ${authErr.message}`);
  if (!auth?.user) return null;

  const profile = await ensureProfile(auth.user);
  return profile.role;
}

/**
 * Подписка на изменения сессии: при логине/логауте перезапрашивает роль.
 * Пример:
 *   const unsub = subscribeAuthRole(async (role) => setRole(role));
 *   // ... on unmount: unsub()
 */
export function subscribeAuthRole(callback) {
  const { data: sub } = supabase.auth.onAuthStateChange(async () => {
    try {
      const role = await getUserRole();
      callback(role);
    } catch (e) {
      console.warn('subscribeAuthRole:', e?.message || e);
      callback(null);
    }
  });
  return () => sub.subscription.unsubscribe();
}
