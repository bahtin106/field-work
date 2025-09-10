import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import Screen from '../../components/layout/Screen';
import { useTheme } from '../../theme/ThemeProvider';
import { supabase } from '../../lib/supabase';

function withAlpha(color, a) {
  if (typeof color === 'string') {
    const hex = color.match(/^#([0-9a-fA-F]{6})$/);
    if (hex) {
      const alpha = Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
      return color + alpha;
    }
    const rgb = color.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
    if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${a})`;
  }
  return `rgba(0,0,0,${a})`;
}

export default function UserView() {
  const { theme } = useTheme();
  const s = React.useMemo(() => styles(theme), [theme]);
  const { id } = useLocalSearchParams();
  const userId = Array.isArray(id) ? id[0] : id;
  const router = useRouter();
  const navigation = useNavigation();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [meIsAdmin, setMeIsAdmin] = useState(false);

  const [avatarUrl, setAvatarUrl] = useState(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [birthdate, setBirthdate] = useState(null);
  const [role, setRole] = useState('worker');
  const [departmentName, setDepartmentName] = useState(null);
  const headerName = useMemo(() => (`${firstName || ''} ${lastName || ''}`).replace(/\s+/g, ' ').trim() || 'Без имени', [firstName, lastName]);

  // Header config: title + neat "Edit" button (Apple-like: blue text, no bg)
  useEffect(() => {
    if (meIsAdmin) {
      navigation.setParams({ headerButtonLabel: 'Изменить', headerButtonTo: `/users/${userId}/edit` });
    } else {
      navigation.setParams({ headerButtonLabel: null, headerButtonTo: null });
    }
  }, [navigation, userId, meIsAdmin]);

  const fetchMe = useCallback(async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) return setMeIsAdmin(false);
      const { data: me } = await supabase.from('profiles').select('role').eq('id', uid).single();
      setMeIsAdmin(me?.role === 'admin');
    } catch { setMeIsAdmin(false); }
  }, []);

  const fetchUser = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const { data: rpc } = await supabase.rpc('admin_get_profile_with_email', { target_user_id: userId });
      const row = Array.isArray(rpc) ? rpc[0] : rpc;
      setEmail(row?.email || '');
      setRole(row?.user_role || 'worker');
      if (row?.birthdate) {
        const d = new Date(row.birthdate);
        setBirthdate(!isNaN(d.getTime()) ? d : null);
      } else setBirthdate(null);

      const { data: prof } = await supabase
        .from('profiles')
        .select('first_name, last_name, phone, avatar_url, department_id, is_suspended, suspended_at')
        .eq('id', userId)
        .maybeSingle();
      if (prof) {
        setFirstName(prof.first_name || '');
        setLastName(prof.last_name || '');
        setAvatarUrl(prof.avatar_url || null);
        setPhone(String(prof.phone || ''));
        const depId = prof?.department_id ?? null;
        if (depId) {
          const { data: d } = await supabase.from('departments').select('name').eq('id', depId).maybeSingle();
          setDepartmentName(d?.name || null);
        } else {
          setDepartmentName(null);
        }
      }
    } catch (e) {
      setErr(e?.message || 'Не удалось загрузить пользователя');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchMe();
    fetchUser();
  }, [fetchMe, fetchUser]);

  const initials = `${(firstName || '').trim().slice(0,1)}${(lastName || '').trim().slice(0,1)}`.toUpperCase();

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
        <View style={[s.card, { padding: 12 }]}>
          <View style={s.headerRow}>
            <View style={s.avatar}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={s.avatarImg} />
              ) : (
                <Text style={s.avatarText}>{initials || '•'}</Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.nameTitle}>{headerName}</Text>
              <View style={s.pillsRow}>
                <View style={[s.pill, { borderColor: withAlpha(theme.colors.success, 0.2), backgroundColor: withAlpha(theme.colors.success, 0.13) }]}>
                  <Text style={[s.pillText, { color: theme.colors.success }]}>Активен</Text>
                </View>
                <View style={[s.pill, { borderColor: withAlpha(theme.colors.primary, 0.2), backgroundColor: withAlpha(theme.colors.primary, 0.13) }]}>
                  <Text style={[s.pillText, { color: theme.colors.primary }]}>
                    {role === 'admin' ? 'Администратор' : role === 'dispatcher' ? 'Диспетчер' : 'Рабочий'}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.section}>Контакты</Text>
          <View style={s.row}><Text style={s.rowLabel}>E‑mail</Text><Text style={s.rowValue}>{email || '—'}</Text></View>
          <View style={s.sep} />
          <View style={s.row}><Text style={s.rowLabel}>Телефон</Text><Text style={s.rowValue}>{phone ? ('+' + String(phone).replace(/^(\+?)/,'').replace(/^7?/, '7')) : '—'}</Text></View>
        </View>

        <View style={s.card}>
          <Text style={s.section}>Профиль</Text>
          <View style={s.row}><Text style={s.rowLabel}>Отдел</Text><Text style={s.rowValue}>{departmentName || '—'}</Text></View>
          <View style={s.sep} />
          <View style={s.row}><Text style={s.rowLabel}>Дата рождения</Text><Text style={s.rowValue}>{birthdate ? birthdate.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'}</Text></View>
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
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { color: t.colors.primary, fontWeight: '700' },
  nameTitle: { fontSize: 16, fontWeight: '600', color: t.colors.text },
  pillsRow: { flexDirection: 'row', gap: 8, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' },
  pill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1 },
  pillText: { fontSize: 12, fontWeight: '600' },
  section: { marginBottom: 8, fontWeight: '600', color: t.colors.text },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  rowLabel: { color: t.colors.textSecondary },
  rowValue: { color: t.colors.text, fontWeight: '500' },
  sep: { height: 1, backgroundColor: t.colors.border },
});
