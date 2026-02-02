// components/ui/modals/ConfirmAlertModals.jsx
import React from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import { useTheme } from '../../../theme';
import UIButton from '../Button';
import BaseModal from './BaseModal';
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
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: theme.spacing.md }}>
      <Pressable
        onPress={onClose}
        style={({ pressed }) => [
          {
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderRadius: 10,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: 'transparent',
            flex: 1,
          },
          pressed && Platform.OS === 'ios' ? { backgroundColor: theme.colors.ripple } : null,
        ]}
      >
        <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '500' }}>
          {cancelLabel}
        </Text>
      </Pressable>
      <UIButton
        variant={confirmVariant}
        size="md"
        onPress={() => {
          try {
            onClose?.();
          } finally {
            setTimeout(() => {
              try {
                onConfirm?.();
              } catch (_) {}
            }, 360);
          }
        }}
        title={loading ? confirmLabel : confirmLabel}
      />
    </View>
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
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
      <UIButton variant="primary" size="md" onPress={onClose} title={buttonLabel} />
    </View>
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
