import { supabase } from '../lib/supabase';

const VALID_ROLES = ['admin', 'dispatcher', 'worker'];

async function selectProfile(uid) {
  if (!uid) return { data: null, error: null };
  try {
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
  const { data: profile, error: selErr } = await selectProfile(user.id);

  if (selErr && selErr.code !== 'PGRST116') {
    throw new Error(`profiles select failed: ${selErr.message}`);
  }

  if (!profile) {
    const { error: rpcErr } = await supabase.rpc('bootstrap_my_profile_from_auth');
    if (rpcErr) {
      throw new Error(`bootstrap_my_profile_from_auth failed: ${rpcErr.message}`);
    }

    const { data: reloaded, error: reloadErr } = await selectProfile(user.id);
    if (reloadErr) throw new Error(`profiles reselect failed: ${reloadErr.message}`);
    if (!reloaded) throw new Error('profile not found after bootstrap');
    return reloaded;
  }

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

export async function getUserRole() {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(`auth.getUser failed: ${authErr.message}`);
  if (!auth?.user) return null;

  const profile = await ensureProfile(auth.user);
  return profile.role;
}

export function subscribeAuthRole(callback) {
  const { data: sub } = supabase.auth.onAuthStateChange(() => {
    setTimeout(async () => {
      try {
        const role = await getUserRole();
        callback(role);
      } catch (e) {
        console.warn('subscribeAuthRole:', e?.message || e);
        callback(null);
      }
    }, 0);
  });
  return () => sub.subscription.unsubscribe();
}
