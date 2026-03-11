// app/orders/components/FullscreenImageViewer.jsx
// Fullscreen photo gallery вЂ” react-native-awesome-gallery.
// Pinch-to-zoom, double-tap, swipe-to-dismiss.
// Footer toolbar: Share В· Rotate В· More В· Delete.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  StatusBar,
  Platform,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Gallery from 'react-native-awesome-gallery';
import Animated, {
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { File, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../../theme';
import { withAlpha } from '../../../theme/colors';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { BaseModal, ConfirmModal } from '../../../components/ui/modals';
import ToastProvider, { useToast } from '../../../components/ui/ToastProvider';

/* в”Ђв”Ђв”Ђв”Ђв”Ђ constants в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ */
const VIEWER_BG = '#000000';
const VIEWER_FG = '#FFFFFF';
const VIEWER_OVERLAY_ALPHA = 0.55;
const ANIM_FADE_IN = 200;
const ANIM_FADE_OUT = 150;
const DOUBLE_TAP_SCALE = 3;
const DOUBLE_TAP_INTERVAL = 300;
const MAX_ZOOM = 8;
const PRERENDER_COUNT = 3;
const ICON_BTN_SIZE = 40;

const haptic = (style = 'Light') =>
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle[style]).catch(() => {});

/* в”Ђв”Ђв”Ђв”Ђв”Ђ gallery item with rotation в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ */
const GalleryImage = memo(function GalleryImage({ item, setImageDimensions, rotation }) {
  return (
    <Image
      source={item}
      style={[
        StyleSheet.absoluteFillObject,
        rotation ? { transform: [{ rotate: `${rotation}deg` }] } : undefined,
      ]}
      contentFit="contain"
      cachePolicy="memory-disk"
      onLoad={(e) => {
        const { width, height } = e.source;
        if (width && height) setImageDimensions({ width, height });
      }}
    />
  );
});

/* в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ */
/*  VIEWER CONTENT (inside ToastProvider)                         */
/* в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ */
const ViewerContent = memo(function ViewerContent({
  images,
  initialIndex,
  onClose,
  onDelete,
  onRotateSave,
  categoryLabel,
  exposeClose,
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const galleryRef = useRef(null);

  const overlayBg = useMemo(
    () => withAlpha(VIEWER_BG, VIEWER_OVERLAY_ALPHA),
    [],
  );

  /* в”Ђв”Ђ dynamic styles в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ */
  const ds = useMemo(() => {
    const { spacing, radii, typography, icons, colors } = theme;
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

  /* в”Ђв”Ђ internal copies в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ */
  const [localImages, setLocalImages] = useState([]);
  const [localIndex, setLocalIndex] = useState(0);
  const [galleryKey, setGalleryKey] = useState(0);

  /* в”Ђв”Ђ ui state в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ */
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  /* в”Ђв”Ђ rotation per image в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ */
  const [rotations, setRotations] = useState({});
  const rotationsRef = useRef({});

  /* в”Ђв”Ђ image dimensions cache в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ */
  const dimsRef = useRef({});

  /* reset on open */
  useEffect(() => {
    if (images?.length) {
      setLocalImages([...images]);
      setLocalIndex(Math.max(0, Math.min(initialIndex, images.length - 1)));
      setGalleryKey((k) => k + 1);
      setToolbarVisible(true);
      setMenuOpen(false);
      setInfoOpen(false);
      setConfirmDelete(false);
      setBusy(false);
      setRotations({});
      rotationsRef.current = {};
      dimsRef.current = {};
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    rotationsRef.current = rotations;
  }, [rotations]);

  const imageCount = localImages.length;

  /* в”Ђв”Ђ helpers в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ */
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

  /* в”Ђв”Ђ close with rotation save в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ */
  const handleClose = useCallback(() => {
    const active = rotationsRef.current;
    const nonZero = Object.fromEntries(
      Object.entries(active).filter(([, deg]) => deg !== 0),
    );
    if (Object.keys(nonZero).length > 0 && onRotateSave) {
      onRotateSave(nonZero);
    }
    onClose?.();
  }, [onClose, onRotateSave]);

  // Expose handleClose to the outer Modal's onRequestClose
  useEffect(() => {
    if (exposeClose) exposeClose.current = handleClose;
  }, [exposeClose, handleClose]);

  /* в”Ђв”Ђ gallery callbacks в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ */
  const handleIndexChange = useCallback((idx) => {
    setLocalIndex(idx);
    setMenuOpen(false);
    setInfoOpen(false);
  }, []);

  const handleTap = useCallback(() => {
    if (menuOpen || infoOpen) {
      setMenuOpen(false);
      setInfoOpen(false);
      return;
    }
    setToolbarVisible((v) => !v);
  }, [menuOpen, infoOpen]);

  const handleSwipeToClose = useCallback(() => handleClose(), [handleClose]);

  const renderItem = useCallback(
    ({ item, setImageDimensions, index }) => {
      const wrappedSet = (dims) => {
        dimsRef.current[index] = dims;
        setImageDimensions(dims);
      };
      return (
        <GalleryImage
          item={item}
          setImageDimensions={wrappedSet}
          rotation={rotations[index] || 0}
        />
      );
    },
    [rotations],
  );

  /* в”Ђв”Ђ rotate в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ */
  const handleRotate = useCallback(() => {
    haptic();
    setRotations((prev) => ({
      ...prev,
      [localIndex]: ((prev[localIndex] || 0) + 90) % 360,
    }));
  }, [localIndex]);

  /* в”Ђв”Ђ share в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ */
  const handleShare = useCallback(async () => {
    if (busy || !localImages[localIndex]) return;
    haptic();
    setBusy(true);
    try {
      if (!(await Sharing.isAvailableAsync())) return;
      const localUri = await downloadToCache(localImages[localIndex]);
      await Sharing.shareAsync(localUri);
    } catch (e) {
      console.warn('[Viewer] share:', e);
    } finally {
      setBusy(false);
    }
  }, [busy, localIndex, localImages, downloadToCache]);

  /* в”Ђв”Ђ save to device в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ */
  const handleSave = useCallback(async () => {
    if (busy || !localImages[localIndex]) return;
    haptic();
    setMenuOpen(false);
    setBusy(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync(true);
      if (status !== 'granted') {
        toast.error(t('viewer_permission_denied', 'РќРµС‚ РґРѕСЃС‚СѓРїР° Рє РіР°Р»РµСЂРµРµ'));
        return;
      }
      const localUri = await downloadToCache(localImages[localIndex]);
      await MediaLibrary.saveToLibraryAsync(localUri);
      haptic('Medium');
      toast.success(t('viewer_saved', 'РЎРѕС…СЂР°РЅРµРЅРѕ вњ“'));
    } catch (e) {
      console.warn('[Viewer] save:', e);
      toast.error(t('viewer_save_error', 'РћС€РёР±РєР° СЃРѕС…СЂР°РЅРµРЅРёСЏ'));
    } finally {
      setBusy(false);
    }
  }, [busy, localIndex, localImages, downloadToCache, toast, t]);

  /* в”Ђв”Ђ info в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ */
  const handleShowInfo = useCallback(async () => {
    haptic();
    setMenuOpen(false);
    const uri = localImages[localIndex];
    if (!uri) return;

    const dims = dimsRef.current[localIndex];
    let fileSize = null;
    try {
      const localUri = await downloadToCache(uri);
      const f = new File(localUri);
      fileSize = f.size || null;
    } catch {}

    setInfoOpen({
      resolution: dims ? `${dims.width} Г— ${dims.height}` : null,
      size: formatBytes(fileSize),
    });
  }, [localIndex, localImages, downloadToCache, formatBytes]);

  /* в”Ђв”Ђ delete в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ */
  const handleDeletePress = useCallback(() => {
    haptic('Medium');
    setMenuOpen(false);
    setInfoOpen(false);
    setConfirmDelete(true);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    const idx = localIndex;
    onDelete?.(idx);

    const remaining = localImages.filter((_, i) => i !== idx);
    if (!remaining.length) {
      onClose?.();
      return;
    }
    const newRotations = {};
    Object.keys(rotations).forEach((k) => {
      const ki = Number(k);
      if (ki < idx) newRotations[ki] = rotations[ki];
      else if (ki > idx) newRotations[ki - 1] = rotations[ki];
    });
    setRotations(newRotations);
    setLocalImages(remaining);
    setLocalIndex(Math.min(idx, remaining.length - 1));
    setGalleryKey((k) => k + 1);
  }, [localIndex, localImages, onDelete, onClose, rotations]);

  const handleDeleteCancel = useCallback(() => setConfirmDelete(false), []);

  /* в”Ђв”Ђ menu в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ */
  const toggleMenu = useCallback(() => {
    haptic();
    setInfoOpen(false);
    setMenuOpen((v) => !v);
  }, []);

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closeInfo = useCallback(() => setInfoOpen(false), []);

  /* в”Ђв”Ђ info rows в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ */
  const infoRows = useMemo(() => {
    if (!infoOpen) return [];
    return [
      infoOpen.resolution && {
        label: t('viewer_info_resolution', 'Р Р°Р·СЂРµС€РµРЅРёРµ'),
        value: infoOpen.resolution,
      },
      infoOpen.size && {
        label: t('viewer_info_size', 'Р Р°Р·РјРµСЂ'),
        value: infoOpen.size,
      },
    ].filter(Boolean);
  }, [infoOpen, t]);

  /* в”Ђв”Ђ render в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ */
  if (!imageCount) return null;

  const counterLabel = categoryLabel
    ? `${categoryLabel} В· ${localIndex + 1}/${imageCount}`
    : `${localIndex + 1} / ${imageCount}`;

  return (
    <View style={ds.root}>
      <StatusBar hidden animated />

      {/* в”Ђв”Ђ Gallery в”Ђв”Ђ */}
      <Gallery
        key={galleryKey}
        ref={galleryRef}
        data={localImages}
        keyExtractor={(item, i) => `${item}_${i}`}
        initialIndex={localIndex}
        onIndexChange={handleIndexChange}
        onTap={handleTap}
        onSwipeToClose={handleSwipeToClose}
        renderItem={renderItem}
        doubleTapScale={DOUBLE_TAP_SCALE}
        doubleTapInterval={DOUBLE_TAP_INTERVAL}
        maxScale={MAX_ZOOM}
        pinchEnabled
        disableTransitionOnScaledImage
        numToRender={PRERENDER_COUNT}
        emptySpaceWidth={theme.spacing.lg}
        style={ds.gallery}
      />

      {/* в”Ђв”Ђ Header в”Ђв”Ђ */}
      {toolbarVisible && (
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
      )}

      {/* в”Ђв”Ђ Footer в”Ђв”Ђ */}
      {toolbarVisible && (
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
            <Text style={ds.footerLabel}>
              {t('viewer_share', 'РџРѕРґРµР»РёС‚СЊСЃСЏ')}
            </Text>
          </Pressable>

          <Pressable
            onPress={handleRotate}
            hitSlop={theme.spacing.sm}
            style={[ds.footerBtn, { backgroundColor: overlayBg }]}
          >
            <Feather name="rotate-cw" size={theme.icons.sm} color={VIEWER_FG} />
            <Text style={ds.footerLabel}>
              {t('viewer_rotate', 'РџРѕРІРµСЂРЅСѓС‚СЊ')}
            </Text>
          </Pressable>

          <Pressable
            onPress={toggleMenu}
            hitSlop={theme.spacing.sm}
            style={[ds.footerBtn, { backgroundColor: overlayBg }]}
          >
            <Feather name="more-horizontal" size={theme.icons.sm} color={VIEWER_FG} />
            <Text style={ds.footerLabel}>
              {t('viewer_more', 'Р•С‰С‘')}
            </Text>
          </Pressable>

          {onDelete && (
            <Pressable
              onPress={handleDeletePress}
              hitSlop={theme.spacing.sm}
              style={[ds.footerBtn, { backgroundColor: overlayBg }]}
            >
              <Feather name="trash-2" size={theme.icons.sm} color={theme.colors.danger} />
              <Text style={[ds.footerLabel, { color: theme.colors.danger }]}>
                {t('viewer_delete', 'РЈРґР°Р»РёС‚СЊ')}
              </Text>
            </Pressable>
          )}
        </Animated.View>
      )}

      {/* в”Ђв”Ђ Action Menu (BaseModal) в”Ђв”Ђ */}
      <BaseModal
        visible={menuOpen}
        onClose={closeMenu}
        title={t('viewer_more', 'Р•С‰С‘')}
        maxHeightRatio={0.35}
      >
        <Pressable
          onPress={handleSave}
          style={({ pressed }) => [
            ds.menuRow,
            ds.menuRowBorder,
            pressed && { opacity: 0.6 },
          ]}
        >
          <Feather name="download" size={theme.icons.md} color={theme.colors.text} />
          <Text style={ds.menuRowLabel}>
            {t('viewer_save_to_device', 'РЎРѕС…СЂР°РЅРёС‚СЊ РЅР° СѓСЃС‚СЂРѕР№СЃС‚РІРѕ')}
          </Text>
        </Pressable>
        <Pressable
          onPress={handleShowInfo}
          style={({ pressed }) => [
            ds.menuRow,
            pressed && { opacity: 0.6 },
          ]}
        >
          <Feather name="info" size={theme.icons.md} color={theme.colors.text} />
          <Text style={ds.menuRowLabel}>
            {t('viewer_info_title', 'РРЅС„РѕСЂРјР°С†РёСЏ Рѕ С„РѕС‚Рѕ')}
          </Text>
        </Pressable>
      </BaseModal>

      {/* в”Ђв”Ђ Photo Info (BaseModal) в”Ђв”Ђ */}
      <BaseModal
        visible={!!infoOpen}
        onClose={closeInfo}
        title={t('viewer_info_title', 'РРЅС„РѕСЂРјР°С†РёСЏ Рѕ С„РѕС‚Рѕ')}
        maxHeightRatio={0.3}
      >
        {infoRows.map((r, i) => (
          <View key={i} style={ds.infoRow}>
            <Text style={ds.infoLabel}>{r.label}</Text>
            <Text style={ds.infoValue}>{r.value}</Text>
          </View>
        ))}
      </BaseModal>

      {/* в”Ђв”Ђ Delete Confirmation в”Ђв”Ђ */}
      <ConfirmModal
        visible={confirmDelete}
        title={t('order_photos_delete_single_title')}
        message={t('order_photos_delete_single_message')}
        confirmLabel={t('order_photos_delete_single_confirm')}
        confirmVariant="danger"
        cancelLabel={t('order_photos_delete_single_cancel')}
        onConfirm={handleDeleteConfirm}
        onClose={handleDeleteCancel}
      />
    </View>
  );
});

/* в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ */
/*  OUTER WRAPPER (Modal + ToastProvider)                         */
/* в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ */
function FullscreenImageViewer({
  visible,
  images,
  initialIndex = 0,
  onClose,
  onDelete,
  onRotateSave,
  categoryLabel,
}) {
  // handleClose ref enables onRequestClose to go through ViewerContent's close logic
  const handleCloseRef = useRef(onClose);
  handleCloseRef.current = onClose;

  if (!visible || !images?.length) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => handleCloseRef.current?.()}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ToastProvider>
          <ViewerContent
            images={images}
            initialIndex={initialIndex}
            onClose={onClose}
            onDelete={onDelete}
            onRotateSave={onRotateSave}
            categoryLabel={categoryLabel}
            exposeClose={handleCloseRef}
          />
        </ToastProvider>
      </GestureHandlerRootView>
    </Modal>
  );
}

export default memo(FullscreenImageViewer);
