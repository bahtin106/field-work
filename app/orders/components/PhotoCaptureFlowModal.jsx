// app/orders/components/PhotoCaptureFlowModal.jsx
// ────────────────────────────────────────────────────────────────────
// Fullscreen in-app camera with batch capture (Yandex Drive style).
// Uses expo-camera CameraView for real-time preview.
//
// Layout:
//   ┌─────────────────────────────────────┐
//   │  (X close)            (⚡ flash)    │  ← top bar
//   │                                     │
//   │         LIVE CAMERA PREVIEW         │
//   │                                     │
//   │  [ thumb ] [ thumb ] [ thumb ] ...  │  ← captured strip
//   │     (X)  ──  (●)  ──  (✓)          │  ← controls
//   └─────────────────────────────────────┘
//
// Props:
//   visible  – boolean controlling fullscreen modal
//   onClose  – called when user discards / exits
//   onSave   – called with array of URIs when user confirms
// ────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  Image,
  StyleSheet,
  StatusBar,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ImageViewing from 'react-native-image-viewing';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  FadeIn,
} from 'react-native-reanimated';
import { useTheme } from '../../../theme/ThemeProvider';
import { useTranslation } from '../../../src/i18n/useTranslation';
import Button from '../../../components/ui/Button';
import { BaseModal, AnimatedFullscreenModal } from '../../../components/ui/modals';

// ─── Haptic helpers ───────────────────────────────────────────────
const hapticShutter = () =>
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
const hapticLight = () =>
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

// ─── Unique id generator ─────────────────────────────────────────
let _seqId = 0;
const uid = () => `cap_${Date.now()}_${++_seqId}`;

