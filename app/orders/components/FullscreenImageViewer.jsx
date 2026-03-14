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
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import PagerView from 'react-native-pager-view';
import { Zoomable } from '@likashefqet/react-native-image-zoom';
import { Feather } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { File, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../theme';
import { withAlpha } from '../../../theme/colors';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { BaseModal, ConfirmModal, AnimatedFullscreenModal } from '../../../components/ui/modals';
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
const PAGE_GAP = 12;
const CLOSE_SWIPE_DISTANCE = 140;
const CLOSE_SWIPE_MIN_VELOCITY = 1350;
const ACTIVE_PAGE_BUFFER = 1;

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

const ZoomablePage = memo(function ZoomablePage({
  height,
  index,
  isActive,
  onTap,
  onZoomStateChange,
  rotation,
  uri,
  width,
}) {
  const [naturalSize, setNaturalSize] = useState(null);

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
  const isZoomedRef = useRef(false);
  const zoomScale = useSharedValue(1);

  const handleZoomState = useCallback(
    (zoomed) => {
      if (isZoomedRef.current === zoomed) return;
      isZoomedRef.current = zoomed;
      onZoomStateChange(index, zoomed);
    },
    [index, onZoomStateChange],
  );

  useEffect(() => {
    if (isActive) return;
    isZoomedRef.current = false;
    onZoomStateChange(index, false);
    zoomRef.current?.reset?.();
  }, [index, isActive, onZoomStateChange]);

  useEffect(() => {
    if (!isActive) return;
    zoomScale.value = 1;
    isZoomedRef.current = false;
    onZoomStateChange(index, false);
    zoomRef.current?.reset?.();
  }, [index, isActive, onZoomStateChange, rotation, zoomScale]);

  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
      <View
        collapsable={false}
        style={{
          width,
          height,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Zoomable
          key={`${uri}_${normalizedRotation}`}
          ref={zoomRef}
          minScale={1}
          maxScale={MAX_SCALE}
          scale={zoomScale}
          doubleTapScale={DOUBLE_TAP_SCALE}
          maxPanPointers={1}
          isPanEnabled={isActive}
          isPinchEnabled={isActive}
          isSingleTapEnabled={isActive}
          isDoubleTapEnabled={isActive}
          onSingleTap={onTap}
          onPinchStart={() => handleZoomState(true)}
          onPinchEnd={() => handleZoomState(zoomScale.value > ZOOM_EPSILON)}
          onPanStart={() => handleZoomState(true)}
          onPanEnd={() => handleZoomState(zoomScale.value > ZOOM_EPSILON)}
          onResetAnimationEnd={() => handleZoomState(false)}
          style={{
            width,
            height,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width,
              height,
              alignItems: 'center',
              justifyContent: 'center',
            }}
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
          </View>
        </Zoomable>
      </View>
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
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const pagerRef = useRef(null);
  const rotationsRef = useRef({});
  const rotationsFlushedRef = useRef(false);
  const zoomedMapRef = useRef({});
  const closeInFlightRef = useRef(false);
  const dismissTranslateY = useSharedValue(0);
  const dismissing = useSharedValue(false);

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
  const [listKey, setListKey] = useState(0);
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rotations, setRotations] = useState({});

  useEffect(() => {
    if (!images?.length) return;
    dismissTranslateY.value = 0;
    dismissing.value = false;
    closeInFlightRef.current = false;
    setLocalImages([...images]);
    setLocalIndex(Math.max(0, Math.min(initialIndex, images.length - 1)));
    setListKey((value) => value + 1);
    setToolbarVisible(true);
    setMenuOpen(false);
    setInfoOpen(false);
    setConfirmDelete(false);
    setBusy(false);
    setRotations({});
    rotationsRef.current = {};
    rotationsFlushedRef.current = false;
    zoomedMapRef.current = {};
  }, [dismissing, dismissTranslateY, images, initialIndex]);

  useEffect(() => {
    rotationsRef.current = rotations;
  }, [rotations]);

  useEffect(() => {
    pagerRef.current?.setScrollEnabled?.(
      !(zoomedMapRef.current[localIndex] || false) && imageCount > 1,
    );
  }, [imageCount, listKey, localIndex]);

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

  const dismissAnimatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(0.35, Math.abs(dismissTranslateY.value) / (viewportHeight * 2)),
    transform: [{ translateY: dismissTranslateY.value }],
  }), [viewportHeight]);

  const closeSwipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!(zoomedMapRef.current[localIndex] || false))
        .maxPointers(1)
        .minDistance(20)
        .activeOffsetY([-30, 30])
        .failOffsetX([-8, 8])
        .onUpdate((event) => {
          if (dismissing.value) return;
          const verticalDominant = Math.abs(event.translationY) > Math.abs(event.translationX) * 1.25;
          if (!verticalDominant) return;
          dismissTranslateY.value = event.translationY;
        })
        .onEnd((event) => {
          if (dismissing.value) return;
          const verticalDominant = Math.abs(event.translationY) > Math.abs(event.translationX) * 1.25;
          if (!verticalDominant) {
            dismissTranslateY.value = withTiming(0, { duration: 170 });
            return;
          }
          const distanceY = Math.abs(event.translationY);
          const velocityY = Math.abs(event.velocityY);
          const shouldClose =
            distanceY >= CLOSE_SWIPE_DISTANCE ||
            (velocityY >= CLOSE_SWIPE_MIN_VELOCITY && distanceY >= 36);

          if (shouldClose) {
            dismissing.value = true;
            const targetY = event.translationY >= 0 ? viewportHeight : -viewportHeight;
            dismissTranslateY.value = withTiming(targetY, { duration: 220 }, (finished) => {
              if (finished) {
                runOnJS(handleClose)();
              }
            });
            return;
          }

          dismissing.value = false;
          dismissTranslateY.value = withTiming(0, { duration: 170 });
        })
        .onFinalize(() => {
          if (dismissing.value) return;
          dismissTranslateY.value = withTiming(0, { duration: 170 });
        }),
    [dismissing, dismissTranslateY, handleClose, localIndex, viewportHeight],
  );

  const handleTap = useCallback(() => {
    if (menuOpen || infoOpen) {
      setMenuOpen(false);
      setInfoOpen(false);
      return;
    }
    setToolbarVisible((visible) => !visible);
  }, [infoOpen, menuOpen]);

  const handleZoomStateChange = useCallback((index, zoomed) => {
    zoomedMapRef.current[index] = zoomed;
    if (index === localIndex) {
      pagerRef.current?.setScrollEnabled?.(!zoomed && imageCount > 1);
    }
  }, [imageCount, localIndex]);

  const restorePagerScroll = useCallback(() => {
    pagerRef.current?.setScrollEnabled?.(
      !(zoomedMapRef.current[localIndex] || false) && imageCount > 1,
    );
  }, [imageCount, localIndex]);

  const handlePageSelected = useCallback((event) => {
    const nextIndex = Math.max(0, Math.min(localImages.length - 1, event?.nativeEvent?.position || 0));
    setLocalIndex(nextIndex);
    pagerRef.current?.setScrollEnabled?.(
      !(zoomedMapRef.current[nextIndex] || false) && localImages.length > 1,
    );
  }, [localImages.length]);

  const currentUri = localImages[localIndex];

  const handleRotate = useCallback(() => {
    if (!currentUri) return;
    haptic();
    setRotations((prev) => ({
      ...prev,
      [localIndex]: ((prev[localIndex] || 0) + 90) % 360,
    }));
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

  const handleDeletePress = useCallback(() => {
    haptic('Medium');
    setMenuOpen(false);
    setInfoOpen(false);
    setConfirmDelete(true);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    const idx = localIndex;
    onDelete?.(idx);

    const remaining = localImages.filter((_, imageIndex) => imageIndex !== idx);
    if (!remaining.length) {
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
    setListKey((value) => value + 1);
  }, [handleClose, localImages, localIndex, onDelete, rotations]);

  const handleDeleteCancel = useCallback(() => setConfirmDelete(false), []);
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
        onZoomStateChange={handleZoomStateChange}
        rotation={rotations[index] || 0}
        uri={item}
        width={viewportWidth}
      />
    ),
    [handleTap, handleZoomStateChange, localIndex, rotations, viewportHeight, viewportWidth],
  );

  if (!imageCount) return null;

  const counterLabel = categoryLabel
    ? `${categoryLabel} · ${localIndex + 1}/${imageCount}`
    : `${localIndex + 1} / ${imageCount}`;

  return (
    <View style={ds.root}>
      <StatusBar hidden animated />

      <GestureDetector gesture={closeSwipeGesture}>
        <Animated.View style={[ds.gallery, dismissAnimatedStyle]}>
          <PagerView
            key={listKey}
            ref={pagerRef}
            initialPage={localIndex}
            scrollEnabled={imageCount > 1}
            overScrollMode="never"
            offscreenPageLimit={1}
            pageMargin={PAGE_GAP}
            onPageSelected={handlePageSelected}
            style={ds.gallery}
          >
            {localImages.map((item, index) => (
              <View
                key={`${item}_${index}`}
                collapsable={false}
                style={{ width: viewportWidth, height: viewportHeight }}
              >
                {Math.abs(index - localIndex) <= ACTIVE_PAGE_BUFFER
                  ? renderPage({ item, index })
                  : null}
              </View>
            ))}
          </PagerView>
        </Animated.View>
      </GestureDetector>

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
          style={[ds.footer, { paddingBottom: (insets.bottom || 0) + theme.spacing.lg }]}
        >
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
            onPressIn={() => pagerRef.current?.setScrollEnabled?.(false)}
            onPressOut={restorePagerScroll}
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

      <ConfirmModal
        visible={confirmDelete}
        title={t('order_photos_delete_single_title')}
        message={t('order_photos_delete_single_message')}
        confirmLabel={t('order_photos_delete_single_confirm')}
        confirmVariant="destructive"
        cancelLabel={t('order_photos_delete_single_cancel')}
        onConfirm={handleDeleteConfirm}
        onClose={handleDeleteCancel}
      />
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
}) {
  if (!visible || !images?.length) return null;

  return (
    <AnimatedFullscreenModal visible animation="fade" onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ToastProvider>
          <ViewerContent
            images={images}
            initialIndex={initialIndex}
            onClose={onClose}
            onDelete={onDelete}
            onRotateSave={onRotateSave}
            categoryLabel={categoryLabel}
          />
        </ToastProvider>
      </GestureHandlerRootView>
    </AnimatedFullscreenModal>
  );
}

export default memo(FullscreenImageViewer);
