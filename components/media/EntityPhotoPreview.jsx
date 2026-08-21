import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';
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
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const [visible, setVisible] = React.useState(false);
  const displayUrl = normalizeUrl(imageUrl);
  const fullUrl = normalizeUrl(previewUrl) || displayUrl;
  const hasImage = Boolean(displayUrl);
  const canOpen = hasImage && Boolean(fullUrl) && !disabled;

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
          {hasImage ? (
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
      >
        <View style={previewWrapStyle || styles.previewWrap}>
          {fullUrl ? (
            <CachedImage
              uri={fullUrl}
              style={previewImageStyle || styles.previewImage}
              contentFit={previewContentFit}
              cachePolicy={cachePolicy}
              showLoadingIndicator
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
      alignItems: 'center',
      padding: theme.spacing.md,
    },
    previewImage: {
      width: '100%',
      height: undefined,
      aspectRatio: 1,
      borderRadius: theme.radii.lg,
    },
    previewEmpty: {
      color: theme.colors.textSecondary,
    },
  });
}
