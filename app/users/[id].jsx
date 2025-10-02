import React, { useCallback, useEffect, useMemo, useState, useLayoutEffect } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View, Pressable, Linking, Platform } from 'react-native';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import Screen from '../../components/layout/Screen';
import { useTheme } from '../../theme/ThemeProvider';
import { supabase } from '../../lib/supabase';
import { Feather } from '@expo/vector-icons';
import { normalizeRu, formatRuMask, toE164 } from '../../components/ui/phone';
import IconButton from '../../components/ui/IconButton';
import * as Clipboard from 'expo-clipboard';
import { useToast } from '../../components/ui/ToastProvider';

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

const ROLE_LABELS = { admin: 'Администратор', dispatcher: 'Диспетчер', worker: 'Рабочий' };

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
  const roleLabel = ROLE_LABELS[role] || 'Рабочий';

  // Title: show user's full name
  useLayoutEffect(() => { navigation.setOptions({ title: 'Просмотр профиля', headerTitle: 'Просмотр профиля' }); }, [navigation]);
// Also set title in params so AppHeader picks it
  useEffect(() => { navigation.setParams({ title: 'Просмотр профиля' }); }, [navigation]);
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

    }
  catch (e) {
    const msg = e?.message || 'Не удалось загрузить пользователя';
    setErr(msg);
    try { toast.error(msg); } catch {}
  }
  finally {
      setLoading(false);
    }
  }, [userId]);

  // Header button (Edit): admin can edit anyone; worker/dispatcher can edit ONLY self
  useEffect(() => {
    const canEdit = meIsAdmin || (myUid && myUid === userId);
    if (canEdit) {
      navigation.setParams({
  editLabel: 'Изменить',
  onEditPress: () => router.push(`/users/${userId}/edit`),
  headerButtonLabel: null,
  headerButtonTo: null,
});
    } else {
      navigation.setParams({
        editLabel: null,
        onEditPress: null,
        headerButtonLabel: null,
        headerButtonTo: null,
      });
    }
  }, [navigation, userId, meIsAdmin, myUid]);
  // Copy helpers
  const onCopyEmail = React.useCallback(async () => {
  if (!email) return false;
  const text = String(email);
  try {
    await Clipboard.setStringAsync(text);
    try { toast.success('E-mail скопирован'); } catch {}
    return true;
  } catch {
    if (Platform.OS === 'web' && globalThis?.navigator?.clipboard?.writeText) {
      try {
        await globalThis.navigator.clipboard.writeText(text);
        try { toast.success('E-mail скопирован'); } catch {}
        return true;
      } catch {}
    }
    try { toast.error('Не удалось скопировать e-mail'); } catch {}
    return false;
  }
}, [email, toast]);

  const onCopyPhone = React.useCallback(async () => {
  if (!phone) return false;
  const text = toE164(phone) || ('+' + normalizeRu(phone));
  try {
    await Clipboard.setStringAsync(text);
    try { toast.success('Телефон скопирован'); } catch {}
    return true;
  } catch {
    if (Platform.OS === 'web' && globalThis?.navigator?.clipboard?.writeText) {
      try {
        await globalThis.navigator.clipboard.writeText(text);
        try { toast.success('Телефон скопирован'); } catch {}
        return true;
      } catch {}
    }
    try { toast.error('Не удалось скопировать телефон'); } catch {}
    return false;
  }
}, [phone, toast]);

