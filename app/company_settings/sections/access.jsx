import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Screen from '../../../components/layout/Screen';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import { listItemStyles } from '../../../components/ui/listItemStyles';
import ThemedSwitch from '../../../components/ui/ThemedSwitch';
import { useToast } from '../../../components/ui/ToastProvider';
import { supabase } from '../../../lib/supabase';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

const ROLE_IDS = ['admin', 'dispatcher', 'worker'];
const PERMISSIONS = [
  { key: 'canCreateOrders', labelKey: 'access_settings_perm_create_orders' },
  { key: 'canEditOrders', labelKey: 'access_settings_perm_edit_orders' },
  { key: 'canViewAllOrders', labelKey: 'access_settings_perm_view_all_orders' },
  { key: 'canDeleteOrders', labelKey: 'access_settings_perm_delete_orders' },
];
const ROLE_LABEL_KEYS = {
  admin: 'role_admin',
  dispatcher: 'role_dispatcher',
  worker: 'role_worker',
};

const PERMISSION_COLUMN_FLEX = 1.8;
const ROLE_COLUMN_FLEX = 1;

const createDefaultMatrix = () => ({
  admin: {
    canCreateOrders: true,
    canEditOrders: true,
    canViewAllOrders: true,
    canDeleteOrders: true,
  },
  dispatcher: {
    canCreateOrders: true,
    canEditOrders: true,
    canViewAllOrders: true,
    canDeleteOrders: false,
  },
  worker: {
    canCreateOrders: false,
    canEditOrders: false,
    canViewAllOrders: false,
    canDeleteOrders: false,
  },
});

const toBool = (value) =>
  value === true || value === 1 || value === '1' || value === 'true' || value === 't';

const mergeWithDefaults = (data) => {
  const merged = createDefaultMatrix();
  for (const roleId of ROLE_IDS) {
    merged[roleId] = { ...merged[roleId], ...(data?.[roleId] || {}) };
  }
  return merged;
};

export default function AccessSettingsScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const base = React.useMemo(() => listItemStyles(theme), [theme]);
  const s = React.useMemo(() => styles(theme), [theme]);

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
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
            setPermMatrix(mergeWithDefaults(fromDb));
          } else {
            setPermMatrix(createDefaultMatrix());
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
    setPermMatrix((prev) => ({
      ...prev,
      [roleId]: {
        ...prev[roleId],
        [permKey]: !prev[roleId]?.[permKey],
      },
    }));
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
      const payload = [];
      for (const roleId of ROLE_IDS) {
        for (const perm of PERMISSIONS) {
          payload.push({
            company_id: companyId,
            role: roleId,
            key: perm.key,
            value: !!permMatrix[roleId]?.[perm.key],
          });
        }
      }

      const { error } = await supabase
        .from('app_role_permissions')
        .upsert(payload, { onConflict: 'company_id,role,key' });
      if (error) throw error;

      try {
        const channel = supabase.channel('permissions');
        await channel.subscribe();
        await channel.send({
          type: 'broadcast',
          event: 'perm_changed',
          payload: { company_id: companyId, ts: Date.now() },
        });
        setTimeout(() => {
          try {
            supabase.removeChannel(channel);
          } catch {}
        }, 250);
      } catch {}

      toast.success(t('access_settings_saved'));
    } catch (error) {
      toast.error(error?.message || t('access_settings_save_failed'));
    } finally {
      setSaving(false);
    }
  }, [cloudReady, companyId, permMatrix, t, toast]);

  return (
    <Screen
      background="background"
      headerOptions={{ title: t('settings_management_access') }}
      contentContainerStyle={s.screenContent}
    >
      <Card padded={false}>
        {loading ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={s.loadingText}>{t('access_settings_loading')}</Text>
          </View>
        ) : (
          <>
            <View style={[s.row, s.headerRow]}>
              <Text style={[base.label, s.permissionHeader]}>{t('access_settings_column_permissions')}</Text>
              {ROLE_IDS.map((roleId) => (
                <View key={`header-${roleId}`} style={s.roleCol}>
                  <Text style={s.roleHeaderText}>{t(ROLE_LABEL_KEYS[roleId])}</Text>
                </View>
              ))}
            </View>

            {PERMISSIONS.map((perm, rowIndex) => (
              <View key={perm.key}>
                {rowIndex > 0 ? <View style={base.sep} /> : null}
                <View style={s.row}>
                  <Text style={[base.label, s.permissionLabel]}>{t(perm.labelKey)}</Text>
                  {ROLE_IDS.map((roleId) => (
                    <View key={`${roleId}-${perm.key}`} style={s.roleCol}>
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

      {!cloudReady && !loading ? (
        <Text style={s.hintText}>{t('access_settings_table_missing_hint')}</Text>
      ) : null}

      <Button
        title={t('access_settings_save')}
        onPress={onSave}
        loading={saving}
        disabled={loading || !cloudReady}
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
      minHeight: theme.components?.listItem?.height * 4 || theme.spacing.xxxl,
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
    },
    permissionHeader: {
      flex: PERMISSION_COLUMN_FLEX,
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
      flex: PERMISSION_COLUMN_FLEX,
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.regular,
    },
    roleCol: {
      flex: ROLE_COLUMN_FLEX,
      alignItems: 'center',
      justifyContent: 'center',
    },
    hintText: {
      color: theme.colors.textSecondary,
      fontSize: theme?.typography?.sizes?.xs ?? 12,
      lineHeight: Math.round((theme?.typography?.sizes?.xs ?? 12) * (theme?.typography?.lineHeights?.relaxed ?? 1.5)),
    },
  });
