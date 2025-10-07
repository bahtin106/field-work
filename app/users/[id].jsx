// app/users/[id].jsx
import React, { useCallback, useEffect, useState, useLayoutEffect } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View, Pressable, Linking, Platform } from 'react-native';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import Screen from '../../components/layout/Screen';
import { useTheme, } from '../../theme';
import { supabase } from '../../lib/supabase';
import { Feather } from '@expo/vector-icons';
import { normalizeRu, formatRuMask, toE164 } from '../../components/ui/phone';
import { listItemStyles } from '../../components/ui/listItemStyles';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import IconButton from '../../components/ui/IconButton';
import * as Clipboard from 'expo-clipboard';
import { useToast } from '../../components/ui/ToastProvider';
import { getLocale,t as T,useI18nVersion } from '../../src/i18n';

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
  const base = React.useMemo(() => listItemStyles(theme), [theme]);
  const toast = useToast();
  const { id } = useLocalSearchParams();
  const userId = Array.isArray(id) ? id[0] : id;
  const router = useRouter();
  const navigation = useNavigation();

  // Предотвращаем setState после размонтирования (паттерн как в AppSettings)
  const mountedRef = React.useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const ver = useI18nVersion();
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
  const ROLE_LABELS = React.useMemo(() => ({ admin: T('role_admin','role_admin'), dispatcher: T('role_dispatcher','role_dispatcher'), worker: T('role_worker','role_worker') }), [ver]);

  const roleLabel = ROLE_LABELS[role] || T('role_worker','role_worker');

  useLayoutEffect(() => {
    const routeTitle = T('routes.users/[id]','routes.users/[id]');
    navigation.setOptions({ title: routeTitle, headerTitle: routeTitle });
  }, [navigation, ver]);

  // Also set title in params so AppHeader picks it
  useEffect(() => {
    const routeTitle = T('routes.users/[id]','routes.users/[id]');
    navigation.setParams({ title: routeTitle });
  }, [navigation, ver]);

  // Load viewed user's data
  const fetchUser = useCallback(async () => {
        // Guard: ensure route param exists
    if (!userId) {
      if (mountedRef.current) {
        setErr(T('errors_user_not_found','errors_user_not_found'));
        setLoading(false);
      }
      return;
    }
if (mountedRef.current) setLoading(true);
    if (mountedRef.current) setErr('');
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
        if (mountedRef.current) setMeIsAdmin(iAmAdmin);
        if (mountedRef.current) setMyUid(uid);
      }

      // Base profile fields (including birthdate + role for non-admins)
      const { data: prof } = await supabase
        .from('profiles')
        .select('first_name, last_name, phone, avatar_url, department_id, is_suspended, suspended_at, birthdate, role')
        .eq('id', userId)
        .maybeSingle();

      if (prof) {
        if (mountedRef.current) setFirstName(prof.first_name || '');
        if (mountedRef.current) setLastName(prof.last_name || '');
        if (mountedRef.current) setAvatarUrl(prof.avatar_url || null);
        if (mountedRef.current) setPhone(String(prof.phone || ''));
        if (mountedRef.current) setIsSuspended(!!(prof?.is_suspended || prof?.suspended_at));
        if (mountedRef.current) setRole(prof.role || rpcRow?.user_role || 'worker');

        // birthdate: prefer profiles (RLS allows self), fallback to RPC for admins
        const bd = prof?.birthdate ?? rpcRow?.birthdate ?? null;
        if (bd) {
          const d = new Date(bd);
          if (mountedRef.current) setBirthdate(!isNaN(d.getTime()) ? d : null);
        } else if (mountedRef.current) {
          setBirthdate(null);
        }

        const depId = prof?.department_id ?? null;
        if (depId) {
          const { data: d } = await supabase.from('departments').select('name').eq('id', depId).maybeSingle();
          if (mountedRef.current) setDepartmentName(d?.name || null);
        } else if (mountedRef.current) {
          setDepartmentName(null);
        }
      }

      // email logic:
      // - admin sees email of any user via RPC
      // - non-admin sees email only for own profile from auth
      if (rpcRow?.email) {
        if (mountedRef.current) setEmail(rpcRow.email);
      } else if (uid && userId === uid && authEmail) {
        if (mountedRef.current) setEmail(authEmail);
      } else if (mountedRef.current) {
        setEmail('');
      }

    } catch (e) {
      const msg = e?.message || T('errors_loadUser','errors_loadUser');
      if (mountedRef.current) setErr(msg);
      try { toast.error(msg); } catch {}
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [userId]);

  // Header button (Edit): admin can edit anyone; worker/dispatcher can edit ONLY self
  const handleEditPress = React.useCallback(() => {
    router.push(`/users/${userId}/edit`);
  }, [router, userId]);

  useLayoutEffect(() => {
    const canEdit = meIsAdmin || (myUid && myUid === userId);
    // Move action into header options (serializable params stay clean)
    navigation.setOptions({
      headerRight: canEdit
        ? () => (
            <Button title={T('btn_edit','btn_edit')} onPress={handleEditPress} variant="secondary" size="md" />
          )
        : undefined,
    });
    // Also set serializable header button params for our custom AppHeader
    if (canEdit) {
      navigation.setParams({ headerButtonLabel: T('btn_edit','btn_edit'), headerButtonTo: `/users/${userId}/edit`, editLabel: null });
    }
    // Keep route params free of functions — we no longer pass onEditPress
    if (!canEdit) {
      navigation.setParams({
        editLabel: null,
        headerButtonLabel: null,
        headerButtonTo: null,
      });
    }
  }, [navigation, userId, meIsAdmin, myUid, handleEditPress]);

  // Copy helpers
  const onCopyEmail = React.useCallback(async () => {
    if (!email) return false;
    const text = String(email);
    try {
      await Clipboard.setStringAsync(text);
      try { toast.success(T('toast_email_copied','toast_email_copied')); } catch {}
      return true;
    } catch {
      if (Platform.OS === 'web' && globalThis?.navigator?.clipboard?.writeText) {
        try {
          await globalThis.navigator.clipboard.writeText(text);
          try { toast.success(T('toast_email_copied','toast_email_copied')); } catch {}
          return true;
        } catch {}
      }
      try { toast.error(T('toast_copy_email_fail','toast_copy_email_fail')); } catch {}
      return false;
    }
  }, [email, toast]);

  const onCopyPhone = React.useCallback(async () => {
    if (!phone) return false;
    const text = toE164(phone) || ('+' + normalizeRu(phone));
    try {
      await Clipboard.setStringAsync(text);
      try { toast.success(T('toast_phone_copied','toast_phone_copied')); } catch {}
      return true;
    } catch {
      if (Platform.OS === 'web' && globalThis?.navigator?.clipboard?.writeText) {
        try {
          await globalThis.navigator.clipboard.writeText(text);
          try { toast.success(T('toast_phone_copied','toast_phone_copied')); } catch {}
          return true;
        } catch {}
      }
      try { toast.error(T('toast_copy_phone_fail','toast_copy_phone_fail')); } catch {}
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
        <View style={s.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </Screen>
    );
  }
  if (err) {
    return (
      <Screen>
        <View style={{ padding: theme.spacing.lg }}>
          <Text style={{ color: theme.colors.danger }}>{err}</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={s.contentWrap} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
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

        <Text style={base.sectionTitle}>{T('section_personal','section_personal')}</Text>
        <Card>
          <View style={base.row}>
            <Text style={base.label}>{T('view_label_name','view_label_name')}</Text>
            <View style={base.rightWrap}>
              <Text style={base.value}>{(firstName || lastName) ? (`${firstName || ''} ${lastName || ''}`).trim() : T('common_dash','common_dash')}</Text>
            </View>
          </View>
          <View style={base.sep} />
          <View style={base.row}>
            <Text style={base.label}>{T('view_label_email','view_label_email')}</Text>
            <View style={base.rightWrap}>
              {email ? (
                <Pressable accessibilityRole="link" onPress={async () => {
                  const url = `mailto:${email}`;
                  try {
                    const ok = await Linking.canOpenURL(url);
                    if (ok) await Linking.openURL(url);
                    else toast.error(T('errors_openMail','errors_openMail'));
                  } catch {
                    toast.error(T('errors_openMail','errors_openMail'));
                  }
                }}>
                  <Text style={[base.value, s.link]}>{email}</Text>
                </Pressable>
              ) : (
                <Text style={base.value}>{T('common_dash','common_dash')}</Text>
              )}
              {email ? (
                <IconButton
                  style={{ marginLeft: theme.spacing[theme.components?.row?.gapX || 'md'] }}
                  onPress={onCopyEmail}
                  accessibilityLabel={T('a11y_copy_email','a11y_copy_email')}
                >
                  <Feather name='copy' size={Number(theme?.typography?.sizes?.md ?? 16)} />
                </IconButton>
              ) : null}
            </View>
          </View>
          <View style={base.sep} />
          <View style={base.row}>
            <Text style={base.label}>{T('view_label_phone','view_label_phone')}</Text>
            <View style={base.rightWrap}>
              {phone ? (
                <Pressable accessibilityRole="link" onPress={async () => {
                  const url = `tel:${toE164(phone) || ('+' + normalizeRu(phone))}`;
                  try {
                    const ok = await Linking.canOpenURL(url);
                    if (ok) await Linking.openURL(url);
                    else toast.error(T('errors_callsUnavailable','errors_callsUnavailable'));
                  } catch {
                    toast.error(T('errors_callsUnavailable','errors_callsUnavailable'));
                  }
                }}>
                  <Text style={[base.value, s.link]}>{formatRuMask(phone)}</Text>
                </Pressable>
              ) : (
                <Text style={base.value}>{T('common_dash','common_dash')}</Text>
              )}
              {phone ? (
                <IconButton
                  style={{ marginLeft: theme.spacing[theme.components?.row?.gapX || 'md'] }}
                  onPress={onCopyPhone}
                  accessibilityLabel={T('a11y_copy_phone','a11y_copy_phone')}
                >
                  <Feather name='copy' size={Number(theme?.typography?.sizes?.md ?? 16)} />
                </IconButton>
              ) : null}
            </View>
          </View>

          <View style={base.sep} />
          <View style={base.row}>
            <Text style={base.label}>{T('label_birthdate','label_birthdate')}</Text>
            <View style={base.rightWrap}>
              <Text style={base.value}>{birthdate ? birthdate.toLocaleDateString((() => { try { return getLocale(); } catch { return 'ru-RU'; } })(), { day: '2-digit', month: 'long', year: 'numeric' }) : T('common_dash','common_dash')}</Text>
            </View>
          </View>
        </Card>

        <Text style={base.sectionTitle}>{T('section_company_role','section_company_role')}</Text>
        <Card>
          <View style={base.row}>
            <Text style={base.label}>{T('label_department','label_department')}</Text>
            <View style={base.rightWrap}>
              <Text style={base.value}>{departmentName || T('common_dash','common_dash')}</Text>
            </View>
          </View>
          <View style={base.sep} />
          <View style={base.row}>
            <Text style={base.label}>{T('label_role','label_role')}</Text>
            <View style={base.rightWrap}>
              <Text style={base.value}>{roleLabel}</Text>
            </View>
          </View>
          <View style={base.sep} />
          <View style={base.row}>
            <Text style={base.label}>{T('label_status','label_status')}</Text>
            <View style={base.rightWrap}>
              <Text style={[base.value, { color: statusColor }]}>{isSuspended ? T('status_suspended','status_suspended') : T('status_active','status_active')}</Text>
            </View>
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = (t) => {
  const AV = Number(t?.components?.avatar?.xl ?? 96);
  const BORDER = Number(t?.components?.avatar?.border ?? StyleSheet.hairlineWidth);
  const PRIMARY = t?.colors?.primary ?? '#007AFF';
  const SPACING_LG = Number(t?.spacing?.lg ?? 16);
  const SPACING_XL = Number(t?.spacing?.xl ?? 24);
  return StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    contentWrap: { padding: SPACING_LG, paddingBottom: SPACING_XL },
    avatarXl: {
      width: AV,
      height: AV,
      borderRadius: AV / 2,
      backgroundColor: withAlpha(PRIMARY, 0.12),
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: BORDER,
      borderColor: withAlpha(PRIMARY, 0.24),
      overflow: 'hidden',
    },
    avatarContainer: { alignItems: 'center', marginBottom: SPACING_XL },
    avatarTextXl: {
      fontSize: Math.round(AV * 0.33),
      color: PRIMARY,
      fontWeight: (t?.typography?.weight?.bold) || '700',
    },
    avatarImg: { width: '100%', height: '100%' },
    link: { color: PRIMARY },
  });
};