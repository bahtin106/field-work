// components/ui/modals/ConfirmAlertModals.jsx
import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../../../theme';
import BaseModal from './BaseModal';
import ModalActionsRow from './ModalActionsRow';
import { t as T } from '../../../src/i18n';

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
          loading,
          onPress: () => {
            try {
              onClose?.();
            } finally {
              setTimeout(() => {
                try {
                  onConfirm?.();
                } catch {}
              }, 360);
            }
          },
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
      footer={footer}
    >
      <View style={{ marginBottom: theme.spacing.md }}>{renderMessage()}</View>
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
