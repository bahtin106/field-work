// app/users/[id].jsx
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import React, { useEffect, useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useQueryWithCache } from '../../components/hooks/useQueryWithCache';
import Screen from '../../components/layout/Screen';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import IconButton from '../../components/ui/IconButton';
import { listItemStyles } from '../../components/ui/listItemStyles';
import { formatRuMask, normalizeRu, toE164 } from '../../components/ui/phone';
import { useToast } from '../../components/ui/ToastProvider';
import { supabase } from '../../lib/supabase';
import { getDict, useI18nVersion } from '../../src/i18n';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme';

function withAlpha(color, a) {
  if (typeof color === 'string') {
    const hex = color.match(/^#([0-9a-fA-F]{6})$/);
    if (hex) {
      const alpha = Math.round(Math.max(0, Math.min(1, a)) * 255)
        .toString(16)
        .padStart(2, '0');
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
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const ver = useI18nVersion();
  const { t } = useTranslation();
  const [meIsAdmin, setMeIsAdmin] = useState(false);
  const [myUid, setMyUid] = useState(null);

  // Кеширование профиля пользователя с Realtime
  const {
    data: userData,
    isLoading: loading,
    error: loadError,
    refresh,
  } = useQueryWithCache({
    queryKey: `user:${userId}`,
    queryFn: async () => {
      if (!userId) throw new Error(t('errors_user_not_found', 'errors_user_not_found'));

      // Always know who is logged in for comparison
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id || null;
      const authEmail = auth?.user?.email || '';

      // Try to get extended data via RPC ONLY if admin (RLS-safe)
      let rpcRow = null;
      let iAmAdmin = false;
      if (uid) {
        const { data: me } = await supabase.from('profiles').select('role').eq('id', uid).single();
        iAmAdmin = me?.role === 'admin';
        if (iAmAdmin) {
          const { data: rpc } = await supabase.rpc('admin_get_profile_with_email', {
            target_user_id: userId,
          });
          rpcRow = Array.isArray(rpc) ? rpc[0] : rpc;
        }
      }

      // Base profile fields
      const { data: prof } = await supabase
        .from('profiles')
        .select(
          'first_name, last_name, phone, avatar_url, department_id, is_suspended, suspended_at, birthdate, role',
        )
        .eq('id', userId)
        .maybeSingle();

      if (!prof) throw new Error(t('errors_user_not_found', 'errors_user_not_found'));

      // Load department name
      let departmentName = null;
      const depId = prof?.department_id ?? null;
      if (depId) {
        const { data: d } = await supabase
          .from('departments')
          .select('name')
          .eq('id', depId)
          .maybeSingle();
        departmentName = d?.name || null;
      }

      // email logic: admin sees all, non-admin only their own
      let email = '';
      if (rpcRow?.email) {
        email = rpcRow.email;
      } else if (uid && userId === uid && authEmail) {
        email = authEmail;
      }

      // birthdate: prefer profiles, fallback to RPC for admins
      const bd = prof?.birthdate ?? rpcRow?.birthdate ?? null;
      let birthdate = null;
      if (bd) {
        const d = new Date(bd);
        birthdate = !isNaN(d.getTime()) ? d : null;
      }

      return {
        firstName: prof.first_name || '',
        lastName: prof.last_name || '',
        avatarUrl: prof.avatar_url || null,
        phone: String(prof.phone || ''),
        isSuspended: !!(prof?.is_suspended || prof?.suspended_at),
        role: prof.role || rpcRow?.user_role || 'worker',
        birthdate,
        departmentName,
        email,
        meIsAdmin: iAmAdmin,
        myUid: uid,
      };
    },
    ttl: 3 * 60 * 1000, // 3 минуты (профиль может меняться)
    staleTime: 1 * 60 * 1000, // 1 минута
    placeholderData: null,
    enableRealtime: true,
    realtimeTable: 'profiles',
    supabaseClient: supabase,
    enabled: !!userId,
  });

  // Гарантируем обновление при возврате на экран (после редактирования)
  // Используем ref для refresh чтобы избежать бесконечной перезагрузки
  const refreshRef = React.useRef(refresh);
  React.useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useFocusEffect(
    React.useCallback(() => {
      if (userId && refreshRef.current) {
        try {
          refreshRef.current();
        } catch {}
      }
    }, [userId]),
  );

  // Sync кешированных данных в state
  useEffect(() => {
    if (userData && mountedRef.current) {
      setMeIsAdmin(userData.meIsAdmin);
      setMyUid(userData.myUid);
    }
  }, [userData]);

  const avatarUrl = userData?.avatarUrl || null;
  const firstName = userData?.firstName || '';
  const lastName = userData?.lastName || '';
  const email = userData?.email || '';
  const phone = userData?.phone || '';
  const birthdate = userData?.birthdate || null;
  const role = userData?.role || 'worker';
  const departmentName = userData?.departmentName || null;
  const isSuspended = userData?.isSuspended || false;
  const err = loadError?.message || '';
  const ROLE_LABELS = React.useMemo(
    () => ({
      admin: t('role_admin', 'role_admin'),
      dispatcher: t('role_dispatcher', 'role_dispatcher'),
      worker: t('role_worker', 'role_worker'),
    }),
    [ver],
  );

  const roleLabel = ROLE_LABELS[role] || t('role_worker', 'role_worker');

  useLayoutEffect(() => {
    const routeTitle = t('routes.users/[id]', 'routes.users/[id]');
    navigation.setOptions({ title: routeTitle, headerTitle: routeTitle });
  }, [navigation, ver]);

  // Also set title in params so AppHeader picks it
  useEffect(() => {
    const routeTitle = t('routes.users/[id]', 'routes.users/[id]');
    navigation.setParams({ title: routeTitle });
  }, [navigation, ver]);

  // useQueryWithCache автоматически обновляет данные при focus через refetchOnFocus

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
            <Button
              title={t('btn_edit', 'btn_edit')}
              onPress={handleEditPress}
              variant="secondary"
              size="md"
            />
          )
        : undefined,
    });
    // Also set serializable header button params for our custom AppHeader
    if (canEdit) {
      navigation.setParams({
        headerButtonLabel: t('btn_edit', 'btn_edit'),
        headerButtonTo: `/users/${userId}/edit`,
        editLabel: null,
      });
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
      try {
        toast.success(t('toast_email_copied', 'toast_email_copied'));
      } catch {}
      return true;
    } catch {
      if (Platform.OS === 'web' && globalThis?.navigator?.clipboard?.writeText) {
        try {
          await globalThis.navigator.clipboard.writeText(text);
          try {
            toast.success(t('toast_email_copied', 'toast_email_copied'));
          } catch {}
          return true;
        } catch {}
      }
      try {
        toast.error(t('toast_copy_email_fail', 'toast_copy_email_fail'));
      } catch {}
      return false;
    }
  }, [email, toast]);

  const onCopyPhone = React.useCallback(async () => {
    if (!phone) return false;
    const text = toE164(phone) || '+' + normalizeRu(phone);
    try {
      await Clipboard.setStringAsync(text);
      try {
        toast.success(t('toast_phone_copied', 'toast_phone_copied'));
      } catch {}
      return true;
    } catch {
      if (Platform.OS === 'web' && globalThis?.navigator?.clipboard?.writeText) {
        try {
          await globalThis.navigator.clipboard.writeText(text);
          try {
            toast.success(t('toast_phone_copied', 'toast_phone_copied'));
          } catch {}
          return true;
        } catch {}
      }
      try {
        toast.error(t('toast_copy_phone_fail', 'toast_copy_phone_fail'));
      } catch {}
      return false;
    }
  }, [phone, toast]);

  // useQueryWithCache автоматически обновляет при focus благодаря refetchOnFocus: true

  const initials =
    `${(firstName || '').trim().slice(0, 1)}${(lastName || '').trim().slice(0, 1)}`.toUpperCase();
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
      <ScrollView
        contentContainerStyle={s.contentWrap}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
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

        <Text style={base.sectionTitle}>{t('section_personal', 'section_personal')}</Text>
        <Card paddedXOnly>
          <View style={base.row}>
            <Text style={base.label}>{t('view_label_name', 'view_label_name')}</Text>
            <View style={base.rightWrap}>
              <Text style={base.value}>
                {firstName || lastName
                  ? `${firstName || ''} ${lastName || ''}`.trim()
                  : t('common_dash', 'common_dash')}
              </Text>
            </View>
          </View>
          <View style={base.sep} />
          <View style={base.row}>
            <Text style={base.label}>{t('view_label_email', 'view_label_email')}</Text>
            <View style={base.rightWrap}>
              {email ? (
                <Pressable
                  accessibilityRole="link"
                  onPress={async () => {
                    const url = `mailto:${email}`;
                    try {
                      const ok = await Linking.canOpenURL(url);
                      if (ok) await Linking.openURL(url);
                      else toast.error(t('errors_openMail', 'errors_openMail'));
                    } catch {
                      toast.error(t('errors_openMail', 'errors_openMail'));
                    }
                  }}
                >
                  <Text style={[base.value, s.link]}>{email}</Text>
                </Pressable>
              ) : (
                <Text style={base.value}>{t('common_dash', 'common_dash')}</Text>
              )}
              {email ? (
                <IconButton
                  style={{ marginLeft: theme.spacing[theme.components?.row?.gapX || 'md'] }}
                  onPress={onCopyEmail}
                  accessibilityLabel={t('a11y_copy_email', 'a11y_copy_email')}
                >
                  <Feather name="copy" size={Number(theme?.typography?.sizes?.md ?? 16)} />
                </IconButton>
              ) : null}
            </View>
          </View>
          <View style={base.sep} />
          <View style={base.row}>
            <Text style={base.label}>{t('view_label_phone', 'view_label_phone')}</Text>
            <View style={base.rightWrap}>
              {phone ? (
                <Pressable
                  accessibilityRole="link"
                  onPress={async () => {
                    const url = `tel:${toE164(phone) || '+' + normalizeRu(phone)}`;
                    try {
                      const ok = await Linking.canOpenURL(url);
                      if (ok) await Linking.openURL(url);
                      else toast.error(t('errors_callsUnavailable', 'errors_callsUnavailable'));
                    } catch {
                      toast.error(t('errors_callsUnavailable', 'errors_callsUnavailable'));
                    }
                  }}
                >
                  <Text style={[base.value, s.link]}>{formatRuMask(phone)}</Text>
                </Pressable>
              ) : (
                <Text style={base.value}>{t('common_dash', 'common_dash')}</Text>
              )}
              {phone ? (
                <IconButton
                  style={{ marginLeft: theme.spacing[theme.components?.row?.gapX || 'md'] }}
                  onPress={onCopyPhone}
                  accessibilityLabel={t('a11y_copy_phone', 'a11y_copy_phone')}
                >
                  <Feather name="copy" size={Number(theme?.typography?.sizes?.md ?? 16)} />
                </IconButton>
              ) : null}
            </View>
          </View>

          <View style={base.sep} />
          <View style={base.row}>
            <Text style={base.label}>{t('label_birthdate', 'label_birthdate')}</Text>
            <View style={base.rightWrap}>
              <Text style={base.value}>
                {birthdate
                  ? (() => {
                      try {
                        // Read optional offset from i18n dict (keeps parity with DateTimeModal)
                        const dict = getDict?.() || {};
                        const offset = Number(dict.month_label_offset ?? 0) || 0;
                        const m = birthdate.getMonth(); // 0..11
                        const keyIdx = (m + offset + 12) % 12;
                        const monthName = t(
                          `months_genitive_${keyIdx}`,
                          `months_genitive_${keyIdx}`,
                        );
                        const day = birthdate.getDate();
                        const year = birthdate.getFullYear();
                        return `${day} ${monthName} ${year}`;
                      } catch (e) {
                        // Fallback to dash if anything goes wrong
                        return t('common_dash', 'common_dash');
                      }
                    })()
                  : t('common_dash', 'common_dash')}
              </Text>
            </View>
          </View>
        </Card>

        <Text style={base.sectionTitle}>{t('section_company_role', 'section_company_role')}</Text>
        <Card paddedXOnly>
          <View style={base.row}>
            <Text style={base.label}>{t('label_department', 'label_department')}</Text>
            <View style={base.rightWrap}>
              <Text style={base.value}>{departmentName || t('common_dash', 'common_dash')}</Text>
            </View>
          </View>
          <View style={base.sep} />
          <View style={base.row}>
            <Text style={base.label}>{t('label_role', 'label_role')}</Text>
            <View style={base.rightWrap}>
              <Text style={base.value}>{roleLabel}</Text>
            </View>
          </View>
          <View style={base.sep} />
          <View style={base.row}>
            <Text style={base.label}>{t('label_status', 'label_status')}</Text>
            <View style={base.rightWrap}>
              <Text style={[base.value, { color: statusColor }]}>
                {isSuspended
                  ? t('status_suspended', 'status_suspended')
                  : t('status_active', 'status_active')}
              </Text>
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
      fontWeight: t?.typography?.weight?.bold || '700',
    },
    avatarImg: { width: '100%', height: '100%' },
    link: { color: PRIMARY },
  });
};
