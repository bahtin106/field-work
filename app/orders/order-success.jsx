// apps/field-work/app/orders/order-success.jsx
import { useMemo } from 'react';
import { router } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '../../components/ui/Button';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme/ThemeProvider';

export default function OrderSuccessScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          justifyContent: 'center',
          padding: 24,
          backgroundColor: theme.colors.background, // was theme.colors.bg
        },
        messageBox: {
          backgroundColor: theme.colors.surface, // was theme.colors.card
          padding: 32,
          borderRadius: 12,
          shadowColor:
            theme.colors.shadow ||
            theme.colors.cardShadow ||
            theme.shadows?.level2?.ios?.shadowColor,
          shadowOpacity: 0.1,
          shadowRadius: 10,
          elevation: 4,
        },
        successText: {
          fontSize: 20,
          fontWeight: 'bold',
          marginBottom: 20,
          textAlign: 'center',
          color: theme.colors.success,
        },
      }),
    [theme],
  );

  const goHome = () => {
    // Your app's "home" lives under /orders (see _layout initialRouteName and BottomNav PATHS)
    router.replace('/orders');
  };

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <View style={styles.messageBox}>
        <Text style={styles.successText}>{t('order_success_title')}</Text>
        <Button title={t('order_success_home')} onPress={goHome} />
      </View>
    </SafeAreaView>
  );
}
