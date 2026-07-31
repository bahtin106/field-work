import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image as RNImage,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Feather from '@expo/vector-icons/Feather';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { cacheDirectory, copyAsync, downloadAsync, getInfoAsync } from 'expo-file-system/legacy';
import { Image as ExpoImage } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import { fitContainer, Gallery, useImageResolution } from 'react-native-zoom-toolkit';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../theme';
import { withAlpha } from '../../../theme/colors';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { BaseModal, ConfirmModal } from '../../../components/ui/modals';
import {
  notifyIOSModalDismissed,
  registerIOSModal,
  releaseIOSModal,
  requestIOSModalPresentation,
  unregisterIOSModal,
} from '../../../components/ui/modals/iosModalCoordinator';
import ListSeparator from '../../../components/ui/ListSeparator';
import SeparatedList from '../../../components/ui/SeparatedList';
import ToastProvider, { useToast } from '../../../components/ui/ToastProvider';

const VIEWER_BG = '#000000';
const VIEWER_FG = '#FFFFFF';
const VIEWER_OVERLAY_ALPHA = 0.55;
const ICON_BTN_SIZE = 40;
const LOCAL_MEDIA_URI_RE = /^(file|content|asset|ph|assets-library):\/\//i;
const DATA_IMAGE_URI_RE = /^data:image\//i;
const REMOTE_URI_RE = /^https?:\/\//i;
const GALLERY_WINDOW_SIZE = 3;
const IMAGE_LOAD_TIMEOUT_MS = 15_000;
const MAX_IMAGE_RETRY_ATTEMPTS = 2;
const EDGE_BACK_GESTURE_WIDTH = 28;
const EDGE_BACK_MIN_DISTANCE = 64;
const EDGE_BACK_MIN_FLING_DISTANCE = 22;
const EDGE_BACK_MIN_VELOCITY = 0.55;
const MIN_PLAUSIBLE_PHOTO_DATE_MS = Date.UTC(2000, 0, 1);
const MAX_PHOTO_DATE_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

const haptic = (style = 'Light') =>
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle[style]).catch(() => {});

const normalizeImages = (images) =>
  (Array.isArray(images) ? images : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean);

const normalizeFallbackImages = (images, count) =>
  Array.from({ length: count }, (_, index) => String(images?.[index] || '').trim());

const normalizeImageMetadata = (metadata, count) =>
  Array.from({ length: count }, (_, index) => {
    const value = metadata?.[index];
    return value && typeof value === 'object'
      ? {
          capturedAt: value.capturedAt || value.captured_at || null,
          uploadedAt: value.uploadedAt || value.uploaded_at || null,
          origin: value.origin || value.mediaOrigin || value.media_origin || null,
        }
      : null;
  });

