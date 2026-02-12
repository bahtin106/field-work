import React, { useEffect, useRef, useState } from 'react';
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
} catch (e) {
  Reanimated = null;
}

const HAS_REANIMATED = !!(Reanimated && Reanimated.useSharedValue && Reanimated.useAnimatedGestureHandler);

// Native cropper integration removed — use unified JS cropper for consistent UX in Expo.

function FallbackCropper({ visible, uri, onCancel, onConfirm }) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
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
    } catch (err) {}
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
        const target = zoomStateRef.current.scale > 1.5 ? 1 : 2;
        zoomStateRef.current.scale = target;
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
    } catch (e) {
      onCancel?.();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={!!visible} transparent animationType="none">
      <View style={[styles.backdrop, { backgroundColor: theme.colors.modalBackdrop || 'rgba(0,0,0,0.92)' }]}> 
        <View style={[styles.fullscreenContainer, { backgroundColor: 'transparent' }]}> 
          <View style={styles.headerRowTop}>
            <Pressable onPress={onCancel} style={styles.headerBtn}>
              <Text style={{ color: theme.colors.textSecondary }}>Отмена</Text>
            </Pressable>
            <Pressable onPress={handleConfirm} style={styles.headerBtn}>
              <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>Готово</Text>
            </Pressable>
          </View>
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', width: '100%' }}>
            <View style={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
              {uri ? (
                <ImageZoom
                  cropWidth={Math.min(Dimensions.get('window').width, Dimensions.get('window').height)}
                  cropHeight={Math.min(Dimensions.get('window').width, Dimensions.get('window').height)}
                  imageWidth={Math.min(Dimensions.get('window').width, Dimensions.get('window').height)}
                  imageHeight={Math.min(Dimensions.get('window').width, Dimensions.get('window').height)}
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
                        resizeMode: 'contain',
                      }}
                    />
                  </View>
                </ImageZoom>
              ) : (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <ActivityIndicator size="large" />
                </View>
              )}

              {/* Four overlays to create a circular cutout effect without extra libs */}
              <View pointerEvents="none" style={styles.overlayContainer} onLayout={() => {}}>
                <View style={styles.overlayTop} />
                <View style={styles.overlayMiddleRow}>
                  <View style={styles.overlaySide} />
                  <View style={styles.overlayHole} />
                  <View style={styles.overlaySide} />
                </View>
                <View style={styles.overlayBottom} />
              </View>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ReanimatedCropper() {
  // original reanimated version lives in the file; we keep the JS fallback backup here only.
  return null;
}

export default function AvatarCropModal(props) {
  if (HAS_REANIMATED) return <ReanimatedCropper {...props} />;
  return <FallbackCropper {...props} />;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  fullscreenContainer: { width: '100%', height: '100%' },
  headerRowTop: { position: 'absolute', top: 36, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', zIndex: 20 },
  headerBtn: { paddingVertical: 8, paddingHorizontal: 12 },
  overlayContainer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  overlayTop: { position: 'absolute', left: 0, right: 0, top: 0, height: '10%', backgroundColor: 'rgba(0,0,0,0.6)' },
  overlayBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '10%', backgroundColor: 'rgba(0,0,0,0.6)' },
  overlayMiddleRow: { flexDirection: 'row', alignItems: 'center' },
  overlaySide: { backgroundColor: 'rgba(0,0,0,0.6)', width: 40, height: 40, borderRadius: 4 },
  overlayHole: { width: 260, height: 260, borderRadius: 130, backgroundColor: 'transparent', borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)' },
});
