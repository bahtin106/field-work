import Feather from '@expo/vector-icons/Feather';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import EmptyListState from '../ui/EmptyListState';
import SectionHeader from '../ui/SectionHeader';
import Button from '../ui/Button';
import BaseModal from '../ui/modals/BaseModal';
import HelpInfoButton from '../../src/features/helpCenter/HelpInfoButton';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme/ThemeProvider';

export default function StatisticsDetailModal({ visible, title, subtitle, sections = [], onClose }) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const s = React.useMemo(() => styles(theme), [theme]);
  const hasRows = sections.some((section) => Array.isArray(section?.rows) && section.rows.length > 0);
  const [infoRow, setInfoRow] = React.useState(null);

  React.useEffect(() => {
    if (!visible) setInfoRow(null);
  }, [visible]);

  return (
    <>
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={title}
      presentation="sheet"
      maxHeightRatio={0.9}
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
        {!hasRows ? <EmptyListState /> : null}
        {sections.map((section) => {
          if (!Array.isArray(section?.rows) || section.rows.length === 0) return null;
          return (
            <View key={section.id}>
              {section.title ? <SectionHeader>{section.title}</SectionHeader> : null}
              <View style={s.group}>
                {section.rows.map((row, index) => {
                  const rowStyle = [
                    s.row,
                    index === section.rows.length - 1 && s.lastRow,
                  ];
                  const content = (
                    <>
                      {row.color ? <View style={[s.dot, { backgroundColor: row.color }]} /> : null}
                      <View style={s.rowText}>
                        <Text style={s.label}>{row.label}</Text>
                        {row.secondary ? <Text style={s.secondary}>{row.secondary}</Text> : null}
                      </View>
                      {row.info ? (
                        <HelpInfoButton
                          size={22}
                          onPress={() => setInfoRow({ label: row.label, body: row.info })}
                          accessibilityLabel={`${row.label}: ${row.info}`}
                        />
                      ) : null}
                      {row.value !== '' && row.value != null ? (
                        <Text style={[s.value, row.valueColor ? { color: row.valueColor } : null]}>
                          {row.value}
                        </Text>
                      ) : null}
                      {row.chevron ? (
                        <Feather name="chevron-right" size={theme.icons.sm} color={theme.colors.textSecondary} />
                      ) : null}
                    </>
                  );
                  return row.onPress ? (
                    <Pressable
                      key={row.key || `${section.id}-${index}`}
                      onPress={row.onPress}
                      style={({ pressed }) => [
                        ...rowStyle,
                        pressed ? s.pressed : null,
                      ]}
                      accessibilityRole="button"
                    >
                      {content}
                    </Pressable>
                  ) : (
                    <View key={row.key || `${section.id}-${index}`} style={rowStyle}>
                      {content}
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </BaseModal>
    <BaseModal
      visible={Boolean(infoRow)}
      onClose={() => setInfoRow(null)}
      title={infoRow?.label || ''}
      presentation="sheet"
      maxHeightRatio={0.45}
      footer={<Button title={t('btn_close')} onPress={() => setInfoRow(null)} />}
    >
      <Text style={s.infoBody}>{infoRow?.body || ''}</Text>
    </BaseModal>
    </>
  );
}

const styles = (theme) =>
  StyleSheet.create({
    content: { paddingBottom: theme.spacing.lg },
    subtitle: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      lineHeight: Math.round(theme.typography.sizes.sm * theme.typography.lineHeights.relaxed),
      marginBottom: theme.spacing.sm,
    },
    group: {
      borderWidth: theme.components.card.borderWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.components.card.radius,
      backgroundColor: theme.colors.surface,
      overflow: 'hidden',
    },
    row: {
      minHeight: theme.components.listItem.height,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
      gap: theme.spacing.sm,
    },
    lastRow: { borderBottomWidth: 0 },
    dot: { width: theme.spacing.sm, height: theme.spacing.sm, borderRadius: theme.radii.pill },
    rowText: { flex: 1, minWidth: 0 },
    label: { color: theme.colors.text, fontSize: theme.typography.sizes.md },
    secondary: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.xs,
      marginTop: theme.spacing.xs,
    },
    value: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.semibold,
      textAlign: 'right',
      maxWidth: '42%',
    },
    infoBody: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      lineHeight: Math.round(theme.typography.sizes.md * theme.typography.lineHeights.relaxed),
    },
    pressed: { opacity: theme.components.interactive?.pressedOpacity ?? 0.72 },
  });
