// components/ui/modals/ConfirmAlertModals.jsx
import React, { useEffect, useRef } from 'react';
import { Alert, View, Text } from 'react-native';
import { useTheme } from '../../../theme';
import BaseModal from './BaseModal';
import ModalActionsRow from './ModalActionsRow';
import { t as T } from '../../../src/i18n';

function NativeAlert({ visible, title, message, buttons, onDismiss }) {
  const configRef = useRef({ title, message, buttons, onDismiss });
  configRef.current = { title, message, buttons, onDismiss };

  useEffect(() => {
    if (!visible) return undefined;

    const config = configRef.current;
    let handled = false;
    const finish = (callback) => {
      if (handled) return;
      handled = true;
      try {
        callback?.();
      } catch {}
    };

    // Scheduling prevents React Strict Mode's development-only effect replay
    // from opening the same native alert twice.
    const timer = setTimeout(() => {
      Alert.alert(
        String(config.title || ''),
        String(config.message || ''),
        config.buttons.map((button) => ({
          text: String(button.text || ''),
          style: button.style,
          onPress: () => finish(button.onPress),
        })),
        {
          cancelable: true,
          onDismiss: () => finish(config.onDismiss),
        },
      );
    }, 0);

    return () => {
      clearTimeout(timer);
      handled = true;
    };
  }, [visible]);

  return null;
}

export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel = T('btn_ok'),
  cancelLabel = T('btn_cancel'),
  confirmVariant = 'primary',
  loading = false,
  onConfirm,
  onClose,
}) {
  const { theme } = useTheme();
  const canUseNativeAlert = message == null || ['string', 'number'].includes(typeof message);
  const handleConfirm = () => {
    try {
      onClose?.();
    } finally {
      requestAnimationFrame(() => {
        try {
          onConfirm?.();
        } catch {}
      });
    }
  };

  if (canUseNativeAlert) {
    return (
      <NativeAlert
        visible={visible}
        title={title}
        message={message}
        onDismiss={onClose}
        buttons={[
          { text: cancelLabel, style: 'cancel', onPress: onClose },
          {
            text: confirmLabel,
            style: confirmVariant === 'destructive' ? 'destructive' : 'default',
            onPress: handleConfirm,
          },
        ]}
      />
    );
  }

  const renderMessage = () => {
    if (message == null) return null;
    if (React.isValidElement(message)) return message;
    return (
      <Text style={{ fontSize: theme.typography.sizes.md, color: theme.colors.textSecondary }}>
        {message}
      </Text>
    );
  };
  const footer = (
    <ModalActionsRow
      actions={[
        {
          key: 'cancel',
          title: cancelLabel,
          variant: 'secondary',
          onPress: onClose,
        },
        {
          key: 'confirm',
          title: confirmLabel,
          variant: confirmVariant,
          dismissKeyboardOnPress: true,
          loading,
          onPress: handleConfirm,
        },
      ]}
    />
  );
  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={title}
      maxHeightRatio={0.5}
      presentation="dialog"
      footer={footer}
    >
      <View style={{ marginBottom: theme.spacing.md }}>{renderMessage()}</View>
    </BaseModal>
  );
}

export function AlertModal({ visible, title, message, buttonLabel = T('btn_ok'), onClose }) {
  const { theme } = useTheme();
  const canUseNativeAlert = message == null || ['string', 'number'].includes(typeof message);

  if (canUseNativeAlert) {
    return (
      <NativeAlert
        visible={visible}
        title={title}
        message={message}
        onDismiss={onClose}
        buttons={[{ text: buttonLabel, style: 'default', onPress: onClose }]}
      />
    );
  }

  const footer = (
    <ModalActionsRow
      actions={[
        {
          key: 'close',
          title: buttonLabel,
          variant: 'primary',
          onPress: onClose,
        },
      ]}
    />
  );
  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={title}
      maxHeightRatio={0.45}
      presentation="dialog"
      footer={footer}
    >
      <View style={{ marginBottom: theme.spacing.md }}>
        <Text style={{ fontSize: theme.typography.sizes.md, color: theme.colors.textSecondary }}>
          {message}
        </Text>
      </View>
    </BaseModal>
  );
}
