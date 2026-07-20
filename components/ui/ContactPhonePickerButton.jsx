import Feather from '@expo/vector-icons/Feather';
import * as Contacts from 'expo-contacts';
import React from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
} from 'react-native';

import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme';
import { useToast } from './ToastProvider';
import { formatRuMask } from './phone';
import { ConfirmModal } from './modals';
import SelectModal from './modals/SelectModal';

const PHONE_EXTENSION_RE = /\s*(?:доб\.?|ext\.?|extension|x)\s*\d+\s*$/i;

function normalizePickedPhone(value) {
  const digits = String(value || '')
    .replace(PHONE_EXTENSION_RE, '')
    .replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 11 && digits[0] === '7') return digits;
  if (digits.length === 11 && digits[0] === '8') return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return null;
}

function buildPhoneOptions(contact) {
  const contactName = String(contact?.name || '').trim();
  const seen = new Set();
  return (Array.isArray(contact?.phoneNumbers) ? contact.phoneNumbers : [])
    .map((phone, index) => {
      const normalized = normalizePickedPhone(phone?.number);
      if (!normalized || seen.has(normalized)) return null;
      seen.add(normalized);
      const label = String(phone?.label || '').trim();
      return {
        id: normalized,
        normalized,
        label: formatRuMask(normalized),
        subtitle: [label, contactName].filter(Boolean).join(' · '),
        order: index,
      };
    })
    .filter(Boolean);
}

export default function ContactPhonePickerButton({ value, onSelect, disabled = false }) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const [numberOptions, setNumberOptions] = React.useState([]);
  const [permissionHelpVisible, setPermissionHelpVisible] = React.useState(false);
  const mountedRef = React.useRef(true);
  const busyRef = React.useRef(false);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const closeNumberPicker = React.useCallback(() => setNumberOptions([]), []);

  const applyNumber = React.useCallback(
    (option) => {
      const normalized = String(option?.normalized || option?.id || '').trim();
      if (!normalized) return;
      setNumberOptions([]);
      requestAnimationFrame(() => onSelect?.(normalized));
    },
    [onSelect],
  );

  const showPermissionHelp = React.useCallback(() => setPermissionHelpVisible(true), []);

  const openContactPicker = React.useCallback(async () => {
    if (disabled || busyRef.current || Platform.OS === 'web') return;
    busyRef.current = true;
    setBusy(true);
    Keyboard.dismiss();

    try {
      const available = await Contacts.isAvailableAsync();
      if (!available) {
        toast.warning(t('contact_picker_unavailable'));
        return;
      }

      if (Platform.OS === 'android') {
        let permission = await Contacts.getPermissionsAsync();
        if (permission.status !== 'granted' && permission.canAskAgain !== false) {
          permission = await Contacts.requestPermissionsAsync();
        }
        if (permission.status !== 'granted') {
          showPermissionHelp();
          return;
        }
      }

      let contact = await Contacts.presentContactPickerAsync();
      if (!contact) return;

      if ((!contact.phoneNumbers || contact.phoneNumbers.length === 0) && contact.id) {
        try {
          const details = await Contacts.getContactByIdAsync(contact.id, [Contacts.Fields.PhoneNumbers]);
          if (details) contact = { ...contact, ...details };
        } catch {}
      }

      const options = buildPhoneOptions(contact);
      if (!options.length) {
        toast.warning(t('contact_picker_no_phone'));
        return;
      }
      if (options.length === 1) {
        applyNumber(options[0]);
        return;
      }
      if (mountedRef.current) setNumberOptions(options);
    } catch (error) {
      console.warn('[ContactPhonePicker] open failed', error);
      toast.error(t('contact_picker_error'));
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, [applyNumber, disabled, showPermissionHelp, t, toast]);

  if (Platform.OS === 'web') return null;

  const selectedId = normalizePickedPhone(value);
  const iconColor = disabled ? theme.colors.textSecondary : theme.colors.primary;

  return (
    <>
      <Pressable
        onPress={openContactPicker}
        disabled={disabled || busy}
        accessibilityRole="button"
        accessibilityLabel={t('contact_picker_accessibility')}
        accessibilityState={{ disabled: disabled || busy, busy }}
        hitSlop={6}
        android_ripple={{ color: theme.colors.ripple, borderless: true, radius: 20 }}
        style={({ pressed }) => [
          styles.button,
          { borderRadius: theme.radii.pill },
          pressed && !disabled ? { opacity: 0.6 } : null,
          disabled ? { opacity: 0.45 } : null,
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={iconColor} />
        ) : (
          <Feather name="book-open" size={20} color={iconColor} />
        )}
      </Pressable>

      <SelectModal
        visible={numberOptions.length > 1}
        title={t('contact_picker_choose_number')}
        items={numberOptions}
        selectedId={selectedId}
        searchable={false}
        maxHeightRatio={0.5}
        onSelect={applyNumber}
        onClose={closeNumberPicker}
      />
      <ConfirmModal
        visible={permissionHelpVisible}
        title={t('contact_picker_permission_title')}
        message={t('contact_picker_permission_message')}
        confirmLabel={t('contact_picker_open_settings')}
        cancelLabel={t('btn_cancel')}
        onClose={() => setPermissionHelpVisible(false)}
        onConfirm={() => Linking.openSettings().catch(() => {})}
      />
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
