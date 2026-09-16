import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useTheme } from '../../theme';
import { getCachedSupabaseAccessToken } from '../../lib/supabaseSessionCache';
import { isProtectedMediaThumbnailUrl } from '../../src/shared/media/thumbnailUrl';
import CachedImage from '../ui/CachedImage';
import { BaseModal } from '../ui/modals';

export default function EntityPhotoPreview({
  imageUrl,
  previewUrl,
  title,
  fallback,
  emptyLabel,
  containerStyle,
  frameStyle,
  imageStyle,
  fallbackTextStyle,
  previewWrapStyle,
  previewImageStyle,
  previewEmptyStyle,
  accessibilityLabel,
  accessibilityHint,
  contentFit = 'cover',
  previewContentFit = 'contain',
  cachePolicy = 'memory-disk',
  disabled = false,
}) {
  const { theme } = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const previewSize = React.useMemo(() => {
    const outerPadding = Number(theme.spacing?.lg ?? 16) * 2;
    const innerPadding = Number(theme.spacing?.md ?? 12) * 2;
    const availableWidth = Math.max(1, windowWidth - outerPadding - innerPadding);
    const availableHeight = Math.max(1, windowHeight * 0.62);
    return Math.max(1, Math.min(640, availableWidth, availableHeight));
  }, [theme.spacing?.lg, theme.spacing?.md, windowHeight, windowWidth]);
  const [visible, setVisible] = React.useState(false);
  const [previewImageRef, setPreviewImageRef] = React.useState(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState(false);
  const previewImageRefRef = React.useRef(null);
  const previewRequestRef = React.useRef(0);
  const displayUrl = normalizeUrl(imageUrl);
  const fullUrl = normalizeUrl(previewUrl) || displayUrl;
  const hasImage = Boolean(displayUrl);
  const canReuseLoadedImage = Boolean(displayUrl && fullUrl && displayUrl === fullUrl);
  const canOpen =
    hasImage &&
    Boolean(fullUrl) &&
    !disabled &&
    (!canReuseLoadedImage || Boolean(previewImageRef));

  const replacePreviewImageRef = React.useCallback((nextImageRef) => {
    const previous = previewImageRefRef.current;
    previewImageRefRef.current = nextImageRef || null;
    setPreviewImageRef(nextImageRef || null);
    if (previous && previous !== nextImageRef) {
      try {
        previous.release?.();
      } catch {}
    }
  }, []);

  React.useEffect(() => {
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    replacePreviewImageRef(null);
    setPreviewLoading(canReuseLoadedImage);
    setPreviewError(false);

    if (!canReuseLoadedImage) return undefined;

    let cancelled = false;
    const loadSharedImage = async () => {
      try {
        const protectedSource = isProtectedMediaThumbnailUrl(fullUrl);
        let source = { uri: fullUrl };
        if (protectedSource) {
          const accessToken = await getCachedSupabaseAccessToken();
          if (!accessToken) throw new Error('Protected image session is unavailable');
          source = {
            uri: fullUrl,
            headers: { Authorization: `Bearer ${accessToken}` },
          };
        }

        const imageRef = await ExpoImage.loadAsync(source, {
          maxWidth: 2048,
          maxHeight: 2048,
        });
        if (cancelled || previewRequestRef.current !== requestId) {
          imageRef?.release?.();
          return;
        }
        replacePreviewImageRef(imageRef);
        setPreviewLoading(false);
      } catch {
        if (cancelled || previewRequestRef.current !== requestId) return;
        setPreviewLoading(false);
        setPreviewError(true);
      }
    };

    loadSharedImage();
    return () => {
      cancelled = true;
    };
  }, [canReuseLoadedImage, fullUrl, replacePreviewImageRef]);

  React.useEffect(
    () => () => {
      previewRequestRef.current += 1;
      const current = previewImageRefRef.current;
      previewImageRefRef.current = null;
      try {
        current?.release?.();
      } catch {}
    },
    [],
  );

  const open = React.useCallback(() => {
    if (!canOpen) return;
    setVisible(true);
  }, [canOpen]);

  const close = React.useCallback(() => {
    setVisible(false);
  }, []);

  return (
    <>
      <View style={containerStyle}>
        <Pressable
          style={({ pressed }) => [
            frameStyle || styles.frame,
            pressed && canOpen ? styles.pressed : null,
          ]}
          onPress={open}
          disabled={!canOpen}
          accessibilityRole={canOpen ? 'button' : undefined}
          accessibilityLabel={accessibilityLabel || title}
          accessibilityHint={canOpen ? accessibilityHint : undefined}
        >
          {canReuseLoadedImage && previewImageRef ? (
            <ExpoImage
              source={previewImageRef}
              style={imageStyle || styles.image}
              contentFit={contentFit}
              transition={180}
            />
          ) : canReuseLoadedImage && previewLoading ? (
            <ActivityIndicator size="small" color={theme.colors.primary} />
          ) : canReuseLoadedImage && previewError ? (
            <Text style={fallbackTextStyle || styles.fallbackText}>{fallback}</Text>
          ) : hasImage ? (
            <CachedImage
              uri={displayUrl}
              fallbackUri={fullUrl && fullUrl !== displayUrl ? fullUrl : undefined}
              style={imageStyle || styles.image}
              contentFit={contentFit}
              cachePolicy={cachePolicy}
              transition={180}
            />
          ) : (
            <Text style={fallbackTextStyle || styles.fallbackText}>{fallback}</Text>
          )}
        </Pressable>
      </View>

      <BaseModal
        visible={visible}
        onClose={close}
        title={title}
        maxHeightRatio={0.9}
        presentation="sheet"
        disableContentShrink
      >
        <View
          style={[
            previewWrapStyle || styles.previewWrap,
            { minHeight: previewSize },
          ]}
        >
          {canReuseLoadedImage && previewImageRef ? (
            <ExpoImage
              source={previewImageRef}
              style={
                previewImageStyle || [styles.previewImage, { width: previewSize, height: previewSize }]
              }
              contentFit={previewContentFit}
              transition={180}
            />
          ) : canReuseLoadedImage && previewLoading ? (
            <ActivityIndicator size="large" color={theme.colors.primary} />
          ) : canReuseLoadedImage && previewError ? (
            <Text style={previewEmptyStyle || styles.previewEmpty}>{emptyLabel}</Text>
          ) : fullUrl ? (
            <CachedImage
              uri={fullUrl}
              style={
                previewImageStyle || [styles.previewImage, { width: previewSize, height: previewSize }]
              }
              contentFit={previewContentFit}
              cachePolicy={cachePolicy}
              showLoadingIndicator
              priority="high"
              placeholder={null}
              recyclingKey={`${fullUrl}:preview`}
              transition={180}
            />
          ) : (
            <Text style={previewEmptyStyle || styles.previewEmpty}>{emptyLabel}</Text>
          )}
        </View>
      </BaseModal>
    </>
  );
}

function normalizeUrl(value) {
  const next = String(value || '').trim();
  return next.length ? next : '';
}

function createStyles(theme) {
  return StyleSheet.create({
    frame: {
      width: theme.components?.avatar?.xl ?? 96,
      height: theme.components?.avatar?.xl ?? 96,
      borderRadius: (theme.components?.avatar?.xl ?? 96) / 2,
      backgroundColor: theme.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    pressed: {
      opacity: 0.85,
      transform: [{ scale: 0.99 }],
    },
    image: {
      width: '100%',
      height: '100%',
    },
    fallbackText: {
      color: theme.colors.primary,
      fontSize: theme.typography.sizes.lg,
      fontWeight: theme.typography.weight.bold,
    },
    previewWrap: {
      width: '100%',
      alignSelf: 'stretch',
      alignItems: 'center',
      padding: theme.spacing.md,
    },
    previewImage: {
      borderRadius: theme.radii.lg,
    },
    previewEmpty: {
      color: theme.colors.textSecondary,
    },
  });
}
