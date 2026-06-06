import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import Screen from '../../../components/layout/Screen';
import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import { SwitchField } from '../../../components/ui/TextField';
import { useToast } from '../../../components/ui/ToastProvider';
import { useCompanySettings } from '../../../hooks/useCompanySettings';
import {
  DEFAULT_FEED_ORDER_FIELDS,
  FEED_ORDER_FIELD_OPTIONS,
  normalizeFeedOrderFields,
} from '../../../lib/feedOrderFieldVisibility';
import {
  applyCompanySettingsCachePatch,
  broadcastCompanySettingsChanged,
  COMPANY_SETTINGS_QUERY_KEY,
} from '../../../lib/companySettingsQuery';
import { supabase } from '../../../lib/supabase';
import { useAuthContext } from '../../../providers/SimpleAuthProvider';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { listItemStyles } from '../../../components/ui/listItemStyles';
import { useTheme } from '../../../theme/ThemeProvider';

export default function OrderFeedFieldsSettingsScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile, user } = useAuthContext();
  const accountType = String(user?.user_metadata?.account_type || '').trim().toLowerCase();
  const isSoloAdmin = String(profile?.role || '').toLowerCase() === 'admin' && accountType === 'solo';
  const companyId = profile?.company_id || null;
  const { settings, isLoading, refetch } = useCompanySettings(companyId);
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const base = React.useMemo(() => listItemStyles(theme), [theme]);
  const [draft, setDraft] = React.useState(() => [...DEFAULT_FEED_ORDER_FIELDS]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!settings) return;
    setDraft(normalizeFeedOrderFields(settings.feed_order_card_fields));
  }, [settings]);

  React.useEffect(() => {
    if (!isSoloAdmin) return;
    router.replace('/company_settings');
  }, [isSoloAdmin, router]);

  const toggleField = React.useCallback((key) => {
    setDraft((prev) => {
      const normalized = normalizeFeedOrderFields(prev);
      if (normalized.includes(key)) {
        return normalized.filter((item) => item !== key);
      }
      const optionOrder = FEED_ORDER_FIELD_OPTIONS.map((item) => item.key);
      return [...normalized, key].sort((a, b) => optionOrder.indexOf(a) - optionOrder.indexOf(b));
    });
  }, []);

  const save = React.useCallback(async () => {
    if (isSoloAdmin) return;
    if (!companyId) {
      toast.error(t('errors_companyNotFound'));
      return;
    }
    setSaving(true);
    try {
      const payload = normalizeFeedOrderFields(draft);
      const patch = { feed_order_card_fields: payload };
      const { error } = await supabase
        .from('companies')
        .update(patch)
        .eq('id', companyId);
      if (error) throw error;
      applyCompanySettingsCachePatch(queryClient, companyId, patch);
      await broadcastCompanySettingsChanged(companyId, Object.keys(patch));
      await queryClient.invalidateQueries({ queryKey: COMPANY_SETTINGS_QUERY_KEY, refetchType: 'active' });
      await refetch();
      toast.success(t('toast_settingsSaved'));
    } catch (error) {
      toast.error(error?.message || t('toast_error'));
    } finally {
      setSaving(false);
    }
  }, [companyId, draft, isSoloAdmin, queryClient, refetch, t, toast]);

  if (isSoloAdmin) return null;

  return (
    <Screen
      scroll={false}
      background="background"
      headerOptions={{ title: t('settings_management_feed_fields') }}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Card paddedXOnly>
          {FEED_ORDER_FIELD_OPTIONS.map((item) => {
            const checked = draft.includes(item.key);
            const disabled = saving || isLoading;
            return (
              <React.Fragment key={item.key}>
                <SwitchField
                  label={t(item.labelKey)}
                  value={checked}
                  onValueChange={() => toggleField(item.key)}
                  disabled={disabled}
                />
                {item.key !== FEED_ORDER_FIELD_OPTIONS[FEED_ORDER_FIELD_OPTIONS.length - 1].key ? <View style={base.sep} /> : null}
              </React.Fragment>
            );
          })}
        </Card>
        <Button
          title={saving ? t('btn_saving') : t('btn_save')}
          onPress={save}
          loading={saving}
          disabled={saving || isLoading}
          style={styles.saveButton}
        />
      </ScrollView>
    </Screen>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    content: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.components?.scrollView?.paddingBottom ?? theme.spacing.xl,
      gap: theme.spacing.sm,
    },
    saveButton: {
      marginTop: theme.spacing.md,
    },
  });
}
