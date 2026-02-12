// app/users/[id]/index.jsx
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect } from 'react';
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AppHeader from '../../../components/navigation/AppHeader';
import Card from '../../../components/ui/Card';
import IconButton from '../../../components/ui/IconButton';
import { listItemStyles } from '../../../components/ui/listItemStyles';
import { formatRuMask, normalizeRu, toE164 } from '../../../components/ui/phone';
import SectionHeader from '../../../components/ui/SectionHeader';
import LabelValueRow from '../../../components/ui/LabelValueRow';
import { useToast } from '../../../components/ui/ToastProvider';
import { useEmployee, useEmployeesRealtimeSync } from '../../../src/features/employees/queries';
import { getDict, useI18nVersion } from '../../../src/i18n';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme';

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
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { id } = useLocalSearchParams();
  const userId = Array.isArray(id) ? id[0] : id;
  const router = useRouter();

  // Предотвращаем setState после размонтирования (паттерн как в AppSettings)
  const mountedRef = React.useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useI18nVersion();
  const { t } = useTranslation();
  const {
    data: userData,
    isLoading: loading,
    error: loadError,
    refetch,
  } = useEmployee(userId, {
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
    refetchOnMount: 'always',
  });
  useEmployeesRealtimeSync({ enabled: !!userId });

  // Гарантируем обновление при возврате на экран (после редактирования)
  // Используем ref для refresh чтобы избежать бесконечной перезагрузки
  const refreshRef = React.useRef(refetch);
  React.useEffect(() => {
    refreshRef.current = refetch;
  }, [refetch]);

  useFocusEffect(
    React.useCallback(() => {
      if (userId && refreshRef.current) {
        try {
          refreshRef.current();
        } catch {}
      }
    }, [userId]),
  );

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
    [t],
  );

  const roleLabel = ROLE_LABELS[role] || t('role_worker', 'role_worker');

  // Header button (Edit): admin can edit anyone; worker/dispatcher can edit ONLY self
  const meIsAdmin = !!userData?.meIsAdmin;
  const myUid = userData?.myUid || null;
  const canEdit = meIsAdmin || (myUid && myUid === userId);
  const handleEditPress = React.useCallback(() => {
    router.push(`/users/${userId}/edit`);
  }, [router, userId]);

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
  }, [email, t, toast]);

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
  }, [phone, t, toast]);

  const initials =
    `${(firstName || '').trim().slice(0, 1)}${(lastName || '').trim().slice(0, 1)}`.toUpperCase();
  const statusColor = isSuspended ? theme.colors.danger : theme.colors.success;

  if (loading) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        edges={['left', 'right']}
      >
        <View style={s.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </SafeAreaView>
    );
  }
  if (err) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        edges={['left', 'right']}
      >
        <View style={{ padding: theme.spacing.lg }}>
          <Text style={{ color: theme.colors.danger }}>{err}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      edges={['left', 'right']}
    >
      <AppHeader
        back
        options={{
          headerTitleAlign: 'left',
          title: t('routes.users/[id]', 'routes.users/[id]'),
          rightTextLabel: canEdit ? t('btn_edit', 'btn_edit') : undefined,
          onRightPress: canEdit ? handleEditPress : undefined,
        }}
      />
      <ScrollView
        contentContainerStyle={[
          s.contentWrap,
          {
            paddingBottom:
              (theme.components?.scrollView?.paddingBottom ?? theme.spacing.xl) +
              (insets?.bottom ?? 0),
          },
        ]}
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

        <SectionHeader>{t('section_personal', 'section_personal')}</SectionHeader>
        <Card paddedXOnly>
          <LabelValueRow
            label={t('view_label_name', 'view_label_name')}
            value={
              firstName || lastName
                ? `${firstName || ''} ${lastName || ''}`.trim()
                : t('common_dash', 'common_dash')
            }
          />
          <View style={base.sep} />

          <LabelValueRow
            label={t('view_label_email', 'view_label_email')}
            valueComponent={
              email ? (
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
              )
            }
            rightActions={
              email ? (
                <IconButton
                  onPress={onCopyEmail}
                  accessibilityLabel={t('a11y_copy_email', 'a11y_copy_email')}
                >
                  <Feather name="copy" size={Number(theme?.typography?.sizes?.md ?? 16)} />
                </IconButton>
              ) : null
            }
          />
          <View style={base.sep} />

          <LabelValueRow
            label={t('view_label_phone', 'view_label_phone')}
            valueComponent={
              phone ? (
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
              )
            }
            rightActions={
                phone ? (
                  <IconButton
                    onPress={onCopyPhone}
                    accessibilityLabel={t('a11y_copy_phone', 'a11y_copy_phone')}
                  >
                    <Feather name="copy" size={Number(theme?.typography?.sizes?.md ?? 16)} />
                  </IconButton>
                ) : null
            }
          />
          <View style={base.sep} />

          <LabelValueRow
            label={t('label_birthdate', 'label_birthdate')}
            value={(() => {
              if (!birthdate) return t('common_dash', 'common_dash');
              let dateObj = birthdate;
              // Если birthdate строка — преобразуем
              if (typeof birthdate === 'string') {
                const parsed = new Date(birthdate);
                if (!isNaN(parsed)) dateObj = parsed;
              }
              if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return t('common_dash', 'common_dash');
              try {
                const dict = getDict?.() || {};
                const offset = Number(dict.month_label_offset ?? 0) || 0;
                const m = dateObj.getMonth();
                const keyIdx = (m + offset + 12) % 12;
                const monthName = t(`months_genitive_${keyIdx}`, `months_genitive_${keyIdx}`);
                const day = dateObj.getDate();
                const year = dateObj.getFullYear();
                return `${day} ${monthName} ${year}`;
              } catch {
                return t('common_dash', 'common_dash');
              }
            })()}
          />
        </Card>

        <SectionHeader>{t('section_company_role', 'section_company_role')}</SectionHeader>
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
    </SafeAreaView>
  );
}

const styles = (t) => {
  const AV = Number(t?.components?.avatar?.xl ?? 96);
  const BORDER = Number(t?.components?.avatar?.border ?? StyleSheet.hairlineWidth);
  const PRIMARY = t?.colors?.primary ?? '#007AFF';
  const SPACING_LG = Number(t?.spacing?.lg ?? 16);
  return StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    contentWrap: { paddingHorizontal: SPACING_LG },
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
    avatarContainer: { alignItems: 'center', marginBottom: t.spacing?.xl ?? 24 },
    avatarTextXl: {
      fontSize: Math.round(AV * 0.33),
      color: PRIMARY,
      fontWeight: t?.typography?.weight?.bold || '700',
    },
    avatarImg: { width: '100%', height: '100%' },
    link: { color: PRIMARY },
  });
};
