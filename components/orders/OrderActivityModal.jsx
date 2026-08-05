import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme';
import { BaseModal } from '../ui/modals';
import OrderActivityTimeline from './OrderActivityTimeline';

export default function OrderActivityModal({ visible, onClose, orderId, version }) {
  const router = useRouter();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const pendingRouteRef = React.useRef(null);
  const [hasOpened, setHasOpened] = React.useState(false);

  React.useEffect(() => {
    if (visible) setHasOpened(true);
  }, [visible]);

  const close = React.useCallback(() => {
    pendingRouteRef.current = null;
    onClose?.();
  }, [onClose]);

  const openReference = React.useCallback((route) => {
    pendingRouteRef.current = String(route || '');
    onClose?.();
  }, [onClose]);

  const handleDismiss = React.useCallback(() => {
    const route = pendingRouteRef.current;
    pendingRouteRef.current = null;
    if (route) router.push(route);
  }, [router]);

  return (
    <BaseModal
      visible={visible}
      onRequestClose={close}
      onClose={onClose}
      onDismiss={handleDismiss}
      title={t('order_activity_title')}
      maxHeightRatio={0.9}
      disablePanClose
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: theme.spacing.lg }}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {hasOpened && orderId ? (
          <OrderActivityTimeline
            orderId={orderId}
            version={version}
            active={visible}
            onNavigateReference={openReference}
          />
        ) : null}
      </ScrollView>
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  scroll: {
    minHeight: 0,
  },
});
