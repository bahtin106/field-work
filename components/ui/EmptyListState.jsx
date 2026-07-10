import { StyleSheet, Text, View } from 'react-native';

import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme/ThemeProvider';

export default function EmptyListState({ style }) {
  const { theme } = useTheme();
  const { t } = useTranslation();

  return (
    <View style={[styles.wrap, { paddingVertical: theme.spacing.xl }, style]}>
      <Text style={[styles.text, { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm }]}>
        {t('empty_noResults')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  text: {
    textAlign: 'center',
  },
});
