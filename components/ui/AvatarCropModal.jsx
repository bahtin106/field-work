import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import ImageZoom from 'react-native-image-pan-zoom';
import * as ImageManipulator from 'expo-image-manipulator';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme/ThemeProvider';

async function getImageSize(uri) {
  return await new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      (error) => reject(error),
    );
  });
}

export default function AvatarCropModal({ visible, uri, onCancel, onConfirm }) {
  const { theme } = useTheme();
  const { t } = useTranslation();

  const [fallbackMode, setFallbackMode] = useState(false);
  const [normalizedUri, setNormalizedUri] = useState(null);
  const [applyingFallback, setApplyingFallback] = useState(false);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [zoomCenterOn, setZoomCenterOn] = useState(null);

  const runIdRef = useRef(0);
  const zoomRef = useRef({ scale: 1, positionX: 0, positionY: 0 });
  const lastTapRef = useRef(0);

  const win = Dimensions.get('window');
  const cropSize = useMemo(() => Math.max(220, Math.min(win.width - 32, 420)), [win.width]);

  const cropHint = useMemo(() => {
    const translated = t('profile_photo_crop_hint');
    const base =
      translated && translated !== 'profile_photo_crop_hint'
        ? translated
        : 'Перемещайте и масштабируйте фото, затем нажмите «Применить».';
    return base.replace(/Готово/g, 'Применить');
  }, [t]);

  const prepareFallback = useCallback(
    async (runId, imageUri) => {
      try {
        // Normalize EXIF/orientation first so preview and crop share the same pixel space.
        const normalized = await ImageManipulator.manipulateAsync(
          imageUri,
          [{ rotate: 0 }],
          { compress: 1, format: ImageManipulator.SaveFormat.JPEG },
        );
        if (runIdRef.current !== runId) return;
        const preparedUri = normalized?.uri || imageUri;
        const width = Number(normalized?.width || 0);
        const height = Number(normalized?.height || 0);
        const size =
          width > 0 && height > 0 ? { width, height } : await getImageSize(preparedUri);
        if (runIdRef.current !== runId) return;
        setNormalizedUri(preparedUri);
        setImageSize(size);
        zoomRef.current = { scale: 1, positionX: 0, positionY: 0 };
        setZoomCenterOn({ x: 0, y: 0, scale: 1, duration: 1 });
        setFallbackMode(true);
      } catch {
        if (runIdRef.current !== runId) return;
        onCancel?.();
      }
    },
    [onCancel],
  );

  useEffect(() => {
    if (!visible || !uri) return;

    const runId = Date.now();
    runIdRef.current = runId;
    setFallbackMode(false);
    setApplyingFallback(false);

    const openEditor = async () => {
      await prepareFallback(runId, uri);
    };

    openEditor();

    return () => {
      runIdRef.current = 0;
      setNormalizedUri(null);
      setApplyingFallback(false);
      setFallbackMode(false);
    };
  }, [visible, uri, onCancel, onConfirm, prepareFallback]);

  const applyFallbackCrop = async () => {
    if (!normalizedUri || !imageSize.width || !imageSize.height) {
      onCancel?.();
      return;
    }

    setApplyingFallback(true);

    try {
      const iw = imageSize.width;
      const ih = imageSize.height;

      const scale = Math.max(1, Number(zoomRef.current.scale || 1));
      const positionX = Number(zoomRef.current.positionX || 0);
      const positionY = Number(zoomRef.current.positionY || 0);

      const baseScale = Math.max(cropSize / iw, cropSize / ih);
      const baseW = iw * baseScale;
      const baseH = ih * baseScale;
      const displayedW = baseW * scale;
      const displayedH = baseH * scale;

      // react-native-image-pan-zoom stores translation in pre-scale units.
      // Convert it to rendered pixels before mapping viewport -> source coordinates.
      const offsetX = positionX * scale + (cropSize - displayedW) / 2;
      const offsetY = positionY * scale + (cropSize - displayedH) / 2;

      const cropSideFromW = Math.round((cropSize / displayedW) * iw);
      const cropSideFromH = Math.round((cropSize / displayedH) * ih);
      const cropSide = Math.max(1, Math.min(iw, ih, cropSideFromW, cropSideFromH));
      const maxCropX = Math.max(0, iw - cropSide);
      const maxCropY = Math.max(0, ih - cropSide);
      const cropX = Math.max(0, Math.min(maxCropX, Math.round(((-offsetX) / displayedW) * iw)));
      const cropY = Math.max(0, Math.min(maxCropY, Math.round(((-offsetY) / displayedH) * ih)));

      const result = await ImageManipulator.manipulateAsync(
        normalizedUri,
        [
          {
            crop: {
              originX: cropX,
              originY: cropY,
              width: cropSide,
              height: cropSide,
            },
          },
          {
            resize: {
              width: 1024,
              height: 1024,
            },
          },
        ],
        {
          compress: 0.9,
          format: ImageManipulator.SaveFormat.JPEG,
        },
      );

      onConfirm?.(result.uri);
    } catch {
      onCancel?.();
    } finally {
      setApplyingFallback(false);
    }
  };

  if (!visible) return null;

  if (fallbackMode) {
    const iw = imageSize.width || cropSize;
    const ih = imageSize.height || cropSize;
    const baseScale = Math.max(cropSize / iw, cropSize / ih);
    const baseW = Math.max(1, Math.round(iw * baseScale));
    const baseH = Math.max(1, Math.round(ih * baseScale));

    const handleDoubleTap = () => {
      const nextScale = zoomRef.current.scale > 1.6 ? 1 : 2;
      zoomRef.current = { scale: nextScale, positionX: 0, positionY: 0 };
      setZoomCenterOn({ x: 0, y: 0, scale: nextScale, duration: 180 });
    };

    return (
      <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
        <View style={styles.editorBackdrop}>
          <View style={styles.editorHeader}>
            <Pressable onPress={onCancel} style={styles.headerBtn}>
              <Text style={[styles.headerBtnText, { color: theme.colors.textSecondary }]}>
                {t('btn_cancel') || 'Отмена'}
              </Text>
            </Pressable>
            <Pressable onPress={applyFallbackCrop} style={styles.headerBtn} disabled={applyingFallback}>
              <Text style={[styles.headerBtnText, { color: theme.colors.primary }]}>
                {applyingFallback ? t('btn_applying') || '...' : t('btn_apply') || 'Применить'}
              </Text>
            </Pressable>
          </View>

          <View style={[styles.cropBox, { width: cropSize, height: cropSize }]}>
            <ImageZoom
              cropWidth={cropSize}
              cropHeight={cropSize}
              imageWidth={baseW}
              imageHeight={baseH}
              panToMove
              pinchToZoom
              enableCenterFocus={false}
              minScale={1}
              maxScale={4}
              centerOn={zoomCenterOn || undefined}
              onDoubleClick={handleDoubleTap}
              onClick={() => {
                const now = Date.now();
                if (now - lastTapRef.current < 260) {
                  handleDoubleTap();
                }
                lastTapRef.current = now;
              }}
              onMove={({ positionX, positionY, scale }) => {
                zoomRef.current = {
                  scale: Number(scale || 1),
                  positionX: Number(positionX || 0),
                  positionY: Number(positionY || 0),
                };
              }}
            >
              <View style={[styles.zoomCanvas, { width: baseW, height: baseH }]}>
                <Image
                  source={{ uri: normalizedUri || uri }}
                  style={{ width: baseW, height: baseH, resizeMode: 'contain' }}
                />
              </View>
            </ImageZoom>

            <View
              pointerEvents="none"
              style={[
                styles.circleFrame,
                {
                  width: cropSize,
                  height: cropSize,
                },
              ]}
            />
          </View>

          <Text style={styles.hintText}>
            {cropHint}
          </Text>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <View style={[styles.loaderBackdrop, { backgroundColor: 'rgba(0,0,0,0.65)' }]}>
        <View
          style={[
            styles.loaderCard,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
            },
          ]}
        >
          <ActivityIndicator size="small" color={theme.colors.primary} animating />
          <Text style={[styles.loaderTitle, { color: theme.colors.text }]}>
            {t('profile_photo_preparing') || 'Подготавливаем редактор...'}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  loaderBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  loaderCard: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingVertical: 18,
    alignItems: 'center',
  },
  loaderTitle: {
    marginTop: 10,
    fontSize: 14,
    fontWeight: '600',
  },
  editorBackdrop: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 48,
    paddingBottom: 28,
  },
  editorHeader: {
    width: '100%',
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  headerBtn: {
    paddingVertical: 8,
    minWidth: 84,
  },
  headerBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  cropBox: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  zoomCanvas: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
  circleFrame: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.92)',
  },
  hintText: {
    marginTop: 14,
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});