const formatImageDateTime = (value, locale) => {
  const date = new Date(value);
  const timestamp = date.getTime();
  if (
    !Number.isFinite(timestamp) ||
    timestamp < MIN_PLAUSIBLE_PHOTO_DATE_MS ||
    timestamp > Date.now() + MAX_PHOTO_DATE_FUTURE_SKEW_MS
  ) return null;
  try {
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
};

const clampIndex = (index, count) => {
  if (!count) return 0;
  const numeric = Number(index);
  const safe = Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
  return Math.max(0, Math.min(safe, count - 1));
};

function createEdgeBackResponder(direction, onClose) {
  const inwardDistance = (gesture) => Number(gesture?.dx || 0) * direction;
  return PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event, gesture) => {
      const distance = inwardDistance(gesture);
      return (
        distance > 8 &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2
      );
    },
    onMoveShouldSetPanResponderCapture: (_event, gesture) => {
      const distance = inwardDistance(gesture);
      return (
        distance > 8 &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2
      );
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: (_event, gesture) => {
      const distance = inwardDistance(gesture);
      const velocity = Number(gesture?.vx || 0) * direction;
      const passedDistance = distance >= EDGE_BACK_MIN_DISTANCE;
      const passedVelocity =
        distance >= EDGE_BACK_MIN_FLING_DISTANCE &&
        velocity >= EDGE_BACK_MIN_VELOCITY;
      if (passedDistance || passedVelocity) onClose();
    },
    onShouldBlockNativeResponder: () => true,
  });
}

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
  fallbackUri,
  viewportWidth,
  viewportHeight,
  loadingLabel,
  onFallbackActivated,
  onLoadStateChange,
  onRefreshUri,
  onDisplayedUri,
}) {
  const [activeUri, setActiveUri] = useState(uri);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [loadState, setLoadState] = useState('loading');
  const retryTimerRef = useRef(null);
  const loadTimeoutRef = useRef(null);
  const retryScheduledRef = useRef(false);
  const refreshAttemptedRef = useRef(false);
  const refreshRequestRef = useRef(0);
  const { resolution } = useImageResolution({ uri: activeUri });

  const clearLoadTimeout = useCallback(() => {
    if (!loadTimeoutRef.current) return;
    clearTimeout(loadTimeoutRef.current);
    loadTimeoutRef.current = null;
  }, []);

  const handleLoadFailure = useCallback(() => {
    if (loadState === 'ready' || retryScheduledRef.current) return;
    clearLoadTimeout();
    const safeFallback = String(fallbackUri || '').trim();
    if (safeFallback && safeFallback !== activeUri) {
      setActiveUri(safeFallback);
      setRetryAttempt(0);
      setLoadState('loading');
      onFallbackActivated?.(safeFallback);
      return;
    }
    if (/^https?:\/\//i.test(String(activeUri || '')) && retryAttempt < MAX_IMAGE_RETRY_ATTEMPTS) {
      retryScheduledRef.current = true;
      const nextAttempt = retryAttempt + 1;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        retryScheduledRef.current = false;
        setLoadState('loading');
        setRetryAttempt(nextAttempt);
      }, 450 * nextAttempt);
      return;
    }
    if (onRefreshUri && !refreshAttemptedRef.current) {
      refreshAttemptedRef.current = true;
      retryScheduledRef.current = true;
      const requestId = refreshRequestRef.current + 1;
      refreshRequestRef.current = requestId;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        if (refreshRequestRef.current !== requestId) return;
        retryScheduledRef.current = false;
        setLoadState('error');
      }, IMAGE_LOAD_TIMEOUT_MS);
      void Promise.resolve(onRefreshUri(activeUri))
        .then((value) => {
          if (refreshRequestRef.current !== requestId) return;
          if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
          }
          retryScheduledRef.current = false;
          const refreshedUri = String(value || '').trim();
          if (!refreshedUri) {
            setLoadState('error');
            return;
          }
          setActiveUri(refreshedUri);
          setRetryAttempt(0);
          setLoadState('loading');
        })
        .catch(() => {
          if (refreshRequestRef.current !== requestId) return;
          if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
          }
          retryScheduledRef.current = false;
          setLoadState('error');
        });
      return;
    }
    setLoadState('error');
  }, [
    activeUri,
    clearLoadTimeout,
    fallbackUri,
    loadState,
    onFallbackActivated,
    onRefreshUri,
    retryAttempt,
  ]);

  const handleDisplayed = useCallback(() => {
    retryScheduledRef.current = false;
    clearLoadTimeout();
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setLoadState('ready');
    onDisplayedUri?.(activeUri);
  }, [activeUri, clearLoadTimeout, onDisplayedUri]);

  const restartLoadTimeout = useCallback(() => {
    clearLoadTimeout();
    if (loadState !== 'loading') return;
    loadTimeoutRef.current = setTimeout(handleLoadFailure, IMAGE_LOAD_TIMEOUT_MS);
  }, [clearLoadTimeout, handleLoadFailure, loadState]);

  useEffect(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryScheduledRef.current = false;
    refreshAttemptedRef.current = false;
    refreshRequestRef.current += 1;
    setActiveUri(uri);
    setRetryAttempt(0);
    setLoadState('loading');
  }, [uri]);

  useEffect(() => {
    restartLoadTimeout();
    return clearLoadTimeout;
  }, [activeUri, clearLoadTimeout, restartLoadTimeout, retryAttempt]);

  useEffect(() => {
    onLoadStateChange?.(uri, loadState);
  }, [loadState, onLoadStateChange, uri]);

  useEffect(
    () => () => {
      refreshRequestRef.current += 1;
      clearLoadTimeout();
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    },
    [clearLoadTimeout],
  );

  const fittedSize = useMemo(() => {
    const width = Number(resolution?.width) || 0;
    const height = Number(resolution?.height) || 0;
    if (width <= 0 || height <= 0) {
      return { width: viewportWidth, height: viewportHeight };
    }
    return fitContainer(width / height, {
      width: viewportWidth,
      height: viewportHeight,
    });
  }, [resolution?.height, resolution?.width, viewportHeight, viewportWidth]);

  return (
    <View style={[styles.galleryPhoto, fittedSize]}>
      <ExpoImage
        key={`${activeUri}:${retryAttempt}`}
        source={{ uri: activeUri }}
        contentFit="contain"
        cachePolicy={retryAttempt > 0 ? 'none' : 'memory-disk'}
        priority="high"
        transition={0}
        recyclingKey={`${activeUri}:${retryAttempt}`}
        onDisplay={handleDisplayed}
        onError={handleLoadFailure}
        onProgress={restartLoadTimeout}
        style={StyleSheet.absoluteFill}
      />
      {loadState === 'loading' ? (
        <View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          accessibilityLabel={loadingLabel}
          style={styles.imageStateOverlay}
        >
          <ActivityIndicator size="large" color={VIEWER_FG} />
        </View>
      ) : null}
    </View>
  );
});

