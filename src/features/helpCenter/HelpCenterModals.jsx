import Feather from '@expo/vector-icons/Feather';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Button from '../../../components/ui/Button';
import ThemedSwitch from '../../../components/ui/ThemedSwitch';
import { BaseModal } from '../../../components/ui/modals';
import ModalActionsRow from '../../../components/ui/modals/ModalActionsRow';
import { useTranslation } from '../../i18n/useTranslation';
import { useTheme } from '../../../theme';
import { withAlpha } from '../../../theme/colors';

function IntroIcon({ name }) {
  const { theme } = useTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={s.introIcon}>
      <Feather name={name} size={24} color={theme.colors.primary} />
    </View>
  );
}

function PreferenceRow({ icon, label, description, value, onValueChange }) {
  const { theme } = useTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable
      style={({ pressed }) => [s.preferenceRow, pressed && s.pressedRow]}
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: !!value }}
      accessibilityLabel={label}
      accessibilityHint={description}
    >
      <View style={s.preferenceIcon}>
        <Feather name={icon} size={19} color={theme.colors.primary} />
      </View>
      <View style={s.preferenceCopy}>
        <Text style={s.preferenceLabel}>{label}</Text>
        <Text style={s.preferenceDescription}>{description}</Text>
      </View>
      <View pointerEvents="none">
        <ThemedSwitch value={!!value} onValueChange={() => {}} />
      </View>
    </Pressable>
  );
}

function CheckRow({ label, value, onValueChange }) {
  const { theme } = useTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable
      style={({ pressed }) => [s.checkRow, pressed && s.pressedRow]}
      onPress={() => onValueChange(!value)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!value }}
      accessibilityLabel={label}
    >
      <View style={[s.checkBox, value && s.checkBoxChecked]}>
        {value ? <Feather name="check" size={15} color={theme.colors.primaryTextOn} /> : null}
      </View>
      <Text style={s.checkLabel}>{label}</Text>
    </Pressable>
  );
}

export function HelpSettingsModal({ visible, preferences, hiddenTipCount, onClose, onSave, onResetHidden }) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  const [draft, setDraft] = useState(preferences);

  useEffect(() => {
    if (visible) setDraft(preferences);
  }, [preferences, visible]);

  const footer = (
    <ModalActionsRow
      actions={[
        { key: 'cancel', title: t('btn_cancel'), variant: 'secondary', onPress: onClose },
        { key: 'save', title: t('btn_ok'), variant: 'primary', onPress: () => onSave(draft) },
      ]}
    />
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={t('help_settings_title')}
      footer={footer}
      maxHeightRatio={0.82}
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <View style={s.introRow}>
          <IntroIcon name="help-circle" />
          <Text style={s.introText}>{t('help_settings_intro')}</Text>
        </View>

        <View style={s.preferenceCard}>
          <PreferenceRow
            icon="info"
            label={t('help_settings_contextual_title')}
            description={t('help_settings_contextual_body')}
            value={draft.contextualHelpEnabled !== false}
            onValueChange={(value) => setDraft((prev) => ({ ...prev, contextualHelpEnabled: value }))}
          />
          <View style={s.divider} />
          <PreferenceRow
            icon="zap"
            label={t('help_settings_smart_title')}
            description={t('help_settings_smart_body')}
            value={draft.smartTipsEnabled !== false}
            onValueChange={(value) => setDraft((prev) => ({ ...prev, smartTipsEnabled: value }))}
          />
        </View>

        <Text style={s.privacyNote}>{t('help_settings_offline_note')}</Text>

        {hiddenTipCount > 0 ? (
          <Button
            title={t('help_settings_restore_hidden').replace('{count}', String(hiddenTipCount))}
            variant="outline"
            size="sm"
            onPress={onResetHidden}
          />
        ) : null}
      </ScrollView>
    </BaseModal>
  );
}

export function ContextHelpModal({ topic, visible, onClose }) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  if (!topic) return null;

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={t(topic.titleKey)}
      maxHeightRatio={0.76}
      footer={<ModalActionsRow actions={[{ key: 'ok', title: t('btn_ok'), onPress: onClose }]} />}
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <View style={s.centerIcon}><IntroIcon name={topic.icon} /></View>
        <Text style={s.bodyText}>{t(topic.bodyKey)}</Text>
        <View style={s.explanationCard}>
          <View style={s.explanationRow}>
            <Feather name="check-circle" size={19} color={theme.colors.primary} />
            <Text style={s.explanationText}>{t(topic.actionKey)}</Text>
          </View>
          <View style={s.explanationRow}>
            <Feather name="info" size={19} color={theme.colors.primary} />
            <Text style={s.explanationText}>{t(topic.noteKey)}</Text>
          </View>
        </View>
      </ScrollView>
    </BaseModal>
  );
}

