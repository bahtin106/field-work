// components/ui/PhoneInput.jsx
import { useCallback, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { getRequiredFieldLabel } from '../../src/shared/forms/fieldValidation';
import { t as T } from '../../src/i18n';
import ClearButton from './ClearButton';
import ContactPhonePickerButton from './ContactPhonePickerButton';
import TextField from './TextField';
import { maskApply, normalizeRu } from './phone';

export default function PhoneInput({
  label = T('fields_phone'),
  value,
  onChangeText,
  error,
  style,
  placeholder = '+7 (9XX) XXX-XX-XX',
  required,
  disabled = false,
  contactPickerEnabled = true,
  rightSlot = null,
  ...rest
}) {
  const prevMaskedRef = useRef('');

  const handleChange = useCallback(
    (raw) => {
      const currDigits = normalizeRu(raw);
      const { masked, e164, valid } = maskApply(raw);
      prevMaskedRef.current = masked;
      onChangeText?.(currDigits, { masked, e164, valid });
    },
    [onChangeText],
  );

  // Всегда рендерим маску из входного значения
  const { masked } = maskApply(value || '');
  const hasValue = normalizeRu(value).length > 0;
  // держим prev в актуальном состоянии
  if (prevMaskedRef.current !== masked) prevMaskedRef.current = masked;

  return (
    <TextField
      label={getRequiredFieldLabel(label, required)}
      value={masked}
      onChangeText={handleChange}
      placeholder={placeholder}
      keyboardType="phone-pad"
      maxLength={18} // "+7 (XXX) XXX-XX-XX"
      error={error}
      required={required}
      disabled={disabled}
      style={style}
      rightSlot={
        rightSlot || ((hasValue && !disabled) || contactPickerEnabled ? (
          <View style={styles.actions}>
            {hasValue && !disabled ? (
              <ClearButton
                onPress={() => handleChange('')}
                accessibilityLabel={T('phone_clear_accessibility')}
              />
            ) : null}
            {contactPickerEnabled ? (
              <ContactPhonePickerButton value={value} onSelect={handleChange} disabled={disabled} />
            ) : null}
          </View>
        ) : null)
      }
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
