import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image as RNImage,
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Feather } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { cacheDirectory, copyAsync, downloadAsync, getInfoAsync } from 'expo-file-system/legacy';
import { Image as ExpoImage } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import { Gallery } from 'react-native-zoom-toolkit';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../theme';
import { withAlpha } from '../../../theme/colors';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { BaseModal } from '../../../components/ui/modals';
import ModalActionsRow from '../../../components/ui/modals/ModalActionsRow';
import ToastProvider, { useToast } from '../../../components/ui/ToastProvider';

const VIEWER_BG = '#000000';
const VIEWER_FG = '#FFFFFF';
const VIEWER_OVERLAY_ALPHA = 0.55;
const ICON_BTN_SIZE = 40;
const LOCAL_MEDIA_URI_RE = /^(file|content|asset|ph|assets-library):\/\//i;
const DATA_IMAGE_URI_RE = /^data:image\//i;
const REMOTE_URI_RE = /^https?:\/\//i;

const haptic = (style = 'Light') =>
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle[style]).catch(() => {});

const normalizeImages = (images) =>
  (Array.isArray(images) ? images : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean);

const clampIndex = (index, count) => {
  if (!count) return 0;
  const numeric = Number(index);
  const safe = Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
  return Math.max(0, Math.min(safe, count - 1));
};

const measureImage = (uri) =>
  new Promise((resolve) => {
    if (!uri) {
      resolve(null);
      return;
    }

    RNImage.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => resolve(null),
    );
  });

const getImageExtension = (uri) => {
  const path = String(uri || '').trim().split('?')[0].split('#')[0];
  const match = path.match(/\.(jpe?g|png|gif|webp)$/i);
  return match ? match[0] : '.jpg';
};

const GalleryPhoto = memo(function GalleryPhoto({
  uri,
  viewportWidth,
  viewportHeight,
}) {
  return (
    <View style={[styles.galleryPhotoFrame, { width: viewportWidth, height: viewportHeight }]}>
      <ExpoImage
        source={{ uri }}
        contentFit="contain"
        cachePolicy="memory-disk"
        transition={0}
        recyclingKey={uri}
        style={styles.galleryPhoto}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  rootFill: {
    flex: 1,
  },
  galleryPhotoFrame: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: VIEWER_BG,
  },
  galleryPhoto: {
    width: '100%',
    height: '100%',
  },
});

