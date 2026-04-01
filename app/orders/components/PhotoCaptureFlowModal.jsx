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
  AppState,
  View,
  Text,
  Pressable,
  FlatList,
  Image,
  Linking,
  StyleSheet,
  StatusBar,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import FullscreenImageViewer from './FullscreenImageViewer';
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

  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const cameraRef = useRef(null);
  const permissionPromptedForThisOpenRef = useRef(false);

  // Session photos: [{ id, uri }]
  const [photos, setPhotos] = useState([]);
  const [torch, setTorch] = useState(false);
  const [cameraFacing, setCameraFacing] = useState('back');
  const [isTaking, setIsTaking] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);

  // Preview state (ImageViewing)
  const [previewIndex, setPreviewIndex] = useState(-1);
  const previewVisible = previewIndex >= 0;
  const previewImages = useMemo(() => photos.map((item) => item.uri), [photos]);

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
      setCameraFacing('back');
      setIsTaking(false);
      setCameraReady(false);
      setPreviewIndex(-1);
    }
  }, [visible]);

  // ── Request permission on mount ────────────────────────────
  useEffect(() => {
    if (!visible) return;
    let active = true;

    if (!permissionPromptedForThisOpenRef.current) {
      permissionPromptedForThisOpenRef.current = true;
      requestPermission().catch(() => {});
    }

    const syncPermission = async ({ promptIfPossible = false } = {}) => {
      try {
        const latest = (await getPermission?.()) || permission;
        const granted = latest?.granted === true;
        if (promptIfPossible && !granted) {
          await requestPermission();
        }
      } catch {}
    };

    syncPermission({ promptIfPossible: false }).catch(() => {});

    const sub = AppState.addEventListener('change', (state) => {
      if (!active || state !== 'active') return;
      syncPermission({ promptIfPossible: false }).catch(() => {});
    });

    return () => {
      active = false;
      sub?.remove?.();
    };
  }, [getPermission, permission, requestPermission, visible]);

  useEffect(() => {
    if (!visible) {
      permissionPromptedForThisOpenRef.current = false;
    }
  }, [visible]);

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
        shutterSound: false,
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
    if (cameraFacing !== 'back') return;
    hapticLight();
    setTorch((prev) => !prev);
  }, [cameraFacing]);

  const toggleCameraFacing = useCallback(() => {
    hapticLight();
    setTorch(false);
    setCameraFacing((prev) => (prev === 'back' ? 'front' : 'back'));
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

  // Use refs so handlers always see fresh values
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const previewIndexRef = useRef(previewIndex);
  previewIndexRef.current = previewIndex;

  const handleDeleteFromPreview = useCallback((idxFromViewer) => {
    const current = photosRef.current;
    if (!Array.isArray(current) || !current.length) return;

    const raw = Number.isFinite(Number(idxFromViewer))
      ? Number(idxFromViewer)
      : Number(previewIndexRef.current);
    const idx = Math.max(0, Math.min(Number.isFinite(raw) ? Math.trunc(raw) : 0, current.length - 1));

    hapticLight();
    const next = current.filter((_, itemIndex) => itemIndex !== idx);
    setPhotos(next);
    if (!next.length) {
      setPreviewIndex(-1);
      return;
    }
    setPreviewIndex(Math.min(idx, next.length - 1));
  }, []);

  const handleModalRequestClose = useCallback(() => {
    if (previewIndexRef.current >= 0) {
      setPreviewIndex(-1);
      return;
    }
    handleDiscard();
  }, [handleDiscard]);

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

  if (!permission || !permission.granted) {
    const canAskAgain = permission?.canAskAgain !== false;
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
            title={
              canAskAgain
                ? t('order_photos_camera_grant', 'Разрешить доступ')
                : t('order_photos_camera_settings', 'Открыть настройки')
            }
            onPress={() => {
              requestPermission()
                .then((res) => {
                  if (res?.granted) return;
                  if (res?.canAskAgain === false) {
                    Linking.openSettings().catch(() => {});
                  }
                })
                .catch(() => {});
            }}
          />
          <Button
            variant="secondary"
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
      onRequestClose={handleModalRequestClose}
    >
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <View style={s.root}>
        {!previewVisible ? (
          <>
            {/* ── Live camera ── */}
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing={cameraFacing}
              flash={cameraFacing === 'back' && torch ? 'on' : 'off'}
              enableTorch={cameraFacing === 'back' && torch}
              mode="picture"
              onCameraReady={() => setCameraReady(true)}
            />

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

                {/* Switch camera */}
                <Pressable
                  onPress={toggleCameraFacing}
                  style={s.controlBtn}
                  accessibilityLabel={t('camera_switch', 'Сменить камеру')}
                >
                  <Feather name="refresh-ccw" size={theme.icons.md} color={theme.colors.onPrimary} />
                </Pressable>

                {/* Shutter */}
                <Pressable onPress={handleTakePicture} disabled={isTaking || !cameraReady}>
                  <Animated.View style={[s.shutterOuter, shutterAnimStyle]}>
                    <View style={s.shutterInner} />
                  </Animated.View>
                </Pressable>

                {/* Flash */}
                <Pressable
                  onPress={toggleTorch}
                  disabled={cameraFacing !== 'back'}
                  style={[
                    s.controlBtn,
                    torch && s.controlBtnActive,
                    cameraFacing !== 'back' && s.controlBtnDisabled,
                  ]}
                  accessibilityLabel={t('camera_flash', 'Вспышка')}
                >
                  <Feather
                    name={torch ? 'zap' : 'zap-off'}
                    size={theme.icons.md}
                    color={theme.colors.onPrimary}
                  />
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
          </>
        ) : null}
      </View>

      <FullscreenImageViewer
        visible={previewVisible}
        images={previewImages}
        initialIndex={Math.max(0, Math.min(previewIndex, Math.max(0, previewImages.length - 1)))}
        onClose={handleClosePreview}
        onDelete={handleDeleteFromPreview}
        capturePreviewMode
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
  const bottomPad = Math.max(insets.bottom, sp.lg) + sp.sm;
  const overlayBg = cl.overlay;
  const thumbSize = sp.xxl + sp.xl; // 56
  const shutterOuterSize = sp.xxl * 2 + sp.md; // ~78
  const shutterInnerSize = shutterOuterSize - sp.sm * 2;
  const controlBtnSize = sp.xxl + sp.md; // ~46

  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: '#000',
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
      paddingHorizontal: sp.lg,
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
    controlBtnActive: {
      backgroundColor: cl.primary,
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

  });
}

