import React from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { useTheme } from '../../theme';

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
  const minTouchSize = Number(switchTheme?.minTouchSize) || 48;
  const disabledOpacity = Number(switchTheme?.disabledOpacity) || 0.42;
  const trackOn =
    disabled
      ? switchTheme?.trackOnDisabled ?? switchTheme?.trackOn ?? theme?.colors?.primary
      : trueColor ?? switchTheme?.trackOn ?? theme?.colors?.primary;
  const trackOff =
    disabled
      ? switchTheme?.trackOffDisabled ?? switchTheme?.trackOff ?? theme?.colors?.inputBorder ?? theme?.colors?.border
      : falseColor ?? switchTheme?.trackOff ?? theme?.colors?.inputBorder ?? theme?.colors?.border;
  const resolvedThumbColor = thumbColor ?? switchTheme?.thumbColor ?? '#FFFFFF';
  const scale = Number(switchTheme?.scale) || 1;
  const iosBackgroundColor = switchTheme?.iosBackgroundColor ?? trackOff;

  return (
    <View
      style={[
        styles.wrap,
        {
          minWidth: minTouchSize,
          minHeight: minTouchSize,
          opacity: disabled ? disabledOpacity : 1,
        },
      ]}
    >
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
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default React.memo(ThemedSwitch);
