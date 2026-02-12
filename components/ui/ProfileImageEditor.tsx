import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, View, StyleSheet, Text, TouchableOpacity, ActivityIndicator, LayoutChangeEvent, Image } from 'react-native';
import { PanGestureHandler, PinchGestureHandler, State } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { Animated as RNAnimated } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import MaskedView from '@react-native-masked-view/masked-view';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../theme/ThemeProvider';

// Feature detection for Reanimated API
let Reanimated;
try {
  Reanimated = require('react-native-reanimated');
} catch (e) {
  Reanimated = Animated;
}

const hasReanimated = !!(
  Reanimated &&
  typeof Reanimated.useSharedValue === 'function' &&
  typeof Reanimated.useAnimatedStyle === 'function' &&
  typeof Reanimated.useAnimatedGestureHandler === 'function'
);

type Props = {
  visible: boolean;
  imageUri: string | null;
  onCancel: () => void;
  onSave: (uri: string) => void;
};

export default function ProfileImageEditor({ visible, imageUri, onCancel, onSave }: Props) {
  const { theme } = useTheme();
  const [layoutW, setLayoutW] = useState(0);
  const [layoutH, setLayoutH] = useState(0);
  const [origW, setOrigW] = useState<number | null>(null);
  const [origH, setOrigH] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!imageUri) return;
    // preload size
    try {
      (require('react-native').Image as any).getSize(imageUri, (w: number, h: number) => {
        setOrigW(w);
        setOrigH(h);
      }, () => { setOrigW(null); setOrigH(null); });
    } catch {
      setOrigW(null); setOrigH(null);
    }
  }, [imageUri]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setLayoutW(width);
    setLayoutH(height);
  }, []);

  // modal animation
  const opacity = hasReanimated ? Reanimated.useSharedValue(0) : { value: 0 } as any;
  const scale = hasReanimated ? Reanimated.useSharedValue(0.98) : { value: 0.98 } as any;
  const hintOpacity = hasReanimated ? Reanimated.useSharedValue(1) : { value: 1 } as any;
  useEffect(() => {
    if (!hasReanimated) return;
    if (visible) {
      opacity.value = Reanimated.withTiming(1, { duration: 200 });
      scale.value = Reanimated.withTiming(1, { duration: 200 });
      // fade hint after 2s
      hintOpacity.value = 1;
      setTimeout(() => {
        hintOpacity.value = Reanimated.withTiming(0, { duration: 600 });
      }, 2000);
    } else {
      opacity.value = Reanimated.withTiming(0, { duration: 160 });
      scale.value = Reanimated.withTiming(0.98, { duration: 160 });
    }
  }, [visible]);

  // gestures shared values
  const translateX = hasReanimated ? Reanimated.useSharedValue(0) : { value: 0 } as any;
  const translateY = hasReanimated ? Reanimated.useSharedValue(0) : { value: 0 } as any;
  const scaleVal = hasReanimated ? Reanimated.useSharedValue(1) : { value: 1 } as any;

  // JS fallback gesture values (when Reanimated not available)
  const panRef = React.useRef<RNAnimated.ValueXY | null>(null);
  const baseScaleRef = React.useRef<RNAnimated.Value | null>(null);
  const pinchScaleRef = React.useRef<RNAnimated.Value | null>(null);
  const panOffsetRef = React.useRef({ x: 0, y: 0 });
  const lastScaleRef = React.useRef(1);
  if (!hasReanimated && !panRef.current) {
    panRef.current = new RNAnimated.ValueXY();
    baseScaleRef.current = new RNAnimated.Value(1);
    pinchScaleRef.current = new RNAnimated.Value(1);
  }

  // animated style for image
  const imageAnimatedStyle = hasReanimated ? Reanimated.useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scaleVal.value },
    ],
  })) : {};

  const hintAnimatedStyle = hasReanimated ? Reanimated.useAnimatedStyle(() => ({ opacity: hintOpacity.value })) : {};

  // gesture handlers
  let panHandler: any = null;
  let pinchHandler: any = null;
  if (hasReanimated) {
    panHandler = Reanimated.useAnimatedGestureHandler({
      onStart: (_, ctx: any) => { ctx.sx = translateX.value; ctx.sy = translateY.value; },
      onActive: (ev, ctx: any) => { translateX.value = ctx.sx + ev.translationX; translateY.value = ctx.sy + ev.translationY; },
      onEnd: () => {},
    });
    pinchHandler = Reanimated.useAnimatedGestureHandler({
      onStart: (_, ctx: any) => { ctx.s = scaleVal.value; },
      onActive: (ev, ctx: any) => { const next = Math.max(1, Math.min(6, ctx.s * ev.scale)); scaleVal.value = next; },
      onEnd: () => { if (scaleVal.value < 1) scaleVal.value = Reanimated.withTiming(1); },
    });
  }

  // JS fallback gesture events
  // Use simple JS handlers for gesture events (more robust across envs)
  const handlePan = (e: any) => {
    try {
      if (!panRef.current) return;
      const tx = e.nativeEvent.translationX || 0;
      const ty = e.nativeEvent.translationY || 0;
      panRef.current.setValue({ x: tx, y: ty });
    } catch (err) {}
  };

  const onPanStateChange = (e: any) => {
    try {
      if (!panRef.current) return;
      if (e.nativeEvent.oldState === State.ACTIVE) {
        panOffsetRef.current.x += e.nativeEvent.translationX || 0;
        panOffsetRef.current.y += e.nativeEvent.translationY || 0;
        panRef.current.setOffset({ x: panOffsetRef.current.x, y: panOffsetRef.current.y });
        panRef.current.setValue({ x: 0, y: 0 });
      }
    } catch (err) {}
  };

  const handlePinch = (e: any) => {
    try {
      if (!pinchScaleRef.current) return;
      const s = e.nativeEvent.scale || 1;
      pinchScaleRef.current.setValue(s);
    } catch (err) {}
  };

  const onPinchStateChange = (e: any) => {
    try {
      if (!baseScaleRef.current || !pinchScaleRef.current) return;
      if (e.nativeEvent.oldState === State.ACTIVE) {
        const s = e.nativeEvent.scale || 1;
        lastScaleRef.current = lastScaleRef.current * s;
        baseScaleRef.current.setValue(lastScaleRef.current);
        pinchScaleRef.current.setValue(1);
      }
    } catch (err) {}
  };

  const diameter = useMemo(() => {
    const d = Math.min(layoutW || 0, layoutH || 0) * 0.82;
    return d || Math.min(require('react-native').Dimensions.get('window').width, require('react-native').Dimensions.get('window').height) * 0.82;
  }, [layoutW, layoutH]);

  const computeCropAndSave = useCallback(async (s: number, tx: number, ty: number) => {
    if (!imageUri || !origW || !origH) return onCancel();
    setBusy(true);
    try {
      const containerW = layoutW || require('react-native').Dimensions.get('window').width;
      const containerH = layoutH || require('react-native').Dimensions.get('window').height;
      const fitScale = Math.min(containerW / origW, containerH / origH);
      const displayedW = origW * fitScale * s;
      const displayedH = origH * fitScale * s;
      const imageLeft = (containerW - displayedW) / 2 + tx;
      const imageTop = (containerH - displayedH) / 2 + ty;
      const circleLeft = (containerW - diameter) / 2;
      const circleTop = (containerH - diameter) / 2;
      const relX = (circleLeft - imageLeft) / displayedW;
      const relY = (circleTop - imageTop) / displayedH;
      const cropX = Math.max(0, Math.round(relX * origW));
      const cropY = Math.max(0, Math.round(relY * origH));
      const cropW = Math.min(origW - cropX, Math.round((diameter / displayedW) * origW));
      const cropH = Math.min(origH - cropY, Math.round((diameter / displayedH) * origH));
      const actions = [{ crop: { originX: cropX, originY: cropY, width: cropW, height: cropH } }];
      const res = await ImageManipulator.manipulateAsync(imageUri, actions, { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onSave(res.uri);
    } catch (e) {
      onCancel();
    } finally { setBusy(false); }
  }, [imageUri, origW, origH, layoutW, layoutH, diameter]);

  const runOnJS = (Reanimated && (Reanimated.runOnJS || Reanimated.default?.runOnJS)) || ((fn: any) => (...args: any[]) => fn(...args));
  const onDone = useCallback(() => {
    if (hasReanimated) {
      // light haptic on press
      try { Haptics.selectionAsync(); } catch {}
      runOnJS(computeCropAndSave)(scaleVal.value, translateX.value, translateY.value);
    }
  }, [computeCropAndSave]);

  return (
    <Modal visible={!!visible} transparent animationType="none">
      <Animated.View style={[styles.backdrop, { backgroundColor: '#000' }]}> 
        <View style={styles.screen} onLayout={onLayout}>
          <View style={styles.topBar} pointerEvents="box-none">
            <TouchableOpacity onPress={onCancel} style={styles.topBtn}><Text style={[styles.topText, { color: '#fff' }]}>Отмена</Text></TouchableOpacity>
            <TouchableOpacity onPress={onDone} style={[styles.topBtnPrimary, { backgroundColor: theme.colors.primary }]} disabled={busy}>
              {busy ? <ActivityIndicator color={theme.colors.onPrimary || '#fff'}/> : <Text style={[styles.topPrimaryText, { color: theme.colors.onPrimary || '#fff' }]}>Готово</Text>}
            </TouchableOpacity>
          </View>

          <View style={styles.editorArea} pointerEvents="box-none">
            {hasReanimated ? (
              <PinchGestureHandler onGestureEvent={pinchHandler}>
                <Animated.View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <PanGestureHandler onGestureEvent={panHandler}>
                    <Animated.View style={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                      {imageUri ? (
                        <Animated.Image source={{ uri: imageUri }} style={[{ width: layoutW || '100%', height: layoutH || '100%', resizeMode: 'contain' }, imageAnimatedStyle]} />
                      ) : (
                        <ActivityIndicator color={theme.colors.primary} />
                      )}
                    </Animated.View>
                  </PanGestureHandler>
                </Animated.View>
              </PinchGestureHandler>
            ) : (
              // JS fallback: enable pan + pinch using RN Animated when Reanimated isn't available
              imageUri ? (
                <PinchGestureHandler onGestureEvent={handlePinch} onHandlerStateChange={onPinchStateChange}>
                  <RNAnimated.View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <PanGestureHandler onGestureEvent={handlePan} onHandlerStateChange={onPanStateChange}>
                      <RNAnimated.View style={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                        {panRef.current && baseScaleRef.current && pinchScaleRef.current ? (
                          <RNAnimated.Image
                            source={{ uri: imageUri }}
                            style={[
                              { width: layoutW || '100%', height: layoutH || '100%', resizeMode: 'contain' },
                              { transform: [...panRef.current.getTranslateTransform(), { scale: RNAnimated.multiply(baseScaleRef.current, pinchScaleRef.current) }] },
                            ]}
                          />
                        ) : (
                          <Image source={{ uri: imageUri }} style={{ width: layoutW || '100%', height: layoutH || '100%', resizeMode: 'contain' }} />
                        )}
                      </RNAnimated.View>
                    </PanGestureHandler>
                  </RNAnimated.View>
                </PinchGestureHandler>
              ) : (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <ActivityIndicator color={theme.colors.primary} />
                </View>
              )
            )}

            {/* mask overlays using MaskedView for circular hole + stroke + grid */}
            <View style={styles.maskContainer} pointerEvents="none">
              <MaskedView style={{ flex: 1 }} maskElement={
                <View style={{ flex: 1, backgroundColor: 'white' }}>
                  <View style={{ position: 'absolute', left: (layoutW ? (layoutW - diameter) / 2 : 0), top: (layoutH ? (layoutH - diameter) / 2 : 0), width: diameter, height: diameter, borderRadius: diameter / 2, backgroundColor: 'transparent' }} />
                </View>
              }>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' }} />
              </MaskedView>

              {/* circle stroke + grid (visible inside circle) */}
              <View style={{ position: 'absolute', left: (layoutW ? (layoutW - diameter) / 2 : 0), top: (layoutH ? (layoutH - diameter) / 2 : 0), width: diameter, height: diameter, borderRadius: diameter / 2, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }}>
                <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: diameter / 2, borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)' }} />
                <View style={{ position: 'absolute', left: 6, right: 6, top: 6, bottom: 6, borderRadius: (diameter - 12) / 2, borderWidth: 0, backgroundColor: 'transparent', opacity: 0.02 }} />
                {/* grid lines */}
                <View style={{ position: 'absolute', left: diameter / 3 - 0.5, top: 0, width: 1, height: diameter, backgroundColor: 'rgba(255,255,255,0.15)' }} />
                <View style={{ position: 'absolute', left: (diameter / 3) * 2 - 0.5, top: 0, width: 1, height: diameter, backgroundColor: 'rgba(255,255,255,0.15)' }} />
                <View style={{ position: 'absolute', top: diameter / 3 - 0.5, left: 0, height: 1, width: diameter, backgroundColor: 'rgba(255,255,255,0.15)' }} />
                <View style={{ position: 'absolute', top: (diameter / 3) * 2 - 0.5, left: 0, height: 1, width: diameter, backgroundColor: 'rgba(255,255,255,0.15)' }} />
              </View>
            </View>
          </View>

          <Animated.View style={[styles.hintRow, hintAnimatedStyle]}><Text style={styles.hintText}>Переместите и масштабируйте</Text></Animated.View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000' , justifyContent: 'center', alignItems: 'center'},
  screen: { width: '100%', height: '100%' },
  topBar: { position: 'absolute', top: 36, left: 16, right: 16, zIndex: 40, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  topBtn: { paddingVertical: 8, paddingHorizontal: 12 },
  topText: { color: '#fff', fontSize: 16 },
  topBtnPrimary: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.18, shadowRadius: 8, elevation: 6 },
  topPrimaryText: { fontWeight: '700', fontSize: 16 },
  editorArea: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  maskContainer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' },
  maskRowTop: { position: 'absolute', left: 0, right: 0, top: 0 },
  maskRowBottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  maskMiddleRow: { flexDirection: 'row', alignItems: 'center' },
  maskSide: { flex: 1 },
  maskHole: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)', overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  hintRow: { position: 'absolute', bottom: 36, left: 0, right: 0, alignItems: 'center' },
  hintText: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },
});
