import { ActivityIndicator, Text, View } from 'react-native';
import { useCompanySettings } from '../hooks/useCompanySettings';
import { useTranslation } from '../src/i18n/useTranslation';
import { useTheme } from '../theme/ThemeProvider';

export default function GlobalCurrencyRecalcBanner() {
  const { settings: companySettings } = useCompanySettings();
  const { t } = useTranslation();
  const { theme } = useTheme();

  if (!companySettings?.recalc_in_progress) return null;

  return (
    <View
      style={{
        width: '100%',
        backgroundColor: theme.colors.warning || '#F59E0B',
        paddingVertical: 8,
        paddingHorizontal: 12,
        alignItems: 'center',
        flexDirection: 'row',
        gap: 8,
      }}
    >
      <ActivityIndicator size="small" color={theme.colors.onPrimary || '#fff'} />
      <Text style={{ color: theme.colors.onPrimary || '#fff', fontWeight: '600' }}>
        {t('settings_recalc_in_progress')}
      </Text>
    </View>
  );
}
