import { supabase } from '../lib/supabase'; // проверь путь к твоему клиенту Supabase

const VALID_ROLES = ['admin', 'dispatcher', 'worker'];

async function selectProfile(uid) {
  if (!uid) return { data: null, error: null };
  try {
    // Try both id and user_id. If user_id column is missing, fall back to id only.
    const { data, error } = await supabase
      .from('profiles')
      .select('id, user_id, email, role, full_name')
      .or(`id.eq.${uid},user_id.eq.${uid}`)
      .maybeSingle();

    if (error && (error.code === '42703' || /user_id/i.test(error.message || ''))) {
      return await supabase
        .from('profiles')
        .select('id, email, role, full_name')
        .eq('id', uid)
        .maybeSingle();
    }

    return { data, error };
  } catch (error) {
    return { data: null, error };
  }
}

async function ensureProfile(user) {
  // 1) Пытаемся прочитать профиль
  const { data: profile, error: selErr } = await selectProfile(user.id);

  if (selErr && selErr.code !== 'PGRST116') {
    // не "row not found"
    throw new Error(`profiles select failed: ${selErr.message}`);
  }

  // 2) Если профиля нет — создаём со стандартной ролью 'worker'
  if (!profile) {
    let insertPayload = {
      id: user.id,
      user_id: user.id,
      email: user.email ?? null,
      full_name: (user.user_metadata?.full_name || '').toString(),
      role: 'worker',
    };

    let inserted = null;
    let insErr = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await supabase
          .from('profiles')
          .insert(insertPayload, { defaultToNull: true })
          .select('id, role')
          .single();
        inserted = res.data;
        insErr = res.error;
      } catch (e) {
        insErr = e;
      }

      if (insErr && (insErr.code === '42703' || /user_id/i.test(insErr.message || ''))) {
        delete insertPayload.user_id;
        continue;
      }

      break;
    }

    if (insErr) throw new Error(`profiles insert failed: ${insErr.message || insErr}`);
    return inserted;
  }

  // 3) Если роль пустая/битая — чиним на 'worker'
  const role = typeof profile.role === 'string' ? profile.role : '';
  if (!VALID_ROLES.includes(role)) {
    let fixed = null;
    let updErr = null;
    try {
      const res = await supabase
        .from('profiles')
        .update({ role: 'worker' })
        .or(`id.eq.${user.id},user_id.eq.${user.id}`)
        .select('id, role')
        .single();
      fixed = res.data;
      updErr = res.error;
      if (updErr && (updErr.code === '42703' || /user_id/i.test(updErr.message || ''))) {
        const resFallback = await supabase
          .from('profiles')
          .update({ role: 'worker' })
          .eq('id', user.id)
          .select('id, role')
          .single();
        fixed = resFallback.data;
        updErr = resFallback.error;
      }
    } catch (e) {
      updErr = e;
    }

    if (updErr) throw new Error(`profiles role fix failed: ${updErr.message || updErr}`);
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
