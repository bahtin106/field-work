// components/ui/PhoneInput.jsx
import React, { useCallback, useRef } from "react";
import TextField from "./TextField";
import { maskApply, normalizeRu } from "./phone";

export default function PhoneInput({
  label = "Телефон",
  value,
  onChangeText,
  error,
  required = false,
  style,
}) {
  const prevMaskedRef = useRef("");

  const handleChange = useCallback(
    (raw) => {
      const prevMasked = prevMaskedRef.current || "";
      const prevDigits = normalizeRu(prevMasked); // "7XXXXXXXXXX" или "7", или ""
      const currDigits = normalizeRu(raw);

      // Если пользователь стёр форматный символ (пробел/скобку/дефис),
      // а цифры не изменились -> удаляем ещё и предыдущую цифру
      if (raw.length < prevMasked.length && currDigits === prevDigits) {
        const shaved = prevDigits.length > 1 ? prevDigits.slice(0, -1) : "";
        const { masked, e164, valid } = maskApply(shaved);
        prevMaskedRef.current = masked;
        onChangeText?.(e164 || masked, { masked, e164, valid });
        return;
      }

      const { masked, e164, valid } = maskApply(raw);
      prevMaskedRef.current = masked;
      onChangeText?.(e164 || masked, { masked, e164, valid });
    },
    [onChangeText]
  );

  // Всегда рендерим маску из входного значения
  const { masked } = maskApply(value || "");
  // держим prev в актуальном состоянии
  if (prevMaskedRef.current !== masked) prevMaskedRef.current = masked;

  return (
    <TextField
  label={label}
  value={masked}
  onChangeText={handleChange}
  placeholder="+7 (___) ___-__-__"
  keyboardType="phone-pad"
  maxLength={18}               // "+7 (XXX) XXX-XX-XX"
  error={error}
  style={style}
/>
  );
}
