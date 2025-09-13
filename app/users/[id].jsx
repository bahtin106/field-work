import React, { useCallback, useEffect, useMemo, useState, useLayoutEffect } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View, Pressable, Linking, Platform } from 'react-native';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import Screen from '../../components/layout/Screen';
import { useTheme } from '../../theme/ThemeProvider';
import { supabase } from '../../lib/supabase';
import { Feather } from '@expo/vector-icons';
import IconButton from '../../components/ui/IconButton';
import * as Clipboard from 'expo-clipboard';
import { useToast } from '../../components/ui/ToastProvider';

function formatPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  let d = digits;
  if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  if (d.length < 11) return '+' + (d || '');
  const p1 = d.slice(1,4), p2 = d.slice(4,7), p3 = d.slice(7,9), p4 = d.slice(9,11);
  return `+7 (${p1}) ${p2}-${p3}-${p4}`;
}
function onlyDigitsPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) return '7' + digits.slice(1);
  if (digits.length === 10) return '7' + digits;
  return digits;
}
function withAlpha(color, a) {
  if (typeof color === 'string') {
    const hex = color.match(/^#([0-9a-fA-F]{6})$/);
    if (hex) {
      const alpha = Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
      return color + alpha;
    }
    const rgb = color.match(/^rgb\\s*\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\)$/i);
    if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${a})`;
  }
  return `rgba(0,0,0,${a})`;
}

export default function UserView() {
  const { theme } = useTheme();
  const s = React.useMemo(() => styles(theme), [theme]);
  const toast = useToast();
  const { id } = useLocalSearchParams();
  const userId = Array.isArray(id) ? id[0] : id;
  const router = useRouter();
  const navigation = useNavigation();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [meIsAdmin, setMeIsAdmin] = useState(false);
  const [myUid, setMyUid] = useState(null);

  const [avatarUrl, setAvatarUrl] = useState(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [birthdate, setBirthdate] = useState(null);
  const [role, setRole] = useState('worker');
  const [departmentName, setDepartmentName] = useState(null);
  const [isSuspended, setIsSuspended] = useState(false);

  const headerName = useMemo(() => (`${firstName || ''} ${lastName || ''}`).replace(/\\s+/g, ' ').trim() || 'Без имени', [firstName, lastName]);
  const roleLabel = role === 'admin' ? 'Администратор' : role === 'dispatcher' ? 'Диспетчер' : 'Рабочий';

  // Title: show user's full name
  useLayoutEffect(() => { navigation.setOptions({ title: headerName, headerTitle: headerName }); }, [navigation, headerName]);
  // Also set title in params so AppHeader picks it
  useEffect(() => { navigation.setParams({ title: headerName }); }, [navigation, headerName]);

  // Determine current user and if admin
  const fetchMe = useCallback(async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id || null;
      setMyUid(uid);
      if (!uid) return setMeIsAdmin(false);
      const { data: me } = await supabase.from('profiles').select('role').eq('id', uid).single();
      setMeIsAdmin(me?.role === 'admin');
    } catch {
      setMeIsAdmin(false);
    }
  }, []);

  // Load viewed user's data
  const fetchUser = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      // Always know who is logged in for comparison
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id || null;
      const authEmail = auth?.user?.email || '';

      // Try to get extended data via RPC ONLY if admin (RLS-safe)
      let rpcRow = null;
      if (uid) {
        const { data: me } = await supabase.from('profiles').select('role').eq('id', uid).single();
        const iAmAdmin = me?.role === 'admin';
        if (iAmAdmin) {
          const { data: rpc } = await supabase.rpc('admin_get_profile_with_email', { target_user_id: userId });
          rpcRow = Array.isArray(rpc) ? rpc[0] : rpc;
        }
        setMeIsAdmin(iAmAdmin);
        setMyUid(uid);
      }

      // Base profile fields (including birthdate + role for non-admins)
      const { data: prof } = await supabase
        .from('profiles')
        .select('first_name, last_name, phone, avatar_url, department_id, is_suspended, suspended_at, birthdate, role')
        .eq('id', userId)
        .maybeSingle();

      if (prof) {
        setFirstName(prof.first_name || '');
        setLastName(prof.last_name || '');
        setAvatarUrl(prof.avatar_url || null);
        setPhone(String(prof.phone || ''));
        setIsSuspended(!!(prof?.is_suspended || prof?.suspended_at));
        setRole(prof.role || rpcRow?.user_role || 'worker');

        // birthdate: prefer profiles (RLS allows self), fallback to RPC for admins
        const bd = prof?.birthdate ?? rpcRow?.birthdate ?? null;
        if (bd) {
          const d = new Date(bd);
          setBirthdate(!isNaN(d.getTime()) ? d : null);
        } else setBirthdate(null);

        const depId = prof?.department_id ?? null;
        if (depId) {
          const { data: d } = await supabase.from('departments').select('name').eq('id', depId).maybeSingle();
          setDepartmentName(d?.name || null);
        } else {
          setDepartmentName(null);
        }
      }

      // email logic:
      // - admin sees email of any user via RPC
      // - non-admin sees email only for own profile from auth
      if (rpcRow?.email) {
        setEmail(rpcRow.email);
      } else if (uid && userId === uid && authEmail) {
        setEmail(authEmail);
      } else {
        setEmail('');
      }

    } catch (e) {
      setErr(e?.message || 'Не удалось загрузить пользователя');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Header button (Edit): admin can edit anyone; worker/dispatcher can edit ONLY self
  useEffect(() => {
    const canEdit = meIsAdmin || (myUid && myUid === userId);
    if (canEdit) {
      navigation.setParams({ headerButtonLabel: 'Изменить', headerButtonTo: `/users/${userId}/edit` });
    } else {
      navigation.setParams({ headerButtonLabel: null, headerButtonTo: null });
    }
  }, [navigation, userId, meIsAdmin, myUid]);

  // Copy helpers
  const onCopyEmail = React.useCallback(async () => {
    if (!email) return;
    const text = String(email);
    let ok = true;
    try {
      await Clipboard.setStringAsync(text);
      const check = await Clipboard.getStringAsync();
      if (check !== text) ok = false;
    } catch (e) {
      ok = false;
    }
    if (!ok && Platform.OS === 'web' && globalThis?.navigator?.clipboard?.writeText) {
      try {
        await globalThis.navigator.clipboard.writeText(text);
        ok = true;
      } catch (e) {}
    }
    return ok;
  }, [email]);

  const onCopyPhone = React.useCallback(async () => {
    if (!phone) return;
    const text = '+' + onlyDigitsPhone(phone);  // всегда с "+"
    let ok = true;
    try {
      await Clipboard.setStringAsync(text);
      const check = await Clipboard.getStringAsync();
      if (check !== text) ok = false;
    } catch (e) {
      ok = false;
    }
    if (!ok && Platform.OS === 'web' && globalThis?.navigator?.clipboard?.writeText) {
      try {
        await globalThis.navigator.clipboard.writeText(text);
        ok = true;
      } catch (e) {}
    }
    return ok;
  }, [phone]);

  useEffect(() => {
    fetchMe();
    fetchUser();
  }, [fetchMe, fetchUser]);

  const initials = `${(firstName || '').trim().slice(0,1)}${(lastName || '').trim().slice(0,1)}`.toUpperCase();
  const statusColor = isSuspended ? theme.colors.danger : theme.colors.success;

  if (loading) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" />
        </View>
      </Screen>
    );
  }
  if (err) {
    return (
      <Screen>
        <View style={{ padding: 16 }}>
          <Text style={{ color: theme.colors.danger }}>{err}</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* Top avatar on background */}
        <View style={{ alignItems: 'center', marginBottom: 24 }}>
          <View style={s.avatarXl}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={s.avatarImg} />
            ) : (
              <Text style={s.avatarTextXl}>{initials || '•'}</Text>
            )}
          </View>
        </View>

        <Text style={s.sectionTitle}>Контакты</Text>
        <View style={s.card}>
          <View style={s.row}>
            <Text style={s.rowLabel}>E‑mail</Text>
            <View style={s.rowRight}>
              {email ? (
                <Pressable onPress={() => Linking.openURL(`mailto:${email}`)}>
                  <Text style={[s.rowValue, s.link]}>{email}</Text>
                </Pressable>
              ) : (
                <Text style={s.rowValue}>—</Text>
              )}
              {email ? (
                <IconButton onPress={onCopyEmail} accessibilityLabel='Скопировать e‑mail'><Feather name='copy' size={16} /></IconButton>
              ) : null}
            </View>
          </View>
          <View style={s.sep} />
          <View style={s.row}>
            <Text style={s.rowLabel}>Телефон</Text>
            <View style={s.rowRight}>
              {phone ? (
                <Pressable onPress={() => Linking.openURL(`tel:+${onlyDigitsPhone(phone)}`)}>
                  <Text style={[s.rowValue, s.link]}>{formatPhone(phone)}</Text>
                </Pressable>
              ) : (
                <Text style={s.rowValue}>—</Text>
              )}
              {phone ? (
                <IconButton onPress={onCopyPhone} accessibilityLabel='Скопировать телефон'><Feather name='copy' size={16} /></IconButton>
              ) : null}
            </View>
          </View>
        </View>

        <Text style={s.sectionTitle}>Профиль</Text>
        <View style={s.card}>
          <View style={s.row}><Text style={s.rowLabel}>Отдел</Text><Text style={s.rowValue}>{departmentName || '—'}</Text></View>
          <View style={s.sep} />
          <View style={s.row}><Text style={s.rowLabel}>Дата рождения</Text><Text style={s.rowValue}>{birthdate ? birthdate.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'}</Text></View>
          <View style={s.sep} />
          <View style={s.row}><Text style={s.rowLabel}>Роль</Text><Text style={s.rowValue}>{roleLabel}</Text></View>
          <View style={s.sep} />
          <View style={s.row}><Text style={s.rowLabel}>Статус</Text><Text style={[s.rowValue, { color: statusColor }]}>{isSuspended ? 'Отстранён' : 'Активен'}</Text></View>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = (t) => StyleSheet.create({
  card: { backgroundColor: t.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: t.colors.border, padding: 12, marginBottom: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: withAlpha(t.colors.primary, 0.12),
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: withAlpha(t.colors.primary, 0.24),
    overflow: 'hidden',
  },
  avatarLg: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: withAlpha(t.colors.primary, 0.12),
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: withAlpha(t.colors.primary, 0.24),
    overflow: 'hidden',
  },
  avatarXl: {
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: withAlpha(t.colors.primary, 0.12),
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: withAlpha(t.colors.primary, 0.24),
    overflow: 'hidden',
  },
  avatarTextXl: { fontSize: 40, color: t.colors.primary, fontWeight: '700' },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { color: t.colors.primary, fontWeight: '700' },
  nameTitle: { fontSize: 16, fontWeight: '600', color: t.colors.text },
  pillsRow: { flexDirection: 'row', gap: 8, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' },
  pill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1 },
  pillText: { fontSize: 12, fontWeight: '600' },
  section: { marginBottom: 8, fontWeight: '600', color: t.colors.text },
  sectionTitle: { fontWeight: '700', marginBottom: 8, marginLeft: 6, color: t.colors.text },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  link: { color: t.colors.primary },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  rowLabel: { color: t.colors.textSecondary },
  rowValue: { color: t.colors.text, fontWeight: '500' },
  sep: { height: 1, backgroundColor: t.colors.border },
});