export default function PhotoCaptureFlowModal({ visible, onClose, onSave }) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef(null);

  // Session photos: [{ id, uri }]
  const [photos, setPhotos] = useState([]);
  const [torch, setTorch] = useState(false);
  const [isTaking, setIsTaking] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);

  // Preview state (ImageViewing)
  const [previewIndex, setPreviewIndex] = useState(-1);

  const s = useMemo(() => buildStyles(theme, insets), [theme, insets]);

  // ── Shutter animation ──────────────────────────────────────
  const shutterScale = useSharedValue(1);
  const shutterAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: shutterScale.value }],
  }));

  // ── Reset on close ────────────────────────────────────────
  useEffect(() => {
    if (!visible) {
      setPhotos([]);
      setTorch(false);
      setIsTaking(false);
      setCameraReady(false);
      setPreviewIndex(-1);
    }
  }, [visible]);

  // ── Request permission on mount ────────────────────────────
  useEffect(() => {
    if (visible && permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [visible, permission]);

  // ── Take picture ───────────────────────────────────────────
  const handleTakePicture = useCallback(async () => {
    if (isTaking || !cameraReady || !cameraRef.current) return;
    setIsTaking(true);
    hapticShutter();

    // Animate shutter button
    shutterScale.value = withSequence(
      withTiming(0.85, { duration: 80 }),
      withSpring(1, { damping: 15, stiffness: 400 }),
    );

    try {
      const result = await cameraRef.current.takePictureAsync({
        quality: theme.media?.quality ?? 0.85,
        shutterSound: true,
      });
      if (result?.uri) {
        setPhotos((prev) => [...prev, { id: uid(), uri: result.uri }]);
      }
    } catch (e) {
      console.warn('[PhotoCapture] takePicture error', e);
    } finally {
      setIsTaking(false);
    }
  }, [isTaking, cameraReady, theme.media?.quality, shutterScale]);

  // ── Confirm (upload all) ───────────────────────────────────
  const handleConfirm = useCallback(() => {
    if (!photos.length) return;
    hapticLight();
    const uris = photos.map((p) => p.uri);
    onSave?.(uris);
    onClose?.();
  }, [photos, onSave, onClose]);

  // ── Close / discard ────────────────────────────────────────
  const handleDiscard = useCallback(() => {
    hapticLight();
    onClose?.();
  }, [onClose]);

  // ── Flash toggle ───────────────────────────────────────────
  const toggleTorch = useCallback(() => {
    hapticLight();
    setTorch((prev) => !prev);
  }, []);

  // ── Remove photo from strip ────────────────────────────────
  const handleRemovePhoto = useCallback((id) => {
    hapticLight();
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // ── Preview handlers ───────────────────────────────────────
  const handleOpenPreview = useCallback((index) => {
    setPreviewIndex(index);
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewIndex(-1);
  }, []);

  // Use refs so the FooterComponent closure always sees fresh values
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const previewIndexRef = useRef(previewIndex);
  previewIndexRef.current = previewIndex;

  const handleDeleteFromPreview = useCallback(() => {
    const idx = previewIndexRef.current;
    const list = photosRef.current;
    if (idx >= 0 && idx < list.length) {
      const id = list[idx].id;
      setPhotos((prev) => prev.filter((p) => p.id !== id));
      setPreviewIndex(-1);
    }
  }, []);

  // ── Preview images for ImageViewing ────────────────────────
  const previewImages = useMemo(
    () => photos.map((p) => ({ uri: p.uri })),
    [photos],
  );

  // ── Thumbnail strip FlatList ───────────────────────────────
  const thumbListRef = useRef(null);

  useEffect(() => {
    // Scroll to end when new photo added
    if (photos.length > 0 && thumbListRef.current) {
      setTimeout(() => {
        thumbListRef.current?.scrollToEnd?.({ animated: true });
      }, 100);
    }
  }, [photos.length]);

  const renderThumb = useCallback(
    ({ item, index }) => (
      <Animated.View entering={FadeIn.duration(200)} style={s.thumbWrap}>
        <Pressable onPress={() => handleOpenPreview(index)}>
          <Image source={{ uri: item.uri }} style={s.thumbImage} />
        </Pressable>
        <Pressable
          onPress={() => handleRemovePhoto(item.id)}
          style={s.thumbRemove}
          hitSlop={theme.spacing.xs}
        >
          <Feather name="x" size={theme.icons.sm - 4} color={theme.colors.onPrimary} />
        </Pressable>
      </Animated.View>
    ),
    [s, theme, handleOpenPreview, handleRemovePhoto],
  );

  const thumbKeyExtractor = useCallback((item) => item.id, []);

  // ── No permission ──────────────────────────────────────────
  if (!visible) return null;

  if (permission && !permission.granted) {
    return (
      <BaseModal visible={visible} onClose={onClose} title={t('order_photos_no_camera_title', 'Нет доступа к камере')}>
        <View style={s.permContent}>
          <Feather name="camera-off" size={theme.icons.lg * 2} color={theme.colors.textSecondary} />
          <Text style={s.permHint}>
            {t('order_photos_no_camera_hint', 'Разрешите доступ к камере в настройках устройства')}
          </Text>
          <Button
            variant="primary"
            size="md"
            title={t('order_photos_close', 'Закрыть')}
            onPress={onClose}
          />
        </View>
      </BaseModal>
    );
  }

  // ── Main camera UI ─────────────────────────────────────────
  return (
    <AnimatedFullscreenModal
      visible={visible}
      animation="slide"
      onRequestClose={handleDiscard}
    >
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <View style={s.root}>
        {/* ── Live camera ── */}
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          flash={torch ? 'on' : 'off'}
          enableTorch={torch}
          mode="picture"
          onCameraReady={() => setCameraReady(true)}
        />

        {/* ── Top bar ── */}
        <View style={s.topBar}>
          <Pressable
            onPress={handleDiscard}
            style={s.topBtn}
            hitSlop={theme.spacing.sm}
            accessibilityLabel={t('order_photos_close', 'Закрыть')}
          >
            <Feather name="x" size={theme.icons.md} color={theme.colors.onPrimary} />
          </Pressable>

          <Pressable
            onPress={toggleTorch}
            style={[s.topBtn, torch && s.topBtnActive]}
            hitSlop={theme.spacing.sm}
            accessibilityLabel={t('camera_flash', 'Вспышка')}
          >
            <Feather
              name={torch ? 'zap' : 'zap-off'}
              size={theme.icons.md}
              color={theme.colors.onPrimary}
            />
          </Pressable>
        </View>

        {/* ── Bottom panel (thumbs + controls) ── */}
        <View style={s.bottomPanel}>
          {/* Thumbnail strip */}
          {photos.length > 0 ? (
            <FlatList
              ref={thumbListRef}
              data={photos}
              renderItem={renderThumb}
              keyExtractor={thumbKeyExtractor}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.thumbList}
              style={s.thumbListWrap}
            />
          ) : (
            <View style={s.emptyStrip}>
              <Text style={s.emptyStripText}>
                {t('camera_no_photos_yet', 'Сделайте фото')}
              </Text>
            </View>
          )}

          {/* Controls row */}
          <View style={s.controlsRow}>
            {/* Close (X) */}
            <Pressable
              onPress={handleDiscard}
              style={s.controlBtn}
              accessibilityLabel={t('order_photos_close', 'Закрыть')}
            >
              <Feather name="x" size={theme.icons.lg} color={theme.colors.onPrimary} />
            </Pressable>

            {/* Shutter */}
            <Pressable onPress={handleTakePicture} disabled={isTaking || !cameraReady}>
              <Animated.View style={[s.shutterOuter, shutterAnimStyle]}>
                <View style={s.shutterInner} />
              </Animated.View>
            </Pressable>

            {/* Confirm (✓) */}
            <Pressable
              onPress={handleConfirm}
              disabled={photos.length === 0}
              style={[s.controlBtn, s.confirmBtn, photos.length === 0 && s.controlBtnDisabled]}
              accessibilityLabel={t('camera_confirm', 'Подтвердить')}
            >
              <Feather name="check" size={theme.icons.lg} color={theme.colors.onPrimary} />
            </Pressable>
          </View>
        </View>
      </View>

      {/* ── Image preview (fullscreen zoomable) ── */}
      <ImageViewing
        images={previewImages}
        imageIndex={previewIndex >= 0 ? previewIndex : 0}
        visible={previewIndex >= 0}
        onRequestClose={handleClosePreview}
        swipeToCloseEnabled
        doubleTapToZoomEnabled
        presentationStyle="overFullScreen"
        backgroundColor={theme.colors.background}
        FooterComponent={() =>
          previewIndex >= 0 ? (
            <View style={s.previewFooter}>
              <Button
                variant="destructive"
                size="md"
                title={t('camera_delete_photo', 'Удалить фото')}
                onPress={handleDeleteFromPreview}
                style={s.previewDeleteBtn}
              />
            </View>
          ) : null
        }
      />
    </AnimatedFullscreenModal>
  );
}

// ─── Fully themed styles ───────────────────────────────────────────
function buildStyles(theme, insets) {
  const sp = theme.spacing;
  const ty = theme.typography;
  const cl = theme.colors;
  const rd = theme.radii;
  const ic = theme.icons;

  const topPad = Math.max(insets.top, sp.xl) + sp.xs;
  const bottomPad = Math.max(insets.bottom, sp.lg) + sp.sm;
  const overlayBg = cl.overlay;
  const thumbSize = sp.xxl + sp.xl; // 56
  const shutterOuterSize = sp.xxl * 2 + sp.md; // ~78
  const shutterInnerSize = shutterOuterSize - sp.sm * 2;
  const controlBtnSize = sp.xxl + sp.md; // ~46
  const topBtnSize = sp.xxl + sp.xs; // ~38

  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: '#000',
    },

    /* Top bar */
    topBar: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      paddingTop: topPad,
      paddingHorizontal: sp.lg,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      zIndex: 10,
    },
    topBtn: {
      width: topBtnSize,
      height: topBtnSize,
      borderRadius: rd.pill,
      backgroundColor: overlayBg,
      justifyContent: 'center',
      alignItems: 'center',
    },
    topBtnActive: {
      backgroundColor: cl.primary,
    },

    /* Bottom panel */
    bottomPanel: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      paddingBottom: bottomPad,
      zIndex: 10,
    },

    /* Thumb strip */
    thumbListWrap: {
      maxHeight: thumbSize + sp.md * 2,
    },
    thumbList: {
      paddingHorizontal: sp.lg,
      paddingVertical: sp.sm,
      gap: sp.sm,
    },
    thumbWrap: {
      width: thumbSize,
      height: thumbSize,
      borderRadius: rd.sm,
      borderWidth: 2,
      borderColor: cl.onPrimary,
      overflow: 'hidden',
      position: 'relative',
    },
    thumbImage: {
      width: '100%',
      height: '100%',
      borderRadius: rd.sm - 1,
    },
    thumbRemove: {
      position: 'absolute',
      top: -1,
      right: -1,
      width: sp.lg,
      height: sp.lg,
      borderRadius: rd.pill,
      backgroundColor: cl.danger,
      justifyContent: 'center',
      alignItems: 'center',
    },
    emptyStrip: {
      height: thumbSize + sp.md * 2,
      justifyContent: 'center',
      alignItems: 'center',
    },
    emptyStripText: {
      color: cl.onPrimary,
      fontSize: ty.sizes.sm,
      opacity: 0.6,
    },

    /* Controls row */
    controlsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: sp.xxl + sp.lg,
      paddingTop: sp.md,
    },
    controlBtn: {
      width: controlBtnSize,
      height: controlBtnSize,
      borderRadius: rd.pill,
      backgroundColor: overlayBg,
      justifyContent: 'center',
      alignItems: 'center',
    },
    confirmBtn: {
      backgroundColor: cl.success || cl.primary,
    },
    controlBtnDisabled: {
      opacity: 0.35,
    },

    /* Shutter */
    shutterOuter: {
      width: shutterOuterSize,
      height: shutterOuterSize,
      borderRadius: rd.pill,
      borderWidth: sp.xs,
      borderColor: cl.onPrimary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    shutterInner: {
      width: shutterInnerSize,
      height: shutterInnerSize,
      borderRadius: rd.pill,
      backgroundColor: cl.onPrimary,
    },

    /* Permission */
    permContent: {
      alignItems: 'center',
      paddingVertical: sp.xl,
      gap: sp.lg,
    },
    permHint: {
      textAlign: 'center',
      fontSize: ty.sizes.sm,
      color: cl.textSecondary,
    },

    /* Preview footer */
    previewFooter: {
      paddingHorizontal: sp.xl,
      paddingBottom: bottomPad,
      alignItems: 'center',
    },
    previewDeleteBtn: {
      minWidth: sp.xxl * 6,
    },
  });
}
