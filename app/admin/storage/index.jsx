import { useNavigation } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Screen from '../../../components/layout/Screen';
import Card from '../../../components/ui/Card';
import LabelValueRow from '../../../components/ui/LabelValueRow';
import SectionHeader from '../../../components/ui/SectionHeader';
import { useRequireSuperAdmin } from '../../../hooks/useRequireSuperAdmin';
import { useAdminStorageOverview } from '../../../hooks/useAdminStorageOverview';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';
import { withAlpha } from '../../../theme/colors';

function formatBytes(valueBytes) {
  const bytes = Number(valueBytes || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const tb = 1024 * 1024 * 1024 * 1024;
  const gb = 1024 * 1024 * 1024;
  const mb = 1024 * 1024;
  if (bytes >= tb) return `${(bytes / tb).toFixed(2)} TB`;
  if (bytes >= gb) return `${(bytes / gb).toFixed(2)} GB`;
  if (bytes >= mb) return `${(bytes / mb).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function formatSignedBytes(valueBytes) {
  const value = Number(valueBytes || 0);
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${formatBytes(Math.abs(value))}`;
}

function getUsedTone(theme, usedPercent) {
  if (usedPercent >= 95) return theme.colors.danger;
  if (usedPercent >= 80) return theme.colors.warningStrong || theme.colors.warning;
  return theme.colors.success;
}

function getUsedLevel(usedPercent) {
  if (usedPercent >= 95) return 'critical';
  if (usedPercent >= 80) return 'warning';
  return 'ok';
}

function getDeltaTone(theme, delta) {
  if (delta > 0) return theme.colors.warning;
  if (delta < 0) return theme.colors.success;
  return theme.colors.textSecondary;
}

export default function AdminStorageScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const nav = useNavigation();
  const { isAllowed, isLoading } = useRequireSuperAdmin();
  const {
    data: rows,
    isLoading: metricsLoading,
    error,
  } = useAdminStorageOverview(isAllowed);

  React.useLayoutEffect(() => {
    nav.setParams({ headerTitle: t('routes.admin/storage') });
  }, [nav, t]);

  const baseRows = Array.isArray(rows) ? rows : [];

  if (isLoading || !isAllowed) return <Screen background="background" />;

  return (
    <Screen background="background" scroll={false}>
      <ScrollView
        contentContainerStyle={styles(theme).content}
        showsVerticalScrollIndicator={false}
      >
        {error ? (
          <Card>
            <Text style={styles(theme).error}>{String(error?.message || t('admin_unknown_error'))}</Text>
          </Card>
        ) : null}

        {baseRows.length === 0 && !metricsLoading ? (
          <Card>
            <Text style={styles(theme).text}>{t('admin_storage_empty')}</Text>
          </Card>
        ) : null}

        {baseRows.map((row) => {
          const used = Number(row?.used_bytes || 0);
          const systemUsed = Number(row?.system_used_bytes || 0);
          const mediaUsed = Number(row?.media_used_bytes || 0);
          const quota = Number(row?.quota_bytes || row?.filesystem_total_bytes || 0);
          const usedPercent = quota > 0 ? Math.max(0, Math.min(100, (used / quota) * 100)) : 0;
          const remaining = Math.max(quota - used, 0);
          const delta24 = Number(row?.delta_used_bytes_24h || 0);
          const deltaSystem24 = Number(row?.delta_system_used_bytes_24h || 0);
          const deltaMedia24 = Number(row?.delta_media_used_bytes_24h || 0);
          const tone = getUsedTone(theme, usedPercent);
          const deltaTone = getDeltaTone(theme, delta24);
          const deltaSystemTone = getDeltaTone(theme, deltaSystem24);
          const deltaMediaTone = getDeltaTone(theme, deltaMedia24);
          const level = getUsedLevel(usedPercent);
          const levelLabel = t(`admin_storage_level_${level}`);
          const measuredAt = row?.measured_at ? new Date(row.measured_at) : null;
          const measuredLabel = measuredAt ? measuredAt.toLocaleString() : '';
          const sourceMeta = t('admin_storage_primary_source');
          const sourceTitle = row?.source_name || t('admin_storage_source_default');
          const key = String(row?.source_code || row?.source_name || 'unknown');

          return (
            <View key={key} style={styles(theme).sectionWrap}>
              <SectionHeader>{sourceTitle}</SectionHeader>
              <Card paddedXOnly>
                <View style={styles(theme).headerRow}>
                  <View style={styles(theme).fill}>
                    {sourceMeta ? <Text style={styles(theme).sourceMeta}>{sourceMeta}</Text> : null}
                  </View>
                  <View style={[styles(theme).levelPill, { backgroundColor: withAlpha(tone, 0.14) }]}>
                    <Text style={[styles(theme).levelText, { color: tone }]}>{levelLabel}</Text>
                  </View>
                </View>
                <View style={styles(theme).remainingWrap}>
                  <Text style={[styles(theme).remainingPercent, { color: tone }]}>{`${usedPercent.toFixed(2)}%`}</Text>
                </View>
                <View style={styles(theme).details}>
                  <View style={styles(theme).barTrack}>
                    <View
                      style={[
                        styles(theme).barFill,
                        {
                          width: `${usedPercent}%`,
                          backgroundColor: tone,
                        },
                      ]}
                    />
                  </View>
                  <View style={styles(theme).scaleRow}>
                    <Text style={styles(theme).scaleText}>0</Text>
                    <Text style={styles(theme).scaleText}>{formatBytes(quota)}</Text>
                  </View>
                  <LabelValueRow label={t('admin_storage_used')} value={formatBytes(used)} />
                  <View style={styles(theme).sep} />
                  <LabelValueRow label={t('admin_storage_system_used')} value={formatBytes(systemUsed)} />
                  <View style={styles(theme).sep} />
                  <LabelValueRow label={t('admin_storage_media_used')} value={formatBytes(mediaUsed)} />
                  <View style={styles(theme).sep} />
                  <LabelValueRow label={t('admin_storage_remaining')} value={formatBytes(remaining)} />
                  <View style={styles(theme).sep} />
                  <LabelValueRow label={t('admin_storage_quota')} value={formatBytes(quota)} />
                  <View style={styles(theme).sep} />
                  <LabelValueRow label={t('admin_storage_last_update')} value={measuredLabel} />
                  <LabelValueRow
                    label={t('admin_storage_delta_24h')}
                    valueComponent={
                      <Text style={[styles(theme).sourceValue, { color: deltaTone }]}>
                        {formatSignedBytes(delta24)}
                      </Text>
                    }
                  />
                  <LabelValueRow
                    label={t('admin_storage_system_delta_24h')}
                    valueComponent={
                      <Text style={[styles(theme).sourceValue, { color: deltaSystemTone }]}>
                        {formatSignedBytes(deltaSystem24)}
                      </Text>
                    }
                  />
                  <LabelValueRow
                    label={t('admin_storage_media_delta_24h')}
                    valueComponent={
                      <Text style={[styles(theme).sourceValue, { color: deltaMediaTone }]}>
                        {formatSignedBytes(deltaMedia24)}
                      </Text>
                    }
                  />
                </View>
              </Card>
            </View>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

const styles = (theme) =>
  StyleSheet.create({
    content: { flexGrow: 1, padding: theme.spacing.lg, gap: theme.spacing.sm, paddingBottom: theme.spacing.xl },
    sectionWrap: { gap: 0 },
    fill: { flex: 1 },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingTop: theme.spacing.sm },
    levelPill: {
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 4,
      borderRadius: theme.radii.pill,
    },
    levelText: {
      fontSize: theme.typography.sizes.xs,
      fontWeight: theme.typography.weight.bold,
      textTransform: 'uppercase',
    },
    remainingWrap: {
      marginTop: theme.spacing.sm,
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: theme.spacing.xs,
    },
    remainingPercent: {
      fontSize: theme.typography.sizes.xl,
      fontWeight: theme.typography.weight.bold,
    },
    sourceMeta: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
    sourceValue: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.bold,
    },
    sep: {
      height: theme.components?.listItem?.dividerWidth ?? 1,
      backgroundColor: theme.colors.border,
      marginLeft: theme.spacing.xs,
      marginRight: theme.spacing.xs,
    },
    error: { color: theme.colors.danger, fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weight.semibold },
    scaleRow: { marginTop: theme.spacing.xs, flexDirection: 'row', justifyContent: 'space-between' },
    scaleText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.xs,
      fontWeight: theme.typography.weight.semibold,
    },
    barTrack: {
      marginTop: theme.spacing.sm,
      width: '100%',
      height: 10,
      borderRadius: theme.radii.pill,
      backgroundColor: withAlpha(theme.colors.textSecondary, 0.2),
      overflow: 'hidden',
    },
    barFill: { height: '100%', borderRadius: theme.radii.pill, minWidth: 2 },
    details: {
      marginTop: theme.spacing.sm,
      borderTopWidth: 0,
      borderTopColor: theme.colors.border,
      paddingTop: 0,
      paddingBottom: theme.spacing.sm,
      gap: theme.spacing.xs,
    },
  });
