// components/ui/modals/ConfirmAlertModals.jsx
import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../../../theme';
import BaseModal from './BaseModal';
import ModalActionsRow from './ModalActionsRow';
import { t as T } from '../../../src/i18n';

function ModalMessage({ message, theme }) {
  if (message == null) return null;
  if (React.isValidElement(message)) return message;
  return (
    <Text style={{ fontSize: theme.typography.sizes.md, color: theme.colors.textSecondary }}>
      {String(message)}
    </Text>
  );
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
      <View style={{ marginBottom: theme.spacing.md }}>
        <ModalMessage message={message} theme={theme} />
      </View>
    </BaseModal>
  );
}

export function AlertModal({ visible, title, message, buttonLabel = T('btn_ok'), onClose }) {
  const { theme } = useTheme();
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
        <ModalMessage message={message} theme={theme} />
      </View>
    </BaseModal>
  );
}
