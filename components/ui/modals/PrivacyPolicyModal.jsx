import { ScrollView, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme';
import BaseModal from './BaseModal';

export default function PrivacyPolicyModal({ visible, onClose }) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={t('privacy_policy_title')}
      maxHeightRatio={0.85}
      showHandle
    >
      <ScrollView
        style={{ maxHeight: 400, marginBottom: insets.bottom }}
        contentContainerStyle={{ paddingVertical: theme.spacing.md }}
        showsVerticalScrollIndicator={true}
      >
        <Text
          style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md, lineHeight: 22 }}
        >
          {t('privacy_policy_body')}
        </Text>
      </ScrollView>
    </BaseModal>
  );
}
