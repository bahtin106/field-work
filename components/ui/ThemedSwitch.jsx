import React from 'react';
import { Platform, Switch } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

function ThemedSwitch({
  value,
  onValueChange,
  disabled = false,
  trueColor,
  falseColor,
  thumbColor,
  ...rest
}) {
  const { theme } = useTheme();
  const switchTheme = theme?.components?.switch || {};
  const isDark = theme?.mode === 'dark';
  const trackOn = trueColor ?? theme?.colors?.primary;
  const trackOff = falseColor ?? theme?.colors?.inputBorder ?? theme?.colors?.border;
  const resolvedThumbColor =
    thumbColor ??
    (Platform.OS === 'android'
      ? value
        ? theme?.colors?.onPrimary ?? '#FFFFFF'
        : isDark
          ? theme?.colors?.textSecondary ?? '#A3A3A3'
          : theme?.colors?.surface ?? '#FFFFFF'
      : undefined);
  const scale = Number(switchTheme?.scale) || 1;
  const iosBackgroundColor = switchTheme?.iosBackgroundColor ?? trackOff;

  return (
    <Switch
      value={!!value}
      onValueChange={onValueChange}
      disabled={!!disabled}
      trackColor={{ true: trackOn, false: trackOff }}
      thumbColor={resolvedThumbColor}
      ios_backgroundColor={iosBackgroundColor}
      style={scale !== 1 ? { transform: [{ scaleX: scale }, { scaleY: scale }] } : undefined}
      {...rest}
    />
  );
}

export default React.memo(ThemedSwitch);
