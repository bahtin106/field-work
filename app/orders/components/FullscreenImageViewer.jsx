import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image as RNImage,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import ImageZoom from 'react-native-image-pan-zoom';
import { Feather } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { File, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../theme';
import { withAlpha } from '../../../theme/colors';
import { useTranslation } from '../../../src/i18n/useTranslation';
import Button from '../../../components/ui/Button';
import { BaseModal, AnimatedFullscreenModal } from '../../../components/ui/modals';
import ModalActionsRow from '../../../components/ui/modals/ModalActionsRow';
import ToastProvider, { useToast } from '../../../components/ui/ToastProvider';

const VIEWER_BG = '#000000';
const VIEWER_FG = '#FFFFFF';
const VIEWER_OVERLAY_ALPHA = 0.55;
const ANIM_FADE_IN = 200;
const ANIM_FADE_OUT = 150;
const ICON_BTN_SIZE = 40;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const ZOOM_EPSILON = 1.01;
const PAGE_SWIPE_THRESHOLD = 48;

const haptic = (style = 'Light') =>
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle[style]).catch(() => {});

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

const getContainSize = (sourceWidth, sourceHeight, maxWidth, maxHeight) => {
  if (!sourceWidth || !sourceHeight || !maxWidth || !maxHeight) {
    return { width: maxWidth || 1, height: maxHeight || 1 };
  }

  const ratio = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * ratio)),
    height: Math.max(1, Math.round(sourceHeight * ratio)),
  };
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getPanLimit = (imageSize, cropSize, scale) => {
  const scaledSize = imageSize * scale;
  if (scaledSize <= cropSize) return 0;
  return (scaledSize - cropSize) / 2 / scale;
};

const ZoomablePage = memo(function ZoomablePage({
  height,
  index,
  isActive,
  onTap,
  onSwipePage,
  rotation,
  uri,
  width,
}) {
  const [naturalSize, setNaturalSize] = useState(null);
  const pageSwipeLockedRef = useRef(false);
  const pendingPageSwipeRef = useRef(null);
  const pageSwipeTimerRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setNaturalSize(null);
    measureImage(uri).then((result) => {
      if (!alive || !result?.width || !result?.height) return;
      setNaturalSize(result);
    });
    return () => {
      alive = false;
    };
  }, [uri]);

  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const isSideways = normalizedRotation === 90 || normalizedRotation === 270;

  const fitted = useMemo(() => {
    const sourceWidth = naturalSize?.width || width;
    const sourceHeight = naturalSize?.height || height;
    const effectiveWidth = isSideways ? sourceHeight : sourceWidth;
    const effectiveHeight = isSideways ? sourceWidth : sourceHeight;
    return getContainSize(effectiveWidth, effectiveHeight, width, height);
  }, [height, isSideways, naturalSize?.height, naturalSize?.width, width]);

  const renderWidth = isSideways ? fitted.height : fitted.width;
  const renderHeight = isSideways ? fitted.width : fitted.height;

  const zoomRef = useRef(null);
  const currentScaleRef = useRef(1);
  const [centerOn, setCenterOn] = useState(null);

  useEffect(() => {
    if (isActive) return;
    currentScaleRef.current = 1;
    setCenterOn({ x: 0, y: 0, scale: 1, duration: 0 });
    zoomRef.current?.reset?.();
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;
    currentScaleRef.current = 1;
    setCenterOn({ x: 0, y: 0, scale: 1, duration: 0 });
    zoomRef.current?.reset?.();
  }, [isActive, rotation]);

  useEffect(
    () => () => {
      if (pageSwipeTimerRef.current) clearTimeout(pageSwipeTimerRef.current);
      pendingPageSwipeRef.current = null;
    },
    [],
  );

  const handleOuterRange = useCallback(
    (offset) => {
      if (!isActive || pageSwipeLockedRef.current || Math.abs(offset || 0) < PAGE_SWIPE_THRESHOLD) return;
      pageSwipeLockedRef.current = true;
      pendingPageSwipeRef.current = index + (offset > 0 ? -1 : 1);
      pageSwipeTimerRef.current = setTimeout(() => {
        pageSwipeLockedRef.current = false;
      }, 320);
    },
    [index, isActive],
  );

  const handleMove = useCallback((position) => {
    currentScaleRef.current = Number(position?.scale || 1);
  }, []);

  const handleRelease = useCallback(
    (_vx, scale) => {
      currentScaleRef.current = Number(scale || 1);
      const nextPage = pendingPageSwipeRef.current;
      pendingPageSwipeRef.current = null;
      if (nextPage == null) return;

      requestAnimationFrame(() => {
        onSwipePage(nextPage);
      });
    },
    [onSwipePage],
  );

  const handleDoubleTap = useCallback(
    ({ locationX, locationY }) => {
      if (currentScaleRef.current > ZOOM_EPSILON) {
        currentScaleRef.current = 1;
        setCenterOn({ x: 0, y: 0, scale: 1, duration: 140 });
        return;
      }

      const nextScale = DOUBLE_TAP_SCALE;
      const rawX = ((width / 2 - Number(locationX || width / 2)) * (nextScale - 1)) / nextScale;
      const rawY = ((height / 2 - Number(locationY || height / 2)) * (nextScale - 1)) / nextScale;
      const xLimit = getPanLimit(renderWidth, width, nextScale);
      const yLimit = getPanLimit(renderHeight, height, nextScale);
      const x = clamp(rawX, -xLimit, xLimit);
      const y = clamp(rawY, -yLimit, yLimit);

      currentScaleRef.current = nextScale;
      setCenterOn({ x, y, scale: nextScale, duration: 140 });
    },
    [height, renderHeight, renderWidth, width],
  );

  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
      <ImageZoom
        key={`${uri}_${normalizedRotation}`}
        ref={zoomRef}
        cropWidth={width}
        cropHeight={height}
        imageWidth={renderWidth}
        imageHeight={renderHeight}
        minScale={1}
        maxScale={MAX_SCALE}
        enableDoubleClickZoom={false}
        doubleClickInterval={220}
        maxOverflow={0}
        panToMove={isActive}
        pinchToZoom={isActive}
        enableCenterFocus
        useNativeDriver
        centerOn={centerOn}
        onClick={onTap}
        onDoubleClick={handleDoubleTap}
        onMove={handleMove}
        responderRelease={handleRelease}
        horizontalOuterRangeOffset={handleOuterRange}
        onStartShouldSetPanResponder={() => isActive}
        onMoveShouldSetPanResponder={() => isActive}
      >
        <RNImage
          source={{ uri }}
          resizeMode="contain"
          style={{
            width: renderWidth,
            height: renderHeight,
            transform: [{ rotate: `${normalizedRotation}deg` }],
          }}
        />
      </ImageZoom>
    </View>
  );
});