export function SmartTipModal({ tip, visible, onClose, onApply, onLearnMore }) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  const [hideTip, setHideTip] = useState(false);
  const [disableAll, setDisableAll] = useState(false);

  useEffect(() => {
    if (visible) {
      setHideTip(false);
      setDisableAll(false);
    }
  }, [tip?.id, visible]);

  if (!tip) return null;

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={t('help_feature_suggestion_title')}
      maxHeightRatio={0.86}
      footer={
        <ModalActionsRow
          actions={[
            { key: 'cancel', title: t('btn_cancel'), variant: 'secondary', onPress: onClose },
            {
              key: 'ok',
              title: t('btn_ok'),
              variant: 'primary',
              onPress: () => onApply({ hideTip, disableAll }),
            },
          ]}
        />
      }
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <View style={s.featureCard}>
          <View style={s.featureCardHeader}>
            <View style={s.featureCardIcon}>
              <Feather name={tip.icon || 'zap'} size={22} color={theme.colors.primary} />
            </View>
            <View style={s.featureCardHeading}>
              <Text style={s.tipEyebrow}>{t(tip.categoryKey || 'help_smart_tip_eyebrow')}</Text>
              <Text style={s.featureCardTitle}>{t(tip.titleKey)}</Text>
            </View>
          </View>
          <Text style={s.featureCardBody}>{t(tip.bodyKey)}</Text>
          <View style={s.featureValueRow}>
            <Feather name="check-circle" size={18} color={theme.colors.primary} />
            <Text style={s.featureValueText}>{t(tip.valueKey)}</Text>
          </View>
        </View>
        <Button
          title={t('help_learn_more')}
          variant="outline"
          size="sm"
          onPress={onLearnMore}
          style={s.learnMoreButton}
        />
        <View style={s.checkPanel}>
          <CheckRow label={t('help_tip_hide_this')} value={hideTip} onValueChange={setHideTip} />
          <View style={s.divider} />
          <CheckRow label={t('help_tip_disable_all')} value={disableAll} onValueChange={setDisableAll} />
        </View>
      </ScrollView>
    </BaseModal>
  );
}

const createStyles = (theme) =>
  StyleSheet.create({
    content: { paddingBottom: theme.spacing.xs, gap: theme.spacing.md },
    introRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
    introIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(theme.colors.primary, 0.11),
      borderWidth: 1,
      borderColor: withAlpha(theme.colors.primary, 0.22),
    },
    centerIcon: { alignItems: 'center' },
    introText: {
      flex: 1,
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      lineHeight: Math.round(theme.typography.sizes.sm * 1.45),
    },
    preferenceCard: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.xl,
      overflow: 'hidden',
      backgroundColor: theme.colors.surface,
    },
    preferenceRow: {
      minHeight: 82,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    pressedRow: { backgroundColor: theme.colors.ripple },
    preferenceIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(theme.colors.primary, 0.09),
    },
    preferenceCopy: { flex: 1, minWidth: 0 },
    preferenceLabel: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
    },
    preferenceDescription: {
      marginTop: 3,
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.xs,
      lineHeight: Math.round(theme.typography.sizes.xs * 1.35),
    },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border },
    privacyNote: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.xs,
      lineHeight: Math.round(theme.typography.sizes.xs * 1.4),
    },
    bodyText: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      lineHeight: Math.round(theme.typography.sizes.md * 1.5),
    },
    explanationCard: {
      padding: theme.spacing.md,
      borderRadius: theme.radii.lg,
      backgroundColor: withAlpha(theme.colors.primary, 0.07),
      gap: theme.spacing.md,
    },
    explanationRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm },
    explanationText: {
      flex: 1,
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      lineHeight: Math.round(theme.typography.sizes.sm * 1.42),
    },
    tipEyebrow: {
      color: theme.colors.primary,
      textTransform: 'uppercase',
      letterSpacing: 0.7,
      fontSize: theme.typography.sizes.xs,
      fontWeight: theme.typography.weight.bold,
    },
    featureCard: {
      borderWidth: 1,
      borderColor: withAlpha(theme.colors.primary, 0.25),
      borderRadius: theme.radii.xl,
      padding: theme.spacing.md,
      backgroundColor: withAlpha(theme.colors.primary, 0.055),
      gap: theme.spacing.md,
    },
    featureCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    featureCardIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: withAlpha(theme.colors.primary, 0.2),
    },
    featureCardHeading: { flex: 1, minWidth: 0, gap: 3 },
    featureCardTitle: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.lg,
      fontWeight: theme.typography.weight.bold,
      lineHeight: Math.round(theme.typography.sizes.lg * 1.25),
    },
    featureCardBody: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      lineHeight: Math.round(theme.typography.sizes.sm * 1.48),
    },
    featureValueRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.sm,
      paddingTop: theme.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(theme.colors.primary, 0.22),
    },
    featureValueText: {
      flex: 1,
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      lineHeight: Math.round(theme.typography.sizes.sm * 1.4),
    },
    learnMoreButton: { alignSelf: 'stretch' },
    checkPanel: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.lg,
      overflow: 'hidden',
      backgroundColor: theme.colors.surface,
    },
    checkRow: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
    },
    checkBox: {
      width: 23,
      height: 23,
      borderRadius: theme.radii.xs,
      borderWidth: 2,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkBoxChecked: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary },
    checkLabel: { flex: 1, color: theme.colors.text, fontSize: theme.typography.sizes.sm },
  });
