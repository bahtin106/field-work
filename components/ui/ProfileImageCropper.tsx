import React, { useCallback, useEffect, useState } from 'react';
import { Modal, View, StyleSheet, Image, Text, TouchableOpacity, ActivityIndicator, LayoutChangeEvent } from 'react-native';
import { PanGestureHandler, PinchGestureHandler } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import ImageZoom from 'react-native-image-pan-zoom';
// Feature-detect reanimated exports to avoid runtime import issues in some bundlers
let Reanimated;
try {
  Reanimated = require('react-native-reanimated');
} catch (e) {
  Reanimated = Animated;
}
const { withTiming, runOnJS } = Reanimated;
import * as ImageManipulator from 'expo-image-manipulator';
import { useTheme } from '../../theme/ThemeProvider';

type Props = {
  visible: boolean;
  imageUri: string | null;
  onCancel: () => void;
  onComplete: (resultUri: string) => void;
};

export default function ProfileImageCropper({ visible, imageUri, onCancel, onComplete }: Props) {
  const { theme } = useTheme();
  const [containerW, setContainerW] = useState(0);
  const [containerH, setContainerH] = useState(0);
  const [origW, setOrigW] = useState<number | null>(null);
  const [origH, setOrigH] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);

  // detect availability of reanimated gesture helpers
  const HAS_REANIMATED = !!(
    Reanimated &&
    typeof Reanimated.useSharedValue === 'function' &&
    typeof Reanimated.useAnimatedGestureHandler === 'function' &&
    typeof Reanimated.useAnimatedStyle === 'function'
  );

  // If Reanimated gesture helpers are not available, render a JS fallback using ImageZoom
  if (!HAS_REANIMATED) {
    const zoomStateRef = { current: { scale: 1, positionX: 0, positionY: 0 } } as any;

    useEffect(() => {
      if (!imageUri) return;
      Image.getSize(imageUri, (w, h) => setOrigW(w), () => setOrigW(null));
    }, [imageUri]);

    const handleConfirmFallback = async () => {
      if (!imageUri || !origW || !origH) return onCancel();
      setProcessing(true);
      try {
        const win = require('react-native').Dimensions.get('window');
        const containerWc = containerW || win.width;
        const containerHc = containerH || win.height;
        const diameter = Math.min(containerWc, containerHc) * 0.82;
        const fitScale = Math.min(containerWc / origW, containerHc / origH);
        const displayedW = origW * fitScale * (zoomStateRef.current.scale || 1);
        const displayedH = origH * fitScale * (zoomStateRef.current.scale || 1);
        const offsetX = (zoomStateRef.current.positionX || 0) + (containerWc - displayedW) / 2;
        const offsetY = (zoomStateRef.current.positionY || 0) + (containerHc - displayedH) / 2;
        const cropX = Math.max(0, Math.round(((0 - offsetX) / displayedW) * origW));
        const cropY = Math.max(0, Math.round(((0 - offsetY) / displayedH) * origH));
        const cropSize = Math.round((diameter / displayedW) * origW);
        const cropW = Math.min(cropSize, origW - cropX);
        const cropH = Math.min(cropSize, origH - cropY);
        const actions = [{ crop: { originX: cropX, originY: cropY, width: cropW, height: cropH } }];
        const result = await ImageManipulator.manipulateAsync(imageUri, actions, { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG });
        onComplete(result.uri);
      } catch (e) {
        onCancel();
      } finally {
        setProcessing(false);
      }
    };

    return (
      <Modal visible={!!visible} transparent animationType="none">
        <Animated.View style={[styles.backdrop, { backgroundColor: theme.colors.modalBackdrop || 'rgba(0,0,0,0.92)' }]}>
          <View style={styles.container} onLayout={(e) => { const { width, height } = e.nativeEvent.layout; setContainerW(width); setContainerH(height); }}>
            <View style={styles.header}>
              <TouchableOpacity onPress={onCancel} style={styles.headerBtn}>
                <Text style={[styles.headerText, { color: theme.colors.textSecondary || theme.colors.text }]}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleConfirmFallback} style={[styles.headerBtnPrimary, { backgroundColor: theme.colors.primary }]} disabled={processing}>
                {processing ? <ActivityIndicator color={theme.colors.background || '#fff'} /> : <Text style={[styles.headerPrimaryText, { color: theme.colors.onPrimary || theme.colors.background || '#fff' }]}>Готово</Text>}
              </TouchableOpacity>
            </View>

            <View style={styles.content}>
              {imageUri ? (
                <ImageZoom
                  cropWidth={Math.min(require('react-native').Dimensions.get('window').width, require('react-native').Dimensions.get('window').height)}
                  cropHeight={Math.min(require('react-native').Dimensions.get('window').width, require('react-native').Dimensions.get('window').height)}
                  imageWidth={Math.min(require('react-native').Dimensions.get('window').width, require('react-native').Dimensions.get('window').height)}
                  imageHeight={Math.min(require('react-native').Dimensions.get('window').width, require('react-native').Dimensions.get('window').height)}
                  onMove={({ positionX, positionY, scale }) => { zoomStateRef.current.scale = scale; zoomStateRef.current.positionX = positionX; zoomStateRef.current.positionY = positionY; }}
                  panToMove
                  pinchToZoom
                >
                  <View style={{ width: containerW || '100%', height: containerH || '100%', alignItems: 'center', justifyContent: 'center' }}>
                    <Image source={{ uri: imageUri }} style={{ width: containerW || '100%', height: containerH || '100%', resizeMode: 'contain' }} />
                  </View>
                </ImageZoom>
              ) : (
                <ActivityIndicator size="large" color={theme.colors.primary} />
              )}
            </View>
          </View>
        </Animated.View>
      </Modal>
    );
  }

  useEffect(() => {
    if (visible) {
      opacity.value = withTiming(1, { duration: 220 });
      scaleModal.value = withTiming(1, { duration: 220 });
    } else {
      opacity.value = withTiming(0, { duration: 180 });
      scaleModal.value = withTiming(0.98, { duration: 180 });
    }
  }, [visible]);

  useEffect(() => {
    if (!imageUri) return;
    Image.getSize(
      imageUri,
      (w, h) => {
        setOrigW(w);
        setOrigH(h);
      },
      () => {
        setOrigW(null);
        setOrigH(null);
      }
    );
  }, [imageUri]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerW(width);
    setContainerH(height);
  }, []);

  // gestures (reanimated available)
  const useSharedValue = Reanimated.useSharedValue;
  const useAnimatedStyle = Reanimated.useAnimatedStyle;
  const useAnimatedGestureHandler = Reanimated.useAnimatedGestureHandler;

  // shared values for gestures
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);

  const opacity = useSharedValue(0);
  const scaleModal = useSharedValue(0.98);

  const panHandler = useAnimatedGestureHandler({
    onStart: (_, ctx: any) => {
      ctx.startX = translateX.value;
      ctx.startY = translateY.value;
    },
    onActive: (event, ctx: any) => {
      translateX.value = ctx.startX + event.translationX;
      translateY.value = ctx.startY + event.translationY;
    },
    onEnd: (event) => {
      // small easing back could be added
    },
  });

  const pinchHandler = useAnimatedGestureHandler({
    onStart: (_, ctx: any) => {
      ctx.start = scale.value;
    },
    onActive: (event, ctx: any) => {
      const next = Math.max(1, Math.min(4, ctx.start * event.scale));
      scale.value = next;
    },
    onEnd: () => {
      if (scale.value < 1) scale.value = withTiming(1, { duration: 200 });
      if (scale.value > 4) scale.value = withTiming(4, { duration: 200 });
    },
  });

  const imgStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const modalAnimated = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scaleModal.value }],
  }));

  // compute crop and call manipulator on JS thread
  const doCrop = async (currentScale: number, currentTX: number, currentTY: number) => {
    if (!imageUri || !origW || !origH) return;
    try {
      setProcessing(true);

      const win = require('react-native').Dimensions.get('window');
      const diameter = Math.min(containerW || win.width, containerH || win.height) * 0.82; // circular crop size on screen

      // displayed image size (contain)
      const fitScale = Math.min(containerW / origW, containerH / origH);
      const displayedW = origW * fitScale * currentScale;
      const displayedH = origH * fitScale * currentScale;

      const imageLeft = (containerW - displayedW) / 2 + currentTX;
      const imageTop = (containerH - displayedH) / 2 + currentTY;

      const circleLeft = (containerW - diameter) / 2;
      const circleTop = (containerH - diameter) / 2;

      const relX = (circleLeft - imageLeft) / displayedW; // 0..1 relative
      const relY = (circleTop - imageTop) / displayedH;

      const cropX = Math.max(0, Math.round(relX * origW));
      const cropY = Math.max(0, Math.round(relY * origH));
      const cropW = Math.min(origW - cropX, Math.round((diameter / displayedW) * origW));
      const cropH = Math.min(origH - cropY, Math.round((diameter / displayedH) * origH));

      const actions = [
        { crop: { originX: cropX, originY: cropY, width: cropW, height: cropH } },
      ];

      const result = await ImageManipulator.manipulateAsync(imageUri, actions, { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG });
      onComplete(result.uri);
    } catch (e) {
      // fail silently and cancel
      onCancel();
    } finally {
      setProcessing(false);
    }
  };

  const handleDone = useCallback(() => {
    // read shared values via runOnJS: pass current values
    runOnJS(doCrop)(scale.value, translateX.value, translateY.value);
  }, [imageUri, origW, origH, containerW, containerH]);

  const win = require('react-native').Dimensions.get('window');
  const diameter = Math.min(containerW || win.width, containerH || win.height) * 0.82;

  return (
    <Modal visible={!!visible} transparent animationType="none">
      <Animated.View style={[styles.backdrop, { backgroundColor: theme.colors.modalBackdrop || 'rgba(0,0,0,0.92)' }, modalAnimated]}>
        <View style={styles.container} onLayout={onLayout}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onCancel} style={styles.headerBtn}>
              <Text style={[styles.headerText, { color: theme.colors.textSecondary || theme.colors.text }]}>Отмена</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDone} style={[styles.headerBtnPrimary, { backgroundColor: theme.colors.primary }]} disabled={processing}>
              {processing ? <ActivityIndicator color={theme.colors.background || '#fff'} /> : <Text style={[styles.headerPrimaryText, { color: theme.colors.onPrimary || theme.colors.background || '#fff' }]}>Готово</Text>}
            </TouchableOpacity>
          </View>

          <View style={styles.content} pointerEvents="box-none">
            <PinchGestureHandler onGestureEvent={pinchHandler}>
              <Animated.View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <PanGestureHandler onGestureEvent={panHandler}>
                  <Animated.View style={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                    {imageUri ? (
                      <Animated.Image
                        source={{ uri: imageUri }}
                        style={[{ width: containerW || '100%', height: containerH || '100%', resizeMode: 'contain' }, imgStyle]}
                      />
                    ) : (
                      <ActivityIndicator size="large" color={theme.colors.primary} />
                    )}
                  </Animated.View>
                </PanGestureHandler>
              </Animated.View>
            </PinchGestureHandler>

            {/* four overlays to darken outside the central circle */}
            <View style={styles.maskContainer} pointerEvents="none">
              <View style={[styles.maskTop, { height: containerH ? (containerH - diameter) / 2 : 0, backgroundColor: theme.colors.modalBackdrop || 'rgba(0,0,0,0.6)' }]} />
              <View style={styles.maskMiddleRow}>
                <View style={[styles.maskSide, { backgroundColor: theme.colors.modalBackdrop || 'rgba(0,0,0,0.6)' }]} />
                <View style={[styles.maskHole, { width: diameter, height: diameter, borderRadius: diameter / 2, borderColor: theme.colors.border || 'rgba(255,255,255,0.9)' }]} />
                <View style={[styles.maskSide, { backgroundColor: theme.colors.modalBackdrop || 'rgba(0,0,0,0.6)' }]} />
              </View>
              <View style={[styles.maskBottom, { height: containerH ? (containerH - diameter) / 2 : 0, backgroundColor: theme.colors.modalBackdrop || 'rgba(0,0,0,0.6)' }]} />
            </View>
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  container: { width: '100%', height: '100%', paddingTop: 40 },
  header: { position: 'absolute', top: 18, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between', zIndex: 40 },
  headerBtn: { paddingVertical: 8, paddingHorizontal: 12 },
  headerBtnPrimary: { paddingVertical: 8, paddingHorizontal: 14, backgroundColor: '#0066FF', borderRadius: 8 },
  headerText: { color: '#fff', fontSize: 16 },
  headerPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  maskContainer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' },
  maskTop: { position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  maskBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  maskMiddleRow: { flexDirection: 'row', alignItems: 'center' },
  maskSide: { backgroundColor: 'rgba(0,0,0,0.6)', flex: 1, height: 1 },
  maskHole: { backgroundColor: 'transparent', borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)' },
});