const ViewerContent = memo(function ViewerContent({
  images,
  initialIndex,
  onClose,
  onDelete,
  onRotateSave,
  categoryLabel,
  capturePreviewMode = false,
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const rotationsRef = useRef({});
  const rotationsFlushedRef = useRef(false);
  const closeInFlightRef = useRef(false);

  const overlayBg = useMemo(() => withAlpha(VIEWER_BG, VIEWER_OVERLAY_ALPHA), []);

  const ds = useMemo(() => {
    const { spacing, radii, typography, colors } = theme;
    return StyleSheet.create({
      root: { flex: 1, backgroundColor: VIEWER_BG },
      gallery: { flex: 1, backgroundColor: VIEWER_BG },
      header: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.sm,
        zIndex: 10,
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
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'space-evenly',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        paddingTop: spacing.md,
        zIndex: 10,
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
      captureDeleteBtn: {
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
      infoLabel: { fontSize: typography.sizes.sm, color: colors.textSecondary },
      infoValue: {
        fontSize: typography.sizes.sm,
        fontWeight: typography.weight.semibold,
        color: colors.text,
      },
    });
  }, [theme]);

  const [localImages, setLocalImages] = useState([]);
  const [localIndex, setLocalIndex] = useState(0);
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rotations, setRotations] = useState({});

  useEffect(() => {
    if (!images?.length) {
      setLocalImages([]);
      setLocalIndex(0);
      setToolbarVisible(true);
      setMenuOpen(false);
      setInfoOpen(false);
      setConfirmDelete(false);
      setDeleting(false);
      setBusy(false);
      setRotations({});
      rotationsRef.current = {};
      rotationsFlushedRef.current = false;
      return;
    }
    closeInFlightRef.current = false;
    setLocalImages([...images]);
    setLocalIndex(Math.max(0, Math.min(initialIndex, images.length - 1)));
    setToolbarVisible(true);
    setMenuOpen(false);
    setInfoOpen(false);
    setConfirmDelete(false);
    setDeleting(false);
    setBusy(false);
    setRotations({});
    rotationsRef.current = {};
    rotationsFlushedRef.current = false;
  }, [images, initialIndex]);

  useEffect(() => {
    rotationsRef.current = rotations;
  }, [rotations]);

  const imageCount = localImages.length;

  const downloadToCache = useCallback(async (uri) => {
    const ext = (uri.match(/\.(jpe?g|png|gif|webp)/i) || ['.jpg'])[0];
    const filename = `viewer_${Date.now()}${ext}`;
    const dest = new File(Paths.cache, filename);
    const downloaded = await File.downloadFileAsync(uri, dest, { idempotent: true });
    return downloaded.uri;
  }, []);

  const formatBytes = useCallback((bytes) => {
    if (!bytes || bytes <= 0) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }, []);

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

  const handleClose = useCallback(() => {
    if (closeInFlightRef.current) return;
    closeInFlightRef.current = true;
    flushRotations();
    onClose?.();
  }, [flushRotations, onClose]);

  useEffect(() => () => {
    flushRotations();
  }, [flushRotations]);

  const handleTap = useCallback(() => {
    if (menuOpen || infoOpen) {
      setMenuOpen(false);
      setInfoOpen(false);
      return;
    }
    setToolbarVisible((visible) => !visible);
  }, [infoOpen, menuOpen]);

  const handleSwipePage = useCallback(
    (nextIndex) => {
      const clampedIndex = Math.max(0, Math.min(localImages.length - 1, nextIndex));
      if (clampedIndex === localIndex) return;
      setLocalIndex(clampedIndex);
    },
    [localImages.length, localIndex],
  );

  const currentUri = localImages[localIndex];

  const handleRotate = useCallback(() => {
    if (!currentUri) return;
    haptic();
    setRotations((prev) => {
      const next = {
        ...prev,
        [localIndex]: ((prev[localIndex] || 0) + 90) % 360,
      };
      rotationsRef.current = next;
      return next;
    });
  }, [currentUri, localIndex]);

  const handleShare = useCallback(async () => {
    if (busy || !currentUri) return;
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
  }, [busy, currentUri, downloadToCache]);

  const handleSave = useCallback(async () => {
    if (busy || !currentUri) return;
    haptic();
    setMenuOpen(false);
    setBusy(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync(true);
      if (status !== 'granted') {
        toast.error(t('viewer_permission_denied', 'Permission denied'));
        return;
      }
      const localUri = await downloadToCache(currentUri);
      await MediaLibrary.saveToLibraryAsync(localUri);
      haptic('Medium');
      toast.success(t('viewer_saved', 'Saved'));
    } catch (error) {
      console.warn('[Viewer] save:', error);
      toast.error(t('viewer_save_error', 'Save failed'));
    } finally {
      setBusy(false);
    }
  }, [busy, currentUri, downloadToCache, t, toast]);

  const handleShowInfo = useCallback(async () => {
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
        const file = new File(localUri);
        fileSize = file.size || null;
      }
    } catch {}

    setInfoOpen({
      resolution: dims ? `${dims.width} x ${dims.height}` : null,
      size: formatBytes(fileSize),
    });
  }, [currentUri, downloadToCache, formatBytes]);

  const handleDeleteConfirm = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    const idx = localIndex;
    try {
      await Promise.resolve(onDelete?.(idx));
    } catch {
      setDeleting(false);
      toast.error(t('order_toast_delete_error', 'Ошибка удаления'));
      return;
    }

    const remaining = localImages.filter((_, imageIndex) => imageIndex !== idx);
    if (!remaining.length) {
      setDeleting(false);
      setConfirmDelete(false);
      handleClose();
      return;
    }

    const nextRotations = {};
    Object.keys(rotations).forEach((key) => {
      const numericKey = Number(key);
      if (numericKey < idx) nextRotations[numericKey] = rotations[numericKey];
      else if (numericKey > idx) nextRotations[numericKey - 1] = rotations[numericKey];
    });

    setRotations(nextRotations);
    setLocalImages(remaining);
    setLocalIndex(Math.min(idx, remaining.length - 1));
    setConfirmDelete(false);
    setDeleting(false);
  }, [deleting, handleClose, localImages, localIndex, onDelete, rotations, t, toast]);

  const handleDeletePress = useCallback(() => {
    if (capturePreviewMode) {
      handleDeleteConfirm();
      return;
    }
    haptic('Medium');
    setMenuOpen(false);
    setInfoOpen(false);
    setConfirmDelete(true);
  }, [capturePreviewMode, handleDeleteConfirm]);

  const handleDeleteCancel = useCallback(() => {
    setDeleting(false);
    setConfirmDelete(false);
  }, []);
  const toggleMenu = useCallback(() => {
    haptic();
    setInfoOpen(false);
    setMenuOpen((visible) => !visible);
  }, []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closeInfo = useCallback(() => setInfoOpen(false), []);

  const infoRows = useMemo(() => {
    if (!infoOpen) return [];
    return [
      infoOpen.resolution && {
        label: t('viewer_info_resolution', 'Resolution'),
        value: infoOpen.resolution,
      },
      infoOpen.size && {
        label: t('viewer_info_size', 'Size'),
        value: infoOpen.size,
      },
    ].filter(Boolean);
  }, [infoOpen, t]);

  const renderPage = useCallback(
    ({ item, index }) => (
      <ZoomablePage
        height={viewportHeight}
        index={index}
        isActive={index === localIndex}
        onTap={handleTap}
        onSwipePage={handleSwipePage}
        rotation={rotations[index] || 0}
        uri={item}
        width={viewportWidth}
      />
    ),
    [handleSwipePage, handleTap, localIndex, rotations, viewportHeight, viewportWidth],
  );

  if (!imageCount) {
    if (!capturePreviewMode) return null;
    return (
      <View style={ds.root}>
        <StatusBar translucent barStyle="light-content" backgroundColor="transparent" />
        <Animated.View
          pointerEvents="box-none"
          style={[ds.header, { paddingTop: (insets.top || 0) + theme.spacing.md }]}
        >
          <Pressable
            onPress={handleClose}
            hitSlop={theme.spacing.md}
            style={[ds.iconBtn, { backgroundColor: overlayBg }]}
          >
            <Feather name="chevron-left" size={theme.icons.md} color={VIEWER_FG} />
          </Pressable>
          <View style={[ds.counterPill, { backgroundColor: overlayBg }]}>
            <Text style={ds.counterText}>0 / 0</Text>
          </View>
        </Animated.View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: VIEWER_FG, opacity: 0.7 }}>
            {t('order_photos_empty_title', 'Нет фотографий')}
          </Text>
        </View>
      </View>
    );
  }

  const counterLabel = categoryLabel
    ? `${categoryLabel} · ${localIndex + 1}/${imageCount}`
    : `${localIndex + 1} / ${imageCount}`;

  return (
    <View style={ds.root}>
      <StatusBar translucent barStyle="light-content" backgroundColor="transparent" />

      <View style={ds.gallery}>
        {renderPage({ item: localImages[localIndex], index: localIndex })}
      </View>

      {toolbarVisible ? (
        <Animated.View
          entering={FadeIn.duration(ANIM_FADE_IN)}
          exiting={FadeOut.duration(ANIM_FADE_OUT)}
          pointerEvents="box-none"
          style={[ds.header, { paddingTop: (insets.top || 0) + theme.spacing.md }]}
        >
          <Pressable
            onPress={handleClose}
            hitSlop={theme.spacing.md}
            style={[ds.iconBtn, { backgroundColor: overlayBg }]}
          >
            <Feather name="chevron-left" size={theme.icons.md} color={VIEWER_FG} />
          </Pressable>
          <View style={[ds.counterPill, { backgroundColor: overlayBg }]}>
            <Text style={ds.counterText}>{counterLabel}</Text>
          </View>
        </Animated.View>
      ) : null}

      {toolbarVisible ? (
        <Animated.View
          entering={FadeIn.duration(ANIM_FADE_IN)}
          exiting={FadeOut.duration(ANIM_FADE_OUT)}
          pointerEvents="box-none"
          style={[
            ds.footer,
            capturePreviewMode && ds.footerSingle,
            { paddingBottom: (insets.bottom || 0) + theme.spacing.lg },
          ]}
        >
          {capturePreviewMode ? (
            <Button
              variant="destructive"
              size="md"
              title={t('camera_delete_photo', 'Удалить фото')}
              onPress={handleDeletePress}
              style={ds.captureDeleteBtn}
            />
          ) : (
            <>
              <Pressable
                onPress={handleShare}
                disabled={busy}
                hitSlop={theme.spacing.sm}
                style={[ds.footerBtn, { backgroundColor: overlayBg }]}
              >
                <Feather name="share" size={theme.icons.sm} color={VIEWER_FG} />
                <Text style={ds.footerLabel}>{t('viewer_share', 'Share')}</Text>
              </Pressable>

              <Pressable
                onPress={(event) => {
                  event?.stopPropagation?.();
                  handleRotate();
                }}
                hitSlop={theme.spacing.sm}
                style={[ds.footerBtn, { backgroundColor: overlayBg }]}
              >
                <Feather name="rotate-cw" size={theme.icons.sm} color={VIEWER_FG} />
                <Text style={ds.footerLabel}>{t('viewer_rotate', 'Rotate')}</Text>
              </Pressable>

              <Pressable
                onPress={toggleMenu}
                hitSlop={theme.spacing.sm}
                style={[ds.footerBtn, { backgroundColor: overlayBg }]}
              >
                <Feather name="more-horizontal" size={theme.icons.sm} color={VIEWER_FG} />
                <Text style={ds.footerLabel}>{t('viewer_more', 'More')}</Text>
              </Pressable>

              {onDelete ? (
                <Pressable
                  onPress={handleDeletePress}
                  hitSlop={theme.spacing.sm}
                  style={[ds.footerBtn, { backgroundColor: overlayBg }]}
                >
                  <Feather name="trash-2" size={theme.icons.sm} color={theme.colors.danger} />
                  <Text style={[ds.footerLabel, { color: theme.colors.danger }]}>
                    {t('viewer_delete', 'Delete')}
                  </Text>
                </Pressable>
              ) : null}
            </>
          )}
        </Animated.View>
      ) : null}

      <BaseModal
        visible={menuOpen}
        onClose={closeMenu}
        title={t('viewer_more', 'More')}
        maxHeightRatio={0.35}
      >
        <Pressable
          onPress={handleSave}
          style={({ pressed }) => [ds.menuRow, ds.menuRowBorder, pressed && { opacity: 0.6 }]}
        >
          <Feather name="download" size={theme.icons.md} color={theme.colors.text} />
          <Text style={ds.menuRowLabel}>{t('viewer_save_to_device', 'Save to device')}</Text>
        </Pressable>
        <Pressable onPress={handleShowInfo} style={({ pressed }) => [ds.menuRow, pressed && { opacity: 0.6 }]}>
          <Feather name="info" size={theme.icons.md} color={theme.colors.text} />
          <Text style={ds.menuRowLabel}>{t('viewer_info_title', 'Photo info')}</Text>
        </Pressable>
      </BaseModal>

      <BaseModal
        visible={!!infoOpen}
        onClose={closeInfo}
        title={t('viewer_info_title', 'Photo info')}
        maxHeightRatio={0.3}
      >
        {infoRows.map((row, index) => (
          <View key={index} style={ds.infoRow}>
            <Text style={ds.infoLabel}>{row.label}</Text>
            <Text style={ds.infoValue}>{row.value}</Text>
          </View>
        ))}
      </BaseModal>

      {!capturePreviewMode ? (
        <BaseModal
          visible={confirmDelete}
          onClose={handleDeleteCancel}
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
                  onPress: handleDeleteCancel,
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
      ) : null}
    </View>
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
  if (!capturePreviewMode && !images?.length) return null;

  return (
    <AnimatedFullscreenModal visible={visible} animation="fade" onRequestClose={onClose} onDismiss={onDismiss}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ToastProvider>
          <ViewerContent
            images={images}
            initialIndex={initialIndex}
            onClose={onClose}
            onDelete={onDelete}
            onRotateSave={onRotateSave}
            categoryLabel={categoryLabel}
            capturePreviewMode={capturePreviewMode}
          />
        </ToastProvider>
      </GestureHandlerRootView>
    </AnimatedFullscreenModal>
  );
}

export default memo(FullscreenImageViewer);