const ImageViewingGallery = memo(function ImageViewingGallery({
  visible,
  images,
  initialIndex = 0,
  onClose,
  onDelete,
  onRotateSave,
  categoryLabel,
  capturePreviewMode = false,
  onDismiss,
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const galleryRef = useRef(null);
  const rotationsRef = useRef({});
  const rotationsFlushedRef = useRef(false);
  const closeInFlightRef = useRef(false);
  const dismissTimerRef = useRef(null);
  const dismissNotifiedRef = useRef(false);

  const initialImages = normalizeImages(images);
  const imageSignature = initialImages.join('\u001f');
  const initialSafeIndex = clampIndex(initialIndex, initialImages.length);
  const syncedSignatureRef = useRef(imageSignature);
  const visibleRef = useRef(visible);

  const [localImages, setLocalImages] = useState(initialImages);
  const [currentIndex, setCurrentIndex] = useState(initialSafeIndex);
  const [viewerIndex, setViewerIndex] = useState(initialSafeIndex);
  const [menuOpen, setMenuOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rotations, setRotations] = useState({});
  const [toolbarVisible, setToolbarVisible] = useState(true);

  const overlayBg = useMemo(() => withAlpha(VIEWER_BG, VIEWER_OVERLAY_ALPHA), []);
  const currentUri = localImages[currentIndex] || '';
  const galleryKey = `${imageSignature}:${viewerIndex}`;

  const ds = useMemo(() => {
    const { spacing, radii, typography, colors } = theme;
    return StyleSheet.create({
      header: {
        paddingTop: (insets.top || 0) + spacing.md,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      },
      iconBtn: {
        width: ICON_BTN_SIZE,
        height: ICON_BTN_SIZE,
        borderRadius: ICON_BTN_SIZE / 2,
        alignItems: 'center',
        justifyContent: 'center',
      },
      counterPill: {
        borderRadius: radii.pill,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
      },
      counterText: {
        color: VIEWER_FG,
        fontWeight: typography.weight.bold,
        fontSize: typography.sizes.sm,
      },
      footer: {
        paddingHorizontal: spacing.md,
        paddingTop: spacing.md,
        paddingBottom: (insets.bottom || 0) + spacing.lg,
        flexDirection: 'row',
        justifyContent: 'space-evenly',
        alignItems: 'center',
      },
      footerSingle: {
        justifyContent: 'center',
      },
      footerBtn: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm + spacing.xs / 2,
        borderRadius: radii.xl,
        minWidth: spacing.xxxl * 2 + spacing.xs,
      },
      footerLabel: {
        color: VIEWER_FG,
        fontSize: typography.sizes.xs,
        fontWeight: typography.weight.semibold,
        marginTop: spacing.xs,
      },
      menuRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.lg,
        paddingHorizontal: spacing.xl,
      },
      menuRowBorder: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: withAlpha(colors.textSecondary, 0.2),
      },
      menuRowLabel: {
        fontSize: typography.sizes.md,
        fontWeight: typography.weight.medium,
        marginLeft: spacing.lg,
        color: colors.text,
      },
      infoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.xl,
        paddingVertical: spacing.sm + spacing.xs / 2,
      },
      infoLabel: {
        fontSize: typography.sizes.sm,
        color: colors.textSecondary,
      },
      infoValue: {
        fontSize: typography.sizes.sm,
        fontWeight: typography.weight.semibold,
        color: colors.text,
      },
      modalRoot: {
        flex: 1,
        backgroundColor: VIEWER_BG,
      },
      gallery: {
        flex: 1,
        backgroundColor: VIEWER_BG,
      },
      overlayHeader: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 20,
      },
      overlayFooter: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 20,
      },
    });
  }, [insets.bottom, insets.top, theme]);

  useEffect(() => {
    const previousVisible = visibleRef.current;
    const becameVisible = visible && !previousVisible;
    const imagesChanged = syncedSignatureRef.current !== imageSignature;

    visibleRef.current = visible;
    if (!becameVisible && !imagesChanged) return;

    const nextImages = initialImages;
    const currentUriBeforeSync = localImages[currentIndex] || '';
    const preservedIndex = imagesChanged && currentUriBeforeSync
      ? nextImages.indexOf(currentUriBeforeSync)
      : -1;
    const nextIndex = preservedIndex >= 0
      ? preservedIndex
      : clampIndex(initialIndex, nextImages.length);

    syncedSignatureRef.current = imageSignature;
    if (becameVisible) {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
      dismissNotifiedRef.current = false;
    }
    setLocalImages(nextImages);
    setCurrentIndex(nextIndex);
    setViewerIndex(nextIndex);
    setMenuOpen(false);
    setInfoOpen(false);
    setConfirmDelete(false);
    setDeleting(false);
    setBusy(false);
    setToolbarVisible(true);
    if (becameVisible) {
      setRotations({});
      rotationsRef.current = {};
      rotationsFlushedRef.current = false;
    }
    closeInFlightRef.current = false;
  }, [currentIndex, imageSignature, initialImages, initialIndex, localImages, visible]);

  useEffect(() => {
    rotationsRef.current = rotations;
  }, [rotations]);

  useEffect(() => {
    localImages.forEach((uri) => {
      ExpoImage.prefetch(uri, 'memory-disk').catch(() => {});
    });
  }, [localImages]);

  const flushRotations = useCallback(() => {
    if (rotationsFlushedRef.current) return;
    const nonZero = Object.fromEntries(
      Object.entries(rotationsRef.current).filter(([, deg]) => deg !== 0),
    );
    if (Object.keys(nonZero).length > 0 && onRotateSave) {
      rotationsFlushedRef.current = true;
      onRotateSave(nonZero);
    }
  }, [onRotateSave]);

  const scheduleDismiss = useCallback(() => {
    if (!onDismiss || dismissNotifiedRef.current || dismissTimerRef.current) return;
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = null;
      if (dismissNotifiedRef.current) return;
      dismissNotifiedRef.current = true;
      onDismiss();
    }, 220);
  }, [onDismiss]);

  const requestClose = useCallback(() => {
    if (closeInFlightRef.current) return;
    closeInFlightRef.current = true;
    flushRotations();
    setMenuOpen(false);
    setInfoOpen(false);
    setConfirmDelete(false);
    onClose?.();
    scheduleDismiss();
  }, [flushRotations, onClose, scheduleDismiss]);

  useEffect(
    () => () => {
      flushRotations();
      scheduleDismiss();
    },
    // This cleanup is intentionally unmount-only. Running it on callback identity
    // changes would notify parent modals while the viewer is still open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const downloadToCache = useCallback(async (uri) => {
    const source = String(uri || '').trim();
    if (!source) return '';
    if (source.startsWith('file:') || DATA_IMAGE_URI_RE.test(source)) return source;
    if (!cacheDirectory) throw new Error('viewer cache directory is unavailable');

    const ext = getImageExtension(source);
    const filename = `viewer_${Date.now()}${ext}`;
    const dest = `${cacheDirectory}${filename}`;

    if (LOCAL_MEDIA_URI_RE.test(source)) {
      await copyAsync({ from: source, to: dest });
      return dest;
    }

    if (!REMOTE_URI_RE.test(source)) return source;

    const downloaded = await downloadAsync(source, dest);
    const status = Number(downloaded?.status);
    if (Number.isFinite(status) && status >= 400) {
      throw new Error(`Unable to download image: response status ${status}`);
    }
    return downloaded?.uri || dest;
  }, []);

  const formatBytes = useCallback((bytes) => {
    if (!bytes || bytes <= 0) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }, []);

  const handleShare = useCallback(async () => {
    if (busy || deleting || capturePreviewMode || !currentUri) return;
    haptic();
    setBusy(true);
    try {
      if (!(await Sharing.isAvailableAsync())) return;
      const localUri = await downloadToCache(currentUri);
      await Sharing.shareAsync(localUri);
    } catch (error) {
      console.warn('[Viewer] share:', error);
    } finally {
      setBusy(false);
    }
  }, [busy, capturePreviewMode, currentUri, deleting, downloadToCache]);

  const handleSave = useCallback(async () => {
    if (busy || deleting || capturePreviewMode || !currentUri) return;
    haptic();
    setMenuOpen(false);
    setBusy(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync(true);
      if (status !== 'granted') {
        toast.error(t('viewer_permission_denied'));
        return;
      }
      const localUri = await downloadToCache(currentUri);
      await MediaLibrary.saveToLibraryAsync(localUri);
      haptic('Medium');
      toast.success(t('viewer_saved'));
    } catch (error) {
      console.warn('[Viewer] save:', error);
      toast.error(t('viewer_save_error'));
    } finally {
      setBusy(false);
    }
  }, [busy, capturePreviewMode, currentUri, deleting, downloadToCache, t, toast]);

  const handleRotate = useCallback(async () => {
    if (busy || deleting || capturePreviewMode || !currentUri) return;
    haptic();
    setBusy(true);
    try {
      const source = await downloadToCache(currentUri);
      const rotated = await ImageManipulator.manipulateAsync(source, [{ rotate: 90 }], {
        compress: 1,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      const rotatedUri = String(rotated?.uri || '').trim();
      if (!rotatedUri) return;

      setLocalImages((prev) => prev.map((value, index) => (index === currentIndex ? rotatedUri : value)));
      setViewerIndex(currentIndex);
      setRotations((prev) => {
        const next = {
          ...prev,
          [currentIndex]: ((prev[currentIndex] || 0) + 90) % 360,
        };
        rotationsRef.current = next;
        return next;
      });
    } catch (error) {
      console.warn('[Viewer] rotate:', error);
    } finally {
      setBusy(false);
    }
  }, [busy, capturePreviewMode, currentIndex, currentUri, deleting, downloadToCache]);

  const handleShowInfo = useCallback(async () => {
    if (capturePreviewMode) return;
    haptic();
    setMenuOpen(false);
    if (!currentUri) return;

    const [dims, localUri] = await Promise.all([
      measureImage(currentUri),
      downloadToCache(currentUri).catch(() => null),
    ]);

    let fileSize = null;
    try {
      if (localUri) {
        const file = await getInfoAsync(localUri, { size: true });
        fileSize = file?.size || null;
      }
    } catch {}

    setInfoOpen({
      resolution: dims ? `${dims.width} x ${dims.height}` : null,
      size: formatBytes(fileSize),
    });
  }, [capturePreviewMode, currentUri, downloadToCache, formatBytes]);

  const handleDeleteConfirm = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    const idx = clampIndex(currentIndex, localImages.length);
    try {
      await Promise.resolve(onDelete?.(idx));
    } catch {
      setDeleting(false);
      toast.error(t('order_toast_delete_error'));
      return;
    }

    const remaining = localImages.filter((_, imageIndex) => imageIndex !== idx);
    if (!remaining.length) {
      setDeleting(false);
      setConfirmDelete(false);
      requestClose();
      return;
    }

    const nextRotations = {};
    Object.keys(rotationsRef.current).forEach((key) => {
      const numericKey = Number(key);
      if (!Number.isFinite(numericKey)) return;
      if (numericKey < idx) nextRotations[numericKey] = rotationsRef.current[numericKey];
      else if (numericKey > idx) nextRotations[numericKey - 1] = rotationsRef.current[numericKey];
    });
    rotationsRef.current = nextRotations;
    setRotations(nextRotations);

    const nextIndex = Math.min(idx, remaining.length - 1);
    setLocalImages(remaining);
    setCurrentIndex(nextIndex);
    setViewerIndex(nextIndex);
    setConfirmDelete(false);
    setDeleting(false);
  }, [currentIndex, deleting, localImages, onDelete, requestClose, t, toast]);

  const handleDeletePress = useCallback(() => {
    if (!onDelete) return;
    if (busy || deleting) return;
    haptic('Medium');
    setMenuOpen(false);
    setInfoOpen(false);
    if (capturePreviewMode) {
      handleDeleteConfirm();
      return;
    }
    setConfirmDelete(true);
  }, [busy, capturePreviewMode, deleting, handleDeleteConfirm, onDelete]);

  const infoRows = useMemo(() => {
    if (!infoOpen) return [];
    return [
      infoOpen.resolution && {
        label: t('viewer_info_resolution'),
        value: infoOpen.resolution,
      },
      infoOpen.size && {
        label: t('viewer_info_size'),
        value: infoOpen.size,
      },
    ].filter(Boolean);
  }, [infoOpen, t]);

  const handleIndexChange = useCallback((nextIndex) => {
    setCurrentIndex(clampIndex(nextIndex, localImages.length));
  }, [localImages.length]);

  const handleGalleryTap = useCallback(() => {
    if (menuOpen || infoOpen || confirmDelete) {
      setMenuOpen(false);
      setInfoOpen(false);
      setConfirmDelete(false);
      return;
    }
    setToolbarVisible((value) => !value);
  }, [confirmDelete, infoOpen, menuOpen]);

  const renderGalleryItem = useCallback(
    (uri) => (
      <GalleryPhoto
        uri={uri}
        viewportWidth={viewportWidth}
        viewportHeight={viewportHeight}
      />
    ),
    [viewportHeight, viewportWidth],
  );

  const galleryKeyExtractor = useCallback((uri, index) => `${index}:${uri}`, []);

  const counter = localImages.length ? `${currentIndex + 1} / ${localImages.length}` : '0 / 0';
  const counterLabel = categoryLabel ? `${categoryLabel} · ${counter}` : counter;

  if (!visible || !localImages.length) return null;

  return (
    <>
      <Modal
        visible={visible}
        transparent={false}
        animationType="fade"
        presentationStyle="fullScreen"
        statusBarTranslucent
        hardwareAccelerated
        onRequestClose={requestClose}
      >
        <GestureHandlerRootView style={styles.rootFill}>
          <StatusBar translucent barStyle="light-content" backgroundColor="transparent" />
          <View style={ds.modalRoot}>
            <View style={ds.gallery}>
              <Gallery
                key={galleryKey}
                ref={galleryRef}
                data={localImages}
                initialIndex={clampIndex(viewerIndex, localImages.length)}
                renderItem={renderGalleryItem}
                keyExtractor={galleryKeyExtractor}
                onIndexChange={handleIndexChange}
                onTap={handleGalleryTap}
                maxScale={5}
                windowSize={5}
                tapOnEdgeToItem
                allowPinchPanning
                allowOverflow={false}
                scaleMode="bounce"
                pinchMode="clamp"
              />
            </View>

            {toolbarVisible ? (
              <View pointerEvents="box-none" style={ds.overlayHeader}>
                <View style={ds.header}>
                  <Pressable
                    onPress={requestClose}
                    hitSlop={theme.spacing.md}
                    style={[ds.iconBtn, { backgroundColor: overlayBg }]}
                  >
                    <Feather name="chevron-left" size={theme.icons.md} color={VIEWER_FG} />
                  </Pressable>
                  <View style={[ds.counterPill, { backgroundColor: overlayBg }]}>
                    <Text style={ds.counterText}>{counterLabel}</Text>
                  </View>
                </View>
              </View>
            ) : null}

            {toolbarVisible ? (
              <View pointerEvents="box-none" style={ds.overlayFooter}>
                <View style={[ds.footer, capturePreviewMode && ds.footerSingle]}>
                  {capturePreviewMode ? (
                    onDelete ? (
                      <Pressable
                        onPress={handleDeletePress}
                        disabled={deleting}
                        hitSlop={theme.spacing.sm}
                        style={[ds.footerBtn, { backgroundColor: overlayBg }]}
                      >
                        <Feather name="trash-2" size={theme.icons.sm} color={theme.colors.danger} />
                        <Text style={[ds.footerLabel, { color: theme.colors.danger }]}>
                          {t('camera_delete_photo')}
                        </Text>
                      </Pressable>
                    ) : null
                  ) : (
                    <>
                      <Pressable
                        onPress={handleShare}
                        disabled={busy || deleting}
                        hitSlop={theme.spacing.sm}
                        style={[ds.footerBtn, { backgroundColor: overlayBg }]}
                      >
                        <Feather name="share" size={theme.icons.sm} color={VIEWER_FG} />
                        <Text style={ds.footerLabel}>{t('viewer_share')}</Text>
                      </Pressable>
                      <Pressable
                        onPress={handleRotate}
                        disabled={busy || deleting}
                        hitSlop={theme.spacing.sm}
                        style={[ds.footerBtn, { backgroundColor: overlayBg }]}
                      >
                        <Feather name="rotate-cw" size={theme.icons.sm} color={VIEWER_FG} />
                        <Text style={ds.footerLabel}>{t('viewer_rotate')}</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          haptic();
                          setInfoOpen(false);
                          setMenuOpen((visibleState) => !visibleState);
                        }}
                        hitSlop={theme.spacing.sm}
                        style={[ds.footerBtn, { backgroundColor: overlayBg }]}
                      >
                        <Feather name="more-horizontal" size={theme.icons.sm} color={VIEWER_FG} />
                        <Text style={ds.footerLabel}>{t('viewer_more')}</Text>
                      </Pressable>
                      {onDelete ? (
                        <Pressable
                          onPress={handleDeletePress}
                          disabled={busy || deleting}
                          hitSlop={theme.spacing.sm}
                          style={[ds.footerBtn, { backgroundColor: overlayBg }]}
                        >
                          <Feather name="trash-2" size={theme.icons.sm} color={theme.colors.danger} />
                          <Text style={[ds.footerLabel, { color: theme.colors.danger }]}>
                            {t('viewer_delete')}
                          </Text>
                        </Pressable>
                      ) : null}
                    </>
                  )}
                </View>
              </View>
            ) : null}
          </View>
        </GestureHandlerRootView>
      </Modal>

      {!capturePreviewMode ? (
        <>
          <BaseModal
            visible={menuOpen}
            onClose={() => setMenuOpen(false)}
            title={t('viewer_more')}
            maxHeightRatio={0.35}
          >
            <Pressable
              onPress={handleSave}
              disabled={busy || deleting}
              style={({ pressed }) => [ds.menuRow, ds.menuRowBorder, pressed && { opacity: 0.6 }]}
            >
              <Feather name="download" size={theme.icons.md} color={theme.colors.text} />
              <Text style={ds.menuRowLabel}>{t('viewer_save_to_device')}</Text>
            </Pressable>
            <Pressable onPress={handleShowInfo} style={({ pressed }) => [ds.menuRow, pressed && { opacity: 0.6 }]}>
              <Feather name="info" size={theme.icons.md} color={theme.colors.text} />
              <Text style={ds.menuRowLabel}>{t('viewer_info_title')}</Text>
            </Pressable>
          </BaseModal>

          <BaseModal
            visible={!!infoOpen}
            onClose={() => setInfoOpen(false)}
            title={t('viewer_info_title')}
            maxHeightRatio={0.3}
          >
            {infoRows.map((row, index) => (
              <View key={index} style={ds.infoRow}>
                <Text style={ds.infoLabel}>{row.label}</Text>
                <Text style={ds.infoValue}>{row.value}</Text>
              </View>
            ))}
          </BaseModal>

          <BaseModal
            visible={confirmDelete}
            onClose={() => {
              setDeleting(false);
              setConfirmDelete(false);
            }}
            title={t('order_photos_delete_single_title')}
            maxHeightRatio={0.42}
            footer={
              <ModalActionsRow
                actions={[
                  {
                    key: 'cancel',
                    title: t('order_photos_delete_single_cancel'),
                    variant: 'secondary',
                    disabled: deleting,
                    onPress: () => {
                      setDeleting(false);
                      setConfirmDelete(false);
                    },
                  },
                  {
                    key: 'confirm',
                    title: t('order_photos_delete_single_confirm'),
                    variant: 'destructive',
                    loading: deleting,
                    onPress: handleDeleteConfirm,
                  },
                ]}
              />
            }
          >
            <Text style={ds.infoLabel}>{t('order_photos_delete_single_message')}</Text>
          </BaseModal>
        </>
      ) : null}
    </>
  );
});

function FullscreenImageViewer({
  visible,
  images,
  initialIndex = 0,
  onClose,
  onDelete,
  onRotateSave,
  categoryLabel,
  capturePreviewMode = false,
  onDismiss,
}) {
  if (!visible || !images?.length) return null;

  return (
    <ToastProvider>
      <ImageViewingGallery
        visible={visible}
        images={images}
        initialIndex={initialIndex}
        onClose={onClose}
        onDelete={onDelete}
        onRotateSave={onRotateSave}
        categoryLabel={categoryLabel}
        capturePreviewMode={capturePreviewMode}
        onDismiss={onDismiss}
      />
    </ToastProvider>
  );
}

export default memo(FullscreenImageViewer);
