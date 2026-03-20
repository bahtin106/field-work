import React, { Suspense } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

const CompanySettingsScreen = React.lazy(() => import('./CompanySettingsScreen'));

function CompanySettingsFallback() {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.background,
      }}
    >
      <ActivityIndicator size="small" color={theme.colors.primary} />
    </View>
  );
}

export default function CompanySettingsRoute() {
  return (
    <Suspense fallback={<CompanySettingsFallback />}>
      <CompanySettingsScreen />
    </Suspense>
  );
}
