import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import PhoneInput from '../ui/PhoneInput';
import { APP_ICON_NAMES } from '../ui/iconNames';
import { focusNextInput, registerInput, unregisterInput } from '../ui/inputFocusRegistry';
import { useTheme } from '../../theme/ThemeProvider';
import { useTranslation } from '../../src/i18n/useTranslation';
import { CLIENT_ADDITIONAL_PHONE_LABEL_MAX_LENGTH } from '../../src/features/clients/additionalPhones';

export default function AdditionalPhoneInputRow({
  phoneValue,
  onPhoneChange,
  designationValue,
  onDesignationChange,
  onRemove,
  phoneError,
  phoneRequired = false,
  onPhoneBlur,
  style,
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const hasPhoneError = !!phoneError;
  const styles = React.useMemo(() => createStyles(theme, hasPhoneError), [theme, hasPhoneError]);
  const inputRef = React.useRef(null);
  const fieldIdRef = React.useRef(Symbol('additional-phone-title-field'));
  const mountOrderRef = React.useRef(Date.now() + Math.random());
  const [isEditing, setIsEditing] = React.useState(false);
  const fallbackLabel = String(t('order_field_secondary_phone') || 'Доп. телефон');
  const resolvedLabel =
    String(designationValue || '').trim().slice(0, CLIENT_ADDITIONAL_PHONE_LABEL_MAX_LENGTH) || fallbackLabel;
  const [draftLabel, setDraftLabel] = React.useState(resolvedLabel);

  React.useEffect(() => {
    if (!isEditing) setDraftLabel(resolvedLabel);
  }, [isEditing, resolvedLabel]);

  React.useEffect(() => {
    if (!isEditing) return;
    const timer = setTimeout(() => inputRef.current?.focus?.(), 30);
    return () => clearTimeout(timer);
  }, [isEditing]);

  React.useEffect(() => {
    if (!isEditing) return undefined;

    const id = fieldIdRef.current;
    registerInput({
      id,
      order: mountOrderRef.current,
      getInput: () => inputRef.current,
    });

    return () => {
      unregisterInput(id);
    };
  }, [isEditing]);

  const startEdit = React.useCallback(() => {
    setDraftLabel(resolvedLabel);
    setIsEditing(true);
  }, [resolvedLabel]);

  const commitEdit = React.useCallback(() => {
    const normalized = String(draftLabel || '')
      .trim()
      .slice(0, CLIENT_ADDITIONAL_PHONE_LABEL_MAX_LENGTH);
    const nextValue = normalized || fallbackLabel;
    onDesignationChange?.(nextValue);
    setDraftLabel(nextValue);
    setIsEditing(false);
  }, [draftLabel, fallbackLabel, onDesignationChange]);

  return (
    <View style={style}>
      <View style={styles.headerRow}>
        <View style={styles.leftGroup}>
          <View style={styles.inlineLabelWrap}>
            {isEditing ? (
              <TextInput
                ref={inputRef}
                value={draftLabel}
                onChangeText={(nextText) => {
                  const cleaned = String(nextText || '')
                    .replace(/[\r\n]+/g, ' ')
                    .slice(0, CLIENT_ADDITIONAL_PHONE_LABEL_MAX_LENGTH);
                  setDraftLabel(cleaned);
                  onDesignationChange?.(cleaned);
                }}
                onBlur={commitEdit}
                maxLength={CLIENT_ADDITIONAL_PHONE_LABEL_MAX_LENGTH}
                multiline
                scrollEnabled={false}
                returnKeyType="next"
                blurOnSubmit
                onSubmitEditing={() => {
                  commitEdit();
                  const moved = focusNextInput(fieldIdRef.current);
                  if (!moved) inputRef.current?.blur?.();
                }}
                style={styles.designationInput}
                accessibilityLabel={t('clients_additional_phone_a11y_edit_name')}
              />
            ) : (
              <Text style={styles.baseLabel} numberOfLines={2}>
                {resolvedLabel}
              </Text>
            )}
          </View>
          {!isEditing ? (
            <View style={styles.editAction}>
              <Pressable
                onPress={startEdit}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={t('clients_additional_phone_a11y_edit_name')}
                style={styles.editButton}
              >
                <Feather
                  name={APP_ICON_NAMES.EDIT_PENCIL}
                  size={theme.components?.icon?.sizeXs ?? Math.round((theme.icons?.sm ?? 18) * 0.75)}
                  color={hasPhoneError ? theme.colors.danger : theme.colors.textSecondary}
                  style={styles.editIcon}
                />
              </Pressable>
            </View>
          ) : null}
        </View>
        {typeof onRemove === 'function' ? (
          <Pressable
            onPress={() => onRemove?.()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={t('clients_additional_phone_a11y_remove')}
            style={styles.removeButton}
          >
            <Feather
              name="x"
              size={theme.components?.icon?.sizeXs ?? Math.round((theme.icons?.sm ?? 18) * 0.75)}
              color={hasPhoneError ? theme.colors.danger : theme.colors.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>
      <PhoneInput
        label=""
        value={phoneValue}
        onChangeText={onPhoneChange}
        onBlur={onPhoneBlur}
        required={phoneRequired}
        error={phoneError ? 'invalid' : undefined}
        style={styles.phoneField}
      />
    </View>
  );
}

function createStyles(theme, hasPhoneError = false) {
  const sep = theme.components?.input?.separator || {};
  const insetKey = sep.insetX || 'lg';
  const horizontalInset = Number(theme.spacing?.[insetKey] ?? theme.spacing.lg ?? 0) || 0;
  const lineHeight = Math.round((theme.typography.sizes.sm ?? 13) * 1.3);
  return StyleSheet.create({
    headerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      paddingHorizontal: horizontalInset,
      marginBottom: theme.spacing.xs,
    },
    leftGroup: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      flex: 1,
      minWidth: 0,
      paddingRight: theme.spacing.xs,
    },
    inlineLabelWrap: {
      flexShrink: 1,
      flexGrow: 0,
      minWidth: 0,
      maxWidth: '100%',
    },
    baseLabel: {
      color: hasPhoneError ? theme.colors.danger : theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.medium,
      lineHeight,
      flexShrink: 1,
    },
    designationInput: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      lineHeight,
      paddingVertical: 0,
      minHeight: lineHeight,
      maxHeight: Math.round(lineHeight * 2.3),
      flexShrink: 1,
      minWidth: 0,
      textAlignVertical: 'top',
    },
    editAction: {
      marginLeft: theme.spacing.xs,
    },
    editButton: {
      minWidth: 24,
      minHeight: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    editIcon: {
      transform: [{ translateY: -2 }],
    },
    removeButton: {
      marginTop: 1,
      minWidth: 24,
      minHeight: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    phoneField: {
      marginVertical: 0,
    },
  });
}
