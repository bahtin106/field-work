import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Theme / layout / UI
import Screen from '../../components/layout/Screen';
import UIButton from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import ClearButton from '../../components/ui/ClearButton';
import { listItemStyles } from '../../components/ui/listItemStyles';
import { ConfirmModal, DateTimeModal, SelectModal } from '../../components/ui/modals';
import PhoneInput from '../../components/ui/PhoneInput';
import TextField from '../../components/ui/TextField';
import { useToast } from '../../components/ui/ToastProvider';
import { useTheme } from '../../theme';

// i18n
import { useI18nVersion } from '../../src/i18n';
import { useTranslation } from '../../src/i18n/useTranslation';

// data / constants
import { ROLE, ROLE_LABELS, EDITABLE_ROLES as ROLES } from '../../constants/roles';
import { AUTH_CONSTRAINTS, isValidEmail as isValidEmailShared } from '../../lib/authValidation';
import { FUNCTIONS as APP_FUNCTIONS, AVATAR, STORAGE, TBL } from '../../lib/constants';
import { supabase } from '../../lib/supabase';
import { getDict, t as T } from '../../src/i18n';

// --- locals / env-driven ---
const TABLES = {
  profiles: TBL.PROFILES || 'profiles',
  departments: TBL.DEPARTMENTS || 'departments',
};

const __IS_PROD = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const __pick = (val, devFallback) => (val != null ? val : __IS_PROD ? null : devFallback);

const AVA_PREFIX = AVATAR.FILENAME_PREFIX;
const AVA_MIME = AVATAR.MIME;

const FN_CREATE_USER =
  process.env.EXPO_PUBLIC_FN_CREATE_USER || (APP_FUNCTIONS.CREATE_USER ?? 'create_user');

let ROLE_LABELS_LOCAL = ROLE_LABELS;
try {
  const fromEnv = process.env.EXPO_PUBLIC_ROLE_LABELS_JSON;
  if (fromEnv) ROLE_LABELS_LOCAL = { ...ROLE_LABELS_LOCAL, ...JSON.parse(fromEnv) };
} catch {}

