// components/ui/PhoneInput.jsx
import { useCallback, useRef } from 'react';
import { getRequiredFieldLabel } from '../../src/shared/forms/fieldValidation';
import TextField from './TextField';
import { maskApply, normalizeRu } from './phone';
import { t as T } from '../../src/i18n';

export default function PhoneInput({
  label = T('fields_phone'),
  value,
  onChangeText,
  error,
  style,
  placeholder = '+7 (9XX) XXX-XX-XX',
  required = false,
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
      style={style}
      {...rest}
    />
  );
}