// Refetch when screen regains focus (after editing)
  useFocusEffect(
    React.useCallback(() => {
      fetchUser();
      return undefined;
    }, [fetchUser])
  );

  const initials = `${(firstName || '').trim().slice(0,1)}${(lastName || '').trim().slice(0,1)}`.toUpperCase();
  const statusColor = isSuspended ? theme.colors.danger : theme.colors.success;

  if (loading) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
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
      <ScrollView contentContainerStyle={s.contentWrap} keyboardShouldPersistTaps="handled">
        {/* Top avatar on background */}
        <View style={s.avatarContainer}>
          <View style={s.avatarXl}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={s.avatarImg} />
            ) : (
              <Text style={s.avatarTextXl}>{initials || '•'}</Text>
            )}
          </View>
        </View>

        
        
        <Text style={s.sectionTitle}>Личные данные</Text>
        <View style={s.card}>
          <View style={s.row}>
            <Text style={s.rowLabel}>Имя</Text>
            <View style={s.rowRight}>
              <Text style={s.rowValue}>{(firstName || lastName) ? (`${firstName || ''} ${lastName || ''}`).trim() : '—'}</Text>
            </View>
          </View>
          <View style={s.sep} />
          <View style={s.row}>
            <Text style={s.rowLabel}>E‑mail</Text>
            <View style={s.rowRight}>
              {email ? (
                <Pressable accessibilityRole="link" onPress={async () => {
  const url = `mailto:${email}`;
  try {
    const ok = await Linking.canOpenURL(url);
    if (ok) await Linking.openURL(url);
    else toast.error('Невозможно открыть почтовый клиент');
  } catch {
    toast.error('Невозможно открыть почтовый клиент');
  }
}}>
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
                <Pressable accessibilityRole="link" onPress={async () => {
  const url = `tel:${toE164(phone) || ('+' + normalizeRu(phone))}`;
  try {
    const ok = await Linking.canOpenURL(url);
    if (ok) await Linking.openURL(url);
    else toast.error('Звонки недоступны на этом устройстве');
  } catch {
    toast.error('Звонки недоступны на этом устройстве');
  }
}}>
  <Text style={[s.rowValue, s.link]}>{formatRuMask(phone)}</Text>
                </Pressable>
              ) : (
                <Text style={s.rowValue}>—</Text>
              )}
              {phone ? (
                <IconButton onPress={onCopyPhone} accessibilityLabel='Скопировать телефон'><Feather name='copy' size={16} /></IconButton>
              ) : null}
            </View>
          </View>
          
          <View style={s.sep} />
          <View style={s.row}>
            <Text style={s.rowLabel}>Дата рождения</Text>
            <View style={s.rowRight}>
              <Text style={s.rowValue}>{birthdate ? birthdate.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'}</Text>
            </View>
          </View>
</View>

<Text style={s.sectionTitle}>Роль в компании</Text>
        <View style={s.card}>
          <View style={s.row}>
            <Text style={s.rowLabel}>Отдел</Text>
            <View style={s.rowRight}>
              <Text style={s.rowValue}>{departmentName || '—'}</Text>
            </View>
          </View>
          <View style={s.sep} />
          <View style={s.row}>
            <Text style={s.rowLabel}>Роль</Text>
            <View style={s.rowRight}>
              <Text style={s.rowValue}>{roleLabel}</Text>
            </View>
          </View>
          <View style={s.sep} />
          <View style={s.row}>
            <Text style={s.rowLabel}>Статус</Text>
            <View style={s.rowRight}>
              <Text style={[s.rowValue, { color: statusColor }]}>{isSuspended ? 'Отстранён' : 'Активен'}</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = (t) => StyleSheet.create({
  contentWrap: { padding: t.spacing.lg, paddingBottom: t.spacing.xl },
  card: {
    backgroundColor: t.colors.surface,
    borderRadius: t.radii.md,
    borderWidth: t.components.card.borderWidth,
    borderColor: t.colors.border,
    paddingHorizontal: t.spacing[t.components.card.padX || 'md'],
    paddingVertical:   0,
    marginBottom: t.spacing.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md },
  avatar: {
    width: t.components.avatar.md, height: t.components.avatar.md, borderRadius: t.components.avatar.md / 2,
    backgroundColor: withAlpha(t.colors.primary, 0.12),
    alignItems: 'center', justifyContent: 'center',
    borderWidth: t.components.avatar.border, borderColor: withAlpha(t.colors.primary, 0.24),
    overflow: 'hidden',
  },
  avatarLg: {
    width: t.components.avatar.lg, height: t.components.avatar.lg, borderRadius: t.components.avatar.lg / 2,
    backgroundColor: withAlpha(t.colors.primary, 0.12),
    alignItems: 'center', justifyContent: 'center',
    borderWidth: t.components.avatar.border, borderColor: withAlpha(t.colors.primary, 0.24),
    overflow: 'hidden',
  },
  avatarXl: {
    width: t.components.avatar.xl, height: t.components.avatar.xl, borderRadius: t.components.avatar.xl / 2,
    backgroundColor: withAlpha(t.colors.primary, 0.12),
    alignItems: 'center', justifyContent: 'center',
    borderWidth: t.components.avatar.border, borderColor: withAlpha(t.colors.primary, 0.24),
    overflow: 'hidden',
  },
  avatarContainer: { alignItems: 'center', marginBottom: t.spacing.xl },
  avatarTextXl: { fontSize: Math.round(t.components.avatar.xl * 0.33), color: t.colors.primary, fontWeight: '700' },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { color: t.colors.primary, fontWeight: '700' },
  nameTitle: { fontSize: t.typography.sizes.md, fontWeight: '600', color: t.colors.text },
  pillsRow: { flexDirection: 'row', gap: t.spacing.sm, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' },
  pill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: t.radii.md, borderWidth: 1 },
  pillText: { fontSize: t.typography.sizes.xs, fontWeight: '600' },
  section: { marginBottom: t.spacing.sm, fontWeight: '600', color: t.colors.text },
  sectionTitle: {
    fontWeight: '700',
    marginBottom: t.spacing[t.components.sectionTitle.mb],
    marginLeft: t.spacing[t.components.sectionTitle.ml],
    color: t.colors.text
  },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: t.spacing[t.components.row.gapX] },
  link: { color: t.colors.primary },
  row: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: t.components.row.minHeight,
  paddingVertical: t.components.row.py ? t.spacing[t.components.row.py] : 0,
},
  rowLabel: { color: t.colors.textSecondary },
  rowValue: { color: t.colors.text, fontWeight: '500' },
  sep: { height: t.components.listItem.dividerWidth, backgroundColor: t.colors.border },
});