const ZoomGallery = memo(function ZoomGallery({
  galleryKey,
  galleryRef,
  images,
  initialIndex,
  renderItem,
  keyExtractor,
  onIndexChange,
  onTap,
}) {
  return (
    <Gallery
      key={galleryKey}
      ref={galleryRef}
      data={images}
      initialIndex={initialIndex}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      onIndexChange={onIndexChange}
      onTap={onTap}
      maxScale={5}
      windowSize={GALLERY_WINDOW_SIZE}
      tapOnEdgeToItem={false}
      allowPinchPanning
      allowOverflow={false}
      scaleMode="bounce"
      pinchMode="clamp"
    />
  );
});

const styles = StyleSheet.create({
  rootFill: {
    flex: 1,
  },
  edgeBackGestureArea: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: EDGE_BACK_GESTURE_WIDTH,
    zIndex: 10,
  },
  edgeBackGestureAreaLeft: {
    left: 0,
  },
  edgeBackGestureAreaRight: {
    right: 0,
  },
  galleryPhoto: {
    backgroundColor: VIEWER_BG,
  },
  imageStateOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: VIEWER_BG,
  },
  imageErrorText: {
    marginTop: 12,
    color: VIEWER_FG,
    fontSize: 15,
    lineHeight: 20,
    textAlign: 'center',
  },
  imageRetryButton: {
    marginTop: 18,
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageRetryButtonPressed: {
    opacity: 0.7,
  },
  imageRetryText: {
    marginLeft: 8,
    color: VIEWER_FG,
    fontSize: 14,
    fontWeight: '600',
  },
});

