import { useEffect, useRef, useState } from 'react';
import { Modal, View, StyleSheet, Image, Text, Pressable, ActivityIndicator, Dimensions } from 'react-native';
import { PanGestureHandler, PinchGestureHandler, RotationGestureHandler, TapGestureHandler } from 'react-native-gesture-handler';
import ImageZoom from 'react-native-image-pan-zoom';
import * as ImageManipulator from 'expo-image-manipulator';
import { useTheme } from '../../theme/ThemeProvider';
import { useTranslation } from '../../src/i18n/useTranslation';

// Feature-detect reanimated native availability. Use Reanimated AAA implementation when available,
// otherwise fall back to a safe JS implementation compatible with Expo Go.
let Reanimated;
try {
  Reanimated = require('react-native-reanimated');
} catch {
  Reanimated = null;
}

const HAS_REANIMATED = !!(Reanimated && Reanimated.useSharedValue && Reanimated.useAnimatedGestureHandler);

// Native cropper integration removed — use unified JS cropper for consistent UX in Expo.

function FallbackCropper({ visible, uri, onCancel, onConfirm }) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [_loading, setLoading] = useState(false);
  const [imageSize, setImageSize] = useState({ w: 0, h: 0 });
  const [shape, setShape] = useState('circle'); // 'circle' or 'square'
  const windowW = Dimensions.get('window').width;
  const windowH = Dimensions.get('window').height;
  const containerSize = Math.min(windowW - 48, Math.min(windowW, windowH) - 200);
  const scaleRef = useRef(1);
  const translateRef = useRef({ x: 0, y: 0 });
  const lastScaleRef = useRef(1);
  const lastTranslateRef = useRef({ x: 0, y: 0 });
  const rotationRef = useRef(0);
  const lastRotationRef = useRef(0);
  const [_, setTick] = useState(0);
  // ImageZoom state
  const zoomStateRef = useRef({ scale: 1, positionX: 0, positionY: 0 });

  useEffect(() => {
    if (!uri) return;
    Image.getSize(uri, (w, h) => setImageSize({ w, h }), () => setImageSize({ w: 0, h: 0 }));
  }, [uri]);

  // Use ImageZoom's onMove to track pan/zoom
  const onZoomMove = (e) => {
    try {
      const { scale = 1, positionX = 0, positionY = 0 } = e || {};
      zoomStateRef.current.scale = scale;
      zoomStateRef.current.positionX = positionX;
      zoomStateRef.current.positionY = positionY;
      setTick((t) => t + 1);
    } catch {}
  };

  // pinch handled by ImageZoom

  const _onRotateGestureEvent = (event) => {
    try {
      const _e = event.nativeEvent;
      rotationRef.current = lastRotationRef.current + (_e.rotation || 0);
      setTick((t) => t + 1);
    } catch {}
  };

  const _onRotateHandlerStateChange = (event) => {
    const _e = event.nativeEvent;
    if (_e.state === 5 || _e.oldState === 4) {
      lastRotationRef.current = rotationRef.current;
    }
  };

  const _onDoubleTapHandler = (event) => {
    try {
      const _e = event.nativeEvent;
      if (_e.state === 5) {
        const target = zoomStateRef.current.scale > 1.5 ? 1 : 2;
        zoomStateRef.current.scale = target;
        setTick((t) => t + 1);
      }
    } catch {}
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
      const zoom = zoomStateRef.current.scale || 1;
      const displayedW = iw * fitScale * zoom;
      const displayedH = ih * fitScale * zoom;
      const offsetX = (zoomStateRef.current.positionX || 0) + (container - displayedW) / 2;
      const offsetY = (zoomStateRef.current.positionY || 0) + (container - displayedH) / 2;
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
    } catch {
      onCancel?.();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={!!visible} transparent animationType="slide">
      <View style={[styles.backdrop, { backgroundColor: theme.colors.modalBackdrop || 'rgba(0,0,0,0.85)' }]}> 
        <View style={[styles.fullscreenContainer, { backgroundColor: theme.colors.surface }]}> 
          <View style={styles.headerRowTop}>
            <Pressable onPress={onCancel} style={styles.headerBtn}>
              <Text style={{ color: theme.colors.textSecondary }}>{t('btn_cancel') || 'Отмена'}</Text>
            </Pressable>
            <Text style={{ fontSize: theme.typography.sizes.lg, fontWeight: '700', color: theme.colors.text }}>{t('profile_photo_crop_title') && t('profile_photo_crop_title') !== 'profile_photo_crop_title' ? t('profile_photo_crop_title') : 'Обрезать фото'}</Text>
            <Pressable onPress={handleConfirm} style={styles.headerBtn}>
              <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>{t('btn_apply') || 'Применить'}</Text>
            </Pressable>
          </View>
          <View style={{ alignSelf: 'center', width: containerSize, height: containerSize, backgroundColor: theme.colors.background, overflow: 'hidden', borderRadius: 8 }}>
            {uri ? (
              <ImageZoom
                cropWidth={containerSize}
                cropHeight={containerSize}
                imageWidth={containerSize}
                imageHeight={containerSize}
                onMove={({ positionX, positionY, scale }) => onZoomMove({ positionX, positionY, scale })}
                panToMove={true}
                pinchToZoom={true}
                enableCenterFocus={false}
              >
                <View style={{ width: containerSize, height: containerSize, alignItems: 'center', justifyContent: 'center' }}>
                  <Image
                    source={{ uri }}
                    style={{
                      width: containerSize,
                      height: containerSize,
                      transform: [
                        { rotate: `${rotationRef.current}rad` },
                      ],
                      resizeMode: 'contain',
                    }}
                  />
                  <View pointerEvents="none" style={[styles.grid, { width: containerSize, height: containerSize }]}> 
                    <View style={styles.gridLineHorizontal} />
                    <View style={[styles.gridLineHorizontal, { top: '66%' }]} />
                    <View style={[styles.gridLineHorizontal, { top: '33%' }]} />
                    <View style={styles.gridLineVertical} />
                    <View style={[styles.gridLineVertical, { left: '66%' }]} />
                    <View style={[styles.gridLineVertical, { left: '33%' }]} />
                  </View>
                </View>
              </ImageZoom>
            ) : (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" />
              </View>
            )}
            <View pointerEvents="none" style={[styles.cropOverlay, { width: containerSize, height: containerSize, borderRadius: shape === 'circle' ? containerSize / 2 : 6, borderColor: theme.colors.border }]} />
          </View>

          <View style={{ marginTop: theme.spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                <Pressable onPress={rotate90} style={[styles.largeBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]} accessibilityLabel={t('rotate')}>
                  <Text style={{ fontSize: theme.typography.sizes.lg, color: theme.colors.text }}>⤾</Text>
                </Pressable>
                <Pressable onPress={resetTransforms} style={[styles.largeBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]} accessibilityLabel={t('reset')}>
                  <Text style={{ fontSize: theme.typography.sizes.lg, color: theme.colors.text }}>⟲</Text>
                </Pressable>
                <Pressable onPress={() => setShape(shape === 'circle' ? 'square' : 'circle')} style={[styles.largeBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]} accessibilityLabel={t('toggle_shape')}>
                  <Text style={{ fontSize: theme.typography.sizes.lg, color: theme.colors.text }}>{shape === 'circle' ? '●' : '◻'}</Text>
                </Pressable>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                <Pressable onPress={zoomOut} style={[styles.roundBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                  <Text style={{ fontSize: theme.typography.sizes.lg, color: theme.colors.text }}>−</Text>
                </Pressable>
                <Text style={{ minWidth: 48, textAlign: 'center', color: theme.colors.text }}>{Math.round((scaleRef?.current || scale?.value || 1) * 100)}%</Text>
                <Pressable onPress={zoomIn} style={[styles.roundBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                  <Text style={{ fontSize: theme.typography.sizes.lg, color: theme.colors.text }}>+</Text>
                </Pressable>
              </View>

              <View style={{ flexDirection: 'row', gap: theme.spacing.md, alignItems: 'center' }}>
                <Pressable onPress={onCancel} style={{ paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.md }}>
                  <Text style={{ color: theme.colors.textSecondary }}>{t('btn_cancel') || 'Отмена'}</Text>
                </Pressable>
                <Pressable onPress={handleConfirm} style={{ paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.md }}>
                  <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>{t('btn_apply') || 'Применить'}</Text>
                </Pressable>
              </View>
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
  const [_loading, setLoading] = useState(false);
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
    } catch {
      onCancel?.();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={!!visible} transparent animationType="slide">
      <View style={[styles.backdrop, { backgroundColor: theme.colors.modalBackdrop || 'rgba(0,0,0,0.6)' }]}> 
        <View style={[styles.container, { width: containerSize + 32, backgroundColor: theme.colors.surface }]}> 
          {(() => {
            const tt = t('profile_photo_crop_title');
            const titleText = tt && tt !== 'profile_photo_crop_title' ? tt : 'Обрезать фото';
            return <Text style={{ fontSize: theme.typography.sizes.md, fontWeight: '600', marginBottom: theme.spacing.md, color: theme.colors.text }}>{titleText}</Text>;
          })()}
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

          <View style={{ marginTop: theme.spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                <Pressable onPress={rotate90} style={[styles.largeBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]} accessibilityLabel={t('rotate')}>
                  <Text style={{ fontSize: theme.typography.sizes.lg, color: theme.colors.text }}>⤾</Text>
                </Pressable>
                <Pressable onPress={resetTransforms} style={[styles.largeBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]} accessibilityLabel={t('reset')}>
                  <Text style={{ fontSize: theme.typography.sizes.lg, color: theme.colors.text }}>⟲</Text>
                </Pressable>
                <Pressable onPress={() => setShape(shape === 'circle' ? 'square' : 'circle')} style={[styles.largeBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]} accessibilityLabel={t('toggle_shape')}>
                  <Text style={{ fontSize: theme.typography.sizes.lg, color: theme.colors.text }}>{shape === 'circle' ? '●' : '◻'}</Text>
                </Pressable>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                <Pressable onPress={zoomOut} style={[styles.roundBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                  <Text style={{ fontSize: theme.typography.sizes.lg, color: theme.colors.text }}>−</Text>
                </Pressable>
                <Text style={{ minWidth: 48, textAlign: 'center', color: theme.colors.text }}>{Math.round((scale?.value || 1) * 100)}%</Text>
                <Pressable onPress={zoomIn} style={[styles.roundBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                  <Text style={{ fontSize: theme.typography.sizes.lg, color: theme.colors.text }}>+</Text>
                </Pressable>
              </View>

              <View style={{ flexDirection: 'row', gap: theme.spacing.md, alignItems: 'center' }}>
                <Pressable onPress={onCancel} style={{ paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.md }}>
                  <Text style={{ color: theme.colors.textSecondary }}>{t('btn_cancel') || 'Отмена'}</Text>
                </Pressable>
                <Pressable onPress={handleConfirm} style={{ paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.md }}>
                  <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>{t('btn_apply') || 'Применить'}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}



export default function AvatarCropModal(props) {
  // Prefer Reanimated version when available, otherwise use JS fallback.
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
  largeBtn: { width: 48, height: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  roundBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  fullscreenContainer: { width: '92%', maxWidth: 760, borderRadius: 12, padding: 16 },
  headerRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  headerBtn: { paddingVertical: 8, paddingHorizontal: 12 },
  toolbarBottom: { marginTop: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
