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

function useVisibleContentSnapshot(visible, content) {
  const snapshotRef = React.useRef(content);

  // BaseModal remains mounted while its closing animation is running. Keep the
  // last visible content during that interval so clearing the caller's state
  // cannot replace the title, message or actions for the final animation frame.
  if (visible) snapshotRef.current = content;

  return visible ? content : snapshotRef.current;
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
  const content = useVisibleContentSnapshot(visible, {
    title,
    message,
    confirmLabel,
    cancelLabel,
    confirmVariant,
    loading,
  });
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
          title: content.cancelLabel,
          variant: 'secondary',
          onPress: onClose,
        },
        {
          key: 'confirm',
          title: content.confirmLabel,
          variant: content.confirmVariant,
          dismissKeyboardOnPress: true,
          loading: content.loading,
          onPress: handleConfirm,
        },
      ]}
    />
  );
  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={content.title}
      maxHeightRatio={0.5}
      presentation="dialog"
      footer={footer}
    >
      <View style={{ marginBottom: theme.spacing.md }}>
        <ModalMessage message={content.message} theme={theme} />
      </View>
    </BaseModal>
  );
}

export function AlertModal({ visible, title, message, buttonLabel = T('btn_ok'), onClose }) {
  const { theme } = useTheme();
  const content = useVisibleContentSnapshot(visible, { title, message, buttonLabel });
  const footer = (
    <ModalActionsRow
      actions={[
        {
          key: 'close',
          title: content.buttonLabel,
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
      title={content.title}
      maxHeightRatio={0.45}
      presentation="dialog"
      footer={footer}
    >
      <View style={{ marginBottom: theme.spacing.md }}>
        <ModalMessage message={content.message} theme={theme} />
      </View>
    </BaseModal>
  );
}