const ImageViewingGallery = memo(function ImageViewingGallery({
  visible,
  images,
  fallbackImages,
  imageMetadata,
  initialIndex = 0,
  onClose,
  onDelete,
  onRotateSave,
  onRetryImage,
  categoryLabel,
  capturePreviewMode = false,
  onDismiss,
  onNativeDismiss,
  embedded = false,
}) {
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const galleryRef = useRef(null);
  const rotationsRef = useRef({});
  const rotationsFlushedRef = useRef(false);
  const closeInFlightRef = useRef(false);
  const dismissTimerRef = useRef(null);
  const dismissNotifiedRef = useRef(false);
  const modalOverlayOpenRef = useRef(false);
  const infoRequestRef = useRef(0);
  const iosModalIdRef = useRef(null);
  const iosSuspendedRef = useRef(false);
  const nativeVisibleRef = useRef(false);
  const nativeDismissPendingRef = useRef(false);
  const onNativeDismissRef = useRef(onNativeDismiss);
  const presentRef = useRef(null);
  const resumeRef = useRef(null);
  const suspendRef = useRef(null);
  onNativeDismissRef.current = onNativeDismiss;

  const initialImages = useMemo(() => normalizeImages(images), [images]);
  const initialFallbackImages = useMemo(
    () => normalizeFallbackImages(fallbackImages, initialImages.length),
    [fallbackImages, initialImages.length],
  );
  const initialImageMetadata = useMemo(
    () => normalizeImageMetadata(imageMetadata, initialImages.length),
    [imageMetadata, initialImages.length],
  );
  const imageSignature = useMemo(() => initialImages.join('\u001f'), [initialImages]);
  const initialSafeIndex = clampIndex(initialIndex, initialImages.length);
  const currentIndexRef = useRef(initialSafeIndex);
  const syncedSignatureRef = useRef(imageSignature);
  const visibleRef = useRef(visible);

  const [localImages, setLocalImages] = useState(initialImages);
  const [localFallbackImages, setLocalFallbackImages] = useState(initialFallbackImages);
  const [localImageMetadata, setLocalImageMetadata] = useState(initialImageMetadata);
  const [currentIndex, setCurrentIndex] = useState(initialSafeIndex);
  const [viewerIndex, setViewerIndex] = useState(initialSafeIndex);
  const [menuOpen, setMenuOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rotations, setRotations] = useState({});
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const [imageLoadStates, setImageLoadStates] = useState({});
  const [manualRetryNonce, setManualRetryNonce] = useState(0);
  const [nativeVisible, setNativeVisible] = useState(false);
  const [nativeDismissPending, setNativeDismissPending] = useState(false);
  const [resumeWithoutNativeAnimation, setResumeWithoutNativeAnimation] = useState(false);

  presentRef.current = () => {
    setResumeWithoutNativeAnimation(false);
    nativeVisibleRef.current = true;
    nativeDismissPendingRef.current = false;
    setNativeDismissPending(false);
    setNativeVisible(true);
  };
  resumeRef.current = () => {
    setResumeWithoutNativeAnimation(true);
    nativeVisibleRef.current = true;
    nativeDismissPendingRef.current = false;
    setNativeDismissPending(false);
    setNativeVisible(true);
  };
  suspendRef.current = () => {
    if (!nativeVisibleRef.current) return;
    iosSuspendedRef.current = true;
    nativeVisibleRef.current = false;
    nativeDismissPendingRef.current = true;
    setNativeDismissPending(true);
    setNativeVisible(false);
  };

  const overlayBg = useMemo(() => withAlpha(VIEWER_BG, VIEWER_OVERLAY_ALPHA), []);
  const currentUri = localImages[currentIndex] || '';
  const galleryKey = `${imageSignature}:${viewerIndex}:${manualRetryNonce}`;
  const topInset =
    Platform.OS === 'android'
      ? Math.max(insets.top || 0, StatusBar.currentHeight || 0)
      : insets.top || 0;

  const ds = useMemo(() => {
    const { spacing, radii, typography, colors } = theme;
    return StyleSheet.create({
      header: {
        paddingTop: topInset + spacing.md,
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
        flex: 1,
        marginRight: spacing.md,
        fontSize: typography.sizes.sm,
        color: colors.textSecondary,
      },
      infoValue: {
        flexShrink: 1,
        maxWidth: '62%',
        textAlign: 'right',
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
      imageErrorOverlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 15,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.xxl,
        backgroundColor: VIEWER_BG,
      },
      infoLoading: {
        paddingVertical: spacing.lg,
      },
    });
  }, [insets.bottom, theme, topInset]);

  useLayoutEffect(() => {
    if (Platform.OS !== 'ios' || embedded) return undefined;
    const id = registerIOSModal({
      present: () => presentRef.current?.(),
      resume: () => resumeRef.current?.(),
      suspend: () => suspendRef.current?.(),
    });
    iosModalIdRef.current = id;
    return () => {
      unregisterIOSModal(id);
      iosModalIdRef.current = null;
    };
  }, [embedded]);

  useLayoutEffect(() => {
    if (Platform.OS !== 'ios' || embedded) return;
    const id = iosModalIdRef.current;
    if (!id) return;
    if (visible) {
      requestIOSModalPresentation(id);
      return;
    }
    releaseIOSModal(id);
    if (nativeVisibleRef.current) {
      nativeVisibleRef.current = false;
      nativeDismissPendingRef.current = true;
      setNativeDismissPending(true);
      setNativeVisible(false);
      return;
    }
    if (!nativeDismissPendingRef.current) onNativeDismissRef.current?.();
  }, [embedded, visible]);

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
    setLocalFallbackImages(initialFallbackImages);
    setLocalImageMetadata(initialImageMetadata);
    currentIndexRef.current = nextIndex;
    setCurrentIndex(nextIndex);
    setViewerIndex(nextIndex);
    setMenuOpen(false);
    infoRequestRef.current += 1;
    setInfoOpen(false);
    setConfirmDelete(false);
    setDeleting(false);
    setBusy(false);
    setToolbarVisible(true);
    setImageLoadStates({});
    setManualRetryNonce(0);
    if (becameVisible) {
      setRotations({});
      rotationsRef.current = {};
      rotationsFlushedRef.current = false;
    }
    closeInFlightRef.current = false;
  }, [currentIndex, imageSignature, initialFallbackImages, initialImageMetadata, initialImages, initialIndex, localImages, visible]);

  useEffect(() => {
    rotationsRef.current = rotations;
  }, [rotations]);

  useEffect(() => {
    setLocalImageMetadata(initialImageMetadata);
  }, [initialImageMetadata]);

  useEffect(() => {
    modalOverlayOpenRef.current = Boolean(menuOpen || infoOpen || confirmDelete);
  }, [confirmDelete, infoOpen, menuOpen]);

  useEffect(() => {
    let active = true;
    const candidates = [
      localImages[currentIndex],
      localImages[currentIndex + 1],
      localImages[currentIndex - 1],
      localFallbackImages[currentIndex],
      localFallbackImages[currentIndex + 1],
      localFallbackImages[currentIndex - 1],
    ].filter(Boolean);
    const uniqueCandidates = [...new Set(candidates)];

    (async () => {
      for (const uri of uniqueCandidates) {
        if (!active) break;
        await ExpoImage.prefetch(uri, 'memory-disk').catch(() => false);
      }
    })();

    return () => {
      active = false;
    };
  }, [currentIndex, localFallbackImages, localImages]);

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
    infoRequestRef.current += 1;
    setInfoOpen(false);
    setConfirmDelete(false);
    onClose?.();
    scheduleDismiss();
  }, [flushRotations, onClose, scheduleDismiss]);

  const leftEdgeBackResponder = useMemo(
    () =>
      createEdgeBackResponder(1, () => {
        if (!modalOverlayOpenRef.current) requestClose();
      }),
    [requestClose],
  );
  const rightEdgeBackResponder = useMemo(
    () =>
      createEdgeBackResponder(-1, () => {
        if (!modalOverlayOpenRef.current) requestClose();
      }),
    [requestClose],
  );

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

  const closeInfo = useCallback(() => {
    infoRequestRef.current += 1;
    setInfoOpen(false);
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

  const handleShowInfo = useCallback(() => {
    if (capturePreviewMode) return;
    haptic();
    setMenuOpen(false);
    if (!currentUri) return;
    const metadata = localImageMetadata[currentIndex] || {};
    const requestId = infoRequestRef.current + 1;
    infoRequestRef.current = requestId;
    setInfoOpen({
      capturedAt: formatImageDateTime(metadata.capturedAt, locale),
      uploadedAt: formatImageDateTime(metadata.uploadedAt, locale),
      origin: String(metadata.origin || '').trim() || null,
      resolution: null,
      size: null,
      loading: true,
    });

    void (async () => {
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
      if (infoRequestRef.current !== requestId) return;
      setInfoOpen((previous) => previous && ({
        ...previous,
        resolution: dims ? `${dims.width} x ${dims.height}` : null,
        size: formatBytes(fileSize),
        loading: false,
      }));
    })();
  }, [capturePreviewMode, currentIndex, currentUri, downloadToCache, formatBytes, localImageMetadata, locale]);

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
    setLocalFallbackImages((prev) => prev.filter((_, imageIndex) => imageIndex !== idx));
    setLocalImageMetadata((prev) => prev.filter((_, imageIndex) => imageIndex !== idx));
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
    currentIndexRef.current = nextIndex;
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
    closeInfo();
    if (capturePreviewMode) {
      handleDeleteConfirm();
      return;
    }
    setConfirmDelete(true);
  }, [busy, capturePreviewMode, closeInfo, deleting, handleDeleteConfirm, onDelete]);

  const infoRows = useMemo(() => {
    if (!infoOpen) return [];
    return [
      infoOpen.capturedAt && {
        label: t('viewer_info_captured_at'),
        value: infoOpen.capturedAt,
      },
      infoOpen.origin === 'app_camera' && {
        label: t('viewer_info_source'),
        value: t('viewer_info_source_app_camera'),
      },
      infoOpen.origin === 'device_library' && {
        label: t('viewer_info_source'),
        value: t('viewer_info_source_upload'),
      },
      infoOpen.origin !== 'app_camera' && infoOpen.uploadedAt && {
        label: t('viewer_info_uploaded_at'),
        value: infoOpen.uploadedAt,
      },
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
    const safeIndex = clampIndex(nextIndex, localImages.length);
    currentIndexRef.current = safeIndex;
    setCurrentIndex(safeIndex);
  }, [localImages.length]);

  const handleGalleryTap = useCallback(() => {
    if (modalOverlayOpenRef.current) {
      setMenuOpen(false);
      closeInfo();
      setConfirmDelete(false);
      return;
    }
    setToolbarVisible((value) => !value);
  }, [closeInfo]);

  const handleFallbackActivated = useCallback((index, nextUri) => {
    const fallback = String(nextUri || '').trim();
    if (!fallback) return;
    setLocalImages((prev) => prev.map((value, imageIndex) => (imageIndex === index ? fallback : value)));
    setLocalFallbackImages((prev) => prev.map((value, imageIndex) => (imageIndex === index ? '' : value)));
  }, []);

  const handleDisplayedUri = useCallback((index, displayedUri) => {
    const nextUri = String(displayedUri || '').trim();
    if (!nextUri) return;
    setLocalImages((previous) => {
      if (previous[index] === nextUri) return previous;
      return previous.map((uri, imageIndex) => (imageIndex === index ? nextUri : uri));
    });
    setLocalFallbackImages((previous) => {
      if (!previous[index]) return previous;
      return previous.map((uri, imageIndex) => (imageIndex === index ? '' : uri));
    });
  }, []);

  const refreshImageUri = useCallback(
    (index, failedUri) => {
      if (!onRetryImage) return '';
      return onRetryImage(index, failedUri);
    },
    [onRetryImage],
  );

  const handleImageLoadStateChange = useCallback((uri, state) => {
    const key = String(uri || '').trim();
    if (!key) return;
    setImageLoadStates((previous) => (
      previous[key] === state ? previous : { ...previous, [key]: state }
    ));
  }, []);

  const handleManualImageRetry = useCallback(() => {
    if (!currentUri) return;
    const retryIndex = currentIndexRef.current;
    const failedUri = currentUri;
    haptic();
    setImageLoadStates((previous) => ({ ...previous, [failedUri]: 'loading' }));
    setManualRetryNonce((value) => value + 1);

    if (!onRetryImage) return;
    void Promise.resolve(onRetryImage(retryIndex, failedUri))
      .then((value) => {
        const freshUri = String(value || '').trim();
        if (!freshUri || currentIndexRef.current !== retryIndex) return;
        setLocalImages((previous) =>
          previous.map((uri, index) => (index === retryIndex ? freshUri : uri)),
        );
        setLocalFallbackImages((previous) =>
          previous.map((uri, index) => (index === retryIndex ? '' : uri)),
        );
        setImageLoadStates((previous) => {
          const next = { ...previous };
          delete next[failedUri];
          next[freshUri] = 'loading';
          return next;
        });
        setViewerIndex(retryIndex);
        setManualRetryNonce((value) => value + 1);
      })
      .catch(() => {});
  }, [currentUri, onRetryImage]);

  const renderGalleryItem = useCallback(
    (uri, index) => (
      <GalleryPhoto
        uri={uri}
        fallbackUri={localFallbackImages[index]}
        viewportWidth={viewportWidth}
        viewportHeight={viewportHeight}
        loadingLabel={t('viewer_image_loading')}
        onFallbackActivated={(nextUri) => handleFallbackActivated(index, nextUri)}
        onLoadStateChange={handleImageLoadStateChange}
        onRefreshUri={onRetryImage ? (failedUri) => refreshImageUri(index, failedUri) : undefined}
        onDisplayedUri={(displayedUri) => handleDisplayedUri(index, displayedUri)}
      />
    ),
    [
      handleDisplayedUri,
      handleFallbackActivated,
      handleImageLoadStateChange,
      localFallbackImages,
      onRetryImage,
      refreshImageUri,
      t,
      viewportHeight,
      viewportWidth,
    ],
  );

  const galleryKeyExtractor = useCallback((uri, index) => `${index}:${uri}`, []);

  const counter = localImages.length ? `${currentIndex + 1} / ${localImages.length}` : '0 / 0';
  const counterLabel = categoryLabel ? `${categoryLabel} · ${counter}` : counter;

  const ViewerContainer = embedded ? View : Modal;
  const viewerContainerProps = embedded
    ? { style: styles.rootFill }
    : {
        visible: Platform.OS === 'ios' ? nativeVisible : visible,
        transparent: false,
        animationType: resumeWithoutNativeAnimation ? 'none' : 'fade',
        presentationStyle: 'fullScreen',
        hardwareAccelerated: true,
        onRequestClose: requestClose,
        onDismiss: () => {
          const wasSuspended = Platform.OS === 'ios' && iosSuspendedRef.current;
          iosSuspendedRef.current = false;
          nativeVisibleRef.current = false;
          nativeDismissPendingRef.current = false;
          setNativeVisible(false);
          setNativeDismissPending(false);
          if (Platform.OS === 'ios' && iosModalIdRef.current != null) {
            notifyIOSModalDismissed(iosModalIdRef.current, { suspended: wasSuspended });
          }
          if (!wasSuspended) onNativeDismissRef.current?.();
        },
      };

  const keepsNativeLayer =
    Platform.OS === 'ios' && !embedded && (nativeVisible || nativeDismissPending);
  if ((!visible && !keepsNativeLayer) || !localImages.length) return null;

  return (
    <>
      <ViewerContainer {...viewerContainerProps}>
        <GestureHandlerRootView style={styles.rootFill}>
          <StatusBar barStyle="light-content" />
          <View style={ds.modalRoot}>
            <View style={ds.gallery}>
              <ZoomGallery
                galleryKey={galleryKey}
                galleryRef={galleryRef}
                images={localImages}
                initialIndex={clampIndex(viewerIndex, localImages.length)}
                renderItem={renderGalleryItem}
                keyExtractor={galleryKeyExtractor}
                onIndexChange={handleIndexChange}
                onTap={handleGalleryTap}
              />
            </View>

            <View
              collapsable={false}
              pointerEvents="box-only"
              style={[styles.edgeBackGestureArea, styles.edgeBackGestureAreaLeft]}
              {...leftEdgeBackResponder.panHandlers}
            />
            <View
              collapsable={false}
              pointerEvents="box-only"
              style={[styles.edgeBackGestureArea, styles.edgeBackGestureAreaRight]}
              {...rightEdgeBackResponder.panHandlers}
            />

            {imageLoadStates[currentUri] === 'error' ? (
              <View pointerEvents="box-none" style={ds.imageErrorOverlay}>
                <Feather name="image" size={34} color={VIEWER_FG} />
                <Text pointerEvents="none" style={styles.imageErrorText}>{t('viewer_image_load_error')}</Text>
                <Pressable
                  onPress={handleManualImageRetry}
                  accessibilityRole="button"
                  accessibilityLabel={t('btn_retry')}
                  hitSlop={theme.spacing.sm}
                  style={({ pressed }) => [styles.imageRetryButton, pressed && styles.imageRetryButtonPressed]}
                >
                  <Feather name="refresh-cw" size={18} color={VIEWER_FG} />
                  <Text style={styles.imageRetryText}>{t('btn_retry')}</Text>
                </Pressable>
              </View>
            ) : null}

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
                          closeInfo();
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
      </ViewerContainer>

      {!capturePreviewMode ? (
        <BaseModal
          embedded={embedded}
          visible={Boolean(menuOpen || infoOpen)}
          presentation="sheet"
          onClose={() => {
            setMenuOpen(false);
            closeInfo();
          }}
          title={infoOpen ? t('viewer_info_title') : t('viewer_more')}
          maxHeightRatio={infoOpen ? 0.45 : 0.35}
        >
          {menuOpen ? (
            <>
              <Pressable
                onPress={handleSave}
                disabled={busy || deleting}
                style={({ pressed }) => [ds.menuRow, pressed && { opacity: 0.6 }]}
              >
                <Feather name="download" size={theme.icons.md} color={theme.colors.text} />
                <Text style={ds.menuRowLabel}>{t('viewer_save_to_device')}</Text>
              </Pressable>
              <ListSeparator />
              <Pressable
                onPress={handleShowInfo}
                style={({ pressed }) => [ds.menuRow, pressed && { opacity: 0.6 }]}
              >
                <Feather name="info" size={theme.icons.md} color={theme.colors.text} />
                <Text style={ds.menuRowLabel}>{t('viewer_info_title')}</Text>
              </Pressable>
            </>
          ) : null}
          {infoOpen ? (
            <>
              <SeparatedList>
                {infoRows.map((row, index) => (
                  <View key={index} style={ds.infoRow}>
                    <Text style={ds.infoLabel}>{row.label}</Text>
                    <Text style={ds.infoValue}>{row.value}</Text>
                  </View>
                ))}
              </SeparatedList>
              {infoOpen.loading ? (
                <ActivityIndicator style={ds.infoLoading} color={theme.colors.primary} />
              ) : null}
            </>
          ) : null}
        </BaseModal>
      ) : null}
      {!capturePreviewMode ? (
        <ConfirmModal
          visible={confirmDelete}
          title={t('order_photos_delete_single_title')}
          message={t('order_photos_delete_single_message')}
          cancelLabel={t('order_photos_delete_single_cancel')}
          confirmLabel={t('order_photos_delete_single_confirm')}
          confirmVariant="destructive"
          onClose={() => setConfirmDelete(false)}
          onConfirm={handleDeleteConfirm}
        />
      ) : null}
    </>
  );
});

