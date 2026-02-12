import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, StyleSheet, Image, Text, Pressable, ActivityIndicator, Dimensions } from 'react-native';
import { PanGestureHandler, PinchGestureHandler, RotationGestureHandler, TapGestureHandler } from 'react-native-gesture-handler';
import * as ImageManipulator from 'expo-image-manipulator';
import { useTheme } from '../../theme/ThemeProvider';
import { useTranslation } from '../../src/i18n/useTranslation';

// Feature-detect reanimated native availability. Use Reanimated AAA implementation when available,
// otherwise fall back to a safe JS implementation compatible with Expo Go.
let Reanimated;
try {
  Reanimated = require('react-native-reanimated');
} catch (e) {
  Reanimated = null;
}

const HAS_REANIMATED = !!(Reanimated && Reanimated.useSharedValue && Reanimated.useAnimatedGestureHandler);

function FallbackCropper({ visible, uri, onCancel, onConfirm }) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [imageSize, setImageSize] = useState({ w: 0, h: 0 });
  const [shape, setShape] = useState('circle'); // 'circle' or 'square'
  const containerSize = Math.min(Dimensions.get('window').width - 48, 360);
  const scaleRef = useRef(1);
  const translateRef = useRef({ x: 0, y: 0 });
  const lastScaleRef = useRef(1);
  const lastTranslateRef = useRef({ x: 0, y: 0 });
  const rotationRef = useRef(0);
  const lastRotationRef = useRef(0);
  const [_, setTick] = useState(0);

  useEffect(() => {
    if (!uri) return;
    Image.getSize(uri, (w, h) => setImageSize({ w, h }), () => setImageSize({ w: 0, h: 0 }));
  }, [uri]);

  const onPanGestureEvent = (event) => {
    try {
      const e = event.nativeEvent;
      translateRef.current.x = lastTranslateRef.current.x + (e.translationX || 0);
      translateRef.current.y = lastTranslateRef.current.y + (e.translationY || 0);
      setTick((t) => t + 1);
    } catch (err) {}
  };

  const onPanHandlerStateChange = (event) => {
    const e = event.nativeEvent;
    if (e.state === 5 || e.oldState === 4) {
      lastTranslateRef.current.x = translateRef.current.x;
      lastTranslateRef.current.y = translateRef.current.y;
    }
  };

  const onPinchGestureEvent = (event) => {
    try {
      const e = event.nativeEvent;
      const s = Math.max(1, Math.min(3, lastScaleRef.current * (e.scale || 1)));
      scaleRef.current = s;
      setTick((t) => t + 1);
    } catch (err) {}
  };

  const onPinchHandlerStateChange = (event) => {
    const e = event.nativeEvent;
    if (e.state === 5 || e.oldState === 4) {
      lastScaleRef.current = scaleRef.current;
    }
  };

  const onRotateGestureEvent = (event) => {
    try {
      const e = event.nativeEvent;
      rotationRef.current = lastRotationRef.current + (e.rotation || 0);
      setTick((t) => t + 1);
    } catch (err) {}
  };

  const onRotateHandlerStateChange = (event) => {
    const e = event.nativeEvent;
    if (e.state === 5 || e.oldState === 4) {
      lastRotationRef.current = rotationRef.current;
    }
  };

  const onDoubleTapHandler = (event) => {
    try {
      const e = event.nativeEvent;
      if (e.state === 5) {
        const target = scaleRef.current > 1.5 ? 1 : 2;
        scaleRef.current = target;
        lastScaleRef.current = target;
        setTick((t) => t + 1);
      }
    } catch (err) {}
  };

  const rotate90 = () => {
    rotationRef.current = lastRotationRef.current + Math.PI / 2;
    lastRotationRef.current = rotationRef.current;
    setTick((t) => t + 1);
  };

  const resetTransforms = () => {
    scaleRef.current = 1;
    lastScaleRef.current = 1;
    translateRef.current = { x: 0, y: 0 };
    lastTranslateRef.current = { x: 0, y: 0 };
    rotationRef.current = 0;
    lastRotationRef.current = 0;
    setTick((t) => t + 1);
  };

  const zoomIn = () => {
    scaleRef.current = Math.min(scaleRef.current + 0.1, 3);
    setTick((t) => t + 1);
  };
  const zoomOut = () => {
    scaleRef.current = Math.max(scaleRef.current - 0.1, 1);
    setTick((t) => t + 1);
  };

  const handleConfirm = async () => {
    try {
      setLoading(true);
      const { w: iw, h: ih } = imageSize;
      if (!iw || !ih) {
        onConfirm?.(uri);
        return;
      }
      const container = containerSize;
      const fitScale = Math.min(container / iw, container / ih);
      const displayedW = iw * fitScale * scaleRef.current;
      const displayedH = ih * fitScale * scaleRef.current;
      const offsetX = translateRef.current.x + (container - displayedW) / 2;
      const offsetY = translateRef.current.y + (container - displayedH) / 2;
      const cropX = Math.max(0, Math.round(((0 - offsetX) / displayedW) * iw));
      const cropY = Math.max(0, Math.round(((0 - offsetY) / displayedH) * ih));
      const cropSize = Math.round((container / displayedW) * iw);
      const cropW = Math.min(cropSize, iw - cropX);
      const cropH = Math.min(cropSize, ih - cropY);

      const actions = [
        { crop: { originX: cropX, originY: cropY, width: cropW, height: cropH } },
      ];
      const manipResult = await ImageManipulator.manipulateAsync(uri, actions, { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG });
      onConfirm?.(manipResult.uri);
    } catch (e) {
      onCancel?.();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={!!visible} transparent animationType="slide">
      <View style={[styles.backdrop, { backgroundColor: theme.colors.modalBackdrop || 'rgba(0,0,0,0.6)' }]}> 
        <View style={[styles.container, { width: containerSize + 32, backgroundColor: theme.colors.surface }]}> 
          <Text style={{ fontSize: theme.typography.sizes.md, fontWeight: '600', marginBottom: theme.spacing.md, color: theme.colors.text }}>{t('profile_photo_crop_title') || 'Обрезать фото'}</Text>
          <View style={{ alignSelf: 'center', width: containerSize, height: containerSize, backgroundColor: theme.colors.background, overflow: 'hidden' }}>
            {uri ? (
              <TapGestureHandler numberOfTaps={2} onHandlerStateChange={onDoubleTapHandler}>
                <RotationGestureHandler onGestureEvent={onRotateGestureEvent} onHandlerStateChange={onRotateHandlerStateChange}>
                  <PinchGestureHandler onGestureEvent={onPinchGestureEvent} onHandlerStateChange={onPinchHandlerStateChange}>
                    <PanGestureHandler onGestureEvent={onPanGestureEvent} onHandlerStateChange={onPanHandlerStateChange}>
                      <View style={{ width: containerSize, height: containerSize, alignItems: 'center', justifyContent: 'center' }}>
                        <Image
                          source={{ uri }}
                          style={{
                            width: containerSize,
                            height: containerSize,
                            transform: [
                              { translateX: translateRef.current.x },
                              { translateY: translateRef.current.y },
                              { scale: scaleRef.current },
                              { rotate: `${rotationRef.current}rad` },
                            ],
                            resizeMode: 'contain',
                          }}
                        />
                        {/* Grid / rule of thirds overlay */}
                        <View pointerEvents="none" style={[styles.grid, { width: containerSize, height: containerSize }]}> 
                          <View style={styles.gridLineHorizontal} />
                          <View style={[styles.gridLineHorizontal, { top: '66%' }]} />
                          <View style={[styles.gridLineHorizontal, { top: '33%' }]} />
                          <View style={styles.gridLineVertical} />
                          <View style={[styles.gridLineVertical, { left: '66%' }]} />
                          <View style={[styles.gridLineVertical, { left: '33%' }]} />
                        </View>
                      </View>
                    </PanGestureHandler>
                  </PinchGestureHandler>
                </RotationGestureHandler>
              </TapGestureHandler>
            ) : (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" />
              </View>
            )}
            <View pointerEvents="none" style={[styles.cropOverlay, { width: containerSize, height: containerSize, borderRadius: shape === 'circle' ? containerSize / 2 : 6, borderColor: theme.colors.border }]} />
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.spacing.md, marginTop: theme.spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              <Pressable onPress={rotate90} style={[styles.actionBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]} accessibilityLabel={t('rotate')}>
                <Text style={{ fontSize: theme.typography.sizes.md, color: theme.colors.text }}>⤾</Text>
              </Pressable>
              <Pressable onPress={resetTransforms} style={[styles.actionBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]} accessibilityLabel={t('reset')}>
                <Text style={{ fontSize: theme.typography.sizes.md, color: theme.colors.text }}>⟲</Text>
              </Pressable>
              <Pressable onPress={() => setShape(shape === 'circle' ? 'square' : 'circle')} style={[styles.actionBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]} accessibilityLabel={t('toggle_shape')}>
                <Text style={{ fontSize: theme.typography.sizes.md, color: theme.colors.text }}>{shape === 'circle' ? '●' : '◻'}</Text>
              </Pressable>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <Pressable onPress={zoomOut} style={[styles.zoomBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <Text style={{ fontSize: theme.typography.sizes.md, color: theme.colors.text }}>−</Text>
              </Pressable>
              <Pressable onPress={zoomIn} style={[styles.zoomBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <Text style={{ fontSize: theme.typography.sizes.md, color: theme.colors.text }}>+</Text>
              </Pressable>
              <Pressable onPress={onCancel} style={{ padding: theme.spacing.sm }}>
                <Text style={{ color: theme.colors.textSecondary }}>{t('btn_cancel') || 'Отмена'}</Text>
              </Pressable>
              <Pressable onPress={handleConfirm} style={{ padding: theme.spacing.sm }}>
                <Text style={{ color: theme.colors.primary }}>{t('btn_apply') || 'Применить'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ReanimatedCropper({ visible, uri, onCancel, onConfirm }) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [imageSize, setImageSize] = useState({ w: 0, h: 0 });
  const [shape, setShape] = useState('circle');
  const containerSize = Math.min(Dimensions.get('window').width - 48, 360);

  const { useSharedValue, useAnimatedStyle, withTiming, withDecay, useAnimatedGestureHandler } = Reanimated;
  const Animated = Reanimated.default || Reanimated;

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const rotation = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startRotation = useSharedValue(0);

  useEffect(() => {
    if (!uri) return;
    Image.getSize(uri, (w, h) => setImageSize({ w, h }), () => setImageSize({ w: 0, h: 0 }));
  }, [uri]);

  const panHandler = useAnimatedGestureHandler({
    onStart: (_, ctx) => {
      ctx.startX = translateX.value;
      ctx.startY = translateY.value;
    },
    onActive: (event, ctx) => {
      translateX.value = ctx.startX + event.translationX;
      translateY.value = ctx.startY + event.translationY;
    },
    onEnd: (event) => {
      translateX.value = withDecay({ velocity: event.velocityX });
      translateY.value = withDecay({ velocity: event.velocityY });
    },
  });

  const pinchHandler = useAnimatedGestureHandler({
    onStart: () => {
      startScale.value = scale.value;
    },
    onActive: (event) => {
      const next = Math.max(1, Math.min(3, startScale.value * event.scale));
      scale.value = next;
    },
    onEnd: () => {
      if (scale.value < 1) scale.value = withTiming(1);
      if (scale.value > 3) scale.value = withTiming(3);
    },
  });

  const rotateHandler = useAnimatedGestureHandler({
    onStart: () => {
      startRotation.value = rotation.value;
    },
    onActive: (event) => {
      rotation.value = startRotation.value + event.rotation;
    },
  });

  const doubleTapHandler = useAnimatedGestureHandler({
    onActive: () => {
      const target = scale.value > 1.5 ? 1 : 2;
      scale.value = withTiming(target, { duration: 250 });
    },
  });

  const rotate90 = () => { rotation.value = withTiming(rotation.value + Math.PI / 2, { duration: 200 }); };
  const resetTransforms = () => {
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    scale.value = withTiming(1);
    rotation.value = withTiming(0);
  };

  const imageAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
      { rotate: `${rotation.value}rad` },
    ],
  }));

  const zoomIn = () => { scale.value = withTiming(Math.min(scale.value + 0.1, 3)); };
  const zoomOut = () => { scale.value = withTiming(Math.max(scale.value - 0.1, 1)); };

  const handleConfirm = async () => {
    try {
      setLoading(true);
      const { w: iw, h: ih } = imageSize;
      if (!iw || !ih) {
        onConfirm?.(uri);
        return;
      }
      const container = containerSize;
      const fitScale = Math.min(container / iw, container / ih);
      const displayedW = iw * fitScale * scale.value;
      const displayedH = ih * fitScale * scale.value;
      const offsetX = translateX.value + (container - displayedW) / 2;
      const offsetY = translateY.value + (container - displayedH) / 2;
      const cropX = Math.max(0, Math.round(((0 - offsetX) / displayedW) * iw));
      const cropY = Math.max(0, Math.round(((0 - offsetY) / displayedH) * ih));
      const cropSize = Math.round((container / displayedW) * iw);
      const cropW = Math.min(cropSize, iw - cropX);
      const cropH = Math.min(cropSize, ih - cropY);
      const actions = [{ crop: { originX: cropX, originY: cropY, width: cropW, height: cropH } }];
      const manipResult = await ImageManipulator.manipulateAsync(uri, actions, { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG });
      onConfirm?.(manipResult.uri);
    } catch (e) {
      onCancel?.();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={!!visible} transparent animationType="slide">
      <View style={[styles.backdrop, { backgroundColor: theme.colors.modalBackdrop || 'rgba(0,0,0,0.6)' }]}> 
        <View style={[styles.container, { width: containerSize + 32, backgroundColor: theme.colors.surface }]}> 
          <Text style={{ fontSize: theme.typography.sizes.md, fontWeight: '600', marginBottom: theme.spacing.md, color: theme.colors.text }}>{t('profile_photo_crop_title') || 'Обрезать фото'}</Text>
          <View style={{ alignSelf: 'center', width: containerSize, height: containerSize, backgroundColor: theme.colors.background, overflow: 'hidden' }}>
            {uri ? (
              <TapGestureHandler numberOfTaps={2} onGestureEvent={doubleTapHandler}>
                <RotationGestureHandler onGestureEvent={rotateHandler}>
                  <PinchGestureHandler onGestureEvent={pinchHandler}>
                    <PanGestureHandler onGestureEvent={panHandler}>
                      <Animated.View style={{ width: containerSize, height: containerSize, alignItems: 'center', justifyContent: 'center' }}>
                        <Animated.Image source={{ uri }} style={[{ width: containerSize, height: containerSize, resizeMode: 'contain' }, imageAnimatedStyle]} />
                        <View pointerEvents="none" style={[styles.grid, { width: containerSize, height: containerSize }]}> 
                          <View style={styles.gridLineHorizontal} />
                          <View style={[styles.gridLineHorizontal, { top: '66%' }]} />
                          <View style={[styles.gridLineHorizontal, { top: '33%' }]} />
                          <View style={styles.gridLineVertical} />
                          <View style={[styles.gridLineVertical, { left: '66%' }]} />
                          <View style={[styles.gridLineVertical, { left: '33%' }]} />
                        </View>
                      </Animated.View>
                    </PanGestureHandler>
                  </PinchGestureHandler>
                </RotationGestureHandler>
              </TapGestureHandler>
            ) : (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" />
              </View>
            )}
            <View pointerEvents="none" style={[styles.cropOverlay, { width: containerSize, height: containerSize, borderRadius: shape === 'circle' ? containerSize / 2 : 6, borderColor: theme.colors.border }]} />
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.spacing.md, marginTop: theme.spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              <Pressable onPress={rotate90} style={[styles.actionBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]} accessibilityLabel={t('rotate')}>
                <Text style={{ fontSize: theme.typography.sizes.md, color: theme.colors.text }}>⤾</Text>
              </Pressable>
              <Pressable onPress={resetTransforms} style={[styles.actionBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]} accessibilityLabel={t('reset')}>
                <Text style={{ fontSize: theme.typography.sizes.md, color: theme.colors.text }}>⟲</Text>
              </Pressable>
              <Pressable onPress={() => setShape(shape === 'circle' ? 'square' : 'circle')} style={[styles.actionBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]} accessibilityLabel={t('toggle_shape')}>
                <Text style={{ fontSize: theme.typography.sizes.md, color: theme.colors.text }}>{shape === 'circle' ? '●' : '◻'}</Text>
              </Pressable>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <Pressable onPress={zoomOut} style={[styles.zoomBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <Text style={{ fontSize: theme.typography.sizes.md, color: theme.colors.text }}>−</Text>
              </Pressable>
              <Pressable onPress={zoomIn} style={[styles.zoomBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <Text style={{ fontSize: theme.typography.sizes.md, color: theme.colors.text }}>+</Text>
              </Pressable>
              <Pressable onPress={onCancel} style={{ padding: theme.spacing.sm }}>
                <Text style={{ color: theme.colors.textSecondary }}>{t('btn_cancel') || 'Отмена'}</Text>
              </Pressable>
              <Pressable onPress={handleConfirm} style={{ padding: theme.spacing.sm }}>
                <Text style={{ color: theme.colors.primary }}>{t('btn_apply') || 'Применить'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function AvatarCropModal(props) {
  // If Reanimated native is available, use AAA Reanimated version, else fallback.
  if (HAS_REANIMATED) return <ReanimatedCropper {...props} />;
  return <FallbackCropper {...props} />;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { padding: 16, borderRadius: 12 },
  cropOverlay: { position: 'absolute', left: 0, top: 0, borderWidth: 2, opacity: 0.95 },
  zoomBtn: { width: 44, height: 44, borderRadius: 8, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  actionBtn: { width: 40, height: 36, borderRadius: 8, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  grid: { position: 'absolute', left: 0, top: 0, opacity: 0.5 },
  gridLineHorizontal: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.35)', top: '50%' },
  gridLineVertical: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.35)', left: '50%' },
});