// --- helpers ---
function withAlpha(color, a) {
  if (typeof color === 'string') {
    const hex = color.match(/^#([0-9a-fA-F]{6})$/);
    if (hex) {
      const alpha = Math.round(Math.max(0, Math.min(1, a)) * 255)
        .toString(16)
        .padStart(2, '0');
      return color + alpha;
    }
    const rgb = color.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)\s*$/i);
    if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${a})`;
  }
  return `rgba(0,0,0,${a})`;
}
function formatDateRU(date, withYear = true) {
  try {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    const dict = getDict?.() || {};
    const offset = Number(dict.month_label_offset ?? 0) || 0;
    const m = d.getMonth();
    const idx = (m + offset + 12) % 12;
    const month = T(`months_genitive_${idx}`);
    const day = d.getDate();
    const year = d.getFullYear();
    return withYear ? `${day} ${month} ${year}` : `${day} ${month}`;
  } catch {
    return '';
  }
}

export default function NewUserScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const ver = useI18nVersion();
  const router = useRouter();
  const navigation = useNavigation();
  const { success: toastSuccess, error: toastError, info: toastInfo } = useToast();
  const base = useMemo(() => listItemStyles(theme), [theme]);
  const insets = useSafeAreaInsets();

  // Header: align with other pages (title only, chevron back)
  useLayoutEffect(() => {
    const title = t('routes.users/new');
    try {
      navigation.setOptions({ title, headerTitle: title });
    } catch {}
  }, [navigation, ver, t]);
  useEffect(() => {
    try {
      const title = t('routes.users/new');
      // Only set explicit localized title so AppHeader shows it; keep default back chevron
      navigation.setParams({ title });
    } catch {}
  }, [navigation, ver, t]);

  // state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [headerName, setHeaderName] = useState(t('placeholder_no_name'));
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(ROLE.WORKER);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');

  const [phone, setPhone] = useState('');
  const [birthdate, setBirthdate] = useState(null);
  const [withYear, setWithYear] = useState(true);
  const [dobModalVisible, setDobModalVisible] = useState(false);

  const [departmentId, setDepartmentId] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [deptModalVisible, setDeptModalVisible] = useState(false);
  const activeDeptName = useMemo(() => {
    const d = (departments || []).find((x) => String(x.id) === String(departmentId));
    return d ? d.name : null;
  }, [departments, departmentId]);

  const [avatarUrl, setAvatarUrl] = useState(null);
  const [avatarSheet, setAvatarSheet] = useState(false);

  const [showRoles, setShowRoles] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const [cancelVisible, setCancelVisible] = useState(false);
  const [submittedAttempt, setSubmittedAttempt] = useState(false);

  const firstNameRef = useRef(null);
  const lastNameRef = useRef(null);
  const emailRef = useRef(null);
  const pwdRef = useRef(null);
  const phoneRef = useRef(null);
  const scrollRef = useRef(null);
  const scrollYRef = useRef(0);
  const allowLeaveRef = useRef(false);

  const MEDIA_ASPECT = Array.isArray(theme.media?.aspect) ? theme.media.aspect : [1, 1];
  const MEDIA_QUALITY = typeof theme.media?.quality === 'number' ? theme.media.quality : 0.85;
  const ICON_MD = theme.icons?.md ?? 22;
  const ICON_SM = theme.icons?.sm ?? 18;
  const ICONBUTTON_TOUCH = theme.components?.iconButton?.size ?? 32;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: theme.colors.background },
        scroll: { paddingHorizontal: theme.spacing.lg, flexGrow: 1 },
        headerRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
        headerCard: { padding: theme.spacing.sm, marginBottom: theme.spacing.md },
        avatar: {
          width: theme.components?.avatar?.md ?? 96,
          height: theme.components?.avatar?.md ?? 96,
          borderRadius: (theme.components?.avatar?.md ?? 96) / 2,
          backgroundColor: withAlpha(theme.colors.primary, 0.12),
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: theme.components.card.borderWidth,
          borderColor: withAlpha(theme.colors.primary, 0.24),
          overflow: 'hidden',
        },
        avatarImg: { width: '100%', height: '100%' },
        avatarCamBadge: {
          position: 'absolute',
          right: -(theme.components?.avatar?.badgeOffset ?? 2),
          bottom: -(theme.components?.avatar?.badgeOffset ?? 2),
          backgroundColor: theme.colors.primary,
          borderRadius: theme.radii.md,
          paddingHorizontal: theme.spacing.xs,
          paddingVertical: theme.spacing.xs,
          borderWidth: theme.components?.avatar?.border ?? theme.components.card.borderWidth,
          borderColor: theme.colors.surface,
        },
        avatarText: { color: theme.colors.primary, fontWeight: '700' },
        nameTitle: {
          fontSize: theme.typography.sizes.md,
          fontWeight: '600',
          color: theme.colors.text,
        },
        field: { marginHorizontal: 0, marginVertical: theme.spacing.sm },
        helperError: {
          color: theme.colors.danger,
          fontSize: theme.typography.sizes.xs,
          marginTop: theme.spacing.xs,
          marginLeft: theme.spacing.md,
        },
        errorCard: {
          backgroundColor: withAlpha(theme.colors.danger, 0.12),
          borderColor: theme.colors.danger,
          borderWidth: theme.components.card.borderWidth,
          padding: theme.spacing.md,
          borderRadius: theme.radii.xl,
          marginBottom: theme.spacing.md,
        },
        errorTitle: { color: theme.colors.danger, fontWeight: '600' },
        errorText: { color: theme.colors.danger, marginTop: theme.spacing.xs },
        actionBar: {
          flexDirection: 'row',
          gap: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg + theme.spacing[theme.components?.card?.padX ?? 'lg'],
          paddingTop: theme.spacing.sm,
          paddingBottom: theme.components?.scrollView?.paddingBottom ?? theme.spacing.xl,
        },
        actionBtn: { alignSelf: 'stretch' },
      }),
    [theme],
  );

  const MIN_PASSWORD_LENGTH = useMemo(() => {
    const envVal = Number(process.env.EXPO_PUBLIC_PASSWORD_MIN_LENGTH || 0) || 0;
    const sharedMin = Number(AUTH_CONSTRAINTS?.PASSWORD?.MIN_LENGTH || 0) || 0;
    return Math.max(sharedMin, envVal || 6);
  }, []);
  const emailValid = useMemo(() => isValidEmailShared(email), [email]);
  const passwordValid = useMemo(
    () => password.length >= MIN_PASSWORD_LENGTH,
    [password, MIN_PASSWORD_LENGTH],
  );
  const passwordsMatch = useMemo(
    () => !password || password === confirmPassword,
    [password, confirmPassword],
  );

  const initials = useMemo(
    () =>
      `${(firstName || '').trim().slice(0, 1)}${(lastName || '').trim().slice(0, 1)}`.toUpperCase(),
    [firstName, lastName],
  );

  const initialSnapRef = useRef('');
  useEffect(() => {
    initialSnapRef.current = JSON.stringify({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      role: ROLE.WORKER,
      password: false,
      birthdate: null,
      avatar: null,
    });
  }, []);
  const isEmptyForm = useMemo(() => {
    return (
      !firstName.trim() &&
      !lastName.trim() &&
      !email.trim() &&
      !String(phone || '').replace(/\D/g, '') &&
      !password &&
      !confirmPassword &&
      !birthdate &&
      !avatarUrl &&
      (departmentId == null || departmentId === '')
    );
  }, [
    firstName,
    lastName,
    email,
    phone,
    password,
    confirmPassword,
    birthdate,
    avatarUrl,
    departmentId,
  ]);

  const isDirty = useMemo(() => {
    const snap = JSON.stringify({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: String(phone || '').replace(/\D/g, ''),
      role,
      password: password.length > 0,
      birthdate: birthdate ? new Date(birthdate).toISOString().slice(0, 10) : null,
      avatar: !!avatarUrl,
    });
    return snap !== initialSnapRef.current;
  }, [firstName, lastName, email, phone, role, password, birthdate, avatarUrl]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (allowLeaveRef.current || isEmptyForm || !isDirty) {
        return false;
      }
      setCancelVisible(true);
      return true;
    });
    return () => sub.remove();
  }, [isDirty, isEmptyForm]);
  // Intercept header back/cancel: show confirm only when form changed
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (allowLeaveRef.current || isEmptyForm || !isDirty) return;
      e.preventDefault();
      setCancelVisible(true);
    });
    return sub;
  }, [navigation, isDirty, isEmptyForm]);

  useEffect(() => {
    setHeaderName(
      `${firstName || ''} ${lastName || ''}`.replace(/\s+/g, ' ').trim() ||
        t('placeholder_no_name'),
    );
  }, [firstName, lastName, t]);

  const ensureCameraPerms = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    return status === 'granted';
  };
  const ensureLibraryPerms = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    return status === 'granted';
  };
  const uploadAvatar = async (userId, uri) => {
    try {
      const resp = await fetch(uri);
      const ab = await resp.arrayBuffer();
      const fileData = new Uint8Array(ab);
      const filename = `${AVA_PREFIX}${Date.now()}.jpg`;
      const path = `${STORAGE.AVATAR_PREFIX}/${userId}/${filename}`;
      const { error: upErr } = await supabase.storage
        .from(STORAGE.AVATORS || STORAGE.AVATARS)
        .upload(path, fileData, { contentType: AVA_MIME, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage
        .from(STORAGE.AVATORS || STORAGE.AVATARS)
        .getPublicUrl(path);
      const publicUrl = pub?.publicUrl || null;
      const { error: updErr } = await supabase
        .from(TABLES.profiles)
        .update({ avatar_url: publicUrl })
        .eq('id', userId);
      if (updErr) throw updErr;
      setAvatarUrl(publicUrl);
      return publicUrl;
    } catch (e) {
      setErr(e?.message || t('toast_generic_error'));
      return null;
    }
  };
  const pickFromCamera = async () => {
    const ok = await ensureCameraPerms();
    if (!ok) {
      setErr(t('error_camera_denied'));
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: MEDIA_QUALITY,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
    });
    if (!res.canceled && res.assets && res.assets[0]?.uri) setAvatarUrl(res.assets[0].uri);
  };
  const pickFromLibrary = async () => {
    const ok = await ensureLibraryPerms();
    if (!ok) {
      setErr(t('error_library_denied'));
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: MEDIA_QUALITY,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      selectionLimit: 1,
    });
    if (!res.canceled && res.assets && res.assets[0]?.uri) setAvatarUrl(res.assets[0].uri);
  };

  const fetchDepartments = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from(TABLES.departments)
        .select('id, name')
        .order('name', { ascending: true });
      if (!error) setDepartments(Array.isArray(data) ? data : []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  const warn = (key) => {
    toastInfo(t(key));
  };

  const handleCreate = useCallback(async () => {
    if (submitting) return;
    setSubmittedAttempt(true);
    // Aggregate required field checks AFTER marking attempt
    const missingFirst = !firstName.trim();
    const missingLast = !lastName.trim();
    const invalidEmail = !emailValid;
    const shortPwd = !passwordValid;
    const mismatchPwd = !passwordsMatch;

    if (missingFirst || missingLast || invalidEmail || shortPwd || mismatchPwd) {
      // Only toast one generic guidance or first issue (simplified UX)
      const order = [
        missingFirst && 'err_first_name',
        missingLast && 'err_last_name',
        invalidEmail && 'err_email',
        shortPwd && 'err_password_short',
        mismatchPwd && 'err_password_mismatch',
      ].filter(Boolean);
      if (order[0]) warn(order[0]);
      return;
    }

    setErr('');
    setSubmitting(true);
    try {
      const fullName = `${firstName.trim()} ${lastName.trim()}`.replace(/\s+/g, ' ').trim();
      const phoneNormalized = String(phone || '').replace(/\D/g, '') || null;

      // create auth user via edge function
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/${FN_CREATE_USER}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: String(email).trim().toLowerCase(),
          password: String(password),
          role,
        }),
      });
      const raw = await resp.text();
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {}
      if (!resp.ok) {
        const msg =
          (body && (body.message || body.error || body.details || body.hint)) ||
          raw ||
          `HTTP ${resp.status}`;
        if (/already exists|email/i.test(String(msg))) throw new Error(t('error_email_exists'));
        throw new Error(msg);
      }
      const userId = body?.user_id;
      if (!userId) throw new Error(t('error_profile_not_updated'));

      // Save profile fields
      const bdate =
        birthdate instanceof Date ? new Date(birthdate).toISOString().slice(0, 10) : null;
      const { error: upErr } = await supabase
        .from(TABLES.profiles)
        .update({
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
          full_name: fullName || null,
          phone: phoneNormalized,
          birthdate: bdate,
          role,
        })
        .eq('id', userId);
      if (upErr) throw upErr;

      // upload avatar if chosen
      if (avatarUrl && avatarUrl.startsWith('file')) {
        await uploadAvatar(userId, avatarUrl);
      }

      toastSuccess(t('toast_success'));
      setTimeout(() => router.replace('/users'), theme.timings?.backDelayMs ?? 300);
    } catch (e) {
      const msg = String(e?.message || t('toast_generic_error'));
      setErr(msg);
      toastError(msg);
    } finally {
      setSubmitting(false);
    }
  }, [
    submitting,
    firstName,
    lastName,
    email,
    password,
    passwordsMatch,
    emailValid,
    passwordValid,
    role,
    phone,
    birthdate,
    avatarUrl,
    router,
    theme.timings?.backDelayMs,
    t,
    toastSuccess,
    toastError,
  ]);

  const roleItems = useMemo(
    () => ROLES.map((r) => ({ id: r, label: ROLE_LABELS_LOCAL[r] || r })),
    [],
  );

  const onCancel = () => {
    if (isDirty) {
      setCancelVisible(true);
      return;
    }
    router.back();
  };

  return (
    <Screen
      background="background"
      scroll={true}
      scrollRef={scrollRef}
      onScroll={(e) => {
        try {
          scrollYRef.current = e.nativeEvent.contentOffset.y || 0;
        } catch {}
      }}
      scrollEventThrottle={16}
      contentContainerStyle={[
        styles.scroll,
        {
          paddingBottom:
            (theme.components?.scrollView?.paddingBottom ?? theme.spacing.xl) +
            (insets?.bottom ?? 0),
        },
      ]}
    >
      <Card style={styles.headerCard}>
        <View style={styles.headerRow}>
          <Pressable
            style={styles.avatar}
            onPress={() => setAvatarSheet(true)}
            accessibilityRole="button"
            accessibilityLabel={t('a11y_change_avatar')}
            accessibilityHint={t('a11y_change_avatar_hint')}
          >
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImg} />
            ) : (
              <Text style={styles.avatarText}>{initials || '•'}</Text>
            )}
            <View style={styles.avatarCamBadge}>
              <Feather
                name="camera"
                size={Math.max(
                  theme.icons?.minCamera ?? 12,
                  Math.round((theme.icons?.sm ?? 18) * (theme.icons?.cameraRatio ?? 0.67)),
                )}
                color={theme.colors.onPrimary}
              />
            </View>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.nameTitle}>{headerName}</Text>
          </View>
        </View>
      </Card>

      {err ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>{t('dlg_alert_title')}</Text>
          <Text style={styles.errorText}>{err}</Text>
        </View>
      ) : null}

      <Text style={base.sectionTitle}>{t('section_personal')}</Text>
      <Card paddedXOnly>
        <TextField
          ref={firstNameRef}
          label={t('label_first_name')}
          placeholder={t('placeholder_first_name')}
          style={styles.field}
          value={firstName}
          onChangeText={setFirstName}
          forceValidation={submittedAttempt}
          error={!firstName.trim() ? 'required' : undefined}
        />
        <TextField
          ref={lastNameRef}
          label={t('label_last_name')}
          placeholder={t('placeholder_last_name')}
          style={styles.field}
          value={lastName}
          onChangeText={setLastName}
          forceValidation={submittedAttempt}
          error={!lastName.trim() ? 'required' : undefined}
        />
        <TextField
          ref={emailRef}
          label={t('label_email')}
          placeholder={t('placeholder_email')}
          style={styles.field}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          value={email}
          onChangeText={setEmail}
          forceValidation={submittedAttempt}
          error={!emailValid ? 'invalid' : undefined}
        />
        <PhoneInput
          ref={phoneRef}
          value={phone}
          onChangeText={(val) => {
            setPhone(val);
          }}
          error={undefined}
          style={styles.field}
        />
        <TextField
          label={t('label_birthdate')}
          value={
            birthdate
              ? String(formatDateRU(birthdate, withYear))
              : String(t('placeholder_birthdate'))
          }
          style={styles.field}
          pressable
          onPress={() => setDobModalVisible(true)}
          rightSlot={
            birthdate ? (
              <ClearButton
                onPress={() => setBirthdate(null)}
                accessibilityLabel={t('common_clear')}
              />
            ) : null
          }
        />
      </Card>

      <Text style={base.sectionTitle}>{t('section_company_role')}</Text>
      <Card paddedXOnly>
        <TextField
          label={t('label_department')}
          value={String(activeDeptName || t('placeholder_department'))}
          style={styles.field}
          pressable
          onPress={() => setDeptModalVisible(true)}
        />

        <TextField
          label={t('label_role')}
          value={String(ROLE_LABELS_LOCAL[role] || role)}
          style={styles.field}
          pressable
          onPress={() => setShowRoles(true)}
        />
      </Card>

      <Text style={base.sectionTitle}>{t('section_password')}</Text>
      <Card paddedXOnly>
        <View style={{ position: 'relative' }}>
          <TextField
            ref={pwdRef}
            label={t('label_password_new')}
            value={password}
            onChangeText={setPassword}
            placeholder={t('placeholder_new_password')}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.field}
            forceValidation={submittedAttempt}
            error={!passwordValid ? 'invalid' : undefined}
            rightSlot={
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Pressable
                  onPress={() => {
                    setShowPassword((v) => !v);
                  }}
                  android_ripple={{
                    color: theme?.colors?.border ?? '#00000020',
                    borderless: false,
                    radius: 24,
                  }}
                  accessibilityLabel={
                    showPassword ? t('a11y_hide_password') : t('a11y_show_password')
                  }
                  accessibilityRole="button"
                  hitSlop={{
                    top: theme.spacing.sm,
                    bottom: theme.spacing.sm,
                    left: theme.spacing.sm,
                    right: theme.spacing.sm,
                  }}
                  style={{ padding: theme.spacing.xs, borderRadius: theme.radii.md }}
                >
                  <Feather
                    name={showPassword ? 'eye-off' : 'eye'}
                    size={ICON_MD}
                    color={theme.colors.primary ?? theme.colors.text}
                  />
                </Pressable>
              </View>
            }
          />
        </View>

        <TextField
          label={t('label_password_repeat')}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder={t('placeholder_repeat_password')}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.field}
          forceValidation={submittedAttempt}
          error={!passwordsMatch ? 'mismatch' : undefined}
        />
      </Card>
      {/* action bar moved inside scroll so it scrolls with content */}
      <View style={styles.actionBar}>
        <UIButton
          variant="primary"
          onPress={handleCreate}
          disabled={submitting}
          style={styles.actionBtn}
          title={submitting ? t('toast_saving') : t('btn_create_employee')}
        />
      </View>

      <ConfirmModal
        visible={cancelVisible}
        onClose={() => setCancelVisible(false)}
        title={t('dlg_leave_title')}
        message={t('dlg_leave_msg')}
        confirmLabel={t('dlg_leave_confirm')}
        cancelLabel={t('dlg_leave_cancel')}
        confirmVariant="destructive"
        onConfirm={() => {
          allowLeaveRef.current = true;
          setCancelVisible(false);
          router.back();
        }}
      />

      <SelectModal
        visible={avatarSheet}
        onClose={() => setAvatarSheet(false)}
        title={t('profile_photo_title')}
        items={[
          {
            id: 'camera',
            label: t('profile_photo_take'),
            onPress: () => {
              setAvatarSheet(false);
              pickFromCamera();
            },
          },
          {
            id: 'gallery',
            label: t('profile_photo_choose'),
            onPress: () => {
              setAvatarSheet(false);
              pickFromLibrary();
            },
          },
          ...(avatarUrl
            ? [
                {
                  id: 'remove',
                  label: t('profile_photo_delete'),
                  onPress: () => {
                    setAvatarSheet(false);
                    setAvatarUrl(null);
                  },
                },
              ]
            : []),
        ]}
        searchable={false}
      />

      <SelectModal
        visible={deptModalVisible}
        onClose={() => setDeptModalVisible(false)}
        title={t('user_department_title')}
        items={(departments || []).map((d) => ({ id: d.id, label: d.name }))}
        searchable={false}
        onSelect={(it) => {
          setDepartmentId(it.id);
          setDeptModalVisible(false);
        }}
      />

      <SelectModal
        visible={showRoles}
        onClose={() => setShowRoles(false)}
        title={t('user_role_title')}
        items={roleItems}
        searchable={false}
        onSelect={(it) => {
          setRole(it.id);
          setShowRoles(false);
        }}
      />

      <DateTimeModal
        visible={dobModalVisible}
        onClose={() => setDobModalVisible(false)}
        mode="date"
        allowOmitYear={true}
        omitYearDefault={withYear}
        initial={birthdate || new Date()}
        onApply={(dateObj, extra) => {
          try {
            const d = new Date(dateObj);
            setBirthdate(d);
            if (extra && typeof extra.withYear === 'boolean') setWithYear(extra.withYear);
          } finally {
            setDobModalVisible(false);
          }
        }}
      />
    </Screen>
  );
}
