import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Screen from '../../../components/layout/Screen';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import SectionHeader from '../../../components/ui/SectionHeader';
import { listItemStyles } from '../../../components/ui/listItemStyles';
import ThemedSwitch from '../../../components/ui/ThemedSwitch';
import { useToast } from '../../../components/ui/ToastProvider';
import { START_PRESET, usePermissions } from '../../../lib/permissions';
import { supabase } from '../../../lib/supabase';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

const ROLE_IDS = ['admin', 'dispatcher', 'worker'];
const ACCESS_SECTIONS = [
  {
    id: 'requests',
    titleKey: 'access_settings_section_requests',
    permissions: [
      { key: 'canCreateOrders', labelKey: 'access_settings_perm_create_orders' },
      { key: 'canEditOrders', labelKey: 'access_settings_perm_edit_orders' },
      { key: 'canViewAllOrders', labelKey: 'access_settings_perm_view_all_orders' },
      { key: 'canDeleteOrders', labelKey: 'access_settings_perm_delete_orders' },
      { key: 'canAddGalleryPhotos', labelKey: 'access_settings_perm_add_gallery_photos' },
      { key: 'canAddCameraPhotos', labelKey: 'access_settings_perm_add_camera_photos' },
      { key: 'canViewFinanceAll', labelKey: 'access_settings_perm_view_order_finance_field' },
      { key: 'canEditFinanceEntries', labelKey: 'access_settings_perm_edit_order_finance_field' },
    ],
  },
  {
    id: 'clients',
    titleKey: 'access_settings_section_clients',
    permissions: [
      { key: 'canEditClients', labelKey: 'access_settings_perm_edit_clients' },
      { key: 'canDeleteClients', labelKey: 'access_settings_perm_delete_clients' },
    ],
  },
  {
    id: 'objects',
    titleKey: 'access_settings_section_objects',
    permissions: [
      { key: 'canEditObjects', labelKey: 'access_settings_perm_edit_objects' },
      { key: 'canDeleteObjects', labelKey: 'access_settings_perm_delete_objects' },
    ],
  },
];
const ROLE_LABEL_KEYS = {
  admin: 'role_admin',
  dispatcher: 'role_dispatcher',
  worker: 'role_worker',
};
const BROADCAST_CHANNEL = 'permissions';
const BROADCAST_EVENT = 'perm_changed';
const BROADCAST_CLEANUP_DELAY_MS = 250;

const REQUEST_PERMISSION_KEYS = ACCESS_SECTIONS.flatMap((section) =>
  section.permissions.map((permission) => permission.key),
);
const PERSISTED_PERMISSION_KEYS = Array.from(new Set([...REQUEST_PERMISSION_KEYS]));
const PERSISTED_PERMISSION_IN_FILTER = `(${PERSISTED_PERMISSION_KEYS.map((key) => `"${key}"`).join(',')})`;

const createDefaultMatrix = () =>
  ROLE_IDS.reduce((acc, roleId) => {
    const roleDefaults = START_PRESET?.[roleId] || {};
    acc[roleId] = REQUEST_PERMISSION_KEYS.reduce((roleAcc, permissionKey) => {
      roleAcc[permissionKey] = !!roleDefaults[permissionKey];
      return roleAcc;
    }, {});
    return acc;
  }, {});

const toBool = (value) =>
  value === true || value === 1 || value === '1' || value === 'true' || value === 't';

const mergeWithDefaults = (data) => {
  const merged = createDefaultMatrix();
  for (const roleId of ROLE_IDS) {
    merged[roleId] = { ...merged[roleId], ...(data?.[roleId] || {}) };
  }
  return merged;
};

const normalizePermissionDependencies = (matrix) =>
  ROLE_IDS.reduce((acc, roleId) => {
    const rolePerms = { ...(matrix?.[roleId] || {}) };
    if (rolePerms.canEditFinanceEntries) rolePerms.canViewFinanceAll = true;
    if (!rolePerms.canViewFinanceAll) {
      rolePerms.canEditFinanceEntries = false;
    }
    acc[roleId] = rolePerms;
    return acc;
  }, {});

