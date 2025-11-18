import React, { useMemo, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';

export default function RadioGroupField({
  options = [],
  value,
  onChange,
  disabled = false,
  style,
  renderExpanded,
  fullBleed = true,
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={[styles.container, style]}>
      {options.map((opt, idx) => {
        const selected = String(value) === String(opt.id);
        return (
          <RadioRow
            key={String(opt.id)}
            opt={opt}
            selected={selected}
            disabled={disabled}
            onPress={() => !disabled && onChange?.(opt.id)}
            styles={styles}
            showSeparator={idx < options.length - 1}
            renderExpanded={
              selected && typeof renderExpanded === 'function' ? renderExpanded : undefined
            }
            isFirst={idx === 0}
            isLast={idx === options.length - 1}
            fullBleed={fullBleed}
          />
        );
      })}
    </View>
  );
}
function RadioRow({
  opt,
  selected,
  disabled,
  onPress,
  styles,
  showSeparator,
  renderExpanded,
  isFirst,
  isLast,
  fullBleed,
}) {
  const anim = useRef(new Animated.Value(0)).current;
  const handleIn = () => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 120,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };
  const handleOut = () => {
    Animated.timing(anim, {
      toValue: 0,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  return (
    <View>
      <View
        style={[
          styles.rowWrap,
          fullBleed && styles.rowWrapBleed,
          (isFirst || isLast) && styles.roundedWrap,
          isFirst && styles.roundedTop,
          isLast && styles.roundedBottom,
          (isFirst || isLast) && styles.wrapOverflowHidden,
        ]}
      >
        <Animated.View pointerEvents="none" style={[styles.overlay, { opacity: anim }]} />
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected, disabled }}
          disabled={disabled}
          onPress={onPress}
          onPressIn={handleIn}
          onPressOut={handleOut}
          style={[styles.rowPressable, fullBleed && styles.rowPressablePad]}
        >
          <View style={styles.rowInner}>
            <View style={[styles.radio, selected && styles.radioActive]}>
              {selected ? <View style={styles.radioDot} /> : null}
            </View>
            <View style={styles.content}>
              <Text style={styles.title}>{opt.title}</Text>
              {opt.subtitle ? <Text style={styles.subtitle}>{opt.subtitle}</Text> : null}
            </View>
          </View>
        </Pressable>
      </View>
      {showSeparator ? <View style={styles.separator} /> : null}
      {renderExpanded ? <View style={styles.expanded}>{renderExpanded(opt.id)}</View> : null}
    </View>
  );
}

function createStyles(t) {
  const RADIO_SIZE = t.components?.radio?.size ?? 20;
  const DOT_SIZE =
    t.components?.radio?.dot ??
    Math.max(t.components?.radio?.dotMin ?? 6, Math.round(RADIO_SIZE / 2 - 3));
  const ROW_HEIGHT = t.components?.input?.height ?? t.components?.listItem?.height ?? 48;
  const SEP_H =
    t.components?.input?.separator?.height ??
    t.components?.listItem?.dividerWidth ??
    StyleSheet.hairlineWidth;
  const cardPadXKey = t.components?.card?.padX ?? 'lg';
  const CARD_PADX = Number(t.spacing?.[cardPadXKey] ?? 0) || 0;
  const CARD_RADIUS = t.radii?.xl ?? 16;
  const SEP_ALPHA = t.components?.input?.separator?.alpha ?? 0.18;
  const insetKey = t.components?.input?.separator?.insetX ?? 'lg';
  const ML = Number(t.spacing?.[insetKey] ?? 0) || 0;
  const MR = Number(t.spacing?.[insetKey] ?? 0) || 0;
  return StyleSheet.create({
    container: { marginHorizontal: 0 },
    rowWrap: {
      minHeight: ROW_HEIGHT,
      position: 'relative',
      justifyContent: 'center',
    },
    rowWrapBleed: {
      marginLeft: -CARD_PADX,
      marginRight: -CARD_PADX,
    },
    roundedWrap: {
      borderRadius: CARD_RADIUS,
    },
    roundedTop: {
      borderTopLeftRadius: CARD_RADIUS,
      borderTopRightRadius: CARD_RADIUS,
    },
    roundedBottom: {
      borderBottomLeftRadius: CARD_RADIUS,
      borderBottomRightRadius: CARD_RADIUS,
    },
    wrapOverflowHidden: { overflow: 'hidden' },
    rowPressable: {
      minHeight: ROW_HEIGHT,
      justifyContent: 'center',
    },
    rowPressablePad: {
      paddingLeft: CARD_PADX,
      paddingRight: CARD_PADX,
    },
    rowInner: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: t.spacing.sm,
      paddingLeft: ML,
      paddingRight: MR,
    },
    overlay: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: t.colors.ripple,
      borderRadius: 0,
    },
    radio: {
      width: RADIO_SIZE,
      height: RADIO_SIZE,
      borderRadius: RADIO_SIZE / 2,
      borderWidth: 2,
      borderColor: t.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: t.spacing.sm,
      marginLeft: 0,
    },
    radioActive: { borderColor: t.colors.primary },
    radioDot: {
      width: DOT_SIZE,
      height: DOT_SIZE,
      borderRadius: DOT_SIZE / 2,
      backgroundColor: t.colors.primary,
    },
    content: { flex: 1 },
    title: {
      fontSize: t.typography.sizes.md,
      fontWeight: t.typography.weight.semibold,
      color: t.colors.text,
      marginBottom: t.spacing.xs / 2,
    },
    subtitle: {
      fontSize: t.typography.sizes.sm,
      color: t.colors.textSecondary,
      lineHeight: Math.round(t.typography.sizes.sm * 1.3),
    },
    separator: {
      height: SEP_H,
      backgroundColor: t.colors.border,
      opacity: SEP_ALPHA,
      marginLeft: ML,
      marginRight: MR,
    },
    expanded: { paddingTop: t.spacing.sm },
  });
}
