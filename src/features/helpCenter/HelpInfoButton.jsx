import InfoHintButton from '../../../components/ui/InfoHintButton';
import { useTranslation } from '../../i18n/useTranslation';
import { useHelpCenter } from './HelpCenterProvider';

export default function HelpInfoButton({
  topicId,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  size = 28,
  style,
}) {
  const { t } = useTranslation();
  const { ready, preferences, openTopic } = useHelpCenter();

  if (!ready || preferences.contextualHelpEnabled === false) return null;
  if (!onPress && !topicId) return null;

  return (
    <InfoHintButton
      size={size}
      style={style}
      onPress={onPress || (() => openTopic(topicId))}
      accessibilityLabel={accessibilityLabel || t('help_info_accessibility')}
      accessibilityHint={accessibilityHint || t('help_info_accessibility_hint')}
    />
  );
}