const VIEW_EDIT_LINKS = {
  canEditFinanceEntries: 'canViewFinanceAll',
};
const EDIT_VIEW_LINKS = {
  canViewFinanceAll: 'canEditFinanceEntries',
};

export default function AccessSettingsScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const { refresh: refreshPermissions } = usePermissions();
  const base = React.useMemo(() => listItemStyles(theme), [theme]);
  const s = React.useMemo(() => styles(theme), [theme]);
  const cardPadX = React.useMemo(
    () => theme.spacing[theme.components?.card?.padX ?? 'lg'],
    [theme],
  );
  const roleColumnFlex = React.useMemo(() => 1, []);
  const permissionColumnFlex = React.useMemo(() => ROLE_IDS.length, []);

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [resettingDefaults, setResettingDefaults] = React.useState(false);
  const [companyId, setCompanyId] = React.useState(null);
  const [cloudReady, setCloudReady] = React.useState(false);
  const [permMatrix, setPermMatrix] = React.useState(createDefaultMatrix);

  React.useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { data: userRes, error: userErr } = await supabase.auth.getUser();
        if (userErr) throw userErr;
        const userId = userRes?.user?.id;
        if (!userId) throw new Error(t('access_settings_error_user_not_found'));

        const { data: profile, error: profileErr } = await supabase
          .from('profiles')
          .select('company_id')
          .eq('id', userId)
          .maybeSingle();
        if (profileErr) throw profileErr;

        const nextCompanyId = profile?.company_id ?? null;
        if (mounted) setCompanyId(nextCompanyId);
        if (!nextCompanyId) throw new Error(t('access_settings_error_company_missing'));

        const { data: rows, error: permsErr } = await supabase
          .from('app_role_permissions')
          .select('role, key, value')
          .eq('company_id', nextCompanyId);

        if (permsErr) {
          if (mounted) setCloudReady(false);
          return;
        }

        if (mounted) {
          setCloudReady(true);
          if (Array.isArray(rows) && rows.length > 0) {
            const fromDb = { admin: {}, dispatcher: {}, worker: {} };
            for (const row of rows) {
              if (!fromDb[row.role]) fromDb[row.role] = {};
              fromDb[row.role][row.key] = toBool(row.value);
            }
            setPermMatrix(normalizePermissionDependencies(mergeWithDefaults(fromDb)));
          } else {
            setPermMatrix(normalizePermissionDependencies(createDefaultMatrix()));
          }
        }
      } catch (error) {
        if (mounted) {
          toast.error(error?.message || t('access_settings_load_failed'));
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [t, toast]);

  const onToggle = React.useCallback((roleId, permKey) => {
    setPermMatrix((prev) => {
      const next = {
        ...prev,
        [roleId]: (() => {
          const currentRole = prev[roleId] || {};
          const nextValue = !currentRole?.[permKey];
          const nextRole = {
            ...currentRole,
            [permKey]: nextValue,
          };

          const requiredViewKey = VIEW_EDIT_LINKS[permKey];
          if (requiredViewKey && nextValue) {
            nextRole[requiredViewKey] = true;
          }

          const dependentEditKey = EDIT_VIEW_LINKS[permKey];
          if (dependentEditKey && !nextValue) {
            nextRole[dependentEditKey] = false;
          }

          return nextRole;
        })(),
      };
      return normalizePermissionDependencies(next);
    });
  }, []);

  const onSave = React.useCallback(async () => {
    if (!companyId) {
      toast.error(t('access_settings_error_company_missing'));
      return;
    }
    if (!cloudReady) {
      toast.error(t('access_settings_error_table_missing'));
      return;
    }

    setSaving(true);
    try {
      const normalizedMatrix = normalizePermissionDependencies(permMatrix);
      const payload = [];
      for (const roleId of ROLE_IDS) {
        for (const permissionKey of PERSISTED_PERMISSION_KEYS) {
          payload.push({
            company_id: companyId,
            role: roleId,
            key: permissionKey,
            value: !!normalizedMatrix[roleId]?.[permissionKey],
          });
        }
      }

      // Keep DB strictly aligned with the active permission model.
      const { error: deleteLegacyError } = await supabase
        .from('app_role_permissions')
        .delete()
        .eq('company_id', companyId)
        .not('key', 'in', PERSISTED_PERMISSION_IN_FILTER);
      if (deleteLegacyError) throw deleteLegacyError;

      const { error } = await supabase
        .from('app_role_permissions')
        .upsert(payload, { onConflict: 'company_id,role,key' });
      if (error) throw error;

      try {
        const channel = supabase.channel(BROADCAST_CHANNEL);
        await channel.subscribe();
        try {
          const message = {
            type: 'broadcast',
            event: BROADCAST_EVENT,
            payload: { company_id: companyId, ts: Date.now() },
          };
          if (typeof channel.httpSend === 'function') {
            await channel.httpSend(message);
          } else if (typeof channel.send === 'function') {
            await channel.send(message);
          }
        } catch {
          // best-effort broadcast; ignore errors
        }
        setTimeout(() => {
          try {
            supabase.removeChannel(channel);
          } catch {}
        }, BROADCAST_CLEANUP_DELAY_MS);
      } catch {}

      try {
        await refreshPermissions({ silent: true });
      } catch {}

      toast.success(t('access_settings_saved'));
    } catch (error) {
      toast.error(error?.message || t('access_settings_save_failed'));
    } finally {
      setSaving(false);
    }
  }, [cloudReady, companyId, permMatrix, t, toast, refreshPermissions]);

  const onApplyDefaults = React.useCallback(async () => {
    if (!companyId) {
      toast.error(t('access_settings_error_company_missing'));
      return;
    }
    if (!cloudReady) {
      toast.error(t('access_settings_error_table_missing'));
      return;
    }

    setResettingDefaults(true);
    try {
      const defaults = normalizePermissionDependencies(createDefaultMatrix());
      const payload = [];
      for (const roleId of ROLE_IDS) {
        for (const permissionKey of PERSISTED_PERMISSION_KEYS) {
          payload.push({
            company_id: companyId,
            role: roleId,
            key: permissionKey,
            value: !!defaults[roleId]?.[permissionKey],
          });
        }
      }

      const { error: deleteError } = await supabase
        .from('app_role_permissions')
        .delete()
        .eq('company_id', companyId);
      if (deleteError) throw deleteError;

      const { error: upsertDefaultsError } = await supabase
        .from('app_role_permissions')
        .upsert(payload, { onConflict: 'company_id,role,key' });
      if (upsertDefaultsError) throw upsertDefaultsError;

      setPermMatrix(defaults);

      try {
        const channel = supabase.channel(BROADCAST_CHANNEL);
        await channel.subscribe();
        try {
          const message = {
            type: 'broadcast',
            event: BROADCAST_EVENT,
            payload: { company_id: companyId, ts: Date.now() },
          };
          if (typeof channel.httpSend === 'function') {
            await channel.httpSend(message);
          } else if (typeof channel.send === 'function') {
            await channel.send(message);
          }
        } catch {
          // best-effort broadcast; ignore errors
        }
        setTimeout(() => {
          try {
            supabase.removeChannel(channel);
          } catch {}
        }, BROADCAST_CLEANUP_DELAY_MS);
      } catch {}

      try {
        await refreshPermissions({ silent: true });
      } catch {}

      toast.success(t('access_settings_defaults_applied'));
    } catch (error) {
      toast.error(error?.message || t('access_settings_save_failed'));
    } finally {
      setResettingDefaults(false);
    }
  }, [cloudReady, companyId, t, toast, refreshPermissions]);

  return (
    <Screen
      background="background"
      headerOptions={{ title: t('settings_management_access') }}
      contentContainerStyle={s.screenContent}
    >
      <Button
        title={t('access_settings_apply_defaults')}
        onPress={onApplyDefaults}
        loading={resettingDefaults}
        disabled={loading || !cloudReady || saving}
        variant="secondary"
      />

      {ACCESS_SECTIONS.map((section) => (
        <React.Fragment key={section.id}>
          <SectionHeader topSpacing={0}>{t(section.titleKey)}</SectionHeader>
          <Card paddedXOnly>
            {loading ? (
              <View style={s.loadingWrap}>
                <ActivityIndicator color={theme.colors.primary} />
                <Text style={s.loadingText}>{t('access_settings_loading')}</Text>
              </View>
            ) : (
              <>
                <View
                  style={[
                    s.row,
                    s.headerRow,
                    {
                      marginHorizontal: -cardPadX,
                      paddingHorizontal: theme.spacing.md + cardPadX,
                    },
                  ]}
                >
                  <Text
                    style={[
                      base.label,
                      s.permissionHeader,
                      { flex: permissionColumnFlex },
                    ]}
                  >
                    {t('access_settings_column_permissions')}
                  </Text>
                  {ROLE_IDS.map((roleId) => (
                    <View key={`header-${section.id}-${roleId}`} style={[s.roleCol, { flex: roleColumnFlex }]}>
                      <Text style={s.roleHeaderText}>{t(ROLE_LABEL_KEYS[roleId])}</Text>
                    </View>
                  ))}
                </View>

                {section.permissions.map((perm, rowIndex) => (
                  <View key={`${section.id}-${perm.key}`}>
                    {rowIndex > 0 ? <View style={base.sep} /> : null}
                    <View style={s.row}>
                      <Text
                        style={[
                          base.label,
                          s.permissionLabel,
                          { flex: permissionColumnFlex },
                        ]}
                      >
                        {t(perm.labelKey)}
                      </Text>
                      {ROLE_IDS.map((roleId) => (
                        <View key={`${section.id}-${roleId}-${perm.key}`} style={[s.roleCol, { flex: roleColumnFlex }]}>
                          <ThemedSwitch
                            value={!!permMatrix[roleId]?.[perm.key]}
                            onValueChange={() => onToggle(roleId, perm.key)}
                          />
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
              </>
            )}
          </Card>
        </React.Fragment>
      ))}

      {!cloudReady && !loading ? (
        <Text style={s.hintText}>{t('access_settings_table_missing_hint')}</Text>
      ) : null}

      <Button
        title={t('access_settings_save')}
        onPress={onSave}
        loading={saving}
        disabled={loading || !cloudReady || resettingDefaults}
        style={s.saveButton}
      />
    </Screen>
  );
}

const styles = (theme) =>
  StyleSheet.create({
    screenContent: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
      gap: theme.spacing.md,
    },
    loadingWrap: {
      minHeight: (theme.components?.listItem?.height || 0) * (permissionsCount + 1),
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.sm,
      paddingVertical: theme.spacing.xl,
      paddingHorizontal: theme.spacing.lg,
    },
    loadingText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.medium,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: theme.components?.listItem?.height,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      gap: theme.spacing.xs,
    },
    headerRow: {
      borderBottomWidth: theme.components?.listItem?.dividerWidth,
      borderBottomColor: theme.colors.border,
      backgroundColor: theme.colors.background,
      borderTopLeftRadius: theme.radii.xl,
      borderTopRightRadius: theme.radii.xl,
    },
    permissionHeader: {
      color: theme.colors.textSecondary,
      fontWeight: theme.typography.weight.semibold,
    },
    roleHeaderText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.xs,
      fontWeight: theme.typography.weight.semibold,
      textAlign: 'center',
    },
    permissionLabel: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.regular,
    },
    roleCol: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    hintText: {
      color: theme.colors.textSecondary,
      fontSize: theme?.typography?.sizes?.xs ?? 12,
      lineHeight: Math.round((theme?.typography?.sizes?.xs ?? 12) * (theme?.typography?.lineHeights?.relaxed ?? 1.5)),
    },
    saveButton: {
      marginTop: theme.spacing.sm,
    },
  });

const permissionsCount = ACCESS_SECTIONS.reduce(
  (sum, section) => sum + section.permissions.length,
  0,
);