function FullscreenImageViewer({
  visible,
  images,
  fallbackImages,
  imageMetadata,
  initialIndex = 0,
  onClose,
  onDelete,
  onRotateSave,
  onRetryImage,
  categoryLabel,
  capturePreviewMode = false,
  onDismiss,
  embedded = false,
}) {
  const [nativeLayerDismissed, setNativeLayerDismissed] = useState(!visible);
  const retainedPropsRef = useRef(null);
  if (visible && images?.length) {
    retainedPropsRef.current = {
      images,
      fallbackImages,
      imageMetadata,
      initialIndex,
      onClose,
      onDelete,
      onRotateSave,
      onRetryImage,
      categoryLabel,
      capturePreviewMode,
      onDismiss,
    };
  }

  useEffect(() => {
    if (visible) setNativeLayerDismissed(false);
  }, [visible]);

  const handleNativeDismiss = useCallback(() => {
    setNativeLayerDismissed(true);
  }, []);

  const retainedProps = retainedPropsRef.current;
  if (
    !retainedProps ||
    (!visible && !embedded && nativeLayerDismissed) ||
    (embedded && (!visible || !images?.length))
  ) return null;

  return (
    <ToastProvider>
      <ImageViewingGallery
        visible={visible}
        images={retainedProps.images}
        fallbackImages={retainedProps.fallbackImages}
        imageMetadata={retainedProps.imageMetadata}
        initialIndex={retainedProps.initialIndex}
        onClose={retainedProps.onClose}
        onDelete={retainedProps.onDelete}
        onRotateSave={retainedProps.onRotateSave}
        onRetryImage={retainedProps.onRetryImage}
        categoryLabel={retainedProps.categoryLabel}
        capturePreviewMode={retainedProps.capturePreviewMode}
        onDismiss={retainedProps.onDismiss}
        onNativeDismiss={handleNativeDismiss}
        embedded={embedded}
      />
    </ToastProvider>
  );
}

export default memo(FullscreenImageViewer);
